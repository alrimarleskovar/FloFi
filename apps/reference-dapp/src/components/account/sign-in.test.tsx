// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: every sign-in method this deployment cannot run is disabled with its reason; nothing is simulated.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountState } from '../../app/account-action';
import { SignInScreen } from './sign-in';

vi.mock('../../app/account-action', () => ({ completeEmailSignIn: vi.fn(), startEmailSignIn: vi.fn(), startSocialSignIn: vi.fn(), walletAccountSignIn: vi.fn() }));

const none = { accounts: false, google: false, apple: false, email: false, wallet: false, managedWallets: false };
const state = (availability: Partial<typeof none>): AccountState => ({ availability: { ...none, ...availability }, account: null, provider: null }) as AccountState;
const render = (value: AccountState, intent: 'sign-in' | 'link' = 'sign-in') =>
  renderToStaticMarkup(<SignInScreen state={value} initialError={null} returnTo="/app" intent={intent} initialMethod={null}/>);
/** Each method button's label and whether it is disabled, with its title. */
function methods(html: string): Record<string, { disabled: boolean; title: string | null }> {
  const group = html.slice(html.indexOf('aria-label="Sign-in methods"'));
  return Object.fromEntries(group.slice(0, group.indexOf('</div>')).split('<button ').slice(1).map(button => {
    const tag = button.slice(0, button.indexOf('>'));
    return [/<\/svg><span>([^<]+)/.exec(button)![1], { disabled: / disabled=""/.test(tag), title: /title="([^"]*)"/.exec(tag)?.[1] ?? null }];
  }));
}

describe('sign-in availability', () => {
  it('without accounts on this deployment, every method is disabled and the builder stays open without an account', () => {
    const html = render(state({}));
    expect(methods(html)).toEqual({ Apple: { disabled: true, title: 'Not available on this deployment yet' }, Google: { disabled: true, title: 'Not available on this deployment yet' },
      Email: { disabled: true, title: 'Not available on this deployment yet' }, 'Web3 Wallet': { disabled: true, title: 'Not available on this deployment yet' } });
    expect(html).toContain('Accounts aren&#x27;t available on this deployment yet.');
    expect(html).toContain('<a class="');
    expect(html).toMatch(/href="\/app">Continue to FloFi<\/a>/);
    expect(html).toMatch(/href="\/app">Explore the builder without an account<\/a>/);
    expect(html).not.toContain('FloFi stores your sign-in identity');
  });

  it('each unconfigured provider is disabled on its own, with the reason announced', () => {
    const html = render(state({ accounts: true, wallet: true }));
    expect(methods(html)).toEqual({ Apple: { disabled: true, title: 'Not available on this deployment yet' }, Google: { disabled: true, title: 'Not available on this deployment yet' },
      Email: { disabled: true, title: 'Not available on this deployment yet' }, 'Web3 Wallet': { disabled: false, title: null } });
    expect(html).toContain('Methods shown as unavailable are not configured on this deployment yet.');
    expect(html).not.toContain('Accounts aren&#x27;t available');
    expect(methods(render(state({ accounts: true, wallet: true, google: true }))).Google).toEqual({ disabled: false, title: null });
    expect(methods(render(state({ accounts: true, wallet: true, apple: true }))).Apple).toEqual({ disabled: false, title: null });
    expect(methods(render(state({ accounts: true, wallet: true, email: true, managedWallets: true }))).Email).toEqual({ disabled: false, title: null });
  });

  it('with every method configured nothing is disabled and no unavailability notice is shown', () => {
    const html = render(state({ accounts: true, google: true, apple: true, email: true, wallet: true, managedWallets: true }));
    expect(Object.values(methods(html)).every(method => !method.disabled)).toBe(true);
    expect(html).not.toContain('not configured on this deployment');
    expect(html).toContain('FloFi stores your sign-in identity');
  });

  it('adding a sign-in to an account links wallets from Credentials, not from this screen', () => {
    expect(methods(render(state({ accounts: true, google: true, apple: true, email: true, wallet: true, managedWallets: true }), 'link'))['Web3 Wallet'])
      .toEqual({ disabled: true, title: 'Link a wallet from Credentials → My wallets' });
  });
});
