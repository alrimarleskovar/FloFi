// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi's server-side Turnkey client (embedded-wallet provider, non-custodial).
 *
 * FloFi holds a parent-organization API key (a deployment secret, never a user key). With it the server can only: send and
 * verify email one-time codes, create a person's sub-organization, start a sign-in for that person's browser session key, and
 * read public wallet metadata to verify ownership before saving it. Each person's sub-organization has that person as its only
 * root user, authenticated by their email or OIDC identity; FloFi's parent key is not a member and cannot sign with its wallets.
 * Login activities bind the new provider session to the browser's own public key (the OIDC nonce or the OTP verification), so
 * the server cannot open a signing session for itself.
 *
 * Requests are stamped exactly as Turnkey's own Node stamper does (`@turnkey/api-key-stamper/nodecrypto`): ECDSA P-256 over
 * SHA-256 of the exact body, DER-encoded, in an `X-Stamp` header. Activity request and result shapes follow the published
 * `@turnkey/http` 6.7.0 types; they are unverified against the live API in this build (see the build record).
 */
import { createECDH, createSign } from 'node:crypto';
import { isHostedDeployment } from '../server/deployment.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Json = Record<string, unknown>;
export type TurnkeyServerConfig = { readonly organizationId: string; readonly apiPublicKey: string; readonly apiPrivateKey: string;
  readonly apiBaseUrl: string; readonly exportIframeUrl: string; readonly importIframeUrl: string;
  /**
   * The key that signs OTP encryption targets and verification tokens. Null means Turnkey's production key, pinned inside
   * `@turnkey/crypto`; only the MOCKED loopback browser suite may name its own (never on a hosted deployment).
   */
  readonly otpSignerPublicKey: string | null };
/** What the browser needs to talk to the provider. Contains no secret. */
export type TurnkeyBrowserConfig = { readonly apiBaseUrl: string; readonly exportIframeUrl: string; readonly importIframeUrl: string;
  readonly otpSignerPublicKey: string | null };
/** An email one-time code sent by the provider: FloFi keeps the id; the browser encrypts the code to the enclave's signed target. */
export type EmailOtpChallenge = { readonly otpId: string; readonly targetBundle: string };
/** The claims of a provider OTP verification token after its ES256 signature was verified. */
export type VerificationClaims = { readonly id: string; readonly contact: string; readonly publicKey: string; readonly organizationId: string;
  readonly expiresAtMs: number };
/** Proof that the holder of the key bound in a verification token approves one use of it (Turnkey's client signature). */
export type ClientSignature = { readonly publicKey: string; readonly scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256'; readonly message: string;
  readonly signature: string };
export type VerifyOtpToken = (token: string, signerPublicKey: string | null) => Promise<Record<string, unknown>>;
export type ManagedAccount = { readonly walletId: string; readonly address: string; readonly format: 'ADDRESS_FORMAT_ETHEREUM' | 'ADDRESS_FORMAT_SOLANA' };
export type ManagedKey = { readonly privateKeyId: string; readonly imported: boolean; readonly addresses: readonly { readonly format: string; readonly address: string }[] };
export type ManagedWallet = { readonly walletId: string; readonly imported: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, RESOURCE = /^[A-Za-z0-9-]{8,64}$/;
const COMPRESSED = /^0[23][0-9a-f]{64}$/, SCALAR = /^[0-9a-f]{64}$/, UNCOMPRESSED = /^04[0-9a-f]{128}$/;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, RAW_SIGNATURE = /^[0-9a-f]{128}$/;
const fail = (code: string): never => { throw new Error(code); };
/**
 * Lifetime of a FloFi Wallet provider session: the key lives only on the wallet origin (wallet-origin.ts) and every request goes through
 * its relay, so it matches the 30-minute wallet session; an expired one asks the person to unlock again (email code or Google/Apple).
 */
export const MANAGED_SESSION_SECONDS = 1800;

function providerUrl(raw: string | undefined, fallback: string, e2e: boolean): string {
  const value = raw || fallback;
  let url: URL;
  try { url = new URL(value); } catch { return fail('TURNKEY_CONFIG_INVALID'); }
  if (url.origin !== value.replace(/\/$/, '') || url.username || url.password) fail('TURNKEY_CONFIG_INVALID');
  // Provider hosts only (https, *.turnkey.com); the deterministic browser suite may use its loopback harness on a local server.
  const official = url.protocol === 'https:' && (url.hostname === 'turnkey.com' || url.hostname.endsWith('.turnkey.com'));
  const loopback = e2e && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  return official || loopback ? url.origin : fail('TURNKEY_CONFIG_INVALID');
}
/** The provider configuration, or null when this deployment has none (managed wallets and email sign-in say so; nothing is simulated). */
export function turnkeyConfig(env: Env): TurnkeyServerConfig | null {
  const organizationId = env.FLOFI_TURNKEY_ORGANIZATION_ID ?? '', apiPublicKey = (env.FLOFI_TURNKEY_API_PUBLIC_KEY ?? '').toLowerCase();
  const apiPrivateKey = (env.FLOFI_TURNKEY_API_PRIVATE_KEY ?? '').toLowerCase();
  if (!organizationId && !apiPublicKey && !apiPrivateKey) return null;
  const e2e = env.FLOFI_TURNKEY_E2E === 'MOCKED_LOOPBACK_ONLY';
  if ((env.FLOFI_TURNKEY_E2E && !e2e) || (e2e && isHostedDeployment(env))) return null;
  if (!UUID.test(organizationId) || !COMPRESSED.test(apiPublicKey) || !SCALAR.test(apiPrivateKey)) return null;
  // Production always verifies against the key pinned in @turnkey/crypto; an override exists only for the loopback harness.
  const signer = (env.FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY ?? '').toLowerCase();
  if (signer && (!e2e || !UNCOMPRESSED.test(signer))) return null;
  try {
    return { organizationId, apiPublicKey, apiPrivateKey,
      apiBaseUrl: providerUrl(env.FLOFI_TURNKEY_API_BASE_URL, 'https://api.turnkey.com', e2e),
      exportIframeUrl: providerUrl(env.FLOFI_TURNKEY_EXPORT_IFRAME_URL, 'https://export.turnkey.com', e2e),
      importIframeUrl: providerUrl(env.FLOFI_TURNKEY_IMPORT_IFRAME_URL, 'https://import.turnkey.com', e2e),
      otpSignerPublicKey: signer || null };
  } catch { return null; }
}

/**
 * The exact client-signature messages the provider verifies, byte for byte as Turnkey's own SDK builds them
 * (`@turnkey/core` 2.13 `getClientSignatureMessageForLogin` / `ForSignup`, key order included). The holder of the key bound in the
 * verification token signs them; FloFi's server only relays the signature and can neither produce nor reuse one.
 */
export function loginSignatureMessage(tokenId: string, publicKey: string): string {
  if (!RESOURCE.test(tokenId) || !COMPRESSED.test(publicKey)) fail('TURNKEY_SIGNATURE_MESSAGE_INVALID');
  return JSON.stringify({ login: { publicKey }, tokenId, type: 'USAGE_TYPE_LOGIN' });
}
export function emailSignupSignatureMessage(tokenId: string, email: string): string {
  if (!RESOURCE.test(tokenId) || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) fail('TURNKEY_SIGNATURE_MESSAGE_INVALID');
  return JSON.stringify({ signupV2: { apiKeys: [], authenticators: [], oauthProviders: [], email }, tokenId, type: 'USAGE_TYPE_SIGNUP' });
}
/** A client signature over `message` by `publicKey`, as received from the browser (raw r||s, 64 bytes hex). Shape only. */
export function clientSignature(publicKey: unknown, message: string, signature: unknown): ClientSignature {
  if (typeof publicKey !== 'string' || !COMPRESSED.test(publicKey) || typeof signature !== 'string' || !RAW_SIGNATURE.test(signature)) fail('TURNKEY_CLIENT_SIGNATURE_INVALID');
  return { publicKey: publicKey as string, scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256', message, signature: signature as string };
}
/** The provider's signed OTP encryption target, checked for shape (the browser verifies the enclave signature before using it). */
function targetBundle(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8_192) return fail('TURNKEY_RESPONSE_INVALID');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail('TURNKEY_RESPONSE_INVALID'); }
  const bundle = parsed && typeof parsed === 'object' ? parsed as Json : {};
  return typeof bundle.data === 'string' && /^[0-9a-f]+$/i.test(bundle.data) && typeof bundle.dataSignature === 'string' && /^[0-9a-f]+$/i.test(bundle.dataSignature)
    && typeof bundle.enclaveQuorumPublic === 'string' && /^[0-9a-f]+$/i.test(bundle.enclaveQuorumPublic) ? value : fail('TURNKEY_RESPONSE_INVALID');
}
/** `@turnkey/crypto`'s ES256 verification of an OTP verification token (pinned production key unless the harness names its own). */
export const verifyOtpTokenWithProviderKey: VerifyOtpToken = async (token, signerPublicKey) => {
  const { verifyOtpVerificationToken } = await import('@turnkey/crypto');
  return await verifyOtpVerificationToken(token, signerPublicKey ?? undefined) as unknown as Record<string, unknown>;
};

/** The `X-Stamp` header value for a request body, signed with the parent API key. */
export function apiKeyStamp(config: Pick<TurnkeyServerConfig, 'apiPublicKey' | 'apiPrivateKey'>, body: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(config.apiPrivateKey, 'hex'));
  // The configured public key must be this private key's: a mismatched pair fails closed instead of sending unverifiable stamps.
  if (ecdh.getPublicKey('hex', 'compressed') !== config.apiPublicKey) fail('TURNKEY_API_KEY_MISMATCH');
  const point = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', d: Buffer.from(config.apiPrivateKey, 'hex').toString('base64url'),
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33, 65).toString('base64url') };
  const signer = createSign('SHA256');
  signer.update(body);
  const signature = signer.sign({ key: jwk, format: 'jwk' }, 'hex');
  return Buffer.from(JSON.stringify({ publicKey: config.apiPublicKey, scheme: 'SIGNATURE_SCHEME_TK_API_P256', signature })).toString('base64url');
}

/** The single `*Result[Vn]` object of a completed activity whose name starts with `prefix`. */
function resultOf(activity: Json, prefix: string): Json {
  const result = activity.result && typeof activity.result === 'object' ? activity.result as Json : {};
  const key = Object.keys(result).find(name => name.startsWith(prefix) && result[name] && typeof result[name] === 'object');
  return key ? result[key] as Json : fail('TURNKEY_RESPONSE_INVALID');
}
const text = (value: unknown, pattern: RegExp, code = 'TURNKEY_RESPONSE_INVALID') => typeof value === 'string' && pattern.test(value) ? value : fail(code);

export function createTurnkeyServer(config: TurnkeyServerConfig, transport: typeof fetch = fetch, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  verifyToken: VerifyOtpToken = verifyOtpTokenWithProviderKey) {
  async function post(path: string, body: Json): Promise<Json> {
    const raw = JSON.stringify(body);
    const response = await transport(`${config.apiBaseUrl}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Stamp': apiKeyStamp(config, raw) }, body: raw })
      .catch(() => fail('TURNKEY_UNAVAILABLE'));
    const value = await response.json().catch(() => null) as Json | null;
    if (!response.ok || !value || typeof value !== 'object') fail(response.status === 401 || response.status === 403 ? 'TURNKEY_UNAUTHORIZED' : 'TURNKEY_REQUEST_FAILED');
    return value!;
  }
  /** Submits an activity and waits (bounded) for completion. Consensus, rejection or failure never reads as success. */
  async function activity(path: string, type: string, organizationId: string, parameters: Json): Promise<Json> {
    let current = (await post(`/public/v1/submit/${path}`, { type, timestampMs: String(Date.now()), organizationId, parameters })).activity as Json | undefined;
    for (let attempt = 0; current && (current.status === 'ACTIVITY_STATUS_CREATED' || current.status === 'ACTIVITY_STATUS_PENDING') && attempt < 8; attempt++) {
      await sleep(250 * 2 ** Math.min(attempt, 3));
      current = (await post('/public/v1/query/get_activity', { organizationId, activityId: text(current.id, RESOURCE) })).activity as Json | undefined;
    }
    if (!current || current.status !== 'ACTIVITY_STATUS_COMPLETED') fail('TURNKEY_ACTIVITY_NOT_COMPLETED');
    return current!;
  }
  return {
    browser: (): TurnkeyBrowserConfig => ({ apiBaseUrl: config.apiBaseUrl, exportIframeUrl: config.exportIframeUrl, importIframeUrl: config.importIframeUrl,
      otpSignerPublicKey: config.otpSignerPublicKey }),
    /**
     * Sends a one-time code (Turnkey delivers the email) with the encrypted-OTP activity. Returns the provider's OTP id and the
     * enclave-signed encryption target the browser encrypts the code to; FloFi's server never sees the code.
     */
    async initEmailOtp(email: string, purpose: 'sign-in' | 'wallet-unlock' = 'sign-in'): Promise<EmailOtpChallenge> {
      // A FloFi Wallet unlock code looks different from a sign-in code (its own app name, 8 letters and digits), so a page on the product
      // origin asking for one is recognisably not FloFi Wallet. It is typed only on the wallet origin.
      const shape = purpose === 'wallet-unlock' ? { appName: 'FloFi Wallet', otpLength: 8, alphanumeric: true } : { appName: 'FloFi', otpLength: 6, alphanumeric: false };
      const done = await activity('init_otp', 'ACTIVITY_TYPE_INIT_OTP_V3', config.organizationId,
        { otpType: 'OTP_TYPE_EMAIL', contact: email, ...shape, expirationSeconds: '600' });
      const result = resultOf(done, 'initOtpResult');
      return { otpId: text(result.otpId, RESOURCE), targetBundle: targetBundle(result.otpEncryptionTargetBundle) };
    },
    /**
     * Verifies the code the browser encrypted to the enclave together with the browser's own public key. The verification token is
     * bound to that key: using it to sign up or log in needs that key's client signature.
     */
    async verifyEmailOtp(otpId: string, encryptedOtpBundle: string): Promise<string> {
      if (!RESOURCE.test(otpId) || encryptedOtpBundle.length > 4_096) fail('EMAIL_CODE_INVALID');
      const done = await activity('verify_otp', 'ACTIVITY_TYPE_VERIFY_OTP_V2', config.organizationId, { otpId, encryptedOtpBundle, expirationSeconds: '600' });
      return text(resultOf(done, 'verifyOtpResult').verificationToken, TOKEN);
    },
    /**
     * The verified claims of a verification token, required to be for exactly this email and this browser key and unexpired.
     * FloFi signs a person in by email only after this check, not on the activity status alone.
     */
    async verificationClaims(token: string, expected: { readonly contact: string; readonly publicKey: string }, now = Date.now()): Promise<VerificationClaims> {
      let claims: Record<string, unknown>;
      try { claims = await verifyToken(token, config.otpSignerPublicKey); } catch { return fail('EMAIL_VERIFICATION_INVALID'); }
      const exp = Number(claims.exp);
      if (typeof claims.id !== 'string' || !RESOURCE.test(claims.id) || typeof claims.contact !== 'string' || typeof claims.public_key !== 'string'
        || typeof claims.organization_id !== 'string' || !Number.isFinite(exp) || exp <= now) fail('EMAIL_VERIFICATION_INVALID');
      if ((claims.contact as string).toLowerCase() !== expected.contact.toLowerCase() || (claims.public_key as string).toLowerCase() !== expected.publicKey) fail('EMAIL_VERIFICATION_MISMATCH');
      return { id: claims.id as string, contact: claims.contact as string, publicKey: claims.public_key as string, organizationId: claims.organization_id as string, expiresAtMs: exp };
    },
    /** The person's existing sub-organization for this verified email or OIDC token, if the provider has one. */
    async findOrganization(filter: { readonly email: string } | { readonly oidcToken: string }): Promise<{ organization: string; user: string } | null> {
      const query = 'email' in filter ? { path: 'list_verified_suborgs', filterType: 'EMAIL', filterValue: filter.email }
        : { path: 'list_suborgs', filterType: 'OIDC_TOKEN', filterValue: filter.oidcToken };
      const found = await post(`/public/v1/query/${query.path}`, { organizationId: config.organizationId, filterType: query.filterType, filterValue: query.filterValue });
      const ids = Array.isArray(found.organizationIds) ? found.organizationIds.filter((id): id is string => typeof id === 'string' && RESOURCE.test(id)) : [];
      if (ids.length > 1) fail('TURNKEY_ORGANIZATION_AMBIGUOUS');
      if (!ids.length) return null;
      const users = (await post('/public/v1/query/list_users', { organizationId: ids[0] })).users;
      const roots = Array.isArray(users) ? users.filter((user): user is Json => !!user && typeof user === 'object' && typeof (user as Json).userId === 'string') : [];
      if (roots.length !== 1) fail('TURNKEY_ORGANIZATION_AMBIGUOUS');
      return { organization: ids[0]!, user: text(roots[0]!.userId, RESOURCE) };
    },
    /**
     * Creates the person's sub-organization: one root user (them), quorum 1, no FloFi key, no wallet yet. An email root user needs the
     * verification token and the client signature of the key bound in it (`emailSignupSignatureMessage`), as CREATE_SUB_ORGANIZATION_V8
     * requires; a Google/Apple root user needs their OIDC token.
     */
    async createOrganization(name: string, root: { readonly email: string; readonly verificationToken: string; readonly clientSignature: ClientSignature }
      | { readonly provider: 'Google' | 'Apple'; readonly oidcToken: string; readonly email: string | null }): Promise<{ organization: string; user: string }> {
      const user = 'verificationToken' in root
        ? { userName: 'FloFi user', userEmail: root.email, apiKeys: [], authenticators: [], oauthProviders: [] }
        : { userName: 'FloFi user', ...root.email ? { userEmail: root.email } : {}, apiKeys: [], authenticators: [], oauthProviders: [{ providerName: root.provider, oidcToken: root.oidcToken }] };
      const done = await activity('create_sub_organization', 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8', config.organizationId, {
        subOrganizationName: name, rootUsers: [user], rootQuorumThreshold: 1,
        ...'verificationToken' in root ? { verificationToken: root.verificationToken, clientSignature: root.clientSignature } : {} });
      const result = resultOf(done, 'createSubOrganizationResult'), users = Array.isArray(result.rootUserIds) ? result.rootUserIds : [];
      if (users.length !== 1) fail('TURNKEY_RESPONSE_INVALID');
      return { organization: text(result.subOrganizationId, RESOURCE), user: text(users[0], RESOURCE) };
    },
    /**
     * Opens a provider session for the key bound in the verification token (email), with that key's client signature over the login
     * message (`loginSignatureMessage`). Returns the provider's session JWT (not a signing key).
     */
    async emailLogin(organization: string, verificationToken: string, sessionKey: string, signature: ClientSignature): Promise<string> {
      if (signature.publicKey !== sessionKey) fail('TURNKEY_CLIENT_SIGNATURE_INVALID');
      const done = await activity('otp_login', 'ACTIVITY_TYPE_OTP_LOGIN_V2', organization, { verificationToken, publicKey: sessionKey, clientSignature: signature,
        expirationSeconds: String(MANAGED_SESSION_SECONDS), invalidateExisting: true });
      return text(resultOf(done, 'otpLoginResult').session, /^[A-Za-z0-9._-]{16,8192}$/);
    },
    /** Opens a provider session for the browser's own public key (Google/Apple). The token's nonce already commits to that key. */
    async oidcLogin(organization: string, oidcToken: string, sessionKey: string): Promise<string> {
      const done = await activity('oauth_login', 'ACTIVITY_TYPE_OAUTH_LOGIN', organization, { oidcToken, publicKey: sessionKey, expirationSeconds: String(MANAGED_SESSION_SECONDS),
        invalidateExisting: true });
      return text(resultOf(done, 'oauthLoginResult').session, /^[A-Za-z0-9._-]{16,8192}$/);
    },
    /** Public HD-wallet accounts of the person's organization (addresses only). */
    async walletAccounts(organization: string): Promise<ManagedAccount[]> {
      const accounts = (await post('/public/v1/query/list_wallet_accounts', { organizationId: organization })).accounts;
      return (Array.isArray(accounts) ? accounts : []).flatMap(value => {
        const account = value && typeof value === 'object' ? value as Json : {};
        return (account.addressFormat === 'ADDRESS_FORMAT_ETHEREUM' || account.addressFormat === 'ADDRESS_FORMAT_SOLANA') && typeof account.address === 'string'
          && typeof account.walletId === 'string' && RESOURCE.test(account.walletId) ? [{ walletId: account.walletId, address: account.address, format: account.addressFormat }] : [];
      });
    },
    async wallets(organization: string): Promise<ManagedWallet[]> {
      const wallets = (await post('/public/v1/query/list_wallets', { organizationId: organization })).wallets;
      return (Array.isArray(wallets) ? wallets : []).flatMap(value => {
        const wallet = value && typeof value === 'object' ? value as Json : {};
        return typeof wallet.walletId === 'string' && RESOURCE.test(wallet.walletId) ? [{ walletId: wallet.walletId, imported: wallet.imported === true }] : [];
      });
    },
    /** Imported private keys of the person's organization (addresses only). */
    async privateKeys(organization: string): Promise<ManagedKey[]> {
      const keys = (await post('/public/v1/query/list_private_keys', { organizationId: organization })).privateKeys;
      return (Array.isArray(keys) ? keys : []).flatMap(value => {
        const key = value && typeof value === 'object' ? value as Json : {};
        const addresses = Array.isArray(key.addresses) ? key.addresses.flatMap(entry => entry && typeof entry === 'object' && typeof (entry as Json).address === 'string'
          && typeof (entry as Json).format === 'string' ? [{ format: (entry as Json).format as string, address: (entry as Json).address as string }] : []) : [];
        return typeof key.privateKeyId === 'string' && RESOURCE.test(key.privateKeyId) ? [{ privateKeyId: key.privateKeyId, imported: key.imported === true, addresses }] : [];
      });
    },
  };
}
export type TurnkeyServer = ReturnType<typeof createTurnkeyServer>;
