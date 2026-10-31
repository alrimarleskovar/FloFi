// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001 — MOCKED, LOOPBACK/IN-PROCESS ONLY: a stand-in for the Turnkey activities FloFi uses, shared by the
 * browser harness (e2e/account-harness.ts) and the PostgreSQL integration tests. Never a public provider, never a real identity or key.
 *
 * It behaves like the provider where FloFi's security depends on it:
 * - every request's `X-Stamp` is verified (ECDSA P-256 over the exact body); the parent key and per-organization session keys are
 *   authorized separately; a session key is valid only until its expiry and `invalidateExisting` ends the organization's other sessions;
 * - encrypted OTP (INIT_OTP_V3 / VERIFY_OTP_V2): a per-code HPKE target signed by the emulator's OTP key (DER over sha256 of the data),
 *   real HPKE decryption with `@turnkey/crypto`, ES256 verification tokens bound to the browser's public key;
 * - OTP_LOGIN_V2 and CREATE_SUB_ORGANIZATION_V8 require the bound key's raw P-256 client signature over the exact SDK message;
 * - OAUTH_LOGIN requires nonce = sha256(session public key);
 * - wallets have DISPOSABLE in-memory keys (secp256k1 for EVM, Ed25519 for Solana) created on demand and never written anywhere, so
 *   SIGN_TRANSACTION_V2 (EIP-1559) and SIGN_RAW_PAYLOAD_V2 return real signatures the app verifies like any other.
 * Export bundles and the import/export frames stay MOCKED: no secret is ever produced or shown.
 */
import { createECDH, createHash, createPrivateKey, createPublicKey, ECDH, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { generateP256KeyPair, hpkeDecrypt } from '@turnkey/crypto';
import { base58Encode, erc7710, rlpDecode } from '@defi-workflow-engine/reference-compiler';
import { secp256k1 } from '../../../packages/reference-reconciler/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../packages/reference-reconciler/node_modules/@noble/hashes/sha3.js';

export const E2E_SIGN_IN_CODE = '246810';
export const E2E_WALLET_CODE = 'FLOFI246';
type Json = Record<string, unknown>;
type Account = { readonly walletId: string; readonly address: string; readonly format: string; readonly evm?: Uint8Array; readonly solana?: KeyObject };
type Org = { readonly id: string; readonly user: string; readonly email: string | null; readonly oidc: string | null;
  sessions: Map<string, number>; wallets: { walletId: string; accounts: Account[] }[]; keys: { privateKeyId: string; accounts: Account[] }[] };
export type TurnkeyEmulatorOptions = { readonly parentPublicKey: string; readonly parentOrg: string; readonly otpSignerPrivateKey: string };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const payloadOf = (token: string): Record<string, string> => { try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()); } catch { return {}; } };
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

function p256Key(compressed: string) {
  const point = Buffer.from(ECDH.convertKey(compressed, 'prime256v1', 'hex', 'hex', 'uncompressed') as string, 'hex');
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
}
/** The public key that stamped `body` (verified), or null. */
export function stampKey(header: string | undefined, body: string): string | null {
  try {
    const stamp = JSON.parse(Buffer.from(header ?? '', 'base64url').toString()) as { publicKey: string; scheme: string; signature: string };
    if (stamp.scheme !== 'SIGNATURE_SCHEME_TK_API_P256' || !/^0[23][0-9a-f]{64}$/.test(stamp.publicKey)) return null;
    return verify('sha256', Buffer.from(body), p256Key(stamp.publicKey), Buffer.from(stamp.signature, 'hex')) ? stamp.publicKey : null;
  } catch { return null; }
}
function rawP256Valid(compressed: string, message: string, signature: string): boolean {
  try { return verify('sha256', Buffer.from(message), { key: p256Key(compressed), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'hex')); } catch { return false; }
}

export function createTurnkeyEmulator(options: TurnkeyEmulatorOptions) {
  const parentKey = options.parentPublicKey.toLowerCase(), parentOrg = options.parentOrg;
  const signer = (() => {
    const d = Buffer.from(options.otpSignerPrivateKey, 'hex'), ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey();
    const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: d.toString('base64url'), x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    return { key, publicHex: pub.toString('hex') };
  })();
  const orgs = new Map<string, Org>(), otps = new Map<string, { email: string; targetPrivate: string; code: string }>();
  const id = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex')}`;
  const completed = (type: string, organizationId: string, result: object) => ({ activity: { id: id('activity'), organizationId, status: 'ACTIVITY_STATUS_COMPLETED', type, result } });
  const failed = (type: string, organizationId: string) => ({ activity: { id: id('activity'), organizationId, status: 'ACTIVITY_STATUS_FAILED', type, result: {} } });
  function token(claims: Record<string, string>): string {
    const input = `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}`;
    return `${input}.${sign('sha256', Buffer.from(input), { key: signer.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  function verifiedClaims(value: string): Record<string, string> | null {
    const [header, payload, signature] = value.split('.');
    if (!header || !payload || !signature) return null;
    const ok = verify('sha256', Buffer.from(`${header}.${payload}`), { key: createPublicKey(signer.key), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    const claims = payloadOf(value);
    return ok && Number(claims.exp) > Date.now() ? claims : null;
  }
  function session(org: Org, key: string, seconds: number, invalidate: boolean) {
    if (invalidate) org.sessions.clear();
    const exp = Math.floor(Date.now() / 1000) + seconds;
    org.sessions.set(key, exp);
    return `${b64({ alg: 'none' })}.${b64({ organization_id: org.id, user_id: org.user, public_key: key, exp })}.mock`;
  }
  function account(format: string, seed?: Buffer): Account {
    const walletId = id('wallet');
    if (format === 'ADDRESS_FORMAT_ETHEREUM') {
      let secret = seed ? createHash('sha256').update(seed).digest() : randomBytes(32);
      while (!secp256k1.utils.isValidSecretKey(secret)) secret = createHash('sha256').update(secret).digest();
      const address = '0x' + hex(keccak_256(secp256k1.getPublicKey(secret, false).subarray(1)).subarray(12));
      return { walletId, address, format, evm: secret };
    }
    const pair = seed ? (() => { const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), createHash('sha256').update(seed).digest()]);
      const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }); return { privateKey, publicKey: createPublicKey(privateKey) }; })()
      : generateKeyPairSync('ed25519');
    const raw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    return { walletId, address: base58Encode(raw), format, solana: pair.privateKey };
  }
  const accountsOf = (org: Org) => [...org.wallets.flatMap(wallet => wallet.accounts), ...org.keys.flatMap(key => key.accounts)];

  function handle(path: string, body: Json, stamp: string | null): [number, unknown] {
    const parameters = (body.parameters ?? {}) as Json, organizationId = String(body.organizationId ?? ''), type = String(body.type ?? '');
    const parent = stamp === parentKey, org = orgs.get(organizationId);
    const expiry = org && stamp ? org.sessions.get(stamp) : undefined;
    const member = !!org && expiry !== undefined && expiry > Math.floor(Date.now() / 1000);
    if (!stamp) return [401, { message: 'invalid stamp' }];
    switch (path) {
      case 'submit/init_otp': {
        if (!parent || organizationId !== parentOrg || type !== 'ACTIVITY_TYPE_INIT_OTP_V3') return [403, {}];
        const otpId = id('otp'), target = generateP256KeyPair();
        const code = parameters.otpLength === 8 && parameters.alphanumeric === true ? E2E_WALLET_CODE : E2E_SIGN_IN_CODE;
        otps.set(otpId, { email: String(parameters.contact), targetPrivate: target.privateKey, code });
        const data = Buffer.from(JSON.stringify({ targetPublic: target.publicKeyUncompressed })).toString('hex');
        const dataSignature = sign('sha256', Buffer.from(data, 'hex'), signer.key).toString('hex');
        return [200, completed(type, organizationId, { initOtpResultV2: { otpId, otpEncryptionTargetBundle: JSON.stringify({ enclaveQuorumPublic: signer.publicHex, dataSignature, data }) } })];
      }
      case 'submit/verify_otp': {
        if (!parent || type !== 'ACTIVITY_TYPE_VERIFY_OTP_V2') return [403, {}];
        const otp = otps.get(String(parameters.otpId));
        let opened: { otp_code?: string; public_key?: string } = {};
        try {
          const bundle = JSON.parse(String(parameters.encryptedOtpBundle)) as { encappedPublic: string; ciphertext: string };
          opened = JSON.parse(Buffer.from(hpkeDecrypt({ ciphertextBuf: Buffer.from(bundle.ciphertext, 'hex'), encappedKeyBuf: Buffer.from(bundle.encappedPublic, 'hex'),
            receiverPriv: otp?.targetPrivate ?? '' })).toString()) as typeof opened;
        } catch { return [200, failed(type, organizationId)]; }
        if (!otp || opened.otp_code !== otp.code || !/^0[23][0-9a-f]{64}$/.test(opened.public_key ?? '')) return [200, failed(type, organizationId)];
        otps.delete(String(parameters.otpId));
        return [200, completed(type, organizationId, { verifyOtpResult: { verificationToken: token({ id: randomUUIDLike(), verification_type: 'OTP_TYPE_EMAIL', contact: otp.email,
          organization_id: parentOrg, public_key: opened.public_key!, exp: String(Date.now() + 600_000) }) } })];
      }
      case 'query/list_verified_suborgs': case 'query/list_suborgs': {
        if (!parent) return [403, {}];
        const value = String(body.filterValue ?? ''), oidc = body.filterType === 'OIDC_TOKEN' ? `${payloadOf(value).iss}|${payloadOf(value).sub}` : null;
        return [200, { organizationIds: [...orgs.values()].filter(o => oidc ? o.oidc === oidc : o.email === value).map(o => o.id) }];
      }
      case 'query/list_users': return parent || member ? [200, { users: org ? [{ userId: org.user, userName: 'FloFi user' }] : [] }] : [403, {}];
      case 'submit/create_sub_organization': {
        if (!parent || type !== 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8') return [403, {}];
        const root = ((parameters.rootUsers as Json[] | undefined) ?? [])[0] ?? {};
        const oauth = ((root.oauthProviders as { oidcToken: string }[] | undefined) ?? [])[0];
        if ((root.apiKeys as unknown[] | undefined)?.length || (root.authenticators as unknown[] | undefined)?.length) return [400, { message: 'no API keys or authenticators expected' }];
        if (typeof parameters.verificationToken === 'string') {
          const claims = verifiedClaims(parameters.verificationToken), signature = parameters.clientSignature as Record<string, string> | undefined;
          const message = claims && JSON.stringify({ signupV2: { apiKeys: [], authenticators: [], oauthProviders: [], email: root.userEmail }, tokenId: claims.id, type: 'USAGE_TYPE_SIGNUP' });
          if (!claims || claims.contact !== root.userEmail || !signature || signature.message !== message || signature.publicKey !== claims.public_key
            || signature.scheme !== 'CLIENT_SIGNATURE_SCHEME_API_P256' || !rawP256Valid(claims.public_key!, message!, signature.signature ?? '')) return [200, failed(type, organizationId)];
        } else if (!oauth) return [400, { message: 'a root user needs a credential' }];
        const created: Org = { id: id('org'), user: id('user'), email: typeof root.userEmail === 'string' ? root.userEmail : null,
          oidc: oauth ? `${payloadOf(oauth.oidcToken).iss}|${payloadOf(oauth.oidcToken).sub}` : null, sessions: new Map(), wallets: [], keys: [] };
        orgs.set(created.id, created);
        return [200, completed(type, organizationId, { createSubOrganizationResultV8: { subOrganizationId: created.id, rootUserIds: [created.user] } })];
      }
      case 'submit/otp_login': {
        const claims = verifiedClaims(String(parameters.verificationToken)), signature = parameters.clientSignature as Record<string, string> | undefined;
        const key = String(parameters.publicKey), message = claims && JSON.stringify({ login: { publicKey: key }, tokenId: claims.id, type: 'USAGE_TYPE_LOGIN' });
        if (!parent || type !== 'ACTIVITY_TYPE_OTP_LOGIN_V2' || !org || !claims || claims.public_key !== key || claims.contact !== org.email || !signature
          || signature.message !== message || signature.publicKey !== key || !rawP256Valid(key, message!, signature.signature ?? '')) return [200, failed(type, organizationId)];
        return [200, completed(type, organizationId, { otpLoginResult: { session: session(org, key, Number(parameters.expirationSeconds ?? 900), parameters.invalidateExisting === true) } })];
      }
      case 'submit/oauth_login': {
        const claims = payloadOf(String(parameters.oidcToken)), key = String(parameters.publicKey);
        if (!parent || !org || org.oidc !== `${claims.iss}|${claims.sub}` || claims.nonce !== createHash('sha256').update(key).digest('hex')) return [200, failed(type, organizationId)];
        return [200, completed(type, organizationId, { oauthLoginResult: { session: session(org, key, Number(parameters.expirationSeconds ?? 900), parameters.invalidateExisting === true) } })];
      }
      case 'submit/create_wallet': {
        if (!member) return [403, {}];
        const accounts = ((parameters.accounts as { addressFormat: string }[] | undefined) ?? []).map(entry => account(entry.addressFormat));
        const walletId = id('wallet');
        org!.wallets.push({ walletId, accounts: accounts.map(entry => ({ ...entry, walletId })) });
        return [200, completed(type, organizationId, { createWalletResult: { walletId, addresses: accounts.map(entry => entry.address) } })];
      }
      case 'submit/init_import_private_key': return member && parameters.userId === org!.user ? [200, completed(type, organizationId, { initImportPrivateKeyResult: { importBundle: `mock-import-bundle-${randomBytes(8).toString('hex')}` } })] : [403, {}];
      case 'submit/import_private_key': {
        if (!member || typeof parameters.encryptedBundle !== 'string' || !parameters.encryptedBundle.startsWith('mock-encrypted:')) return [200, failed(type, organizationId)];
        const privateKeyId = id('key'), format = ((parameters.addressFormats as string[] | undefined) ?? [])[0] ?? '';
        const imported = account(format, Buffer.from(parameters.encryptedBundle));
        org!.keys.push({ privateKeyId, accounts: [imported] });
        return [200, completed(type, organizationId, { importPrivateKeyResult: { privateKeyId, addresses: [{ format, address: imported.address }] } })];
      }
      case 'submit/export_wallet': case 'submit/export_wallet_account': case 'submit/export_private_key': {
        if (!member || typeof parameters.targetPublicKey !== 'string') return [403, {}];
        const result = path.endsWith('export_wallet') ? 'exportWalletResult' : path.endsWith('account') ? 'exportWalletAccountResult' : 'exportPrivateKeyResult';
        return [200, completed(type, organizationId, { [result]: { exportBundle: `mock-export-bundle:${path.split('/')[1]}` } })];
      }
      case 'submit/sign_transaction': {
        if (!member || type !== 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' || parameters.type !== 'TRANSACTION_TYPE_ETHEREUM') return [403, {}];
        const signer = accountsOf(org!).find(entry => entry.evm && entry.address === String(parameters.signWith).toLowerCase());
        const raw = Buffer.from(String(parameters.unsignedTransaction).replace(/^0x/, ''), 'hex');
        if (!signer || raw[0] !== 2) return [200, failed(type, organizationId)];
        const fields = rlpDecode(raw.subarray(1)) as Uint8Array[];
        const int = (value: Uint8Array) => BigInt('0x' + (hex(value) || '0'));
        const tx = { chainId: int(fields[0]!), nonce: int(fields[1]!), maxPriorityFeePerGas: int(fields[2]!), maxFeePerGas: int(fields[3]!), gasLimit: int(fields[4]!),
          to: '0x' + hex(fields[5]!), value: int(fields[6]!), data: '0x' + hex(fields[7]!) };
        const signature = secp256k1.Signature.fromBytes(secp256k1.sign(Buffer.from(erc7710.eip1559SigningHash(tx).slice(2), 'hex'), signer.evm!, { prehash: false, format: 'recovered' }), 'recovered');
        const signed = erc7710.signedEip1559(tx, (signature.recovery ?? 0) as 0 | 1, signature.r, signature.s);
        return [200, completed(type, organizationId, { signTransactionResult: { signedTransaction: signed.raw.slice(2) } })];
      }
      case 'submit/sign_raw_payload': {
        if (!member || type !== 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2' || parameters.encoding !== 'PAYLOAD_ENCODING_HEXADECIMAL') return [403, {}];
        const signer = accountsOf(org!).find(entry => entry.address === String(parameters.signWith) || entry.address === String(parameters.signWith).toLowerCase());
        const payload = Buffer.from(String(parameters.payload).replace(/^0x/, ''), 'hex');
        if (signer?.evm && parameters.hashFunction === 'HASH_FUNCTION_KECCAK256') {
          const signature = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(payload), signer.evm, { prehash: false, format: 'recovered' }), 'recovered');
          return [200, completed(type, organizationId, { signRawPayloadResult: { r: signature.r.toString(16).padStart(64, '0'), s: signature.s.toString(16).padStart(64, '0'),
            v: (signature.recovery ?? 0).toString(16).padStart(2, '0') } })];
        }
        if (signer?.solana && parameters.hashFunction === 'HASH_FUNCTION_NOT_APPLICABLE') {
          const signature = sign(null, payload, signer.solana);
          return [200, completed(type, organizationId, { signRawPayloadResult: { r: hex(signature.subarray(0, 32)), s: hex(signature.subarray(32)), v: '00' } })];
        }
        return [200, failed(type, organizationId)];
      }
      case 'query/list_wallet_accounts': return parent || member ? [200, { accounts: (org?.wallets ?? []).flatMap(wallet => wallet.accounts.map(entry =>
        ({ walletId: wallet.walletId, address: entry.address, addressFormat: entry.format }))) }] : [403, {}];
      case 'query/list_wallets': return parent || member ? [200, { wallets: (org?.wallets ?? []).map(wallet => ({ walletId: wallet.walletId, walletName: 'w', imported: false, exported: false })) }] : [403, {}];
      case 'query/list_private_keys': return parent || member ? [200, { privateKeys: (org?.keys ?? []).map(key => ({ privateKeyId: key.privateKeyId, imported: true, exported: false,
        addresses: key.accounts.map(entry => ({ format: entry.format, address: entry.address })) })) }] : [403, {}];
      default: return [404, { message: `unsupported ${path}` }];
    }
  }
  return {
    otpSignerPublicKey: signer.publicHex, orgs,
    /** One provider request: the path after `/public/v1/`, the exact body and its `X-Stamp` header. */
    request(path: string, raw: string, stampHeader: string | undefined): [number, unknown] {
      let body: Json;
      try { body = JSON.parse(raw) as Json; } catch { return [400, { message: 'invalid JSON' }]; }
      return handle(path, body, stampKey(stampHeader, raw));
    },
    /** An in-process `fetch` for FloFi's server client (tests): `https://…/public/v1/<path>` → the emulator. */
    transport: (async (url: string, init: RequestInit) => {
      const match = /\/public\/v1\/((?:submit|query)\/[a-z_]+)$/.exec(new URL(url).pathname);
      const [status, value] = match ? handle(match[1]!, JSON.parse(String(init.body)) as Json, stampKey((init.headers as Record<string, string>)['X-Stamp'], String(init.body)))
        : [404, {}] as [number, unknown];
      return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  };
}
const randomUUIDLike = () => { const b = randomBytes(16).toString('hex'); return `${b.slice(0, 8)}-${b.slice(8, 12)}-4${b.slice(13, 16)}-8${b.slice(17, 20)}-${b.slice(20, 32)}`; };
