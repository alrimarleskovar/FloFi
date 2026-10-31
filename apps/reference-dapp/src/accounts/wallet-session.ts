// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: how FloFi Wallet (its own origin, see wallet-origin.ts) learns which FloFi account it serves.
 *
 * 1. Handoff. A product page with a verified account session asks the server for a handoff token: HMAC-sealed, 120 seconds, naming that
 *    account session and the wallet host, and usable once (the store's single-use proof table). The page opens FloFi Wallet with the
 *    token in the URL fragment, which never reaches a server log or a Referer.
 * 2. Wallet session. FloFi Wallet redeems the token at its own route; the server checks it is unexpired, unused and that the account
 *    session it names is still valid, then sets the wallet session cookie (HttpOnly, host-only, `__Host-` on https, SameSite=Strict),
 *    bound to that account session: signing out or revoking the account session ends it too.
 * 3. Unlock. The wallet session alone opens no provider session. Unlocking needs the person's own email code or Google/Apple sign-in on
 *    the wallet origin, bound to a key only the wallet origin holds (wallet-service.ts). The cookie records which key was unlocked and
 *    when, so export can require a fresh unlock.
 *
 * A stolen handoff token gives its holder a wallet session for the account but no provider session and no way to unlock one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ACCOUNT_ID, type IdentityKind } from './account-model.ts';
import { SESSION_PUBLIC_KEY, sealWalletToken, unsealWalletToken, type AccountSessionToken } from './account-session.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const WALLET_HANDOFF_TTL_SECONDS = 120;
export const WALLET_SESSION_TTL_SECONDS = 30 * 60;
/** Export needs an unlock (email code or Google/Apple sign-in on the wallet origin) at most this old. */
export const WALLET_EXPORT_UNLOCK_SECONDS = 5 * 60;

export type WalletSession = { readonly account: AccountSessionToken; readonly issuedAt: number; readonly expiresAt: number;
  /** The wallet-origin key the provider opened a session for, and when; null until the person unlocks. */
  readonly unlockedKey: string | null; readonly unlockedAt: number | null; readonly unlockedUntil: number | null };

const METHODS: readonly IdentityKind[] = ['google', 'apple', 'email', 'eip155', 'solana'];
const HEX32 = /^[0-9a-f]{32}$/;
const seconds = (now: Date) => Math.floor(now.getTime() / 1000);
const fail = (code: string): never => { throw new Error(code); };

function accountOf(v: Record<string, unknown>): AccountSessionToken | null {
  return typeof v.a === 'string' && ACCOUNT_ID.test(v.a) && typeof v.s === 'string' && HEX32.test(v.s) && METHODS.includes(v.m as IdentityKind)
    && Number.isSafeInteger(v.t) && Number.isSafeInteger(v.x)
    ? { accountId: v.a, sessionId: v.s, method: v.m as IdentityKind, authenticatedAt: v.t as number, expiresAt: v.x as number } : null;
}
const accountClaims = (session: AccountSessionToken) =>
  ({ a: session.accountId, s: session.sessionId, m: session.method, t: session.authenticatedAt, x: session.expiresAt });

/** A single-use handoff for this account session to FloFi Wallet on `walletHost`. */
export function sealWalletHandoff(env: Env, session: AccountSessionToken, walletHost: string, now: Date): string {
  if (session.expiresAt <= seconds(now)) fail('ACCOUNT_SESSION_REQUIRED');
  return sealWalletToken(env, 'h1', { ...accountClaims(session), n: randomBytes(16).toString('base64url'),
    e: Math.min(seconds(now) + WALLET_HANDOFF_TTL_SECONDS, session.expiresAt), d: walletHost });
}
/** The account session a handoff names, and the digest that makes it single-use, or null. The caller must consume the digest. */
export function readWalletHandoff(env: Env, token: unknown, now: Date, walletHost: string): { account: AccountSessionToken; digest: string; expiresAt: number } | null {
  const v = unsealWalletToken(env, 'h1', token, now, walletHost);
  const account = v && typeof v.n === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v.n) ? accountOf(v) : null;
  // Single use is keyed on the verified content (its random nonce and account session), never on how the token string is spelled.
  return account ? { account, digest: createHash('sha256').update(`wallet-handoff:${account.sessionId}:${v!.n as string}`).digest('hex'), expiresAt: v!.e as number } : null;
}

export function sealWalletSession(env: Env, session: WalletSession, walletHost: string): string {
  const unlocked = session.unlockedKey && SESSION_PUBLIC_KEY.test(session.unlockedKey) && Number.isSafeInteger(session.unlockedAt) && Number.isSafeInteger(session.unlockedUntil)
    ? { k: session.unlockedKey, u: session.unlockedAt, v: session.unlockedUntil } : {};
  return sealWalletToken(env, 'w1', { ...accountClaims(session.account), i: session.issuedAt, e: session.expiresAt, d: walletHost, ...unlocked });
}
/** The sealed claims of a wallet session cookie, or null. The account session it names must still be verified with the store. */
export function readWalletSession(env: Env, token: unknown, now: Date, walletHost: string): WalletSession | null {
  const v = unsealWalletToken(env, 'w1', token, now, walletHost), account = v && accountOf(v);
  if (!v || !account || !Number.isSafeInteger(v.i)) return null;
  const unlocked = typeof v.k === 'string' && SESSION_PUBLIC_KEY.test(v.k) && Number.isSafeInteger(v.u) && Number.isSafeInteger(v.v) && (v.v as number) > seconds(now);
  return { account, issuedAt: v.i as number, expiresAt: v.e as number, unlockedKey: unlocked ? v.k as string : null,
    unlockedAt: unlocked ? v.u as number : null, unlockedUntil: unlocked ? v.v as number : null };
}
/** A new wallet session for a redeemed handoff: at most 30 minutes and never beyond the account session. */
export function newWalletSession(account: AccountSessionToken, now: Date): WalletSession {
  return { account, issuedAt: seconds(now), expiresAt: Math.min(seconds(now) + WALLET_SESSION_TTL_SECONDS, account.expiresAt),
    unlockedKey: null, unlockedAt: null, unlockedUntil: null };
}
/**
 * The wallet session for a redeemed handoff. When this browser's current wallet session already serves the very same account session
 * (same account, same session id) its live unlock is kept: reopening FloFi Wallet from FloFi must not lock it (the person unlocks before
 * Authorize). A handoff for any other account session, or an expired unlock, starts locked.
 */
export function redeemedWalletSession(account: AccountSessionToken, current: WalletSession | null, now: Date): WalletSession {
  const next = newWalletSession(account, now);
  const same = current !== null && current.account.accountId === account.accountId && current.account.sessionId === account.sessionId;
  if (!same || current!.unlockedKey === null || current!.unlockedUntil === null || current!.unlockedUntil <= seconds(now)) return next;
  return { ...next, unlockedKey: current!.unlockedKey, unlockedAt: current!.unlockedAt, unlockedUntil: current!.unlockedUntil };
}
/** Whether this wallet session holds a provider session for `key` that was opened recently enough to export. */
export function unlockedFor(session: WalletSession, key: string, now: Date, maxAgeSeconds?: number): boolean {
  return session.unlockedKey === key && session.unlockedUntil !== null && session.unlockedUntil > seconds(now)
    && (maxAgeSeconds === undefined || (session.unlockedAt !== null && seconds(now) - session.unlockedAt <= maxAgeSeconds));
}
