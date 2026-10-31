// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canonicalAddress, exportActions, normalizeEmail, parseAccountWalletId, readAccountWallet, type AccountWallet } from './account-model';

const managed: AccountWallet = { id: 'evm:0x' + 'a'.repeat(40), ecosystem: 'evm', address: '0x' + 'a'.repeat(40), origin: 'generated', provider: 'turnkey',
  providerName: 'FloFi wallet', export: 'recovery-phrase', label: 'EVM wallet', addedAt: '2026-10-31T12:00:00.000Z' };
const external: AccountWallet = { ...managed, origin: 'external', provider: 'io.metamask', providerName: 'MetaMask', export: 'none', label: 'MetaMask' };

describe('account wallet records', () => {
  it('reads exact public records and drops any record carrying a secret or extra field', () => {
    expect(readAccountWallet(managed)).toEqual(managed);
    for (const field of ['privateKey', 'mnemonic', 'seedPhrase', 'exportBundle', 'session']) expect(readAccountWallet({ ...managed, [field]: 'x' })).toBeNull();
    expect(readAccountWallet({ ...managed, address: '0x' + 'A'.repeat(40), id: 'evm:0x' + 'A'.repeat(40) })).toBeNull();
  });
  it('never lets an external wallet claim export or a managed provider', () => {
    expect(readAccountWallet(external)).toEqual(external);
    expect(readAccountWallet({ ...external, export: 'private-key' })).toBeNull();
    expect(readAccountWallet({ ...external, provider: 'turnkey' })).toBeNull();
    expect(readAccountWallet({ ...managed, origin: 'imported' })).toBeNull();
  });
  it('offers export only for managed wallets, and a recovery phrase only for generated HD wallets', () => {
    expect(exportActions(external)).toEqual([]);
    expect(exportActions(managed)).toEqual(['private-key', 'recovery-phrase']);
    expect(exportActions({ origin: 'imported', export: 'private-key' })).toEqual(['private-key']);
  });
  it('normalises identities and wallet ids strictly', () => {
    expect(canonicalAddress('evm', '0x' + 'AB'.repeat(20))).toBe('0x' + 'ab'.repeat(20));
    expect(canonicalAddress('solana', 'So11111111111111111111111111111111111111112')).toBe('So11111111111111111111111111111111111111112');
    expect(canonicalAddress('solana', 'so11111111111111111111111111111111111111110l')).toBeNull();
    expect(parseAccountWalletId('evm:0x' + 'a'.repeat(40))).toEqual({ ecosystem: 'evm', address: '0x' + 'a'.repeat(40) });
    expect(parseAccountWalletId('evm:0x' + 'a'.repeat(40) + ':x')).toBeNull();
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeEmail('ana@example')).toBeNull();
    // A sign-in address can never name a wallet-unlock challenge key (or any other prefixed key).
    expect(normalizeEmail('wallet-unlock:ana@example.com')).toBeNull();
    expect(normalizeEmail('ana@exa:mple.com')).toBeNull();
    expect(normalizeEmail('a\nb@example.com')).toBeNull();
  });
});
