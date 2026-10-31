// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001 integration on real PostgreSQL. The identity provider is a disposable RSA key served as a JWKS by an
 * in-process transport; the wallet provider is the shared MOCKED emulator (e2e/turnkey-emulator.ts) behind FloFi's REAL server client:
 * verified stamps, encrypted OTP with real HPKE, provider-signed verification tokens. MOCKED provider evidence only: this proves FloFi's
 * own verification, isolation and authorization rules, not the live providers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createECDH, createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { encryptOtpCodeToBundle } from '@turnkey/crypto';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness';
import { createAccountStore } from './account-store';
import { createAccountService } from './account-service';
import { clearJwksCache, oidcConfig } from './oidc';
import { newOidcFlow, type AccountSessionToken } from './account-session';
import { createTurnkeyServer, turnkeyConfig } from './turnkey-server';
import { createTurnkeyEmulator, E2E_SIGN_IN_CODE } from '../../e2e/turnkey-emulator';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = (async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }))) as unknown as typeof fetch;
const env = { FLOFI_PUBLIC_ORIGIN: 'https://flofi.xyz', FLOFI_APPLE_CLIENT_ID: 'xyz.flofi.web' };
const apple = oidcConfig('apple', env)!;
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(sub: string, nonce: string, at: number) {
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ iss: 'https://appleid.apple.com', aud: apple.clientId, sub, nonce, iat: at, exp: at + 600, email: `${sub}@example.com`, email_verified: 'true', jti: randomUUID() })}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
}
const EVM = '0x' + 'e'.repeat(40), SOL = 'So11111111111111111111111111111111111111112';
/** A sign-in attempt's browser key (only its public half is ever sent; this test plays the browser). */
function browserKey() { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); return ecdh.getPublicKey('hex', 'compressed'); }

let t: TestDatabase, clock: Date, emulator: ReturnType<typeof createTurnkeyEmulator>, turnkey: ReturnType<typeof createTurnkeyServer>;
function provider() {
  const parent = createECDH('prime256v1'); parent.generateKeys();
  const organization = randomUUID(), signer = randomBytes(32).toString('hex');
  emulator = createTurnkeyEmulator({ parentPublicKey: parent.getPublicKey('hex', 'compressed'), parentOrg: organization, otpSignerPrivateKey: signer });
  const config = turnkeyConfig({ FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_TURNKEY_ORGANIZATION_ID: organization,
    FLOFI_TURNKEY_API_PUBLIC_KEY: parent.getPublicKey('hex', 'compressed'), FLOFI_TURNKEY_API_PRIVATE_KEY: parent.getPrivateKey('hex').padStart(64, '0'),
    FLOFI_TURNKEY_API_BASE_URL: 'http://127.0.0.1:9', FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY: emulator.otpSignerPublicKey })!;
  turnkey = createTurnkeyServer(config, emulator.transport, async () => undefined);
}
const service = () => createAccountService({ store: createAccountStore(t.db, 'default'), turnkey, now: () => clock, transport: jwks });
async function appleSignIn(sub: string, current: AccountSessionToken | null = null, intent: 'sign-in' | 'link' = 'sign-in') {
  const flow = newOidcFlow('apple', null, intent, '/app');
  return service().completeOidc(apple, flow, { idToken: idToken(sub, flow.nonce, Math.floor(clock.getTime() / 1000)) }, current);
}
/** Starts an email sign-in and returns the flow plus the browser-side encryption of `code` with the attempt's own key. */
async function emailAttempt(email: string, key = browserKey()) {
  const started = await service().startEmail(email, key);
  const flow = { challengeId: started.challengeId, intent: 'sign-in' as const, returnTo: '/app' };
  const encrypt = (code: string, as = key) => encryptOtpCodeToBundle(code, started.targetBundle, as, emulator.otpSignerPublicKey);
  return { started, flow, key, encrypt };
}
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => t?.drop());
beforeEach(async () => { await t.db.query('TRUNCATE flofi_accounts, flofi_account_email_challenges, flofi_account_used_proofs CASCADE'); provider(); clock = new Date(); clearJwksCache(); });

describe('email sign-in with the provider’s encrypted code', () => {
  it('signs a new person in only after the provider verifies the code they encrypted in their browser; no wallet session is opened', async () => {
    const { started, flow, encrypt } = await emailAttempt(' Bruno@Example.com ');
    expect(started.email).toBe('bruno@example.com');
    // The target is the provider's signed bundle; FloFi's server never receives the code itself.
    expect(JSON.parse(started.targetBundle)).toMatchObject({ enclaveQuorumPublic: emulator.otpSignerPublicKey });
    expect(await service().completeEmail(flow, await encrypt(E2E_SIGN_IN_CODE), null)).toMatchObject({ created: true, managed: null, managedError: null });
    // Signing in opened no provider organization or session (managed wallets are unlocked only in FloFi Wallet).
    expect(emulator.orgs.size).toBe(0);
    expect(JSON.stringify((await t.db.query('SELECT * FROM flofi_account_email_challenges')).rows)).not.toContain(E2E_SIGN_IN_CODE);
  });
  it('refuses wrong codes, garbage and a bundle encrypted for another browser key; nothing is signed in', async () => {
    const { flow, encrypt } = await emailAttempt('carla@example.com');
    await expect(service().completeEmail(flow, await encrypt('000000'), null)).rejects.toThrow('EMAIL_CODE_REJECTED');
    await expect(service().completeEmail(flow, '{"encappedPublic":"04","ciphertext":"00"}'.padEnd(80, ' '), null)).rejects.toThrow('EMAIL_CODE_REJECTED');
    await expect(service().completeEmail(flow, 'x', null)).rejects.toThrow('EMAIL_CODE_INVALID');
    // The right code, encrypted with another key than the one this attempt declared: the provider-signed token names the other key.
    await expect(service().completeEmail(flow, await encrypt(E2E_SIGN_IN_CODE, browserKey()), null)).rejects.toThrow('EMAIL_VERIFICATION_MISMATCH');
    expect((await t.db.query('SELECT count(*)::int AS n FROM flofi_accounts')).rows).toEqual([{ n: 0 }]);
  });
  it('is single use: a challenge, its encrypted bundle and its verification token sign in once', async () => {
    const { flow, encrypt } = await emailAttempt('dora@example.com'), bundle = await encrypt(E2E_SIGN_IN_CODE);
    await service().completeEmail(flow, bundle, null);
    await expect(service().completeEmail(flow, bundle, null)).rejects.toThrow('EMAIL_CHALLENGE_EXPIRED');
    // A second challenge for the same address cannot reuse the first attempt's bundle (another OTP id at the provider).
    const second = await emailAttempt('dora@example.com');
    await expect(service().completeEmail(second.flow, bundle, null)).rejects.toThrow('EMAIL_CODE_REJECTED');
  });
  it('limits code guesses per challenge and code requests per address', async () => {
    const { flow, encrypt } = await emailAttempt('erik@example.com');
    for (let attempt = 0; attempt < 5; attempt++) await expect(service().completeEmail(flow, await encrypt('000000'), null)).rejects.toThrow('EMAIL_CODE_REJECTED');
    // The sixth try is refused before reaching the provider, even with the right code.
    await expect(service().completeEmail(flow, await encrypt(E2E_SIGN_IN_CODE), null)).rejects.toThrow('EMAIL_CHALLENGE_EXPIRED');
    for (let request = 0; request < 4; request++) await service().startEmail('erik@example.com', browserKey());
    await expect(service().startEmail('erik@example.com', browserKey())).rejects.toThrow('EMAIL_RATE_LIMITED');
    await expect(service().startEmail('fern@example.com', browserKey())).resolves.toMatchObject({ email: 'fern@example.com' });
    clock = new Date(clock.getTime() + 61 * 60_000);
    await expect(service().startEmail('erik@example.com', browserKey())).resolves.toMatchObject({ email: 'erik@example.com' });
  });
  it('links a verified email only to the signed-in account, never moving it from another account', async () => {
    const ana = await appleSignIn('ana'), bruno = await appleSignIn('bruno');
    const first = await emailAttempt('shared@example.com');
    await service().completeEmail({ ...first.flow, intent: 'link' }, await first.encrypt(E2E_SIGN_IN_CODE), ana.session);
    const second = await emailAttempt('shared@example.com');
    await expect(service().completeEmail({ ...second.flow, intent: 'link' }, await second.encrypt(E2E_SIGN_IN_CODE), bruno.session)).rejects.toThrow('ACCOUNT_IDENTITY_LINKED_ELSEWHERE');
    expect((await service().view(ana.session))?.identities.map(identity => identity.kind).sort()).toEqual(['apple', 'email']);
    expect((await service().view(bruno.session))?.identities.map(identity => identity.kind)).toEqual(['apple']);
  });
});

describe('account service', () => {
  it('signs a new Apple user in once per ID token and opens no wallet-provider session', async () => {
    const outcome = await appleSignIn('ana');
    expect(outcome).toMatchObject({ created: true, onboarding: 'pending', managed: null, managedError: null });
    expect(await appleSignIn('ana')).toMatchObject({ created: false, session: { accountId: outcome.session.accountId } });
    expect(emulator.orgs.size).toBe(0);
    const flow = newOidcFlow('apple', null, 'sign-in', '/app'), token = idToken('ana', flow.nonce, Math.floor(clock.getTime() / 1000));
    await service().completeOidc(apple, flow, { idToken: token }, null);
    await expect(service().completeOidc(apple, flow, { idToken: token }, null)).rejects.toThrow('OIDC_TOKEN_REPLAYED');
  });
  it('rejects an ID token whose nonce is not this flow’s', async () => {
    const flow = newOidcFlow('apple', null, 'sign-in', '/app'), other = newOidcFlow('apple', null, 'sign-in', '/app');
    await expect(service().completeOidc(apple, flow, { idToken: idToken('ana', other.nonce, Math.floor(clock.getTime() / 1000)) }, null)).rejects.toThrow('OIDC_NONCE_MISMATCH');
  });
  it('deletes an account and its data only after a recent sign-in', async () => {
    const ana = await appleSignIn('ana');
    clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(service().deleteAccount(ana.session)).rejects.toThrow('ACCOUNT_REAUTHENTICATION_REQUIRED');
    const fresh = await appleSignIn('ana');
    await service().deleteAccount(fresh.session);
    for (const table of ['flofi_accounts', 'flofi_account_identities', 'flofi_account_sessions', 'flofi_account_wallets'])
      expect((await t.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows, table).toEqual([{ n: 0 }]);
    expect(await appleSignIn('ana')).toMatchObject({ created: true });
  });
  it('signs a Web3 wallet in as its own account, recorded as a non-exportable external wallet', async () => {
    const outcome = await service().completeWallet({ namespace: 'eip155', address: EVM.toUpperCase().replace('0X', '0x') }, { key: 'io.metamask', name: 'MetaMask' }, 'sign-in', null);
    expect(outcome).toMatchObject({ created: true, managed: null });
    expect((await service().view(outcome.session))?.wallets).toEqual([expect.objectContaining({ address: EVM, origin: 'external', export: 'none', provider: 'io.metamask' })]);
  });
  it('saves managed wallets only when the provider confirms they belong to this person’s own organization', async () => {
    const ana = await appleSignIn('ana'), bruno = await appleSignIn('bruno');
    // Organizations exist only after a FloFi Wallet unlock (wallet-service.pg.test.ts); here they are set up directly.
    const orgA = { id: 'org-ana-00000001', user: 'user-ana-0001', email: null, oidc: null, sessions: new Map(), keys: [],
      wallets: [{ walletId: 'wallet-ana-0001', accounts: [{ walletId: 'wallet-ana-0001', address: SOL, format: 'ADDRESS_FORMAT_SOLANA' }] }] };
    const orgB = { id: 'org-bruno-000001', user: 'user-bruno-001', email: null, oidc: null, sessions: new Map(), wallets: [], keys: [] };
    emulator.orgs.set(orgA.id, orgA); emulator.orgs.set(orgB.id, orgB);
    const store = createAccountStore(t.db, 'default');
    await store.setWalletOrganization(ana.session.accountId, { provider: 'turnkey', organization: orgA.id, user: orgA.user, login: 'apple' }, clock);
    await store.setWalletOrganization(bruno.session.accountId, { provider: 'turnkey', organization: orgB.id, user: orgB.user, login: 'apple' }, clock);
    expect(await service().saveManagedWallets(ana.session, [`solana:${SOL}`])).toEqual([expect.objectContaining({ origin: 'generated', export: 'recovery-phrase' })]);
    await expect(service().saveManagedWallets(bruno.session, [`solana:${SOL}`])).rejects.toThrow('ACCOUNT_WALLET_NOT_OWNED');
    await expect(service().saveManagedWallets(ana.session, ['evm:not-an-address'])).rejects.toThrow('ACCOUNT_WALLET_INVALID');
  });
  it('links identities only with a fresh session and never moves one from another account', async () => {
    const ana = await appleSignIn('ana'), wallet = await service().completeWallet({ namespace: 'solana', address: SOL }, { key: 'Phantom', name: 'Phantom' }, 'sign-in', null);
    await expect(service().linkExternalWallet(ana.session, { namespace: 'solana', address: SOL }, { key: 'Phantom', name: 'Phantom' })).rejects.toThrow('ACCOUNT_WALLET_LINKED_ELSEWHERE');
    expect(await service().linkExternalWallet(ana.session, { namespace: 'eip155', address: EVM }, { key: 'io.metamask', name: 'MetaMask' })).toMatchObject({ origin: 'external' });
    await expect(service().linkExternalWallet(ana.session, null, { key: 'x', name: 'x' })).rejects.toThrow('WALLET_SESSION_REQUIRED');
    await expect(appleSignIn('carla', wallet.session, 'link')).resolves.toMatchObject({ session: { accountId: wallet.session.accountId } });
    clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(appleSignIn('dora', ana.session, 'link')).rejects.toThrow('ACCOUNT_REAUTHENTICATION_REQUIRED');
  });
  it('keeps FloFi sign-in working when the wallet provider is not configured, and says so', async () => {
    const plain = createAccountService({ store: createAccountStore(t.db, 'default'), turnkey: null, now: () => clock, transport: jwks });
    const flow = newOidcFlow('apple', null, 'sign-in', '/app');
    expect(await plain.completeOidc(apple, flow, { idToken: idToken('ana', flow.nonce, Math.floor(clock.getTime() / 1000)) }, null)).toMatchObject({ created: true, managed: null });
    await expect(plain.startEmail('ana@example.com', browserKey())).rejects.toThrow('EMAIL_SIGN_IN_NOT_CONFIGURED');
  });
});
