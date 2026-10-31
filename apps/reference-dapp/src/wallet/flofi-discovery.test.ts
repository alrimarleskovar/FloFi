// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet joins EVM discovery directly: selectable next to announced and legacy wallets, never the passive
// provider, never impersonated by an announcement, and its removal ends its selection.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseEvmWallet, chosenEvmProvider, evmWalletEntries, floFiWalletKey, injected, registerManagedEvmProvider } from './evm-discovery';
import { updateWalletPreference } from './wallet-registry';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+', ADDRESS = '0x' + 'ab'.repeat(20);
const provider = (flags: Record<string, boolean> = {}) => ({ ...flags, request: vi.fn(async () => []) });
function browser(ethereum?: unknown) {
  const store = new Map<string, string>();
  const target = Object.assign(new EventTarget(), { ethereum, localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } } });
  vi.stubGlobal('window', target);
  return target;
}
const announce = (target: EventTarget, wallet: unknown, info: { rdns: string; uuid: string; name: string }) =>
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: wallet, info: { icon: ICON, ...info } } }));
afterEach(() => vi.unstubAllGlobals());

describe('FloFi Wallet in EVM discovery', () => {
  it('lists FloFi Wallet after a legacy-only wallet without hiding it or becoming the passive provider', () => {
    const legacy = provider({ isMetaMask: true }), floFi = provider();
    browser(legacy);
    registerManagedEvmProvider(floFi, { address: ADDRESS, name: 'FloFi Wallet' });
    expect(evmWalletEntries().map(entry => entry.choice)).toEqual([
      { id: 'evm:injected#0', ecosystem: 'evm', key: 'injected', name: 'Browser wallet', icon: null },
      { id: `evm:flofi:${ADDRESS}`, ecosystem: 'evm', key: floFiWalletKey(ADDRESS), name: 'FloFi Wallet', icon: null }]);
    expect(injected()).toBe(legacy);
    expect(floFi.request).not.toHaveBeenCalled();
  });
  it('keeps a single announced extension passive and lists FloFi Wallet after the announced wallets', () => {
    const target = browser(), rabby = provider(), floFi = provider();
    target.addEventListener('eip6963:requestProvider', () => announce(target, rabby, { rdns: 'io.rabby', uuid: 'r', name: 'Rabby Wallet' }));
    registerManagedEvmProvider(floFi, { address: ADDRESS, name: 'FloFi Wallet' });
    expect(evmWalletEntries().map(entry => entry.choice.key)).toEqual(['io.rabby', floFiWalletKey(ADDRESS)]);
    expect(injected()).toBe(rabby);
  });
  it('ignores an announcement claiming FloFi Wallet’s rdns', () => {
    const target = browser(), impostor = provider();
    target.addEventListener('eip6963:requestProvider', () => {
      announce(target, impostor, { rdns: 'xyz.flofi.wallet', uuid: 'x', name: 'FloFi Wallet' });
      announce(target, impostor, { rdns: 'XYZ.FloFi.Wallet', uuid: 'y', name: 'FloFi Wallet' });
    });
    expect(evmWalletEntries()).toEqual([]);
    expect(injected()).toBeNull();
  });
  it('is used only after an explicit choice, never read silently after a reload, and its removal ends the choice', () => {
    const legacy = provider(), floFi = provider();
    browser(legacy);
    const unregister = registerManagedEvmProvider(floFi, { address: ADDRESS, name: 'FloFi Wallet' });
    expect(chooseEvmWallet(`evm:flofi:${ADDRESS}`)).toBe(floFi);
    expect(injected()).toBe(floFi);
    unregister();
    expect(chosenEvmProvider()).toBeNull();
    // The remembered choice was FloFi Wallet: another wallet is not silently read in its place.
    expect(injected()).toBeNull();
    updateWalletPreference({ evm: null });
    expect(injected()).toBe(legacy);
  });
});
