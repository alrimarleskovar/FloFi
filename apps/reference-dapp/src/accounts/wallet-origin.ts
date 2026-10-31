// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet, the separate origin that alone holds managed-wallet provider sessions.
 *
 * Why a separate origin: the product pages (`/app` …) run a large surface (workflows, Copilot output, channels) under a policy without
 * `script-src`. A provider session key stored on that origin could be used by any script injected there to stamp an export or a signing
 * request and replay it to the provider directly, bypassing every FloFi check. So no provider session ever exists for a key the
 * product origin can reach. The wallet origin (`FLOFI_WALLET_ORIGIN`) is served by the same deployment but only for its own small set
 * of routes, under a nonce policy without `'unsafe-eval'`; the product origin can neither read its storage nor script its pages.
 *
 * Without a valid wallet origin, managed wallets (create, import, sign, export) are unavailable and shown as such; nothing is simulated.
 */
import { deploymentEnvironment, isHostedDeployment, publicOrigin } from '../server/deployment.ts';
import { turnkeyConfig } from './turnkey-server.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type WalletOrigin = {
  /** `https://wallet.example` (or a loopback origin in the MOCKED browser suite only). */
  readonly origin: string; readonly host: string;
  /** The product origin that may open FloFi Wallet and receive its answers. */
  readonly appOrigin: string; readonly appHost: string; readonly secure: boolean };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Production has one wallet origin, as it has one brand origin (`FLOFI_PRODUCTION_ORIGIN`); previews may name their own https host. */
export const FLOFI_PRODUCTION_WALLET_ORIGIN = 'https://wallet.flofi.xyz';
const fail = (code: string): never => { throw new Error(code); };

/** The wallet origin of this deployment, or null when it is absent or invalid (managed wallets then stay unavailable). */
export function walletOrigin(env: Env): WalletOrigin | null {
  const raw = env.FLOFI_WALLET_ORIGIN ?? '', app = publicOrigin(env);
  if (!raw || !app) return null;
  let url: URL, appUrl: URL;
  try { url = new URL(raw); appUrl = new URL(app); } catch { return null; }
  if (url.origin !== raw || url.username || url.password || url.host === appUrl.host) return null;
  if (deploymentEnvironment(env) === 'production' && url.origin !== FLOFI_PRODUCTION_WALLET_ORIGIN) return null;
  const loopback = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  // Plain http only for the MOCKED loopback browser suite on a local server (two loopback hosts = two origins).
  if (url.protocol !== 'https:' && !(loopback && env.FLOFI_TURNKEY_E2E === 'MOCKED_LOOPBACK_ONLY' && !isHostedDeployment(env))) return null;
  return { origin: url.origin, host: url.host, appOrigin: appUrl.origin, appHost: appUrl.host, secure: url.protocol === 'https:' };
}
/**
 * Hosts that must never serve the product, even when the wallet configuration is missing or invalid (fail closed): the production wallet
 * host and the host named by `FLOFI_WALLET_ORIGIN` when it parses. A host equal to the product's own is never reserved (that
 * misconfiguration only disables managed wallets).
 */
export function reservedWalletHosts(env: Env): ReadonlySet<string> {
  const hosts = new Set<string>([new URL(FLOFI_PRODUCTION_WALLET_ORIGIN).host]);
  try { if (env.FLOFI_WALLET_ORIGIN) hosts.add(new URL(env.FLOFI_WALLET_ORIGIN).host.toLowerCase()); } catch { /* unparseable: nothing to reserve */ }
  const app = publicOrigin(env);
  try { if (app) hosts.delete(new URL(app).host.toLowerCase()); } catch { /* no product origin */ }
  return hosts;
}
/** Managed wallets need both the provider and the wallet origin. */
export function managedWalletsAvailable(env: Env): boolean {
  return turnkeyConfig(env) !== null && walletOrigin(env) !== null;
}

/** Paths that exist only on the wallet origin. */
export const isWalletPath = (pathname: string) => pathname === '/wallet' || pathname.startsWith('/wallet/') || pathname === '/api/wallet'
  || pathname.startsWith('/api/wallet/');
/** What else the wallet origin serves: its pages' static assets. Everything else there is 404. */
export const isWalletAsset = (pathname: string) => pathname.startsWith('/_next/static/') || pathname.startsWith('/fonts/')
  || pathname.startsWith('/brand/') || pathname === '/favicon.ico';

/**
 * The wallet pages' policy: only scripts this response names (nonce, then what they load), no eval of any kind, no inline handler,
 * network only to the wallet origin itself, frames only the provider's import/export iframes, never framed.
 */
export function walletPagePolicy(nonce: string, env: Env = process.env): string {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(nonce)) fail('CSP_NONCE_INVALID');
  const provider = turnkeyConfig(env);
  const frames = provider ? [...new Set([provider.importIframeUrl, provider.exportIframeUrl])].join(' ') : "'none'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${frames}`,
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The wallet session cookie. On https it carries the `__Host-` prefix: host-only, Secure, Path=/, so a sibling host (for example the
 * product origin under the same registrable domain) cannot set or shadow it. The loopback suite runs on http, without the prefix.
 */
export const walletSessionCookie = (secure: boolean) => secure ? '__Host-flofi_wallet_session' : 'flofi_wallet_session';
