// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // CI containers can expose the host CPU count. Bound page-generation workers to keep the build and PostgreSQL inside the runner's memory budget.
  ...(process.env.CI ? { experimental: { cpus: 2 } } : {}),
  // Optional isolated preview output: keep the owner's existing .next/dev server running.
  distDir: process.env.FLOFI_DOCS_PREVIEW === 'true' ? '.next-docs' : process.env.FLOFI_MOTION_PREVIEW === 'true' ? '.next-motion' : '.next',
  ...(process.env.FLOFI_DOCS_PREVIEW === 'true' ? { typescript: { tsconfigPath: 'tsconfig.docs-preview.json' } } : {}),
  // BUILD-CLOUD-PARITY-001: committed, read-only replay fixtures read at runtime (`FLOFI_COPILOT=replay`, recorded Base observation
  // replay) ship with the serverless functions, so those modes behave on a Vercel deployment as they do locally.
  outputFileTracingIncludes: {
    '/app{,/**}': ['./e2e/copilot/replay.json', './e2e/copilot/replay-v2.json', './e2e/observations/base-recorded-observations.json'],
    '/approve': ['./e2e/copilot/replay.json', './e2e/copilot/replay-v2.json', './e2e/observations/base-recorded-observations.json'],
    '/mcp/approve': ['./e2e/copilot/replay.json', './e2e/copilot/replay-v2.json', './e2e/observations/base-recorded-observations.json'],
  },
  // The browser may connect only to its own origin (read-only Base reads run on the local server) and, for Credentials → Add card,
  // to the three Mercado Pago origins its official Secure Fields SDK needs: its API, its static secure-fields host and the
  // secure-fields iframe origin. Card data is typed only inside those cross-origin iframes.
  async headers() {
    // BUILD-MCP-002: the approval and connections pages hold a handoff secret or account choices: never framed, cached, indexed or referred.
    const sensitive = [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "connect-src 'self'; frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }];
    const cardProvider = 'https://api.mercadopago.com https://api-static.mercadopago.com https://secure-fields.mercadopago.com';
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: `connect-src 'self' ${cardProvider}` }] },
      { source: '/approve', headers: sensitive }, { source: '/connections', headers: sensitive },
      // BUILD-FLOFI-AUTH-WALLETS-001: sign-in, wallet onboarding and Credentials (wallet import/export) are never framed by another site.
      ...['/login', '/onboarding', '/onboarding/:path*', '/app/credentials'].map(source => ({ source, headers: [{ key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: `connect-src 'self' ${cardProvider}; frame-ancestors 'none'` }, { key: 'Referrer-Policy', value: 'no-referrer' }] })),
      // BUILD-ADMIN-001: the private console and its APIs are never framed, cached, indexed or referred either.
      { source: '/admin', headers: sensitive }, { source: '/admin/:path*', headers: sensitive }];
  },
};

export default config;

/**
 * BUILD-002 compatibility shim for a declaration defect in next@16.3.5.
 *
 * The published Next declaration references URLPatternInput and
 * URLPatternOptions as globals, while TypeScript 5.9.3 and the installed
 * @types/node@24.13.4 do not provide both names globally.
 *
 * This is type-only. It does not install or polyfill URLPattern and has no
 * runtime effect. Remove and re-review it when Next, TypeScript, or Node type
 * versions change.
 */
declare global {
  type URLPatternInput = string | URLPatternInit;
  type URLPatternOptions = import("node:url").URLPatternOptions;
}
