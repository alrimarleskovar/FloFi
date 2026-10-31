// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse, type NextRequest } from 'next/server';
import { approvalFrameAncestors } from './server/embedded-approval';
import { accountPagePolicy, cspNonce, isAccountPage } from './accounts/account-csp';
import { isWalletAsset, isWalletPath, reservedWalletHosts, walletOrigin, walletPagePolicy } from './accounts/wallet-origin';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
/** A response carrying a fresh nonce policy, and the request headers Next.js reads to put the nonce on its own scripts. */
function withNonce(request: NextRequest, policy: (nonce: string) => string, extra: Record<string, string> = {}) {
  const nonce = cspNonce(), value = policy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', value);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', value);
  for (const [name, content] of Object.entries(extra)) response.headers.set(name, content);
  return response;
}

/** Evaluate the trusted deployment origin at runtime, including deliberately isolated previews. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet. Its host serves only its own pages, route handlers and static assets (no product page,
  // no server action), and its paths do not exist on the product host. See src/accounts/wallet-origin.ts.
  const wallet = walletOrigin(process.env), host = (request.headers.get('host') ?? '').toLowerCase();
  // Fail closed: the wallet host is wallet-only even when its configuration is invalid (its pages then say FloFi Wallet is unavailable and
  // its routes answer MANAGED_WALLETS_NOT_CONFIGURED); it never falls through to the product.
  if (wallet ? host === wallet.host.toLowerCase() : reservedWalletHosts(process.env).has(host)) {
    if (request.headers.has('next-action')) return notFound();
    if (isWalletAsset(pathname) || pathname.startsWith('/api/wallet')) {
      const response = NextResponse.next();
      response.headers.set('X-Content-Type-Options', 'nosniff');
      // Static brand images and route responses never run script or frame anything on the wallet origin.
      if (!pathname.startsWith('/_next/static/')) response.headers.set('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
      return response;
    }
    if (!isWalletPath(pathname)) return notFound();
    return withNonce(request, nonce => walletPagePolicy(nonce), { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  }
  if (isWalletPath(pathname)) return notFound();
  // BUILD-FLOFI-AUTH-WALLETS-001: sign-in and wallet onboarding get a per-request nonce policy. Next.js reads the request's policy to put
  // the nonce on its own scripts; the account layout reads `x-nonce` for its theme bootstrap.
  if (isAccountPage(pathname)) return withNonce(request, nonce => accountPagePolicy(nonce));
  if (pathname !== '/mcp/approve') return NextResponse.next();
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', `connect-src 'self'; frame-ancestors ${approvalFrameAncestors(process.env)}`);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
// Every request except Next.js's immutable build output and image optimizer: the wallet host must refuse everything that is not its own.
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
