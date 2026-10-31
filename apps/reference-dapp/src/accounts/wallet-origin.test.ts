// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet runs on its own origin, serves only its own routes there and nothing of it exists on the product host.
import { describe, expect, it } from 'vitest';
import { createECDH } from 'node:crypto';
import { NextRequest } from 'next/server';
import { cspNonce } from './account-csp';
import { isWalletAsset, isWalletPath, managedWalletsAvailable, walletOrigin, walletPagePolicy, walletSessionCookie } from './wallet-origin';
import { proxy } from '../proxy';

const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const provider = { FLOFI_TURNKEY_ORGANIZATION_ID: '11111111-2222-4333-8444-555555555555',
  FLOFI_TURNKEY_API_PUBLIC_KEY: ecdh.getPublicKey('hex', 'compressed'), FLOFI_TURNKEY_API_PRIVATE_KEY: ecdh.getPrivateKey('hex').padStart(64, '0') };
const hosted = { FLOFI_PUBLIC_ORIGIN: 'https://app.flofi.example', FLOFI_WALLET_ORIGIN: 'https://wallet.flofi.example' };
const directives = (policy: string) => new Map(policy.split('; ').map(entry => { const [name, ...values] = entry.split(' '); return [name, values.join(' ')]; }));

describe('wallet origin configuration', () => {
  it('needs an exact https origin on another host than the product, and the provider, before managed wallets exist', () => {
    expect(walletOrigin(hosted)).toEqual({ origin: 'https://wallet.flofi.example', host: 'wallet.flofi.example', appOrigin: 'https://app.flofi.example',
      appHost: 'app.flofi.example', secure: true });
    for (const value of ['', 'https://app.flofi.example', 'https://wallet.flofi.example/', 'https://wallet.flofi.example/wallet', 'https://u:p@wallet.flofi.example',
      'http://wallet.flofi.example', 'http://127.0.0.1:3001', 'not a url']) expect(walletOrigin({ ...hosted, FLOFI_WALLET_ORIGIN: value }), value).toBeNull();
    expect(walletOrigin({ FLOFI_WALLET_ORIGIN: hosted.FLOFI_WALLET_ORIGIN })).toBeNull();
    expect(managedWalletsAvailable({ ...hosted, ...provider })).toBe(true);
    expect(managedWalletsAvailable(provider)).toBe(false);
    expect(managedWalletsAvailable(hosted)).toBe(false);
  });
  it('accepts a loopback wallet origin only in the MOCKED browser suite on a local server', () => {
    const local = { FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3000', FLOFI_WALLET_ORIGIN: 'http://localhost:3000' };
    expect(walletOrigin(local)).toBeNull();
    expect(walletOrigin({ ...local, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY' })?.secure).toBe(false);
    expect(walletOrigin({ ...local, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', VERCEL: '1' })).toBeNull();
    expect(walletOrigin({ ...local, FLOFI_WALLET_ORIGIN: 'http://127.0.0.1:3000', FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY' })).toBeNull();
  });
  it('names the session cookie with the __Host- prefix on https so a sibling host cannot set or shadow it', () => {
    expect(walletSessionCookie(true)).toBe('__Host-flofi_wallet_session');
    expect(walletSessionCookie(false)).toBe('flofi_wallet_session');
  });
});

describe('wallet page policy', () => {
  it('runs only nonce-bearing scripts, never eval, talks only to its own origin and frames only the provider iframes', () => {
    const nonce = cspNonce(), policy = directives(walletPagePolicy(nonce, { ...hosted, ...provider }));
    expect(policy.get('script-src')).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy.get('script-src')).not.toMatch(/unsafe|\*|https?:|data:|blob:/);
    expect(policy.get('connect-src')).toBe("'self'");
    expect(policy.get('frame-src')).toBe('https://import.turnkey.com https://export.turnkey.com');
    expect(policy.get('frame-ancestors')).toBe("'none'");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'none'");
    expect(policy.get('worker-src')).toBe("'none'");
    expect(directives(walletPagePolicy(cspNonce(), hosted)).get('frame-src')).toBe("'none'");
    expect(() => walletPagePolicy("x' 'unsafe-inline")).toThrow('CSP_NONCE_INVALID');
  });
  it('classifies wallet routes and assets exactly', () => {
    for (const path of ['/wallet', '/wallet/callback/google', '/api/wallet/session', '/api/wallet']) expect(isWalletPath(path)).toBe(true);
    for (const path of ['/', '/app', '/wallets', '/walletx', '/api/walletx', '/api/account/provider/x']) expect(isWalletPath(path)).toBe(false);
    for (const path of ['/_next/static/chunks/a.js', '/fonts/x.woff2', '/brand/logo.svg', '/favicon.ico']) expect(isWalletAsset(path)).toBe(true);
    expect(isWalletAsset('/app')).toBe(false);
  });
});

describe('proxy routing by host', () => {
  const env = { ...hosted, ...provider };
  async function route(url: string, init: { method?: string; headers?: Record<string, string> } = {}, overrides: Record<string, string> = {}) {
    const previous = { ...process.env }, applied = { ...env, ...overrides };
    Object.assign(process.env, applied);
    try {
      const target = new URL(url);
      return proxy(new NextRequest(url, { method: init.method ?? 'GET', headers: { host: target.host, ...init.headers } }));
    } finally { for (const key of Object.keys(applied)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
  }
  it('serves only wallet pages, wallet routes and static assets on the wallet host, under the strict policy', async () => {
    const page = await route('https://wallet.flofi.example/wallet');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'; /);
    expect(page.headers.get('content-security-policy')).not.toContain('unsafe-eval');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    for (const path of ['/app', '/', '/login', '/approve', '/api/account/provider/submit/export_wallet', '/api/mcp', '/docs']) {
      expect((await route(`https://wallet.flofi.example${path}`)).status, path).toBe(404);
    }
    // No server action runs on the wallet host, whatever page it is posted to.
    expect((await route('https://wallet.flofi.example/wallet', { method: 'POST', headers: { 'next-action': 'abc' } })).status).toBe(404);
    expect((await route('https://wallet.flofi.example/brand/logo.svg')).status).toBe(200);
  });
  it('fails closed: with an invalid wallet configuration the wallet host still serves no product page', async () => {
    for (const broken of [{ FLOFI_WALLET_ORIGIN: 'http://wallet.flofi.example' }, { FLOFI_WALLET_ORIGIN: 'https://wallet.flofi.example/path' }]) {
      for (const path of ['/app', '/login', '/', '/api/account/x']) expect((await route(`https://wallet.flofi.example${path}`, {}, broken)).status, path).toBe(404);
      expect((await route('https://app.flofi.example/app', {}, broken)).status).not.toBe(404);
    }
    // The production wallet host is reserved even when the variable is missing.
    expect((await route('https://wallet.flofi.xyz/app', {}, { FLOFI_WALLET_ORIGIN: '' })).status).toBe(404);
  });
  it('has no wallet routes on the product host and keeps the product policies unchanged', async () => {
    for (const path of ['/wallet', '/wallet/callback/google', '/api/wallet/session']) expect((await route(`https://app.flofi.example${path}`)).status, path).toBe(404);
    const login = await route('https://app.flofi.example/login');
    expect(login.headers.get('content-security-policy')).toMatch(/'unsafe-eval'/);
    const app = await route('https://app.flofi.example/app');
    expect(app.headers.get('content-security-policy')).toBeNull();
    expect((await route('https://app.flofi.example/mcp/approve')).headers.get('content-security-policy')).toMatch(/^connect-src 'self'; frame-ancestors /);
  });
});
