// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: account isolation, identity uniqueness, session revocation and wallet ownership on real PostgreSQL.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureTenant } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness';
import { createAccountStore, type IdentityClaim, type NewWallet } from './account-store';

let t: TestDatabase;
const store = (tenant = 'default') => createAccountStore(t.db, tenant);
const google: IdentityClaim = { kind: 'google', subject: '108234567890123456789', label: 'ana@example.com' };
const email: IdentityClaim = { kind: 'email', subject: 'bruno@example.com', label: 'bruno@example.com' };
const evm = '0x' + 'a'.repeat(40), solana = 'So11111111111111111111111111111111111111112';
const metaMask: NewWallet = { ecosystem: 'evm', address: evm, origin: 'external', provider: 'io.metamask', providerName: 'MetaMask', providerResource: null, label: 'MetaMask' };
const generated: NewWallet = { ecosystem: 'solana', address: solana, origin: 'generated', provider: 'turnkey', providerName: 'FloFi wallet',
  providerResource: 'wallet-0001-abcd', label: 'Solana wallet' };
beforeAll(async () => { t = await createTestDatabase(); await ensureTenant(t.db, 'other-tenant'); });
afterAll(async () => t?.drop());
beforeEach(async () => { await t.db.query('TRUNCATE flofi_accounts CASCADE'); });

describe('FloFi account store', () => {
  it('creates one account per identity, restores it on return and records a verifiable server-side session', async () => {
    const first = await store().signIn(google), again = await store().signIn(google);
    expect(first.created).toBe(true); expect(again.created).toBe(false);
    expect(again.accountId).toBe(first.accountId); expect(again.sessionId).not.toBe(first.sessionId);
    expect(await store().verifySession(first)).toBe(true);
    const account = await store().account(first.accountId);
    expect(account).toMatchObject({ onboarding: 'pending', identities: [{ kind: 'google', label: 'ana@example.com' }], wallets: [], organization: null });
    // Another tenant never sees the account or accepts its session.
    expect(await store('other-tenant').account(first.accountId)).toBeNull();
    expect(await store('other-tenant').verifySession(first)).toBe(false);
  });

  it('concurrent first sign-ins with one identity converge on one account', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => store().signIn(email)));
    expect(new Set(results.map(result => result.accountId)).size).toBe(1);
    expect((await t.db.query('SELECT count(*)::int AS n FROM flofi_accounts')).rows).toEqual([{ n: 1 }]);
  });

  it('rejects revoked, expired, tampered-claim and other-account sessions', async () => {
    const session = await store().signIn(google), other = await store().signIn(email);
    expect(await store().verifySession({ ...session, accountId: other.accountId })).toBe(false);
    expect(await store().verifySession({ ...session, method: 'email' })).toBe(false);
    expect(await store().verifySession({ ...session, authenticatedAt: session.authenticatedAt - 1 })).toBe(false);
    expect(await store().verifySession(session, new Date((session.expiresAt + 1) * 1000))).toBe(false);
    await store().revokeSession({ accountId: other.accountId, sessionId: session.sessionId });
    expect(await store().verifySession(session)).toBe(true);
    await store().revokeSession(session);
    expect(await store().verifySession(session)).toBe(false);
    const a = await store().signIn(google), b = await store().signIn(google);
    expect(await store().revokeAllSessions(a.accountId)).toBe(2);
    expect([await store().verifySession(a), await store().verifySession(b), await store().verifySession(other)]).toEqual([false, false, true]);
  });

  it('never merges or moves an identity held by another account', async () => {
    const ana = await store().signIn(google), bruno = await store().signIn(email);
    await expect(store().linkIdentity(bruno.accountId, google)).rejects.toThrow('ACCOUNT_IDENTITY_LINKED_ELSEWHERE');
    await store().linkIdentity(ana.accountId, google);
    await store().linkIdentity(ana.accountId, { kind: 'eip155', subject: evm, label: null });
    await expect(store().linkIdentity(bruno.accountId, { kind: 'eip155', subject: evm, label: null })).rejects.toThrow('ACCOUNT_IDENTITY_LINKED_ELSEWHERE');
    // Signing in with the linked wallet reaches Ana's account, never Bruno's.
    expect((await store().signIn({ kind: 'eip155', subject: evm, label: null })).accountId).toBe(ana.accountId);
    await expect(store().linkIdentity('acct_' + '0'.repeat(32), { kind: 'solana', subject: solana, label: null })).rejects.toThrow('ACCOUNT_IDENTITY_LINKED_ELSEWHERE');
    await expect(store().signIn({ kind: 'eip155', subject: '0x' + 'A'.repeat(40), label: null })).rejects.toThrow('ACCOUNT_IDENTITY_INVALID');
    await expect(store().signIn({ kind: 'email', subject: 'Mixed@Example.com', label: null })).rejects.toThrow('ACCOUNT_IDENTITY_INVALID');
  });

  it('keeps wallets per account: no cross-account read, save, rename or removal', async () => {
    const ana = await store().signIn(google), bruno = await store().signIn(email);
    const saved = await store().saveWallet(ana.accountId, metaMask);
    expect(saved).toMatchObject({ id: `evm:${evm}`, origin: 'external', export: 'none', provider: 'io.metamask' });
    expect(await store().saveWallet(ana.accountId, metaMask)).toMatchObject({ id: saved.id });
    await expect(store().saveWallet(bruno.accountId, metaMask)).rejects.toThrow('ACCOUNT_WALLET_LINKED_ELSEWHERE');
    expect(await store().wallets(bruno.accountId)).toEqual([]);
    await expect(store().renameWallet(bruno.accountId, 'evm', evm, 'Mine now')).rejects.toThrow('ACCOUNT_WALLET_NOT_FOUND');
    await expect(store().removeWallet(bruno.accountId, 'evm', evm)).rejects.toThrow('ACCOUNT_WALLET_NOT_FOUND');
    expect(await store('other-tenant').wallets(ana.accountId)).toEqual([]);
    await store().saveWallet(ana.accountId, generated);
    expect(await store().managedResource(ana.accountId, 'solana', solana)).toEqual({ origin: 'generated', resource: 'wallet-0001-abcd' });
    expect(await store().managedResource(bruno.accountId, 'solana', solana)).toBeNull();
    expect(await store().managedResource(ana.accountId, 'evm', evm)).toBeNull();
    await store().renameWallet(ana.accountId, 'solana', solana, '  Trading   wallet ');
    expect((await store().wallets(ana.accountId)).map(wallet => [wallet.label, wallet.export])).toEqual([['MetaMask', 'none'], ['Trading wallet', 'recovery-phrase']]);
    await store().removeWallet(ana.accountId, 'evm', evm);
    expect((await store().wallets(ana.accountId)).map(wallet => wallet.id)).toEqual([`solana:${solana}`]);
  });

  it('refuses inconsistent wallet metadata before it reaches the database', async () => {
    const ana = await store().signIn(google);
    await expect(store().saveWallet(ana.accountId, { ...metaMask, providerResource: 'wallet-0001-abcd' })).rejects.toThrow('ACCOUNT_WALLET_INVALID');
    await expect(store().saveWallet(ana.accountId, { ...generated, provider: 'io.metamask' })).rejects.toThrow('ACCOUNT_WALLET_INVALID');
    await expect(store().saveWallet(ana.accountId, { ...metaMask, address: 'not-an-address' })).rejects.toThrow('ACCOUNT_WALLET_INVALID');
    await expect(store().saveWallet(ana.accountId, { ...metaMask, label: '' })).rejects.toThrow('ACCOUNT_WALLET_INVALID');
    expect(await store().saveWallet(ana.accountId, { ...metaMask, address: evm.toUpperCase().replace('0X', '0x') })).toMatchObject({ address: evm });
  });

  it('keeps the only sign-in wallet as an identity when its wallet record is removed', async () => {
    const wallet = await store().signIn({ kind: 'eip155', subject: evm, label: null });
    await store().saveWallet(wallet.accountId, metaMask);
    await store().removeWallet(wallet.accountId, 'evm', evm);
    expect((await store().signIn({ kind: 'eip155', subject: evm, label: null })).accountId).toBe(wallet.accountId);
  });

  it('records onboarding and one provider organization that is never replaced', async () => {
    const ana = await store().signIn(google);
    await store().setOnboarding(ana.accountId, 'dismissed');
    expect((await store().account(ana.accountId))?.onboarding).toBe('dismissed');
    const organization = { provider: 'turnkey' as const, organization: 'org-1111-2222', user: 'user-3333-4444', login: 'google' as const };
    expect(await store().setWalletOrganization(ana.accountId, organization)).toEqual(organization);
    await expect(store().setWalletOrganization(ana.accountId, { ...organization, organization: 'org-9999-9999' })).rejects.toThrow('ACCOUNT_WALLET_ORGANIZATION_CONFLICT');
    await expect(store().setOnboarding('acct_' + '0'.repeat(32), 'completed')).rejects.toThrow('ACCOUNT_NOT_FOUND');
  });
});
