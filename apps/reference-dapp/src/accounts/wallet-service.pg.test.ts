// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet unlock, organization binding and export authorization on real PostgreSQL, with FloFi's REAL
 * Turnkey server client talking to the shared MOCKED emulator (e2e/turnkey-emulator.ts). The test plays the wallet page: it holds the
 * wallet key, encrypts the code to the provider's target and builds and signs the provider's messages itself. MOCKED provider evidence only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createECDH, createPrivateKey, createSign, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { encryptOtpCodeToBundle } from '@turnkey/crypto';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness';
import { createAccountStore } from './account-store';
import { createAccountService } from './account-service';
import { createWalletService } from './wallet-service';
import { newWalletSession, type WalletSession } from './wallet-session';
import { clearJwksCache, oidcConfig } from './oidc';
import { newOidcFlow, type AccountSessionToken } from './account-session';
import { createTurnkeyServer, emailSignupSignatureMessage, loginSignatureMessage, turnkeyConfig } from './turnkey-server';
import { createTurnkeyEmulator, E2E_SIGN_IN_CODE, E2E_WALLET_CODE } from '../../e2e/turnkey-emulator';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = (async () => new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }))) as unknown as typeof fetch;
const env = { FLOFI_PUBLIC_ORIGIN: 'https://flofi.xyz', FLOFI_APPLE_CLIENT_ID: 'xyz.flofi.web', FLOFI_WALLET_APPLE_CLIENT_ID: 'xyz.flofi.wallet' };
const apple = oidcConfig('apple', env)!, walletApple = oidcConfig('apple', env, 'https://wallet.flofi.xyz')!;
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(aud: string, sub: string, nonce: string, at: number) {
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({ iss: 'https://appleid.apple.com', aud, sub, nonce, iat: at, exp: at + 600, email: `${sub}@example.com`, email_verified: 'true', jti: randomUUID() })}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
}
/** A P-256 key the way the wallet page holds one: public half (compressed hex) and a raw (r‖s) signer. */
function walletKey() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const point = ecdh.getPublicKey(), key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: ecdh.getPrivateKey().toString('base64url'),
    x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
  const raw = (message: string) => sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('hex');
  const stamp = (body: string) => Buffer.from(JSON.stringify({ publicKey: ecdh.getPublicKey('hex', 'compressed'), scheme: 'SIGNATURE_SCHEME_TK_API_P256',
    signature: sign('sha256', Buffer.from(body), key).toString('hex') })).toString('base64url');
  return { public: ecdh.getPublicKey('hex', 'compressed'), raw, stamp };
}

let t: TestDatabase, clock: Date, emulator: ReturnType<typeof createTurnkeyEmulator>, turnkey: ReturnType<typeof createTurnkeyServer>;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => t?.drop());
beforeEach(async () => {
  await t.db.query('TRUNCATE flofi_accounts, flofi_account_email_challenges, flofi_account_used_proofs CASCADE');
  clock = new Date(); clearJwksCache();
  const parent = createECDH('prime256v1'); parent.generateKeys();
  const organization = randomUUID();
  emulator = createTurnkeyEmulator({ parentPublicKey: parent.getPublicKey('hex', 'compressed'), parentOrg: organization, otpSignerPrivateKey: randomBytes(32).toString('hex') });
  turnkey = createTurnkeyServer(turnkeyConfig({ FLOFI_TURNKEY_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_TURNKEY_ORGANIZATION_ID: organization,
    FLOFI_TURNKEY_API_PUBLIC_KEY: parent.getPublicKey('hex', 'compressed'), FLOFI_TURNKEY_API_PRIVATE_KEY: parent.getPrivateKey('hex').padStart(64, '0'),
    FLOFI_TURNKEY_API_BASE_URL: 'http://127.0.0.1:9', FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY: emulator.otpSignerPublicKey })!, emulator.transport, async () => undefined);
});
const store = () => createAccountStore(t.db, 'default');
const accounts = () => createAccountService({ store: store(), turnkey, now: () => clock, transport: jwks });
const wallets = () => createWalletService({ store: store(), turnkey, now: () => clock, transport: jwks });
async function emailAccount(email: string): Promise<AccountSessionToken> {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const started = await accounts().startEmail(email, ecdh.getPublicKey('hex', 'compressed'));
  const bundle = await encryptOtpCodeToBundle(E2E_SIGN_IN_CODE, started.targetBundle, ecdh.getPublicKey('hex', 'compressed'), emulator.otpSignerPublicKey);
  return (await accounts().completeEmail({ challengeId: started.challengeId, intent: 'sign-in', returnTo: '/app' }, bundle, null)).session;
}
async function appleAccount(sub: string): Promise<AccountSessionToken> {
  const flow = newOidcFlow('apple', null, 'sign-in', '/app');
  return (await accounts().completeOidc(apple, flow, { idToken: idToken(apple.clientId, sub, flow.nonce, Math.floor(clock.getTime() / 1000)) }, null)).session;
}
/** The wallet page's email unlock, end to end: code to the account's own address, encrypted with the wallet key, messages built locally. */
async function emailUnlock(session: WalletSession, key = walletKey(), code = E2E_WALLET_CODE) {
  const started = await wallets().startEmailUnlock(session, key.public);
  const bundle = await encryptOtpCodeToBundle(code, started.targetBundle, key.public, emulator.otpSignerPublicKey);
  const verified = await wallets().verifyEmailUnlock(session, started.challengeId, bundle);
  const login = key.raw(loginSignatureMessage(verified.tokenId, key.public));
  const signup = verified.signup ? key.raw(emailSignupSignatureMessage(verified.tokenId, verified.email)) : null;
  return { started, verified, key, finish: () => wallets().finishEmailUnlock(session, verified.pending, login, signup) };
}
/** Whether the provider accepts a request stamped by `key` in `organization` (i.e. a live provider session for that key). */
function providerAccepts(key: ReturnType<typeof walletKey>, organization: string): boolean {
  const body = JSON.stringify({ type: 'ACTIVITY_TYPE_CREATE_WALLET', timestampMs: String(Date.now()), organizationId: organization,
    parameters: { walletName: 'w', accounts: [{ curve: 'CURVE_SECP256K1', pathFormat: 'PATH_FORMAT_BIP32', path: "m/44'/60'/0'/0/0", addressFormat: 'ADDRESS_FORMAT_ETHEREUM' }], mnemonicLength: 12 } });
  return emulator.request('submit/create_wallet', body, key.stamp(body))[0] === 200;
}

describe('FloFi Wallet email unlock', () => {
  it('creates the person’s own organization with their signed consent and opens a provider session for the wallet key only', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock);
    const unlock = await emailUnlock(session);
    expect(unlock.started.email).toBe('ana@example.com');
    expect(unlock.verified).toMatchObject({ email: 'ana@example.com', signup: true });
    expect(await unlock.finish()).toMatchObject({ key: unlock.key.public });
    const organization = (await store().account(ana.accountId))!.organization!;
    expect(organization).toMatchObject({ login: 'email' });
    expect(emulator.orgs.get(organization.organization)).toMatchObject({ email: 'ana@example.com' });
    expect(providerAccepts(unlock.key, organization.organization)).toBe(true);
    expect(providerAccepts(walletKey(), organization.organization)).toBe(false);
  });
  it('a new unlock ends the previous provider session (invalidateExisting) and does not create a second organization', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock);
    const first = await emailUnlock(session); await first.finish();
    const second = await emailUnlock(session);
    expect(second.verified.signup).toBe(false);
    await second.finish();
    const organization = (await store().account(ana.accountId))!.organization!.organization;
    expect(emulator.orgs.size).toBe(1);
    expect(providerAccepts(second.key, organization)).toBe(true);
    expect(providerAccepts(first.key, organization)).toBe(false);
  });
  it('never sends anything to the provider with a signature over another message or by another key', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock);
    const unlock = await emailUnlock(session), intruder = walletKey();
    const pending = unlock.verified.pending;
    // A signature over a login for another session key (what a server-chosen message could smuggle in).
    await expect(wallets().finishEmailUnlock(session, pending, unlock.key.raw(loginSignatureMessage(pending.tokenId, intruder.public)), null))
      .rejects.toThrow('TURNKEY_CLIENT_SIGNATURE_INVALID');
    await expect(wallets().finishEmailUnlock(session, pending, intruder.raw(loginSignatureMessage(pending.tokenId, unlock.key.public)),
      intruder.raw(emailSignupSignatureMessage(pending.tokenId, pending.email)))).rejects.toThrow('TURNKEY_CLIENT_SIGNATURE_INVALID');
    expect(emulator.orgs.size).toBe(0);
    expect((await store().account(ana.accountId))!.organization).toBeNull();
  });
  it('keeps unlock and sign-in codes apart, each challenge to its own account, and refuses wrong codes', async () => {
    const ana = await emailAccount('ana@example.com'), bruno = await emailAccount('bruno@example.com');
    const anaSession = newWalletSession(ana, clock), brunoSession = newWalletSession(bruno, clock);
    const key = walletKey(), started = await wallets().startEmailUnlock(anaSession, key.public);
    const bundle = await encryptOtpCodeToBundle(E2E_WALLET_CODE, started.targetBundle, key.public, emulator.otpSignerPublicKey);
    // Bruno's wallet session cannot use Ana's unlock challenge.
    await expect(wallets().verifyEmailUnlock(brunoSession, started.challengeId, bundle)).rejects.toThrow('EMAIL_CHALLENGE_EXPIRED');
    // A sign-in code (6 digits) does not unlock FloFi Wallet, and an unlock challenge does not sign anyone in.
    const wrong = await encryptOtpCodeToBundle(E2E_SIGN_IN_CODE, started.targetBundle, key.public, emulator.otpSignerPublicKey);
    await expect(wallets().verifyEmailUnlock(anaSession, started.challengeId, wrong)).rejects.toThrow('EMAIL_CODE_REJECTED');
    await expect(accounts().completeEmail({ challengeId: started.challengeId, intent: 'sign-in', returnTo: '/app' }, bundle, null)).rejects.toThrow('EMAIL_CHALLENGE_EXPIRED');
    // An unlock never takes an address from the browser: the code always goes to the account's own email.
    expect((await wallets().startEmailUnlock(brunoSession, walletKey().public)).email).toBe('bruno@example.com');
  });
  it('has its own budget of 5 unlock codes per hour, apart from sign-in codes', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock);
    for (let request = 0; request < 5; request++) await wallets().startEmailUnlock(session, walletKey().public);
    await expect(wallets().startEmailUnlock(session, walletKey().public)).rejects.toThrow('EMAIL_RATE_LIMITED');
    // Sign-in codes for the same address are counted separately (1 used by emailAccount above).
    await expect(accounts().startEmail('ana@example.com', walletKey().public)).resolves.toMatchObject({ email: 'ana@example.com' });
  });
  it('ends with the account session: a revoked session cannot start or finish an unlock', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock);
    const unlock = await emailUnlock(session);
    await store().revokeSession(ana);
    await expect(unlock.finish()).rejects.toThrow('ACCOUNT_SESSION_REQUIRED');
    await expect(wallets().startEmailUnlock(session, walletKey().public)).rejects.toThrow('ACCOUNT_SESSION_REQUIRED');
  });
});

describe('FloFi Wallet Google/Apple unlock and organization binding', () => {
  it('unlocks with the same Apple identity as the account, through FloFi Wallet’s own client, for the wallet key the nonce commits to', async () => {
    const ana = await appleAccount('ana'), session = newWalletSession(ana, clock), key = walletKey();
    const flow = newOidcFlow('apple', key.public, 'link', '/app', ana), at = Math.floor(clock.getTime() / 1000);
    // A sign-in token (the product client's audience) never unlocks FloFi Wallet.
    await expect(wallets().completeOidcUnlock(session, walletApple, flow, { idToken: idToken(apple.clientId, 'ana', flow.nonce, at) })).rejects.toThrow();
    // Another person's Apple account cannot unlock Ana's FloFi Wallet.
    await expect(wallets().completeOidcUnlock(session, walletApple, flow, { idToken: idToken(walletApple.clientId, 'mallory', flow.nonce, at) })).rejects.toThrow('WALLET_UNLOCK_IDENTITY_MISMATCH');
    const unlocked = await wallets().completeOidcUnlock(session, walletApple, flow, { idToken: idToken(walletApple.clientId, 'ana', flow.nonce, at) });
    expect(unlocked.key).toBe(key.public);
    const organization = (await store().account(ana.accountId))!.organization!;
    expect(organization).toMatchObject({ login: 'apple' });
    expect(providerAccepts(key, organization.organization)).toBe(true);
  });
  it('creates the organization only from the account’s primary identity, never from one linked later', async () => {
    const ana = await appleAccount('ana');
    clock = new Date(clock.getTime() + 60_000);
    // Later, an email is linked (for example by someone holding a fresh session).
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const started = await accounts().startEmail('mallory@example.com', ecdh.getPublicKey('hex', 'compressed'));
    const bundle = await encryptOtpCodeToBundle(E2E_SIGN_IN_CODE, started.targetBundle, ecdh.getPublicKey('hex', 'compressed'), emulator.otpSignerPublicKey);
    const fresh = { ...ana, authenticatedAt: Math.floor(clock.getTime() / 1000) };
    await t.db.query('UPDATE flofi_account_sessions SET authenticated_at=to_timestamp($3) WHERE tenant_id=$1 AND session_id=$2', ['default', ana.sessionId, fresh.authenticatedAt]);
    await accounts().completeEmail({ challengeId: started.challengeId, intent: 'link', returnTo: '/app' }, bundle, fresh);
    const session = newWalletSession(fresh, clock);
    expect((await wallets().context(session)).methods).toEqual(['apple']);
    await expect(wallets().startEmailUnlock(session, walletKey().public)).rejects.toThrow('WALLET_UNLOCK_METHOD_UNAVAILABLE');
  });
});

describe('FloFi Wallet root on a wallet-first account', () => {
  it('never lets a Google, Apple or email identity linked later become the root of an account created with a Web3 wallet', async () => {
    const created = await store().signIn({ kind: 'eip155', subject: '0x' + 'b'.repeat(40), label: null }, clock);
    clock = new Date(clock.getTime() + 60_000);
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const started = await accounts().startEmail('linked@example.com', ecdh.getPublicKey('hex', 'compressed'));
    const bundle = await encryptOtpCodeToBundle(E2E_SIGN_IN_CODE, started.targetBundle, ecdh.getPublicKey('hex', 'compressed'), emulator.otpSignerPublicKey);
    const fresh = { ...created, authenticatedAt: Math.floor(clock.getTime() / 1000) };
    await t.db.query('UPDATE flofi_account_sessions SET authenticated_at=to_timestamp($3) WHERE tenant_id=$1 AND session_id=$2', ['default', created.sessionId, fresh.authenticatedAt]);
    await accounts().completeEmail({ challengeId: started.challengeId, intent: 'link', returnTo: '/app' }, bundle, fresh);
    expect((await store().account(created.accountId))!.identities.map(identity => identity.kind)).toEqual(['eip155', 'email']);
    const session = newWalletSession(fresh, clock);
    expect((await wallets().context(session)).methods).toEqual([]);
    await expect(wallets().startEmailUnlock(session, walletKey().public)).rejects.toThrow('WALLET_UNLOCK_METHOD_UNAVAILABLE');
    expect((await store().account(created.accountId))!.organization).toBeNull();
  });
});

describe('FloFi Wallet export authorization', () => {
  it('needs an unlock in the last 5 minutes and a managed wallet saved to this account', async () => {
    const ana = await emailAccount('ana@example.com'), session = newWalletSession(ana, clock), unlock = await emailUnlock(session);
    await unlock.finish();
    const organization = (await store().account(ana.accountId))!.organization!.organization;
    const org = emulator.orgs.get(organization)!;
    org.wallets.push({ walletId: 'wallet-ana-0001', accounts: [{ walletId: 'wallet-ana-0001', address: 'So11111111111111111111111111111111111111112', format: 'ADDRESS_FORMAT_SOLANA' }] });
    await accounts().saveManagedWallets(ana, ['solana:So11111111111111111111111111111111111111112']);
    const at = Math.floor(clock.getTime() / 1000), unlocked = { ...session, unlockedKey: unlock.key.public, unlockedAt: at, unlockedUntil: at + 1800 };
    expect(await wallets().exportGrant(unlocked, 'solana:So11111111111111111111111111111111111111112', 'recovery-phrase'))
      .toEqual({ organizationId: organization, kind: 'recovery-phrase', resource: 'wallet-ana-0001', address: 'So11111111111111111111111111111111111111112', keyFormat: 'SOLANA', source: 'wallet' });
    await expect(wallets().exportGrant(session, 'solana:So11111111111111111111111111111111111111112', 'recovery-phrase')).rejects.toThrow('WALLET_UNLOCK_REQUIRED');
    clock = new Date(clock.getTime() + 301_000);
    await expect(wallets().exportGrant(unlocked, 'solana:So11111111111111111111111111111111111111112', 'recovery-phrase')).rejects.toThrow('WALLET_UNLOCK_REQUIRED');
    clock = new Date(clock.getTime() - 301_000);
    await expect(wallets().exportGrant(unlocked, `evm:0x${'e'.repeat(40)}`, 'private-key')).rejects.toThrow('ACCOUNT_WALLET_NOT_FOUND');
  });
});
