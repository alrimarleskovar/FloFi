// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the Google/Apple return of a FloFi Wallet unlock (wallet origin only). It runs in the sign-in popup
 * that FloFi Wallet opened; FloFi Wallet itself polls its session. The single-use flow cookie is cleared first; `state` must match; the
 * ID token is verified by the server for the account's own linked Google/Apple identity and the wallet key the nonce commits to; then the
 * provider session opens for that key. Nothing is shown but a short result page that closes itself.
 */
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { flowCookieOptions } from '../../../../../accounts/account-host';
import { readOidcFlow, type OidcProvider } from '../../../../../accounts/account-session';
import { oidcConfig } from '../../../../../accounts/oidc';
import { currentWalletSession, setWalletSession, walletHost, walletOidcCookie } from '../../../../../accounts/wallet-host';
import { newWalletSession } from '../../../../../accounts/wallet-session';

export const dynamic = 'force-dynamic';
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
type Params = { get(name: string): FormDataEntryValue | string | null };

async function complete(provider: OidcProvider, params: Params): Promise<NextResponse> {
  const host = await walletHost().catch(() => null);
  if (!host) return new NextResponse('Not found', { status: 404 });
  const done = (result: string) => NextResponse.redirect(new URL(`/wallet/done?result=${encodeURIComponent(result)}`, host.origin.origin), 303);
  const jar = await cookies(), now = new Date();
  const flow = readOidcFlow(process.env, jar.get(walletOidcCookie(host.origin.secure))?.value, now, host.origin.host);
  jar.set(walletOidcCookie(host.origin.secure), '', flowCookieOptions(host.origin.secure, 0));
  const text = (name: string) => { const value = params.get(name); return typeof value === 'string' ? value : null; };
  try {
    const state = text('state');
    if (!flow || flow.provider !== provider || !state || !same(state, flow.state) || !flow.linkSession) return done('OIDC_STATE_INVALID');
    if (text('error')) return done('OIDC_CANCELLED');
    const config = oidcConfig(provider, process.env, host.origin.origin);
    if (!config) return done('OIDC_PROVIDER_NOT_CONFIGURED');
    // Apple's cross-site POST carries no Lax wallet cookie: use the account session the flow sealed, re-verified with the store.
    if (!await host.account.store.verifySession(flow.linkSession, now)) return done('ACCOUNT_SESSION_REQUIRED');
    const existing = await currentWalletSession(host);
    const session = existing && existing.account.sessionId === flow.linkSession.sessionId ? existing : newWalletSession(flow.linkSession, now);
    const unlocked = await host.service.completeOidcUnlock(session, config, flow, { code: text('code'), idToken: text('id_token') });
    await setWalletSession(host, { ...session, unlockedKey: unlocked.key, unlockedAt: Math.floor(now.getTime() / 1000),
      unlockedUntil: Math.min(unlocked.until, session.expiresAt) });
    return done('unlocked');
  } catch (error) {
    return done(error instanceof Error && CODE.test(error.message) ? error.message : 'OIDC_SIGN_IN_FAILED');
  }
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (provider !== 'google') return new NextResponse('Not found', { status: 404 });
  return complete('google', new URL(request.url).searchParams);
}
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (provider !== 'apple') return new NextResponse('Not found', { status: 404 });
  return complete('apple', await request.formData());
}
