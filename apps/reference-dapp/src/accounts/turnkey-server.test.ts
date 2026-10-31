// SPDX-License-Identifier: AGPL-3.0-only
// The parent-API stamp is verified with node:crypto against the configured public key; the provider is an in-process transport.
import { describe, expect, it } from 'vitest';
import { createECDH, createPublicKey, verify } from 'node:crypto';
import { apiKeyStamp, clientSignature, createTurnkeyServer, emailSignupSignatureMessage, loginSignatureMessage, turnkeyConfig } from './turnkey-server';

const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const apiPrivateKey = ecdh.getPrivateKey('hex').padStart(64, '0'), apiPublicKey = ecdh.getPublicKey('hex', 'compressed');
const env = { FLOFI_TURNKEY_ORGANIZATION_ID: '11111111-2222-4333-8444-555555555555', FLOFI_TURNKEY_API_PUBLIC_KEY: apiPublicKey, FLOFI_TURNKEY_API_PRIVATE_KEY: apiPrivateKey };
const config = turnkeyConfig(env)!;
type Call = { path: string; body: Record<string, unknown>; stamp: string };
function provider(answer: (call: Call) => unknown, calls: Call[] = []) {
  return Object.assign((async (url: string, init: RequestInit) => {
    const call = { path: new URL(url).pathname, body: JSON.parse(String(init.body)) as Record<string, unknown>, stamp: (init.headers as Record<string, string>)['X-Stamp']! };
    calls.push(call);
    return new Response(JSON.stringify(answer(call)));
  }) as unknown as typeof fetch, { calls });
}
const completed = (result: object) => ({ activity: { id: 'activity-0001', status: 'ACTIVITY_STATUS_COMPLETED', result } });

describe('Turnkey parent API stamp', () => {
  it('signs the exact body with the configured P-256 key in the provider format', () => {
    const body = JSON.stringify({ organizationId: config.organizationId }), stamp = JSON.parse(Buffer.from(apiKeyStamp(config, body), 'base64url').toString());
    expect(stamp).toMatchObject({ publicKey: apiPublicKey, scheme: 'SIGNATURE_SCHEME_TK_API_P256' });
    const point = ecdh.getPublicKey();
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(body), key, Buffer.from(stamp.signature, 'hex'))).toBe(true);
    expect(verify('sha256', Buffer.from(body + ' '), key, Buffer.from(stamp.signature, 'hex'))).toBe(false);
  });
  it('fails closed on a mismatched key pair or an unofficial provider host', () => {
    const other = createECDH('prime256v1'); other.generateKeys();
    expect(() => apiKeyStamp({ apiPublicKey: other.getPublicKey('hex', 'compressed'), apiPrivateKey }, '{}')).toThrow('TURNKEY_API_KEY_MISMATCH');
    expect(turnkeyConfig({})).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_API_BASE_URL: 'https://api.evil.example' })).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_EXPORT_IFRAME_URL: 'http://127.0.0.1:9' })).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_TURNKEY_API_BASE_URL: 'http://127.0.0.1:9' })?.apiBaseUrl).toBe('http://127.0.0.1:9');
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', VERCEL: '1' })).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_API_PRIVATE_KEY: 'zz' })).toBeNull();
    expect(Object.values(createTurnkeyServer(config).browser()).join(' ')).not.toContain(apiPrivateKey);
  });
});

describe('Turnkey activities', () => {
  it('sends the code with the encrypted-OTP activities and never receives the code itself', async () => {
    const bundle = JSON.stringify({ enclaveQuorumPublic: '04' + 'a'.repeat(128), dataSignature: 'ab'.repeat(32), data: '7b7d' });
    const transport = provider(call => call.path.endsWith('init_otp') ? completed({ initOtpResultV2: { otpId: 'otp-00000001', otpEncryptionTargetBundle: bundle } })
      : completed({ verifyOtpResult: { verificationToken: 'aGVhZGVy.cGF5bG9hZA.c2ln' } }));
    const server = createTurnkeyServer(config, transport);
    expect(await server.initEmailOtp('ana@example.com')).toEqual({ otpId: 'otp-00000001', targetBundle: bundle });
    expect(await server.verifyEmailOtp('otp-00000001', '{"encappedPublic":"04","ciphertext":"00"}')).toBe('aGVhZGVy.cGF5bG9hZA.c2ln');
    expect(transport.calls.map(call => [call.path, call.body.type, call.body.organizationId])).toEqual([
      ['/public/v1/submit/init_otp', 'ACTIVITY_TYPE_INIT_OTP_V3', config.organizationId], ['/public/v1/submit/verify_otp', 'ACTIVITY_TYPE_VERIFY_OTP_V2', config.organizationId]]);
    expect(transport.calls[0]!.body.parameters).toEqual({ otpType: 'OTP_TYPE_EMAIL', contact: 'ana@example.com', appName: 'FloFi', otpLength: 6, alphanumeric: false, expirationSeconds: '600' });
    expect(transport.calls[1]!.body.parameters).toEqual({ otpId: 'otp-00000001', encryptedOtpBundle: '{"encappedPublic":"04","ciphertext":"00"}', expirationSeconds: '600' });
    // No legacy activity and no plaintext code anywhere in the requests.
    expect(JSON.stringify(transport.calls)).not.toMatch(/ACTIVITY_TYPE_VERIFY_OTP"|otpCode/);
    // A target bundle that is not the provider's signed shape is refused before it reaches the browser.
    for (const broken of ['not-json', JSON.stringify({ data: 'zz', dataSignature: 'ab', enclaveQuorumPublic: '04' }), JSON.stringify({ data: '00' })]) {
      const bad = provider(() => completed({ initOtpResultV2: { otpId: 'otp-00000001', otpEncryptionTargetBundle: broken } }));
      await expect(createTurnkeyServer(config, bad).initEmailOtp('ana@example.com')).rejects.toThrow('TURNKEY_RESPONSE_INVALID');
    }
  });
  it('accepts a verification token only for this address, this browser key, unexpired and signed by the provider', async () => {
    const key = '02' + 'b'.repeat(64), now = Date.parse('2026-10-31T10:00:00Z');
    const claims = { id: 'token-00000001', verification_type: 'OTP_TYPE_EMAIL', contact: 'Ana@Example.com', organization_id: config.organizationId, public_key: key,
      exp: String(now + 60_000) };
    const verifier = (value: Record<string, unknown> | Error) => async () => { if (value instanceof Error) throw value; return value; };
    const server = (value: Record<string, unknown> | Error) => createTurnkeyServer(config, provider(() => ({})), async () => undefined, verifier(value));
    expect(await server(claims).verificationClaims('h.p.s', { contact: 'ana@example.com', publicKey: key }, now))
      .toEqual({ id: 'token-00000001', contact: 'Ana@Example.com', publicKey: key, organizationId: config.organizationId, expiresAtMs: now + 60_000 });
    await expect(server(new Error('signature')).verificationClaims('h.p.s', { contact: 'ana@example.com', publicKey: key }, now)).rejects.toThrow('EMAIL_VERIFICATION_INVALID');
    await expect(server({ ...claims, exp: String(now) }).verificationClaims('h.p.s', { contact: 'ana@example.com', publicKey: key }, now)).rejects.toThrow('EMAIL_VERIFICATION_INVALID');
    await expect(server(claims).verificationClaims('h.p.s', { contact: 'eve@example.com', publicKey: key }, now)).rejects.toThrow('EMAIL_VERIFICATION_MISMATCH');
    await expect(server(claims).verificationClaims('h.p.s', { contact: 'ana@example.com', publicKey: '03' + 'b'.repeat(64) }, now)).rejects.toThrow('EMAIL_VERIFICATION_MISMATCH');
    // The production verifier pins Turnkey's key; an override is accepted only by the MOCKED loopback configuration.
    expect(config.otpSignerPublicKey).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY: '04' + 'c'.repeat(128) })).toBeNull();
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY: '04' + 'c'.repeat(128) })?.otpSignerPublicKey).toBe('04' + 'c'.repeat(128));
    expect(turnkeyConfig({ ...env, FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY: '04' + 'c'.repeat(128), VERCEL: '1' })).toBeNull();
  });
  it('builds the client-signature messages exactly as the provider SDK and logs in with OTP_LOGIN_V2', async () => {
    const key = '03' + 'd'.repeat(64);
    expect(loginSignatureMessage('token-00000001', key)).toBe(`{"login":{"publicKey":"${key}"},"tokenId":"token-00000001","type":"USAGE_TYPE_LOGIN"}`);
    expect(emailSignupSignatureMessage('token-00000001', 'ana@example.com'))
      .toBe('{"signupV2":{"apiKeys":[],"authenticators":[],"oauthProviders":[],"email":"ana@example.com"},"tokenId":"token-00000001","type":"USAGE_TYPE_SIGNUP"}');
    expect(() => loginSignatureMessage('t', key)).toThrow('TURNKEY_SIGNATURE_MESSAGE_INVALID');
    expect(() => clientSignature(key, 'm', 'zz')).toThrow('TURNKEY_CLIENT_SIGNATURE_INVALID');
    const signature = clientSignature(key, loginSignatureMessage('token-00000001', key), 'e'.repeat(128));
    const transport = provider(() => completed({ otpLoginResult: { session: 'session.jwt.value' } }));
    expect(await createTurnkeyServer(config, transport).emailLogin('org-0000-0001', 'h.p.s', key, signature)).toBe('session.jwt.value');
    expect(transport.calls[0]!.body).toMatchObject({ type: 'ACTIVITY_TYPE_OTP_LOGIN_V2', organizationId: 'org-0000-0001',
      parameters: { verificationToken: 'h.p.s', publicKey: key, clientSignature: { publicKey: key, scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256',
        message: signature.message, signature: 'e'.repeat(128) }, expirationSeconds: '1800', invalidateExisting: true } });
    // A signature by another key than the session key is refused before any request.
    await expect(createTurnkeyServer(config, transport).emailLogin('org-0000-0001', 'h.p.s', '02' + 'd'.repeat(64), signature)).rejects.toThrow('TURNKEY_CLIENT_SIGNATURE_INVALID');
    expect(transport.calls).toHaveLength(1);
    // Email sign-up passes the verification token with the signup client signature (CREATE_SUB_ORGANIZATION_V8).
    const signup = provider(() => completed({ createSubOrganizationResultV8: { subOrganizationId: 'org-0000-0002', rootUserIds: ['user-0000-0002'] } }));
    const signupSignature = clientSignature(key, emailSignupSignatureMessage('token-00000001', 'ana@example.com'), 'f'.repeat(128));
    expect(await createTurnkeyServer(config, signup).createOrganization('flofi-acct', { email: 'ana@example.com', verificationToken: 'h.p.s', clientSignature: signupSignature }))
      .toEqual({ organization: 'org-0000-0002', user: 'user-0000-0002' });
    expect(signup.calls[0]!.body.parameters).toMatchObject({ verificationToken: 'h.p.s', clientSignature: signupSignature, rootQuorumThreshold: 1,
      rootUsers: [{ userEmail: 'ana@example.com', apiKeys: [], authenticators: [], oauthProviders: [] }] });
  });
  it('creates a sub-organization whose only root user is the person (no FloFi key)', async () => {
    const transport = provider(() => completed({ createSubOrganizationResultV7: { subOrganizationId: 'org-0000-0001', rootUserIds: ['user-0000-0001'] } }));
    expect(await createTurnkeyServer(config, transport).createOrganization('flofi-acct', { provider: 'Google', oidcToken: 'h.p.s', email: 'ana@example.com' }))
      .toEqual({ organization: 'org-0000-0001', user: 'user-0000-0001' });
    const parameters = transport.calls[0]!.body.parameters as { rootUsers: { apiKeys: unknown[]; authenticators: unknown[]; oauthProviders: unknown[] }[]; rootQuorumThreshold: number };
    expect(parameters.rootQuorumThreshold).toBe(1);
    expect(parameters.rootUsers).toHaveLength(1);
    expect(parameters.rootUsers[0]).toMatchObject({ apiKeys: [], authenticators: [], oauthProviders: [{ providerName: 'Google', oidcToken: 'h.p.s' }] });
  });
  it('polls pending activities and never reads consensus, rejection or failure as success', async () => {
    let polls = 0;
    const transport = provider(call => call.path.endsWith('get_activity') ? (++polls < 2 ? { activity: { id: 'activity-0001', status: 'ACTIVITY_STATUS_PENDING' } }
      : completed({ oauthLoginResult: { session: 'session.jwt.value' } })) : { activity: { id: 'activity-0001', status: 'ACTIVITY_STATUS_CREATED' } });
    expect(await createTurnkeyServer(config, transport, async () => undefined).oidcLogin('org-0000-0001', 'h.p.s', '02' + 'a'.repeat(64))).toBe('session.jwt.value');
    // The FloFi Wallet provider session lives as long as the 30-minute wallet session, for the wallet origin's own key only.
    expect(transport.calls[0]!.body.parameters).toEqual({ oidcToken: 'h.p.s', publicKey: '02' + 'a'.repeat(64), expirationSeconds: '1800', invalidateExisting: true });
    for (const status of ['ACTIVITY_STATUS_CONSENSUS_NEEDED', 'ACTIVITY_STATUS_REJECTED', 'ACTIVITY_STATUS_FAILED']) {
      const stuck = provider(() => ({ activity: { id: 'activity-0001', status, result: { oauthLoginResult: { session: 'session.jwt.value' } } } }));
      await expect(createTurnkeyServer(config, stuck, async () => undefined).oidcLogin('org-0000-0001', 'h.p.s', '02' + 'a'.repeat(64))).rejects.toThrow('TURNKEY_ACTIVITY_NOT_COMPLETED');
    }
    const unauthorized = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(createTurnkeyServer(config, unauthorized).walletAccounts('org-0000-0001')).rejects.toThrow('TURNKEY_UNAUTHORIZED');
  });
  it('reads only public wallet metadata', async () => {
    const transport = provider(call => call.path.endsWith('list_wallet_accounts')
      ? { accounts: [{ walletId: 'wallet-0001', address: '0xAbC0000000000000000000000000000000000001', addressFormat: 'ADDRESS_FORMAT_ETHEREUM' },
        { walletId: 'wallet-0001', address: 'bc1q', addressFormat: 'ADDRESS_FORMAT_BITCOIN' }] }
      : { privateKeys: [{ privateKeyId: 'key-00000001', imported: true, addresses: [{ format: 'ADDRESS_FORMAT_SOLANA', address: 'So11111111111111111111111111111111111111112' }] }] });
    const server = createTurnkeyServer(config, transport);
    expect(await server.walletAccounts('org-0000-0001')).toEqual([{ walletId: 'wallet-0001', address: '0xAbC0000000000000000000000000000000000001', format: 'ADDRESS_FORMAT_ETHEREUM' }]);
    expect(await server.privateKeys('org-0000-0001')).toEqual([{ privateKeyId: 'key-00000001', imported: true, addresses: [{ format: 'ADDRESS_FORMAT_SOLANA', address: 'So11111111111111111111111111111111111111112' }] }]);
  });
});
