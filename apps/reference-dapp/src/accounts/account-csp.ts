// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the Content Security Policy of sign-in and wallet onboarding (`/login`, `/onboarding*`).
 *
 * These pages take the email address and encrypt the one-time code to the provider, so they run only scripts this response names: a fresh
 * per-request nonce on Next.js's own scripts and the theme bootstrap, then only what those load (`'strict-dynamic'`). An injected
 * `<script>`, inline event handler or `javascript:` URL does not run. The browser talks only to FloFi, frames nothing (wallet import and
 * export happen in FloFi Wallet, on its own origin) and is framed by no one. Styles keep `'unsafe-inline'` for React style attributes; CSS
 * cannot run script. The rest of the product keeps its existing policy (`next.config.ts`).
 *
 * `'unsafe-eval'` remains: the shared wallet-proof module reaches `@defi-workflow-engine/action-registry` and the workflow contracts,
 * whose Ajv validators are compiled with `new Function` when they load (only their own static schemas). Removing it needs those
 * validators precompiled or wallet proof split from the workflow engine (build report, follow-ups).
 */
/** Account pages served by this policy; the proxy matcher names the same paths. */
export const ACCOUNT_PAGE_PATHS = ['/login', '/onboarding', '/onboarding/:path*'] as const;
export const isAccountPage = (pathname: string) => pathname === '/login' || pathname === '/onboarding' || pathname.startsWith('/onboarding/');

/** A request nonce: 128 random bits, base64. */
export function cspNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

export function accountPagePolicy(nonce: string): string {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(nonce)) throw new Error('CSP_NONCE_INVALID');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
