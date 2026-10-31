// SPDX-License-Identifier: AGPL-3.0-only
// Real RS256 verification against a disposable, test-only RSA key served as a JWKS by an in-process transport. No provider is contacted.
import { beforeEach, describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { authorizationUrl, clearJwksCache, e2eIdentityProvider, exchangeGoogleCode, oidcConfig, pkceChallenge, verifyIdToken, type OidcConfig } from './oidc';
import { newOidcFlow } from './account-session';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const env = { FLOFI_PUBLIC_ORIGIN: 'https://flofi.xyz', FLOFI_GOOGLE_CLIENT_ID: 'flofi-web.apps.googleusercontent.com', FLOFI_GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
  FLOFI_APPLE_CLIENT_ID: 'xyz.flofi.web' };
const google = oidcConfig('google', env)!, apple = oidcConfig('apple', env)!;
const now = new Date('2026-10-31T12:00:00.000Z'), at = Math.floor(now.getTime() / 1000);
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }, key = privateKey) {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key).toString('base64url')}`;
}
let fetched = 0;
const transport = (async (url: string | URL) => { fetched++; expect(String(url)).toMatch(/certs|keys$/); return new Response(JSON.stringify({ keys: [jwk] })); }) as typeof fetch;
const claims = (overrides: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: google.clientId, azp: google.clientId, sub: '1089', email: 'Ana@Example.com',
  email_verified: true, nonce: 'n'.repeat(43), iat: at - 5, exp: at + 3600, ...overrides });
const flow = { nonce: 'n'.repeat(43) };
beforeEach(() => { clearJwksCache(); fetched = 0; });

describe('OIDC ID token verification', () => {
  it('accepts a genuine Google token and normalises the verified email', async () => {
    expect(await verifyIdToken(google, sign(claims()), flow, { now, transport })).toEqual({ provider: 'google', subject: '1089', email: 'ana@example.com', emailVerified: true,
      expiresAt: new Date((at + 3600) * 1000) });
    expect(fetched).toBe(1);
    await verifyIdToken(google, sign(claims()), flow, { now, transport });
    expect(fetched).toBe(1);
  });
  it('accepts an Apple token with its string email_verified claim', async () => {
    const token = sign(claims({ iss: 'https://appleid.apple.com', aud: apple.clientId, azp: undefined, email_verified: 'true' }));
    expect(await verifyIdToken(apple, token, flow, { now, transport })).toMatchObject({ provider: 'apple', emailVerified: true });
  });
  it.each([
    ['another issuer', claims({ iss: 'https://evil.example' }), 'OIDC_TOKEN_ISSUER_INVALID'],
    ['another audience', claims({ aud: 'someone-else', azp: 'someone-else' }), 'OIDC_TOKEN_AUDIENCE_INVALID'],
    ['an expired token', claims({ exp: at - 600 }), 'OIDC_TOKEN_EXPIRED'],
    ['a stale token', claims({ iat: at - 3600 }), 'OIDC_TOKEN_STALE'],
    ['another nonce', claims({ nonce: 'x'.repeat(43) }), 'OIDC_NONCE_MISMATCH'],
    ['no nonce', claims({ nonce: undefined }), 'OIDC_NONCE_MISMATCH'],
    ['a malformed subject', claims({ sub: 'a b' }), 'OIDC_SUBJECT_INVALID'],
  ])('rejects %s', async (_, value, code) => {
    await expect(verifyIdToken(google, sign(value), flow, { now, transport })).rejects.toThrow(code);
  });
  it('rejects forged signatures, unsigned and symmetric tokens and unknown keys', async () => {
    await expect(verifyIdToken(google, sign(claims(), undefined, rogue.privateKey), flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_SIGNATURE_INVALID');
    const [h, p] = sign(claims()).split('.');
    await expect(verifyIdToken(google, `${b64({ alg: 'none', kid: 'k1' })}.${p}.`, flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_INVALID');
    await expect(verifyIdToken(google, `${b64({ alg: 'HS256', kid: 'k1' })}.${p}.abc`, flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_ALGORITHM_INVALID');
    await expect(verifyIdToken(google, `${h}.${b64(claims({ sub: 'attacker' }))}.${sign(claims()).split('.')[2]}`, flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_SIGNATURE_INVALID');
    await expect(verifyIdToken(google, sign(claims(), { alg: 'RS256', kid: 'rotated' }), flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_KEY_UNKNOWN');
    await expect(verifyIdToken(google, 'not.a.token!', flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_INVALID');
    await expect(verifyIdToken(google, undefined, flow, { now, transport })).rejects.toThrow('OIDC_TOKEN_INVALID');
  });
  it('fails closed when the provider keys cannot be fetched', async () => {
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(verifyIdToken(google, sign(claims()), flow, { now, transport: down })).rejects.toThrow('OIDC_JWKS_UNAVAILABLE');
  });
});

describe('OIDC configuration and requests', () => {
  it('is unavailable without a public origin or credentials', () => {
    expect(oidcConfig('google', { ...env, FLOFI_GOOGLE_CLIENT_SECRET: '' })).toBeNull();
    expect(oidcConfig('apple', { ...env, FLOFI_PUBLIC_ORIGIN: '' })).toBeNull();
    expect(google.redirectUri).toBe('https://flofi.xyz/auth/callback/google');
  });
  it('builds the code+PKCE (Google) and form_post (Apple) requests with state and nonce', () => {
    const flowG = newOidcFlow('google', null, 'sign-in', '/app'), url = new URL(authorizationUrl(google, flowG));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid email', state: flowG.state, nonce: flowG.nonce,
      code_challenge: pkceChallenge(flowG.verifier), code_challenge_method: 'S256', redirect_uri: google.redirectUri });
    expect(url.searchParams.has('client_secret')).toBe(false);
    const flowA = newOidcFlow('apple', null, 'sign-in', '/app'), appleUrl = new URL(authorizationUrl(apple, flowA));
    expect(Object.fromEntries(appleUrl.searchParams)).toMatchObject({ response_type: 'code id_token', response_mode: 'form_post', state: flowA.state, nonce: flowA.nonce });
  });
  it('exchanges the Google code server-to-server with the PKCE verifier', async () => {
    let body = '';
    const token = (async (_url: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ id_token: 'a.b.c' })); }) as unknown as typeof fetch;
    expect(await exchangeGoogleCode(google as OidcConfig, 'code-1', 'v'.repeat(64), token)).toBe('a.b.c');
    expect(Object.fromEntries(new URLSearchParams(body))).toMatchObject({ code: 'code-1', code_verifier: 'v'.repeat(64), grant_type: 'authorization_code' });
    await expect(exchangeGoogleCode(google, undefined, 'v', token)).rejects.toThrow('OIDC_CODE_INVALID');
  });
  it('allows the loopback test identity provider only when explicitly enabled on a non-hosted server', () => {
    expect(e2eIdentityProvider({})).toBeNull();
    expect(e2eIdentityProvider({ FLOFI_AUTH_E2E_IDP: 'MOCKED_LOOPBACK_ONLY', FLOFI_AUTH_E2E_IDP_ORIGIN: 'http://127.0.0.1:8571' })).toBe('http://127.0.0.1:8571');
    expect(() => e2eIdentityProvider({ FLOFI_AUTH_E2E_IDP: 'MOCKED_LOOPBACK_ONLY', FLOFI_AUTH_E2E_IDP_ORIGIN: 'https://idp.example' })).toThrow('AUTH_E2E_IDP_FORBIDDEN');
    expect(() => e2eIdentityProvider({ FLOFI_AUTH_E2E_IDP: 'MOCKED_LOOPBACK_ONLY', FLOFI_AUTH_E2E_IDP_ORIGIN: 'http://127.0.0.1:8571', VERCEL: '1' })).toThrow('AUTH_E2E_IDP_FORBIDDEN');
    expect(oidcConfig('google', { ...env, FLOFI_AUTH_E2E_IDP: 'MOCKED_LOOPBACK_ONLY', FLOFI_AUTH_E2E_IDP_ORIGIN: 'http://127.0.0.1:8571', VERCEL: '1' })).toBeNull();
  });
});
