// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: unlocking FloFi Wallet with Google or Apple (wallet origin only). Starts an OpenID Connect sign-in that
 * returns to the wallet origin (`/wallet/callback/<provider>`) with a nonce committing to the wallet page's key. The flow cookie also
 * names the account session (Apple's return is a cross-site POST that carries no Lax cookie); the callback re-verifies it.
 */
import { cookies } from 'next/headers';
import { newOidcFlow, sealOidcFlow } from '../../../../../accounts/account-session';
import { flowCookieOptions } from '../../../../../accounts/account-host';
import { authorizationUrl, oidcConfig } from '../../../../../accounts/oidc';
import { currentWalletSession, sameWalletOrigin, walletError, walletHost, walletJson, walletOidcCookie } from '../../../../../accounts/wallet-host';
import { ACCOUNT_FLOW_TTL_SECONDS } from '../../../../../accounts/account-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  const session = await currentWalletSession(host);
  if (!session) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' });
  try {
    const body = await request.json().catch(() => null) as { provider?: unknown; key?: unknown } | null;
    const provider = body?.provider;
    if (provider !== 'google' && provider !== 'apple') return walletJson(400, { code: 'OIDC_PROVIDER_INVALID' });
    const context = await host.service.context(session);
    if (!context.methods.includes(provider)) return walletJson(403, { code: 'WALLET_UNLOCK_METHOD_UNAVAILABLE' });
    const config = oidcConfig(provider, process.env, host.origin.origin);
    if (!config) return walletJson(503, { code: 'OIDC_PROVIDER_NOT_CONFIGURED' });
    if (typeof body?.key !== 'string') return walletJson(400, { code: 'ACCOUNT_SESSION_KEY_INVALID' });
    // The nonce commits the ID token to the wallet page's key: the provider opens a session for that key only.
    const flow = newOidcFlow(provider, body.key, 'link', '/app', session.account);
    (await cookies()).set(walletOidcCookie(host.origin.secure), sealOidcFlow(process.env, flow, host.origin.host, new Date()),
      flowCookieOptions(host.origin.secure, ACCOUNT_FLOW_TTL_SECONDS));
    return walletJson(200, { url: authorizationUrl(config, flow) });
  } catch (cause) { return walletError(cause, 'OIDC_SIGN_IN_FAILED'); }
}
