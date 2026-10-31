// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the request context of FloFi Wallet's route handlers (wallet origin only).
 *
 * Every handler first checks that the request really is a same-origin request to the wallet host: the Host header, `Sec-Fetch-Site:
 * same-origin` and an `Origin` equal to the wallet origin (a sibling host under the same registrable domain is same-site, so SameSite
 * alone is not enough). Then it reads the sealed wallet session cookie and re-verifies the account session it is bound to.
 */
import { cookies } from 'next/headers';
import { accountHost, type AccountHost } from './account-host.ts';
import { readWalletSession, sealWalletSession, type WalletSession } from './wallet-session.ts';
import { createWalletService, type WalletService } from './wallet-service.ts';
import { walletOrigin, walletSessionCookie, type WalletOrigin } from './wallet-origin.ts';
import { createTurnkeyServer, turnkeyConfig } from './turnkey-server.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type WalletHost = { readonly origin: WalletOrigin; readonly account: AccountHost; readonly service: WalletService };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

export const walletJson = (status: number, value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export const walletError = (cause: unknown, fallback = 'WALLET_REQUEST_FAILED', status = 400) =>
  walletJson(status, { code: cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback });

/** Whether `request` is a same-origin request to the wallet host (and, for a body, an allowed method). */
export function sameWalletOrigin(request: Request, origin: WalletOrigin): boolean {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  if (host !== origin.host.toLowerCase()) return false;
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  return request.headers.get('sec-fetch-site') === 'same-origin' && request.headers.get('origin') === origin.origin;
}

/** The wallet host context, or null when managed wallets are not configured on this deployment. */
export async function walletHost(env: Env = process.env): Promise<WalletHost | null> {
  const origin = walletOrigin(env), config = turnkeyConfig(env);
  if (!origin || !config) return null;
  const account = await accountHost(env);
  if (!account) return null;
  return { origin, account, service: createWalletService({ store: account.store, turnkey: createTurnkeyServer(config) }) };
}

/** The verified wallet session of this request, or null (no cookie, tampered, expired, other host, or its account session ended). */
export async function currentWalletSession(host: WalletHost, env: Env = process.env, now = new Date()): Promise<WalletSession | null> {
  const jar = await cookies(), name = walletSessionCookie(host.origin.secure);
  // Two cookies with the wallet's name means another host set one (cookie tossing): refuse rather than guess which is ours.
  if (jar.getAll(name).length > 1) return null;
  const token = jar.get(name)?.value;
  const session = readWalletSession(env, token, now, host.origin.host);
  if (!session) return null;
  try { return await host.account.store.verifySession(session.account, now) ? session : null; } catch { return null; }
}
export const walletCookieOptions = (secure: boolean, maxAge: number) =>
  // Lax (not Strict): Apple's form_post return is a cross-site POST, and the top-level navigation back to the wallet page must carry the
  // session. Every state-changing route also requires Sec-Fetch-Site same-origin and the wallet Origin (sameWalletOrigin).
  ({ httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge });
export async function setWalletSession(host: WalletHost, session: WalletSession, env: Env = process.env, now = new Date()): Promise<void> {
  (await cookies()).set(walletSessionCookie(host.origin.secure), sealWalletSession(env, session, host.origin.host),
    walletCookieOptions(host.origin.secure, Math.max(0, session.expiresAt - Math.floor(now.getTime() / 1000))));
}
/** The Google/Apple unlock flow cookie (SameSite=None on https: Apple returns with a cross-site form POST). */
export const walletOidcCookie = (secure: boolean) => secure ? '__Host-flofi_wallet_oidc' : 'flofi_wallet_oidc';
export async function clearWalletSession(host: WalletHost): Promise<void> {
  (await cookies()).set(walletSessionCookie(host.origin.secure), '', walletCookieOptions(host.origin.secure, 0));
}
