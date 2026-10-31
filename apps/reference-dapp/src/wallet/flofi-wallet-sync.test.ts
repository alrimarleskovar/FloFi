// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet entries follow the account: one EVM provider and one Solana wallet per managed address,
// retired when the address leaves, and nothing at all inside an embedding frame.
import { afterEach, describe, expect, it, vi } from 'vitest';

const EVM_A = '0x' + 'a'.repeat(40), EVM_B = '0x' + 'b'.repeat(40), SOL = '7'.repeat(32) + 'abcd';
const info = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../app/flofi-wallet-action', () => ({ floFiWalletInfo: async () => ({ ok: true, value: info.value }), floFiWalletHandoff: async () => ({ ok: false, code: 'X' }),
  floFiEvmPendingNonce: async () => ({ ok: false, code: 'X' }), floFiEvmFees: async () => ({ ok: false, code: 'X' }), floFiEvmBroadcast: async () => ({ ok: false, code: 'X' }) }));
async function load(framed = false) {
  vi.resetModules();
  const target = Object.assign(new EventTarget(), { localStorage: { getItem: () => null, setItem: () => undefined } });
  Object.assign(target, { self: target, top: framed ? {} : target });
  vi.stubGlobal('window', target);
  return { sync: await import('./flofi-wallet-sync'), evm: await import('./evm-discovery'), solana: await import('./solana-wallet'), channel: await import('./flofi-wallet-channel') };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('FloFi Wallet entries', () => {
  it('registers one entry per managed address, names them apart, and retires removed ones', async () => {
    const { sync, evm, solana, channel } = await load();
    info.value = { walletOrigin: 'https://wallet.flofi.test', wallets: [{ ecosystem: 'evm', address: EVM_A, label: 'A' }, { ecosystem: 'evm', address: EVM_B, label: 'B' },
      { ecosystem: 'solana', address: SOL, label: 'S' }] };
    await sync.syncFloFiWallets({ force: true });
    expect(channel.floFiWalletSnapshot().configured).toBe(true);
    expect(evm.evmWalletEntries().map(entry => entry.choice.name)).toEqual(['FloFi Wallet 0xaaaa…aaaa', 'FloFi Wallet 0xbbbb…bbbb']);
    expect(solana.solanaWalletChoices('solana:mainnet').map(choice => choice.name)).toEqual(['FloFi Wallet']);
    expect(evm.evmWalletEntries().every(entry => sync.isFloFiWalletChoice(entry.choice))).toBe(true);
    expect(sync.isFloFiWalletChoice({ ecosystem: 'solana', key: 'FloFi Wallet' })).toBe(true);
    expect(sync.isFloFiWalletChoice({ ecosystem: 'solana', key: 'Phantom' })).toBe(false);
    const first = evm.evmWalletEntries()[0]!.provider;
    info.value = { walletOrigin: 'https://wallet.flofi.test', wallets: [{ ecosystem: 'evm', address: EVM_A, label: 'A' }] };
    await sync.syncFloFiWallets({ force: true });
    expect(evm.evmWalletEntries().map(entry => entry.provider)).toEqual([first]);
    expect(solana.solanaWalletChoices()).toEqual([]);
    info.value = null;
    await sync.syncFloFiWallets({ force: true });
    expect(evm.evmWalletEntries()).toEqual([]);
    expect(channel.floFiWalletSnapshot().configured).toBe(false);
  });
  it('offers nothing inside a frame', async () => {
    const { sync, evm, channel } = await load(true);
    info.value = { walletOrigin: 'https://wallet.flofi.test', wallets: [{ ecosystem: 'evm', address: EVM_A, label: 'A' }] };
    await sync.syncFloFiWallets({ force: true });
    expect(evm.evmWalletEntries()).toEqual([]);
    expect(channel.floFiWalletSnapshot().configured).toBe(false);
  });
});
