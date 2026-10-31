// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: Sign in with Google and Sign in with Apple as a standard OpenID Connect relying party.
 *
 * Google uses the authorization-code flow with PKCE (S256); the code is exchanged server-to-server with FloFi's client secret.
 * Apple uses `code id_token` with `response_mode=form_post`; FloFi reads only the ID token and never exchanges the code, so no
 * Apple signing key is needed. Every ID token is verified here, on the server: RS256 signature against the provider's published
 * JWKS, issuer, audience (and Google's `azp`), expiry and issue time with bounded skew, and the nonce sealed in this browser's
 * HttpOnly flow cookie. Nothing in the browser is trusted to say who signed in.
 *
 * Endpoints are the providers' public ones. The only override is the deterministic E2E identity provider, which must be on
 * loopback, on a non-hosted server, and explicitly enabled (`FLOFI_AUTH_E2E_IDP=MOCKED_LOOPBACK_ONLY`).
 */
import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import { isHostedDeployment, publicOrigin } from '../server/deployment.ts';
import { normalizeEmail } from './account-model.ts';
import type { OidcFlow, OidcProvider } from './account-session.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Endpoints = { readonly issuers: readonly string[]; readonly authorize: string; readonly token: string | null; readonly jwks: string };
export type OidcConfig = { readonly provider: OidcProvider; readonly clientId: string; readonly clientSecret: string | null;
  readonly redirectUri: string; readonly endpoints: Endpoints };
export type VerifiedIdentity = { readonly provider: OidcProvider; readonly subject: string; readonly email: string | null; readonly emailVerified: boolean;
  readonly expiresAt: Date };

const PUBLIC_ENDPOINTS: Readonly<Record<OidcProvider, Endpoints>> = Object.freeze({
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuers: ['https://appleid.apple.com'], authorize: 'https://appleid.apple.com/auth/authorize', token: null, jwks: 'https://appleid.apple.com/auth/keys' },
});
const CLIENT_ID = /^[A-Za-z0-9._-]{3,255}$/;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/;
const fail = (code: string): never => { throw new Error(code); };

/** The deterministic loopback identity provider of the browser suite, or null. Refused on any hosted deployment. */
export function e2eIdentityProvider(env: Env): string | null {
  if (env.FLOFI_AUTH_E2E_IDP === undefined || env.FLOFI_AUTH_E2E_IDP === '') return null;
  const origin = env.FLOFI_AUTH_E2E_IDP_ORIGIN ?? '';
  if (env.FLOFI_AUTH_E2E_IDP !== 'MOCKED_LOOPBACK_ONLY' || isHostedDeployment(env) || !LOOPBACK.test(origin)) fail('AUTH_E2E_IDP_FORBIDDEN');
  return origin;
}
function endpoints(provider: OidcProvider, env: Env): Endpoints {
  const loopback = e2eIdentityProvider(env);
  if (!loopback) return PUBLIC_ENDPOINTS[provider];
  return { issuers: [`${loopback}/${provider}`], authorize: `${loopback}/${provider}/authorize`, token: provider === 'google' ? `${loopback}/google/token` : null,
    jwks: `${loopback}/${provider}/jwks` };
}
/**
 * The provider's configuration on this deployment, or null when it is not configured (the sign-in button says so).
 *
 * `returnOrigin` is FloFi Wallet's origin for an unlock. An unlock uses its OWN clients (`FLOFI_WALLET_GOOGLE_CLIENT_ID` /
 * `_SECRET`, `FLOFI_WALLET_APPLE_CLIENT_ID`) whose only redirect URIs are on the wallet host: the token audience then separates
 * product sign-in tokens from wallet-unlock tokens, so a sign-in ID token can never unlock FloFi Wallet (and an Apple ID token delivered
 * anywhere else is refused by audience). Sign-in returns to the product with the product clients.
 */
export function oidcConfig(provider: OidcProvider, env: Env, returnOrigin: string | null = null): OidcConfig | null {
  const origin = publicOrigin(env), wallet = returnOrigin !== null;
  const clientId = provider === 'google' ? (wallet ? env.FLOFI_WALLET_GOOGLE_CLIENT_ID : env.FLOFI_GOOGLE_CLIENT_ID)
    : (wallet ? env.FLOFI_WALLET_APPLE_CLIENT_ID : env.FLOFI_APPLE_CLIENT_ID);
  const clientSecret = provider === 'google' ? (wallet ? env.FLOFI_WALLET_GOOGLE_CLIENT_SECRET : env.FLOFI_GOOGLE_CLIENT_SECRET) ?? '' : null;
  // The wallet clients must differ from the product clients, or the audience would not separate the two.
  if (wallet && clientId && clientId === (provider === 'google' ? env.FLOFI_GOOGLE_CLIENT_ID : env.FLOFI_APPLE_CLIENT_ID)) return null;
  if (!origin || !clientId || !CLIENT_ID.test(clientId) || (provider === 'google' && (!clientSecret || clientSecret.length < 8))) return null;
  let resolved: Endpoints;
  try { resolved = endpoints(provider, env); } catch { return null; }
  const redirectUri = returnOrigin ? `${returnOrigin}/wallet/callback/${provider}` : `${origin}/auth/callback/${provider}`;
  return { provider, clientId, clientSecret, redirectUri, endpoints: resolved };
}

const b64url = (bytes: Buffer) => bytes.toString('base64url');
/** RFC 7636 S256 code challenge. */
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());
/** The embedded-wallet provider binds an OIDC token to a browser session key through the nonce: sha256(compressed public key, hex). */
export const sessionKeyNonce = (sessionKey: string) => createHash('sha256').update(sessionKey).digest('hex');

export function authorizationUrl(config: OidcConfig, flow: OidcFlow): string {
  const url = new URL(config.endpoints.authorize);
  const params: Record<string, string> = config.provider === 'google'
    ? { client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email', state: flow.state, nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier), code_challenge_method: 'S256', prompt: 'select_account' }
    : { client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code id_token', response_mode: 'form_post', scope: 'email',
      state: flow.state, nonce: flow.nonce };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Google's authorization-code exchange (server-to-server, PKCE + client secret). Returns the raw ID token for verification. */
export async function exchangeGoogleCode(config: OidcConfig, code: unknown, verifier: string, transport: typeof fetch = fetch): Promise<string> {
  if (config.provider !== 'google' || !config.endpoints.token || !config.clientSecret) fail('OIDC_PROVIDER_NOT_CONFIGURED');
  if (typeof code !== 'string' || code.length < 4 || code.length > 2_048) fail('OIDC_CODE_INVALID');
  const response = await transport(config.endpoints.token!, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ code: code as string, client_id: config.clientId, client_secret: config.clientSecret!, redirect_uri: config.redirectUri,
      grant_type: 'authorization_code', code_verifier: verifier }).toString() }).catch(() => fail('OIDC_TOKEN_EXCHANGE_FAILED'));
  if (!response.ok) fail('OIDC_TOKEN_EXCHANGE_FAILED');
  const body = await response.json().catch(() => null) as { id_token?: unknown } | null;
  return typeof body?.id_token === 'string' ? body.id_token : fail('OIDC_TOKEN_EXCHANGE_FAILED');
}

type Jwk = JsonWebKey & { readonly kid?: string; readonly kty?: string; readonly alg?: string; readonly use?: string };
const JWKS_TTL_MS = 3_600_000, JWKS_REFRESH_MS = 60_000;
const jwksCache = new Map<string, { keys: readonly Jwk[]; fetchedAt: number }>();
async function jwks(url: string, transport: typeof fetch, refresh: boolean, now: number): Promise<readonly Jwk[]> {
  const cached = jwksCache.get(url);
  if (cached && now - cached.fetchedAt < (refresh ? JWKS_REFRESH_MS : JWKS_TTL_MS)) return cached.keys;
  const response = await transport(url, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } }).catch(() => fail('OIDC_JWKS_UNAVAILABLE'));
  if (!response.ok) fail('OIDC_JWKS_UNAVAILABLE');
  const body = await response.json().catch(() => null) as { keys?: unknown } | null;
  const keys = Array.isArray(body?.keys) ? (body.keys as Jwk[]).filter(key => key && typeof key === 'object' && key.kty === 'RSA' && typeof key.kid === 'string') : [];
  if (!keys.length) fail('OIDC_JWKS_UNAVAILABLE');
  jwksCache.set(url, { keys, fetchedAt: now });
  return keys;
}
export function clearJwksCache(): void { jwksCache.clear(); }

const SKEW_SECONDS = 120, MAX_AGE_SECONDS = 900;
const SUBJECT = /^[A-Za-z0-9._-]{1,255}$/;
function json(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('OIDC_TOKEN_INVALID');
  } catch { return fail('OIDC_TOKEN_INVALID'); }
}
const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Verifies an ID token for this provider, client and flow. Throws a classified `OIDC_*` code on any failure. */
export async function verifyIdToken(config: OidcConfig, token: unknown, flow: Pick<OidcFlow, 'nonce'>, options: { readonly now?: Date; readonly transport?: typeof fetch } = {}):
  Promise<VerifiedIdentity> {
  const now = options.now ?? new Date(), transport = options.transport ?? fetch, seconds = Math.floor(now.getTime() / 1000);
  if (typeof token !== 'string' || token.length > 8_192) fail('OIDC_TOKEN_INVALID');
  const parts = (token as string).split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) fail('OIDC_TOKEN_INVALID');
  const [h, p, s] = parts as [string, string, string], header = json(h), claims = json(p);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined) fail('OIDC_TOKEN_ALGORITHM_INVALID');
  let key = (await jwks(config.endpoints.jwks, transport, false, now.getTime())).find(candidate => candidate.kid === header.kid);
  // Providers rotate keys: an unknown key id refreshes the key set at most once a minute.
  key ??= (await jwks(config.endpoints.jwks, transport, true, now.getTime())).find(candidate => candidate.kid === header.kid);
  if (!key || (key.alg !== undefined && key.alg !== 'RS256') || (key.use !== undefined && key.use !== 'sig')) fail('OIDC_TOKEN_KEY_UNKNOWN');
  let valid: boolean;
  try { valid = verify('sha256', Buffer.from(`${h}.${p}`), createPublicKey({ key: key as JsonWebKey, format: 'jwk' }), Buffer.from(s, 'base64url')); } catch { valid = false; }
  if (!valid) fail('OIDC_TOKEN_SIGNATURE_INVALID');
  if (typeof claims.iss !== 'string' || !config.endpoints.issuers.includes(claims.iss)) fail('OIDC_TOKEN_ISSUER_INVALID');
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
  if (!audiences.includes(config.clientId) || (audiences.length > 1 && claims.azp !== config.clientId)) fail('OIDC_TOKEN_AUDIENCE_INVALID');
  if (claims.azp !== undefined && claims.azp !== config.clientId) fail('OIDC_TOKEN_AUDIENCE_INVALID');
  if (!Number.isSafeInteger(claims.exp) || (claims.exp as number) + SKEW_SECONDS < seconds) fail('OIDC_TOKEN_EXPIRED');
  if (!Number.isSafeInteger(claims.iat) || (claims.iat as number) > seconds + SKEW_SECONDS || (claims.iat as number) < seconds - MAX_AGE_SECONDS) fail('OIDC_TOKEN_STALE');
  if (typeof claims.nonce !== 'string' || !sameText(claims.nonce, flow.nonce)) fail('OIDC_NONCE_MISMATCH');
  if (typeof claims.sub !== 'string' || !SUBJECT.test(claims.sub)) fail('OIDC_SUBJECT_INVALID');
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  return { provider: config.provider, subject: claims.sub as string, email: normalizeEmail(claims.email), emailVerified, expiresAt: new Date((claims.exp as number) * 1000) };
}
