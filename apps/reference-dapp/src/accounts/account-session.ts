// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: sealed, server-verified account cookies.
 *
 * The account session cookie is HttpOnly, host-bound and MAC-sealed with a key derived (separate HKDF label) from the same
 * deployment secret as the wallet session (`FLOFI_SESSION_SECRET`, else `API_AUTH_TOKEN`, else a per-process key on a local
 * server only). A sealed cookie is necessary but not sufficient: the account store must also hold an unrevoked, unexpired record
 * for its session id (`account-store.ts`), so sign-out and "sign out everywhere" take effect server-side.
 *
 * The short-lived flow cookies (OIDC state, email challenge) carry only nonces, PKCE verifiers and FloFi's challenge id: never an OTP
 * code, an OIDC token or any wallet key. FloFi Wallet's own tokens (handoff, wallet session, unlock flows) use the same seal with their
 * own kinds and are bound to the wallet host (wallet-session.ts).
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { walletSessionKey } from '../server/wallet-session.ts';
import { ACCOUNT_ID, type IdentityKind } from './account-model.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const ACCOUNT_SESSION_COOKIE = 'flofi_account_session';
export const ACCOUNT_OIDC_COOKIE = 'flofi_account_oidc';
export const ACCOUNT_EMAIL_COOKIE = 'flofi_account_email';
export const ACCOUNT_SESSION_TTL_SECONDS = 12 * 3600;
export const ACCOUNT_FLOW_TTL_SECONDS = 600;
/** A sensitive action (wallet export) needs a sign-in at most this old. */
export const ACCOUNT_REAUTH_SECONDS = 10 * 60;

export type AccountSessionToken = { readonly accountId: string; readonly sessionId: string; readonly method: IdentityKind;
  readonly authenticatedAt: number; readonly expiresAt: number };
export type OidcProvider = 'google' | 'apple';
export type AccountIntent = 'sign-in' | 'link';
export type OidcFlow = { readonly provider: OidcProvider; readonly state: string; readonly nonce: string; readonly verifier: string;
  readonly sessionKey: string | null; readonly intent: AccountIntent; readonly returnTo: string;
  /** Link intent only: the signed-in session that started the flow (Apple's cross-site return carries no Lax cookie). Re-verified on return. */
  readonly linkSession?: AccountSessionToken | null };
/** The email challenge cookie names only FloFi's challenge record: no address, provider id or code. */
export type EmailFlow = { readonly challengeId: string; readonly intent: AccountIntent; readonly returnTo: string };

/** a1 account session, o1 OIDC flow, m1 email flow, h1 FloFi Wallet handoff, w1 FloFi Wallet session, f1 FloFi Wallet unlock flow. */
type Kind = 'a1' | 'o1' | 'm1' | 'h1' | 'w1' | 'f1';
const seconds = (now: Date) => Math.floor(now.getTime() / 1000);
const METHODS: readonly IdentityKind[] = ['google', 'apple', 'email', 'eip155', 'solana'];
const HEX32 = /^[0-9a-f]{32}$/, B64URL = /^[A-Za-z0-9_-]{43,128}$/;
/** A compressed P-256 public key (hex): the browser's provider session key. */
export const SESSION_PUBLIC_KEY = /^0[23][0-9a-f]{64}$/;


function accountKey(env: Env): Buffer {
  return Buffer.from(hkdfSync('sha256', walletSessionKey(env), 'flofi', 'flofi/account-session/v1', 32));
}
function seal(kind: Kind, payload: object, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${kind}.${body}.${createHmac('sha256', key).update(`${kind}.${body}`).digest('base64url')}`;
}
function unseal(kind: Kind, token: unknown, key: Buffer, now: Date, domain: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 4_096) return null;
  const [prefix, body, mac, ...rest] = token.split('.');
  // Canonical encodings only: Node's base64url decoder ignores padding, whitespace, stray characters and spare bits, so a lenient read
  // would accept many spellings of one token (and defeat any digest of the token string).
  if (prefix !== kind || !body || !mac || rest.length || !/^[A-Za-z0-9_-]{43}$/.test(mac) || !/^[A-Za-z0-9_-]+$/.test(body)
    || Buffer.from(mac, 'base64url').toString('base64url') !== mac || Buffer.from(body, 'base64url').toString('base64url') !== body) return null;
  const expected = createHmac('sha256', key).update(`${kind}.${body}`).digest(), supplied = Buffer.from(mac, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return Number.isSafeInteger(v.e) && (v.e as number) > seconds(now) && v.d === domain ? v : null;
}
const keyOrNull = (env: Env) => { try { return accountKey(env); } catch { return null; } };
/** Seals FloFi Wallet tokens (kinds h1, w1, f1) with the account key; `payload.e` (expiry, seconds) and `payload.d` (host) are required. */
export function sealWalletToken(env: Env, kind: 'h1' | 'w1' | 'f1', payload: Record<string, unknown> & { e: number; d: string }): string {
  return seal(kind, payload, accountKey(env));
}
/** The verified payload of a FloFi Wallet token for this host, or null (absent, tampered, expired, another kind, key or host). */
export function unsealWalletToken(env: Env, kind: 'h1' | 'w1' | 'f1', token: unknown, now: Date, domain: string): Record<string, unknown> | null {
  const key = keyOrNull(env);
  return key ? unseal(kind, token, key, now, domain) : null;
}

export function newSessionId(): string { return randomBytes(16).toString('hex'); }
export function newAccountId(): string { return `acct_${randomBytes(16).toString('hex')}`; }

export function sealAccountSession(env: Env, session: AccountSessionToken, domain: string, now: Date): string {
  if (!ACCOUNT_ID.test(session.accountId) || !HEX32.test(session.sessionId) || !METHODS.includes(session.method)) throw new Error('ACCOUNT_SESSION_INVALID');
  return seal('a1', { a: session.accountId, s: session.sessionId, m: session.method, t: session.authenticatedAt, i: seconds(now), e: session.expiresAt, d: domain },
    accountKey(env));
}
/** The sealed claims of an account cookie, or null (absent, tampered, expired, another key or host). The store still decides. */
export function readAccountSession(env: Env, token: string | undefined, now: Date, domain: string): AccountSessionToken | null {
  const key = keyOrNull(env), v = key && unseal('a1', token, key, now, domain);
  if (!v || typeof v.a !== 'string' || !ACCOUNT_ID.test(v.a) || typeof v.s !== 'string' || !HEX32.test(v.s)
    || !METHODS.includes(v.m as IdentityKind) || !Number.isSafeInteger(v.t) || (v.t as number) > seconds(now) + 60) return null;
  return { accountId: v.a, sessionId: v.s, method: v.m as IdentityKind, authenticatedAt: v.t as number, expiresAt: v.e as number };
}
/** Whether a session signed in recently enough for a sensitive action. */
export const freshlyAuthenticated = (session: Pick<AccountSessionToken, 'authenticatedAt'>, now: Date) =>
  seconds(now) - session.authenticatedAt <= ACCOUNT_REAUTH_SECONDS;

/** Only same-origin FloFi paths are accepted as a destination after sign-in (no open redirect). */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !/^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(value) || value.includes('\\')) return '/app';
  return /^\/(?:app|onboarding)(?:[/?]|$)/.test(value) ? value : '/app';
}

export function newOidcFlow(provider: OidcProvider, sessionKey: string | null, intent: AccountIntent, returnTo: string, linkSession: AccountSessionToken | null = null): OidcFlow {
  if (sessionKey !== null && !SESSION_PUBLIC_KEY.test(sessionKey)) throw new Error('ACCOUNT_SESSION_KEY_INVALID');
  // With a provider session key the nonce commits the ID token to that browser key (sha256 of the compressed key, hex), so the token
  // can open a provider session for this browser only; otherwise it is a random single-use value.
  const nonce = sessionKey ? createHash('sha256').update(sessionKey).digest('hex') : randomBytes(32).toString('base64url');
  return { provider, state: randomBytes(32).toString('base64url'), nonce, verifier: randomBytes(48).toString('base64url'),
    sessionKey, intent, returnTo: safeReturnPath(returnTo), linkSession: intent === 'link' ? linkSession : null };
}
export function sealOidcFlow(env: Env, flow: OidcFlow, domain: string, now: Date): string {
  const link = flow.intent === 'link' && flow.linkSession ? { l: [flow.linkSession.accountId, flow.linkSession.sessionId, flow.linkSession.method,
    flow.linkSession.authenticatedAt, flow.linkSession.expiresAt] } : {};
  return seal('o1', { p: flow.provider, s: flow.state, n: flow.nonce, v: flow.verifier, k: flow.sessionKey, r: flow.intent, u: flow.returnTo,
    e: seconds(now) + ACCOUNT_FLOW_TTL_SECONDS, d: domain, ...link }, accountKey(env));
}
export function readOidcFlow(env: Env, token: string | undefined, now: Date, domain: string): OidcFlow | null {
  const key = keyOrNull(env), v = key && unseal('o1', token, key, now, domain);
  if (!v || (v.p !== 'google' && v.p !== 'apple') || typeof v.s !== 'string' || !B64URL.test(v.s) || typeof v.n !== 'string' || !B64URL.test(v.n)
    || typeof v.v !== 'string' || !B64URL.test(v.v) || (v.k !== null && (typeof v.k !== 'string' || !SESSION_PUBLIC_KEY.test(v.k)))
    || (v.r !== 'sign-in' && v.r !== 'link')) return null;
  const l = Array.isArray(v.l) ? v.l : null;
  const linkSession = v.r === 'link' && l && l.length === 5 && typeof l[0] === 'string' && ACCOUNT_ID.test(l[0]) && typeof l[1] === 'string' && HEX32.test(l[1])
    && METHODS.includes(l[2] as IdentityKind) && Number.isSafeInteger(l[3]) && Number.isSafeInteger(l[4])
    ? { accountId: l[0], sessionId: l[1], method: l[2] as IdentityKind, authenticatedAt: l[3] as number, expiresAt: l[4] as number } : null;
  return { provider: v.p, state: v.s, nonce: v.n, verifier: v.v, sessionKey: v.k as string | null, intent: v.r, returnTo: safeReturnPath(v.u), linkSession };
}
export function sealEmailFlow(env: Env, flow: EmailFlow, domain: string, now: Date): string {
  if (!HEX32.test(flow.challengeId)) throw new Error('EMAIL_CHALLENGE_INVALID');
  return seal('m1', { c: flow.challengeId, r: flow.intent, u: flow.returnTo, e: seconds(now) + ACCOUNT_FLOW_TTL_SECONDS, d: domain }, accountKey(env));
}
export function readEmailFlow(env: Env, token: string | undefined, now: Date, domain: string): EmailFlow | null {
  const key = keyOrNull(env), v = key && unseal('m1', token, key, now, domain);
  if (!v || typeof v.c !== 'string' || !HEX32.test(v.c) || (v.r !== 'sign-in' && v.r !== 'link')) return null;
  return { challengeId: v.c, intent: v.r, returnTo: safeReturnPath(v.u) };
}
