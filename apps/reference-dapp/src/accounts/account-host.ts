// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the request-scoped account context for server actions and route handlers.
 *
 * Accounts live in the deployment's PostgreSQL platform state (no filesystem or in-memory fallback): a deployment without
 * `DATABASE_URL` offers no account sign-in and says so, while `/app` keeps working without an account. The current account is
 * the sealed HttpOnly cookie *and* an unrevoked, unexpired server-side session record — never browser state.
 */
import { cookies } from 'next/headers';
import { platformStateHost } from '../server/platform-state-host.ts';
import { requestOrigin } from '../server/session-principal.ts';
import { ACCOUNT_SESSION_COOKIE, ACCOUNT_SESSION_TTL_SECONDS, readAccountSession, safeReturnPath, sealAccountSession, type AccountIntent,
  type AccountSessionToken } from './account-session.ts';
import { createAccountStore, type AccountStore } from './account-store.ts';
import { createAccountService, type AccountService, type SignInOutcome } from './account-service.ts';
import { oidcConfig } from './oidc.ts';
import { createTurnkeyServer, turnkeyConfig, type TurnkeyBrowserConfig } from './turnkey-server.ts';
import { walletOrigin } from './wallet-origin.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type AccountHost = { readonly store: AccountStore; readonly service: AccountService; readonly turnkey: TurnkeyBrowserConfig | null };
/** What this deployment offers on the sign-in screen. Nothing is shown as available unless it can actually run. */
export type AccountAvailability = { readonly accounts: boolean; readonly google: boolean; readonly apple: boolean; readonly email: boolean;
  readonly wallet: boolean; readonly managedWallets: boolean };

export async function accountHost(env: Env = process.env): Promise<AccountHost | null> {
  if (!env.DATABASE_URL) return null;
  const { db, tenantId } = await platformStateHost(env);
  const config = turnkeyConfig(env), turnkey = config ? createTurnkeyServer(config) : null;
  const store = createAccountStore(db, tenantId);
  return { store, service: createAccountService({ store, turnkey }), turnkey: turnkey?.browser() ?? null };
}
export function accountAvailability(env: Env, host: AccountHost | null): AccountAvailability {
  const accounts = host !== null;
  return { accounts, google: accounts && oidcConfig('google', env) !== null, apple: accounts && oidcConfig('apple', env) !== null,
    // Managed wallets need the provider AND FloFi Wallet's own origin: no provider session may exist on the product origin.
    email: accounts && host.turnkey !== null, wallet: accounts, managedWallets: accounts && host.turnkey !== null && walletOrigin(env) !== null };
}

/** HttpOnly, host-only. Lax so the top-level redirect back from Google/Apple lands signed in; server actions also check Origin. */
export const accountCookieOptions = (secure: boolean, maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge });
/** Apple returns with a cross-site form POST, which only carries a `SameSite=None; Secure` cookie (Lax on a loopback test server). */
export const flowCookieOptions = (secure: boolean, maxAge: number) => ({ httpOnly: true, sameSite: secure ? 'none' as const : 'lax' as const, secure, path: '/', maxAge });

export async function setAccountCookie(session: AccountSessionToken, env: Env = process.env): Promise<void> {
  const origin = await requestOrigin();
  (await cookies()).set(ACCOUNT_SESSION_COOKIE, sealAccountSession(env, session, origin.domain, new Date()),
    accountCookieOptions(origin.secure, Math.max(0, Math.min(ACCOUNT_SESSION_TTL_SECONDS, session.expiresAt - Math.floor(Date.now() / 1000)))));
}
export async function clearAccountCookie(): Promise<void> {
  const origin = await requestOrigin();
  (await cookies()).set(ACCOUNT_SESSION_COOKIE, '', accountCookieOptions(origin.secure, 0));
}
/** The verified account session of this request, or null (no cookie, tampered, expired, revoked, another host or no database). */
export async function currentAccountSession(host: AccountHost | null, env: Env = process.env): Promise<AccountSessionToken | null> {
  if (!host) return null;
  const origin = await requestOrigin(), token = readAccountSession(env, (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value, new Date(), origin.domain);
  if (!token) return null;
  try { return await host.store.verifySession(token) ? token : null; } catch { return null; }
}

/** Where a successful sign-in continues: first-time Google, Apple or email accounts see the wallet introduction; everyone else returns. */
export function nextPath(outcome: Pick<SignInOutcome, 'onboarding' | 'session'>, intent: AccountIntent, returnTo: string): string {
  if (intent === 'link') return safeReturnPath(returnTo);
  const social = outcome.session.method === 'google' || outcome.session.method === 'apple' || outcome.session.method === 'email';
  return social && outcome.onboarding === 'pending' ? '/onboarding' : safeReturnPath(returnTo);
}
/** A new sign-in in this browser supersedes the previous one: its server-side record is revoked (linking keeps the same session). */
export async function supersede(host: AccountHost, previous: AccountSessionToken | null, next: AccountSessionToken): Promise<void> {
  if (previous && previous.sessionId !== next.sessionId) await host.store.revokeSession(previous).catch(() => undefined);
}
