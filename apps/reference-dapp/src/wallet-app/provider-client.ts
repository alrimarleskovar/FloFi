// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's browser side of the embedded-wallet provider (Turnkey). Wallet origin only.
 *
 * - Key: `@turnkey/indexed-db-stamper` keeps a non-extractable WebCrypto P-256 key in the wallet origin's IndexedDB. FloFi's product
 *   origin cannot read this storage. Unlocking binds a 15-minute provider session to this key's public half; requests are stamped with it.
 * - Every request goes to the wallet origin's own relay (`/api/wallet/provider/*`), which checks session, key, organization, activity and
 *   signer before forwarding the exact bytes. Nothing here broadcasts a transaction.
 * - Import and export use the provider's own iframes; the key or phrase is typed or shown only there.
 */
import type { WalletEcosystem } from '../wallet/wallet-registry';
import { parseSigningBinding, signingHeader, type SigningBinding } from './protocol';

type Json = Record<string, unknown>;
export type TurnkeyFrames = { readonly exportIframeUrl: string; readonly importIframeUrl: string };
const fail = (code: string): never => { throw new Error(code); };
const RESOURCE = /^[A-Za-z0-9-]{8,64}$/, CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

type Stamper = { init(): Promise<void>; getPublicKey(): string | null; stamp(payload: string): Promise<{ stampHeaderName: string; stampHeaderValue: string }>;
  sign(payload: string, format?: string): Promise<string>; clear(): Promise<void>; resetKeyPair?(): Promise<void> };
let stamper: Promise<Stamper> | null = null;
async function sessionStamper(): Promise<Stamper> {
  stamper ??= (async () => {
    const { IndexedDbStamper } = await import('@turnkey/indexed-db-stamper');
    const instance = new IndexedDbStamper() as unknown as Stamper;
    await instance.init();
    return instance;
  })().catch(error => { stamper = null; throw error; });
  return stamper;
}
/** This wallet origin's key (compressed P-256, hex). Created on first use; its private half never leaves WebCrypto. */
export async function walletPublicKey(): Promise<string> {
  const key = (await sessionStamper()).getPublicKey();
  return typeof key === 'string' && /^0[23][0-9a-f]{64}$/.test(key) ? key : fail('MANAGED_SESSION_KEY_UNAVAILABLE');
}
/** A raw P-256 signature (r‖s, hex) over `message` with the wallet key: Turnkey's client signature for login or sign-up. */
export async function clientSignatureOver(message: string): Promise<string> {
  const signature = await (await sessionStamper()).sign(message, 'raw');
  return /^[0-9a-f]{128}$/.test(signature) ? signature : fail('MANAGED_SESSION_KEY_UNAVAILABLE');
}
/** Forgets the wallet key (lock / sign-out). A new key is created on the next unlock; the old provider session can no longer be stamped. */
export async function forgetWalletKey(): Promise<void> {
  try { await (await sessionStamper()).clear(); } catch { /* nothing stored */ } finally { stamper = null; }
}

async function request(path: string, body: Json, message?: string, extraHeaders: Readonly<Record<string, string>> = {}): Promise<Json> {
  const raw = JSON.stringify(body), stamp = await (await sessionStamper()).stamp(raw);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extraHeaders, [stamp.stampHeaderName]: stamp.stampHeaderValue };
  if (message !== undefined) headers['x-flofi-message'] = btoa(String.fromCharCode(...new TextEncoder().encode(message))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const response = await fetch(`/api/wallet/provider/${path}`, { method: 'POST', credentials: 'same-origin', referrerPolicy: 'no-referrer', headers, body: raw })
    .catch(() => fail('MANAGED_PROVIDER_UNAVAILABLE'));
  const value = await response.json().catch(() => null) as Json | null;
  if (!response.ok) fail(value && typeof value.code === 'string' && CODE.test(value.code) ? value.code : response.status === 401 || response.status === 403 ? 'WALLET_UNLOCK_REQUIRED' : 'MANAGED_PROVIDER_REQUEST_FAILED');
  return value ?? fail('MANAGED_PROVIDER_REQUEST_FAILED');
}
type ActivityOptions = { readonly headers?: Readonly<Record<string, string>>; readonly onSubmitted?: () => void };
async function activity(path: string, type: string, organizationId: string, parameters: Json, message?: string, options: ActivityOptions = {}): Promise<Json> {
  let current = (await request(`submit/${path}`, { type, timestampMs: String(Date.now()), organizationId, parameters }, message, options.headers)).activity as Json | undefined;
  // From here on the provider has the activity: a later failure cannot prove that nothing was signed.
  options.onSubmitted?.();
  for (let attempt = 0; current && (current.status === 'ACTIVITY_STATUS_CREATED' || current.status === 'ACTIVITY_STATUS_PENDING') && attempt < 8; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250 * 2 ** Math.min(attempt, 3)));
    current = (await request('query/get_activity', { organizationId, activityId: current.id })).activity as Json | undefined;
  }
  if (!current || current.status !== 'ACTIVITY_STATUS_COMPLETED') fail('MANAGED_ACTIVITY_NOT_COMPLETED');
  const result = (current!.result ?? {}) as Json, prefix = path.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) + 'Result';
  const key = Object.keys(result).find(name => name.startsWith(prefix));
  return key && result[key] && typeof result[key] === 'object' ? result[key] as Json : fail('MANAGED_RESPONSE_INVALID');
}

const ACCOUNT_PARAMS: Readonly<Record<WalletEcosystem, Json>> = Object.freeze({
  evm: { curve: 'CURVE_SECP256K1', pathFormat: 'PATH_FORMAT_BIP32', path: "m/44'/60'/0'/0/0", addressFormat: 'ADDRESS_FORMAT_ETHEREUM' },
  solana: { curve: 'CURVE_ED25519', pathFormat: 'PATH_FORMAT_BIP32', path: "m/44'/501'/0'/0'", addressFormat: 'ADDRESS_FORMAT_SOLANA' },
});
/** A new HD wallet with one account, generated by the provider in its enclave. Returns its public address only. */
export async function createWallet(organizationId: string, ecosystem: WalletEcosystem): Promise<string> {
  const result = await activity('create_wallet', 'ACTIVITY_TYPE_CREATE_WALLET', organizationId,
    { walletName: `FloFi ${ecosystem === 'evm' ? 'EVM' : 'Solana'} wallet ${new Date().toISOString().slice(0, 10)}`, accounts: [ACCOUNT_PARAMS[ecosystem]], mnemonicLength: 12 });
  const address = Array.isArray(result.addresses) && typeof result.addresses[0] === 'string' ? result.addresses[0] : fail('MANAGED_RESPONSE_INVALID');
  if (typeof result.walletId !== 'string' || !RESOURCE.test(result.walletId)) fail('MANAGED_RESPONSE_INVALID');
  return address as string;
}

type Frame = { init(): Promise<string>; clear(): void; injectImportBundle(bundle: string, organizationId: string, userId: string): Promise<boolean>;
  extractKeyEncryptedBundle(format?: string): Promise<string>; injectKeyExportBundle(bundle: string, organizationId: string, format?: string, address?: string): Promise<boolean>;
  injectWalletExportBundle(bundle: string, organizationId: string): Promise<boolean>; applySettings(settings: Json): Promise<boolean> };
async function frame(url: string, container: HTMLElement, id: string): Promise<Frame> {
  const { IframeStamper } = await import('@turnkey/iframe-stamper');
  return new IframeStamper({ iframeUrl: url, iframeContainer: container, iframeElementId: id }) as unknown as Frame;
}
const FRAME_STYLE = { styles: { padding: '12px', borderRadius: '12px', fontSize: '14px', fontFamily: 'IBM Plex Mono, monospace', width: '100%', height: '120px',
  overflowWrap: 'anywhere', resize: 'none' } };

/** The provider's import frame in `container`; `submit` imports the ciphertext the frame produced. The key is typed only in the frame. */
export async function openImportFrame(frames: TurnkeyFrames, organizationId: string, userId: string, ecosystem: WalletEcosystem, container: HTMLElement) {
  const instance = await frame(frames.importIframeUrl, container, `flofi-import-${ecosystem}`);
  try {
    await instance.init();
    const init = await activity('init_import_private_key', 'ACTIVITY_TYPE_INIT_IMPORT_PRIVATE_KEY', organizationId, { userId });
    if (typeof init.importBundle !== 'string' || !await instance.injectImportBundle(init.importBundle, organizationId, userId)) fail('MANAGED_IMPORT_UNAVAILABLE');
    await instance.applySettings(FRAME_STYLE).catch(() => false);
  } catch (error) { instance.clear(); throw error; }
  return {
    async submit(): Promise<string> {
      const encryptedBundle = await instance.extractKeyEncryptedBundle(ecosystem === 'evm' ? 'HEXADECIMAL' : 'SOLANA').catch(() => fail('MANAGED_IMPORT_KEY_INVALID'));
      const result = await activity('import_private_key', 'ACTIVITY_TYPE_IMPORT_PRIVATE_KEY', organizationId, { userId,
        privateKeyName: `FloFi imported ${ecosystem === 'evm' ? 'EVM' : 'Solana'} key ${Date.now()}`, encryptedBundle,
        curve: ecosystem === 'evm' ? 'CURVE_SECP256K1' : 'CURVE_ED25519', addressFormats: [ecosystem === 'evm' ? 'ADDRESS_FORMAT_ETHEREUM' : 'ADDRESS_FORMAT_SOLANA'] });
      const addresses = Array.isArray(result.addresses) ? result.addresses as Json[] : [];
      const address = addresses.find(entry => typeof entry?.address === 'string')?.address;
      if (typeof result.privateKeyId !== 'string' || !RESOURCE.test(result.privateKeyId)) fail('MANAGED_RESPONSE_INVALID');
      return typeof address === 'string' ? address : fail('MANAGED_RESPONSE_INVALID');
    },
    close: () => instance.clear(),
  };
}

export type ExportGrant = { readonly organizationId: string; readonly source: 'wallet' | 'wallet-account' | 'private-key'; readonly resource: string;
  readonly address: string; readonly keyFormat: 'HEXADECIMAL' | 'SOLANA' };
/** The provider's export frame in `container`: the provider encrypts the phrase or key to the frame's own key, and only the frame shows it. */
export async function openExportFrame(frames: TurnkeyFrames, grant: ExportGrant, container: HTMLElement): Promise<{ close(): void }> {
  const instance = await frame(frames.exportIframeUrl, container, `flofi-export-${grant.source}`);
  try {
    const targetPublicKey = await instance.init();
    const parameters = grant.source === 'wallet' ? { walletId: grant.resource, targetPublicKey } : grant.source === 'wallet-account'
      ? { address: grant.resource, targetPublicKey } : { privateKeyId: grant.resource, targetPublicKey };
    const path = grant.source === 'wallet' ? 'export_wallet' : grant.source === 'wallet-account' ? 'export_wallet_account' : 'export_private_key';
    const type = grant.source === 'wallet' ? 'ACTIVITY_TYPE_EXPORT_WALLET' : grant.source === 'wallet-account' ? 'ACTIVITY_TYPE_EXPORT_WALLET_ACCOUNT' : 'ACTIVITY_TYPE_EXPORT_PRIVATE_KEY';
    const bundle = (await activity(path, type, grant.organizationId, parameters)).exportBundle;
    if (typeof bundle !== 'string') fail('MANAGED_EXPORT_UNAVAILABLE');
    const shown = grant.source === 'wallet' ? await instance.injectWalletExportBundle(bundle as string, grant.organizationId)
      : await instance.injectKeyExportBundle(bundle as string, grant.organizationId, grant.keyFormat, grant.address);
    if (!shown) fail('MANAGED_EXPORT_UNAVAILABLE');
    await instance.applySettings(FRAME_STYLE).catch(() => false);
  } catch (error) { instance.clear(); throw error instanceof Error && CODE.test(error.message) ? error : new Error('MANAGED_EXPORT_UNAVAILABLE'); }
  return { close: () => instance.clear() };
}

/** Signs an unsigned transaction (hex, no 0x) with a managed wallet: EIP-1559 for EVM, a wire transaction for Solana. Returns signed hex. */
export async function signTransaction(organizationId: string, signWith: string, ecosystem: WalletEcosystem, unsignedHex: string): Promise<string> {
  const result = await activity('sign_transaction', 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2', organizationId,
    { signWith, unsignedTransaction: unsignedHex, type: ecosystem === 'evm' ? 'TRANSACTION_TYPE_ETHEREUM' : 'TRANSACTION_TYPE_SOLANA' });
  const signed = typeof result.signedTransaction === 'string' ? result.signedTransaction.replace(/^0x/i, '').toLowerCase() : '';
  return /^[0-9a-f]+$/.test(signed) && signed.length % 2 === 0 ? signed : fail('MANAGED_RESPONSE_INVALID');
}
/**
 * Signs a sign-in message. EVM: the EIP-191 personal-message bytes, hashed by the provider with keccak256; returns r‖s‖v (65 bytes, hex).
 * Solana: the UTF-8 message (Ed25519); returns r‖s (64 bytes, hex). The relay accepts only sign-in messages naming this wallet.
 */
export async function signMessage(organizationId: string, signWith: string, ecosystem: WalletEcosystem, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const payload = ecosystem === 'evm' ? [...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`), ...bytes] : [...bytes];
  const result = await activity('sign_raw_payload', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', organizationId, { signWith,
    payload: payload.map(byte => byte.toString(16).padStart(2, '0')).join(''), encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
    hashFunction: ecosystem === 'evm' ? 'HASH_FUNCTION_KECCAK256' : 'HASH_FUNCTION_NOT_APPLICABLE' }, message);
  const r = typeof result.r === 'string' ? result.r.toLowerCase().padStart(64, '0') : '', s = typeof result.s === 'string' ? result.s.toLowerCase().padStart(64, '0') : '';
  if (!/^[0-9a-f]{64}$/.test(r) || !/^[0-9a-f]{64}$/.test(s)) fail('MANAGED_RESPONSE_INVALID');
  if (ecosystem === 'solana') return r + s;
  const v = typeof result.v === 'string' ? parseInt(result.v, 16) : NaN;
  if (v !== 0 && v !== 1) fail('MANAGED_RESPONSE_INVALID');
  return r + s + (27 + v).toString(16);
}

/**
 * A signing request that did not complete. `submitted` is false only when FloFi's own relay (or this page) refused it before it reached
 * the provider, so no signature can exist; otherwise the outcome is unknown (spec decision 5) and the caller must say so, never "rejected".
 */
export class WalletSigningError extends Error {
  constructor(code: string, readonly submitted: boolean) { super(code); this.name = 'WalletSigningError'; }
}
/** Codes the wallet relay (`src/accounts/wallet-relay.ts`, `api/wallet/provider`) returns before forwarding anything to the provider. */
const RELAY_REFUSALS: ReadonlySet<string> = new Set(['WALLET_SESSION_REQUIRED', 'WALLET_UNLOCK_REQUIRED', 'WALLET_CROSS_ORIGIN', 'MANAGED_WALLETS_NOT_CONFIGURED',
  'MANAGED_ORGANIZATION_MISSING', 'PROVIDER_ROUTE_NOT_ALLOWED', 'PROVIDER_STAMP_REQUIRED', 'PROVIDER_REQUEST_TOO_LARGE', 'PROVIDER_REQUEST_INVALID',
  'PROVIDER_REQUEST_NOT_CANONICAL', 'PROVIDER_ORGANIZATION_MISMATCH', 'PROVIDER_ACTIVITY_MISMATCH', 'SIGNER_NOT_MANAGED', 'SIGN_REQUEST_INVALID',
  'ACCOUNTS_UNAVAILABLE', 'FLOFI_WALLET_NO_MATCHING_REVIEW', 'FLOFI_WALLET_FLOW_NOT_SUPPORTED',
  // The relay's attempt gate (app/flofi-wallet-signing.ts), also before forwarding.
  'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED', 'FLOFI_WALLET_ALREADY_SIGNED', 'FLOFI_WALLET_REVIEW_EXPIRED', 'FLOFI_WALLET_REVIEW_UNAVAILABLE',
  'FLOFI_WALLET_NONCE_MISMATCH', 'FLOFI_WALLET_FEE_TOO_HIGH', 'FLOFI_WALLET_NETWORK_READ_FAILED']);
async function signingActivity(path: string, type: string, organizationId: string, parameters: Json, message: string | undefined, signing: SigningBinding | null): Promise<Json> {
  let submitted = false;
  try {
    return await activity(path, type, organizationId, parameters, message, { headers: signing ? { 'x-flofi-signing': signingHeader(signing) } : {}, onSubmitted: () => { submitted = true; } });
  } catch (error) {
    const code = error instanceof Error && CODE.test(error.message) ? error.message : 'MANAGED_ACTIVITY_NOT_COMPLETED';
    // A network failure on the submit itself may have reached the provider: only a known relay refusal proves nothing was signed.
    throw new WalletSigningError(code, submitted || !RELAY_REFUSALS.has(code));
  }
}
const SOLANA_SIGNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, EVM_SIGNER = /^0x[0-9a-f]{40}$/;
const refuse = (code: string): never => { throw new WalletSigningError(code, false); };

/**
 * Signs an unsigned EIP-1559 transaction (`02‖rlp(…)`, hex without 0x) that the person confirmed in FloFi Wallet, bound to its FloFi attempt
 * (`x-flofi-signing`). Returns the provider's signed transaction hex (no 0x); the caller checks it is the same transaction before using it.
 */
export async function signEvmTransaction(organizationId: string, signWith: string, unsignedHex: string, signing: SigningBinding): Promise<string> {
  if (!EVM_SIGNER.test(signWith) || !/^02(?:[0-9a-f]{2})+$/.test(unsignedHex) || unsignedHex.length > 262_144 || !parseSigningBinding(signing)) refuse('SIGN_REQUEST_INVALID');
  const result = await signingActivity('sign_transaction', 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2', organizationId,
    { signWith, unsignedTransaction: unsignedHex, type: 'TRANSACTION_TYPE_ETHEREUM' }, undefined, signing);
  const signed = typeof result.signedTransaction === 'string' ? result.signedTransaction.replace(/^0x/i, '').toLowerCase() : '';
  if (!/^[0-9a-f]+$/.test(signed) || signed.length % 2 !== 0) throw new WalletSigningError('MANAGED_RESPONSE_INVALID', true);
  return signed;
}
/**
 * Signs the exact Solana v0 message of a transaction the person confirmed (raw payload, hex, no hashing: Ed25519 signs the bytes), bound
 * to its FloFi attempt. Returns the 64-byte signature r‖s as hex; the caller inserts it into the fee payer's slot.
 */
export async function signSolanaMessage(organizationId: string, signWith: string, messageHex: string, signing: SigningBinding): Promise<string> {
  if (!SOLANA_SIGNER.test(signWith) || !/^80(?:[0-9a-f]{2})+$/.test(messageHex) || messageHex.length > 2_464 || !parseSigningBinding(signing)) refuse('SIGN_REQUEST_INVALID');
  const result = await signingActivity('sign_raw_payload', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', organizationId,
    { signWith, payload: messageHex, encoding: 'PAYLOAD_ENCODING_HEXADECIMAL', hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE' }, undefined, signing);
  const r = typeof result.r === 'string' ? result.r.toLowerCase().padStart(64, '0') : '', s = typeof result.s === 'string' ? result.s.toLowerCase().padStart(64, '0') : '';
  if (!/^[0-9a-f]{64}$/.test(r) || !/^[0-9a-f]{64}$/.test(s)) throw new WalletSigningError('MANAGED_RESPONSE_INVALID', true);
  return r + s;
}
/**
 * `signMessage` for a FloFi sign-in message, with the same honest failure classification as the transaction signers: EVM returns
 * r‖s‖v (65 bytes, hex), Solana r‖s (64 bytes, hex).
 */
export async function signSignInMessage(organizationId: string, signWith: string, ecosystem: WalletEcosystem, message: string): Promise<string> {
  if (!(ecosystem === 'evm' ? EVM_SIGNER : SOLANA_SIGNER).test(signWith) || !message || message.length > 4_096) refuse('SIGN_REQUEST_INVALID');
  const bytes = new TextEncoder().encode(message);
  const payload = ecosystem === 'evm' ? [...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`), ...bytes] : [...bytes];
  const result = await signingActivity('sign_raw_payload', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', organizationId, { signWith,
    payload: payload.map(byte => byte.toString(16).padStart(2, '0')).join(''), encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
    hashFunction: ecosystem === 'evm' ? 'HASH_FUNCTION_KECCAK256' : 'HASH_FUNCTION_NOT_APPLICABLE' }, message, null);
  const r = typeof result.r === 'string' ? result.r.toLowerCase().padStart(64, '0') : '', s = typeof result.s === 'string' ? result.s.toLowerCase().padStart(64, '0') : '';
  if (!/^[0-9a-f]{64}$/.test(r) || !/^[0-9a-f]{64}$/.test(s)) throw new WalletSigningError('MANAGED_RESPONSE_INVALID', true);
  if (ecosystem === 'solana') return r + s;
  const v = typeof result.v === 'string' ? parseInt(result.v, 16) : NaN;
  if (v !== 0 && v !== 1) throw new WalletSigningError('MANAGED_RESPONSE_INVALID', true);
  return r + s + (27 + v).toString(16);
}
