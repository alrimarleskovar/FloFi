// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: the "Continue in FloFi Wallet" prompt appears only while a request waits for the person's click, is a
// labelled dialog with Continue and Cancel, and the Authorize hint speaks only for FloFi Wallet addresses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ADDRESS = '0x' + '1'.repeat(40);
async function load() {
  vi.resetModules();
  const channel = await import('../wallet/flofi-wallet-channel'), component = await import('./flofi-wallet-continue');
  channel.configureFloFiWallet({ walletOrigin: 'https://wallet.flofi.test', handoff: async () => ({ ok: false, code: 'FLOFI_WALLET_UNAVAILABLE' }) });
  return { channel, ...component };
}
afterEach(() => vi.resetModules());

describe('Continue in FloFi Wallet', () => {
  it('renders nothing while no request waits', async () => {
    const { FloFiWalletContinue } = await load();
    expect(renderToStaticMarkup(createElement(FloFiWalletContinue))).toBe('');
  });
  it('renders a labelled dialog with the purpose, Continue and Cancel while a request waits', async () => {
    const { channel, FloFiWalletContinue } = await load();
    const pending = channel.requestThroughFloFiWallet({ op: 'evm_sign_message', address: ADDRESS, message: 'hello' }).catch((error: Error) => error.message);
    const html = renderToStaticMarkup(createElement(FloFiWalletContinue));
    expect(html).toMatch(/^<dialog class="wallet-selector flofi-wallet-continue" aria-labelledby="[^"]+" aria-describedby="[^"]+">/);
    expect(html).toContain('FloFi Wallet needs to open to sign FloFi&#x27;s sign-in message.');
    expect(html).toContain('Nothing is signed until you confirm there.');
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(html).toContain('>Continue in FloFi Wallet</button>');
    expect(html).toContain('>Cancel</button>');
    channel.cancelFloFiWalletRequest();
    expect(await pending).toBe('FLOFI_WALLET_REJECTED');
  });
});

describe('FloFi Wallet hint next to Authorize', () => {
  it('speaks only for FloFi Wallet addresses, says Authorize opens it, and shows a recorded issue', async () => {
    const { channel, FloFiWalletLockHint } = await load();
    expect(renderToStaticMarkup(createElement(FloFiWalletLockHint, { account: ADDRESS }))).toBe('');
    channel.markFloFiAccount(ADDRESS, true);
    expect(renderToStaticMarkup(createElement(FloFiWalletLockHint, { account: ADDRESS }))).toContain('Authorize opens FloFi Wallet, where you confirm the exact transaction.');
    const locked = renderToStaticMarkup(createElement(FloFiWalletLockHint, { account: ADDRESS, issue: 'FLOFI_WALLET_LOCKED' }));
    expect(locked).toContain('role="status"');
    expect(locked).toContain('Unlock FloFi Wallet first, then authorize again.');
  });
});
