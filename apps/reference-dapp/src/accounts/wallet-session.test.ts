// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's handoff and session tokens are sealed, host-bound, short-lived and bound to the account session.
import { describe, expect, it } from 'vitest';
import { newWalletSession, readWalletHandoff, readWalletSession, redeemedWalletSession, sealWalletHandoff, sealWalletSession, unlockedFor, WALLET_EXPORT_UNLOCK_SECONDS,
  WALLET_HANDOFF_TTL_SECONDS, WALLET_SESSION_TTL_SECONDS } from './wallet-session';
import { readAccountSession, sealAccountSession } from './account-session';

const env = { FLOFI_SESSION_SECRET: 'a'.repeat(64) }, other = { FLOFI_SESSION_SECRET: 'b'.repeat(64) };
const at = 1_793_440_000, now = new Date(at * 1000), later = (seconds: number) => new Date((at + seconds) * 1000);
const account = { accountId: 'acct_' + '1'.repeat(32), sessionId: '2'.repeat(32), method: 'email' as const, authenticatedAt: at - 30, expiresAt: at + 12 * 3600 };
const KEY = '02' + 'c'.repeat(64);

describe('FloFi Wallet handoff', () => {
  it('names the account session, works only on the wallet host, for 120 seconds, and has a single-use digest', () => {
    const token = sealWalletHandoff(env, account, 'wallet.flofi.xyz', now);
    const read = readWalletHandoff(env, token, now, 'wallet.flofi.xyz');
    expect(read?.account).toEqual(account);
    expect(read?.expiresAt).toBe(at + WALLET_HANDOFF_TTL_SECONDS);
    expect(read?.digest).toMatch(/^[0-9a-f]{64}$/);
    // Two handoffs for the same session are distinct (fresh nonce), so each has its own single-use digest.
    expect(readWalletHandoff(env, sealWalletHandoff(env, account, 'wallet.flofi.xyz', now), now, 'wallet.flofi.xyz')?.digest).not.toBe(read?.digest);
    expect(readWalletHandoff(env, token, now, 'flofi.xyz')).toBeNull();
    expect(readWalletHandoff(other, token, now, 'wallet.flofi.xyz')).toBeNull();
    expect(readWalletHandoff(env, token, later(WALLET_HANDOFF_TTL_SECONDS), 'wallet.flofi.xyz')).toBeNull();
    // Not interchangeable with the other sealed tokens: an account session cookie is not a handoff, and the reverse.
    expect(readWalletHandoff(env, sealAccountSession(env, account, 'wallet.flofi.xyz', now), now, 'wallet.flofi.xyz')).toBeNull();
    expect(readAccountSession(env, token, now, 'wallet.flofi.xyz')).toBeNull();
    const [kind, body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), a: 'acct_' + 'f'.repeat(32) })).toString('base64url');
    expect(readWalletHandoff(env, `${kind}.${forged}.${mac}`, now, 'wallet.flofi.xyz')).toBeNull();
  });
  it('never outlives the account session and is refused for an expired one', () => {
    const short = { ...account, expiresAt: at + 30 };
    expect(readWalletHandoff(env, sealWalletHandoff(env, short, 'wallet.flofi.xyz', now), later(31), 'wallet.flofi.xyz')).toBeNull();
    expect(() => sealWalletHandoff(env, { ...account, expiresAt: at }, 'wallet.flofi.xyz', now)).toThrow('ACCOUNT_SESSION_REQUIRED');
  });
});

describe('FloFi Wallet session', () => {
  it('lasts at most 30 minutes and never beyond the account session; it is locked until the person unlocks it', () => {
    const session = newWalletSession(account, now);
    expect(session).toEqual({ account, issuedAt: at, expiresAt: at + WALLET_SESSION_TTL_SECONDS, unlockedKey: null, unlockedAt: null, unlockedUntil: null });
    expect(newWalletSession({ ...account, expiresAt: at + 60 }, now).expiresAt).toBe(at + 60);
    const token = sealWalletSession(env, session, 'wallet.flofi.xyz');
    expect(readWalletSession(env, token, now, 'wallet.flofi.xyz')).toEqual(session);
    expect(readWalletSession(env, token, now, 'flofi.xyz')).toBeNull();
    expect(readWalletSession(env, token, later(WALLET_SESSION_TTL_SECONDS), 'wallet.flofi.xyz')).toBeNull();
    expect(Buffer.from(token.split('.')[1]!, 'base64url').toString()).not.toMatch(/token|secret|private|seed|mnemonic|code/i);
  });
  it('records which wallet key was unlocked and when; export needs a recent unlock of that key', () => {
    const session = { ...newWalletSession(account, now), unlockedKey: KEY, unlockedAt: at, unlockedUntil: at + 1800 };
    const read = readWalletSession(env, sealWalletSession(env, session, 'wallet.flofi.xyz'), now, 'wallet.flofi.xyz')!;
    expect(unlockedFor(read, KEY, now)).toBe(true);
    expect(unlockedFor(read, '03' + 'c'.repeat(64), now)).toBe(false);
    expect(unlockedFor(read, KEY, later(WALLET_EXPORT_UNLOCK_SECONDS), WALLET_EXPORT_UNLOCK_SECONDS)).toBe(true);
    expect(unlockedFor(read, KEY, later(WALLET_EXPORT_UNLOCK_SECONDS + 1), WALLET_EXPORT_UNLOCK_SECONDS)).toBe(false);
    expect(unlockedFor(read, KEY, later(1800))).toBe(false);
    // An expired unlock reads as locked.
    expect(readWalletSession(env, sealWalletSession(env, session, 'wallet.flofi.xyz'), later(1800), 'wallet.flofi.xyz')).toBeNull();
    const shortUnlock = { ...session, unlockedUntil: at + 60 };
    expect(readWalletSession(env, sealWalletSession(env, shortUnlock, 'wallet.flofi.xyz'), later(61), 'wallet.flofi.xyz')).toMatchObject({ unlockedKey: null });
  });
});

describe('reopening FloFi Wallet', () => {
  const unlocked = { ...newWalletSession(account, now), unlockedKey: KEY, unlockedAt: at, unlockedUntil: at + 1800 };
  it('keeps a live unlock only for the very same account session', () => {
    const reopened = redeemedWalletSession(account, unlocked, later(60));
    expect([reopened.unlockedKey, reopened.unlockedAt, reopened.unlockedUntil]).toEqual([KEY, at, at + 1800]);
    expect(reopened.issuedAt).toBe(at + 60);
    // Another session of the same account (signed in again), another account, no session, or an expired unlock: locked.
    for (const other of [{ ...account, sessionId: '3'.repeat(32) }, { ...account, accountId: 'acct_' + '9'.repeat(32) }]) {
      expect(redeemedWalletSession(other, unlocked, later(60)).unlockedKey).toBeNull();
    }
    expect(redeemedWalletSession(account, null, later(60)).unlockedKey).toBeNull();
    expect(redeemedWalletSession(account, unlocked, later(1800)).unlockedKey).toBeNull();
    expect(redeemedWalletSession(account, newWalletSession(account, now), later(60)).unlockedKey).toBeNull();
  });
});

describe('handoff spellings', () => {
  it('accepts only the canonical token, so one handoff has one single-use digest', () => {
    const token = sealWalletHandoff(env, account, 'wallet.flofi.xyz', now);
    const digest = readWalletHandoff(env, token, now, 'wallet.flofi.xyz')?.digest;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    for (const variant of [`${token}=`, `${token}==`, `${token} `, `${token}\n`, `${token}!`]) expect(readWalletHandoff(env, variant, now, 'wallet.flofi.xyz')).toBeNull();
    // A spare-bit variant of the last MAC character decodes to the same bytes and is refused too.
    const last = token.at(-1)!, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[(alphabet.indexOf(last) & ~3) | ((alphabet.indexOf(last) + 1) & 3)]!;
    expect(readWalletHandoff(env, token.slice(0, -1) + sibling, now, 'wallet.flofi.xyz')).toBeNull();
  });
});
