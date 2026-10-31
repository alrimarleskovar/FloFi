// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the Google/Apple return. The single-use flow cookie is cleared first, whatever happens; the
 * `state` must match it exactly; the ID token is verified by the server (`oidc.ts`); only then is the account cookie set.
 * Errors return to the sign-in screen with a classified code and nothing signed in.
 */
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requestOrigin } from '../server/session-principal.ts';
import { accountHost, currentAccountSession, flowCookieOptions, nextPath, setAccountCookie, supersede } from './account-host.ts';
import { ACCOUNT_OIDC_COOKIE, readOidcFlow, safeReturnPath, type OidcProvider } from './account-session.ts';
import { oidcConfig } from './oidc.ts';

const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
type Params = { get(name: string): FormDataEntryValue | string | null };

export async function oidcCallback(provider: OidcProvider, params: Params): Promise<NextResponse> {
  const origin = await requestOrigin(), jar = await cookies(), now = new Date();
  const flow = readOidcFlow(process.env, jar.get(ACCOUNT_OIDC_COOKIE)?.value, now, origin.domain);
  jar.set(ACCOUNT_OIDC_COOKIE, '', flowCookieOptions(origin.secure, 0));
  const back = (code: string) => {
    const url = new URL(flow?.intent === 'link' ? safeReturnPath(flow.returnTo) : '/login', origin.uri);
    url.searchParams.set(flow?.intent === 'link' ? 'account_error' : 'error', code);
    return NextResponse.redirect(url, 303);
  };
  const text = (name: string) => { const value = params.get(name); return typeof value === 'string' ? value : null; };
  try {
    const host = await accountHost();
    if (!host) return back('ACCOUNTS_NOT_CONFIGURED');
    const state = text('state');
    if (!flow || flow.provider !== provider || !state || !same(state, flow.state)) return back('OIDC_STATE_INVALID');
    // The person closed or declined the provider's screen: nothing to verify.
    if (text('error')) return back('OIDC_CANCELLED');
    const config = oidcConfig(provider, process.env);
    if (!config) return back('OIDC_PROVIDER_NOT_CONFIGURED');
    // Apple returns with a cross-site POST that carries no Lax account cookie: a link flow uses the session it sealed at its start,
    // re-verified against the server-side record (unrevoked, unexpired, same account).
    const cookieSession = await currentAccountSession(host);
    const current = cookieSession ?? (flow.intent === 'link' && flow.linkSession && await host.store.verifySession(flow.linkSession).catch(() => false) ? flow.linkSession : null);
    const outcome = await host.service.completeOidc(config, flow, { code: text('code'), idToken: text('id_token') }, current);
    await supersede(host, cookieSession, outcome.session);
    await setAccountCookie(outcome.session);
    return NextResponse.redirect(new URL(nextPath(outcome, flow.intent, flow.returnTo), origin.uri), 303);
  } catch (error) {
    return back(error instanceof Error && CODE.test(error.message) ? error.message : 'OIDC_SIGN_IN_FAILED');
  }
}
