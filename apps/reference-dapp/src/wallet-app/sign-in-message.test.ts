// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs exactly the sign-in messages FloFi's server writes for this product host and this
// wallet, and nothing else (another domain, statement, URI, address, extra line or an expired message).
import { describe, expect, it } from 'vitest';
import { SOLANA_SIGN_IN_STATEMENT as SERVER_SOLANA, WALLET_SIGN_IN_STATEMENT as SERVER_EVM, solanaSignInMessage, walletSignInMessage } from '../server/wallet-session';
import { EVM_SIGN_IN_STATEMENT, parseFloFiSignIn, SOLANA_SIGN_IN_STATEMENT } from './sign-in-message';

const app = { host: 'flofi.xyz', origin: 'https://flofi.xyz' }, now = Date.parse('2026-10-31T12:00:00.000Z');
const EVM = '0x52908400098527886e0f7030069857d2e4169ee7', SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const times = { nonce: 'a'.repeat(32), issuedAt: '2026-10-31T11:59:00.000Z', expirationTime: '2026-10-31T12:04:00.000Z' };
const evmMessage = (patch: Partial<Parameters<typeof walletSignInMessage>[0]> = {}) =>
  walletSignInMessage({ domain: app.host, uri: app.origin, address: EVM, chainId: 8453, ...times, ...patch });
const solMessage = (patch: Partial<Parameters<typeof solanaSignInMessage>[0]> = {}) =>
  solanaSignInMessage({ domain: app.host, uri: app.origin, address: SOL, ...times, ...patch });

describe('FloFi sign-in messages', () => {
  it('keeps the statements byte-identical to the server’s', () => {
    expect(EVM_SIGN_IN_STATEMENT).toBe(SERVER_EVM);
    expect(SOLANA_SIGN_IN_STATEMENT).toBe(SERVER_SOLANA);
  });
  it('accepts every message the server builds for this host and wallet', () => {
    expect(parseFloFiSignIn(evmMessage(), 'evm', EVM, app, now)).toEqual({ domain: app.host, address: expect.stringMatching(/^0x/i), uri: app.origin, chainId: 8453, ...times });
    expect(parseFloFiSignIn(solMessage(), 'solana', SOL, app, now)).toEqual({ domain: app.host, address: SOL, uri: app.origin, chainId: null, ...times });
    expect(parseFloFiSignIn(evmMessage(), 'evm', EVM.toUpperCase().replace('0X', '0x'), app, now)).not.toBeNull();
  });
  it('refuses another dapp, another wallet, another statement or URI, extra lines and expired messages', () => {
    expect(parseFloFiSignIn(evmMessage({ domain: 'evil.example' }), 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage({ uri: 'https://evil.example' }), 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage(), 'evm', '0x' + '1'.repeat(40), app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage(), 'solana', SOL, app, now)).toBeNull();
    expect(parseFloFiSignIn(solMessage(), 'solana', SOL.toLowerCase(), app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage().replace(SERVER_EVM, 'Approve everything.'), 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(`${evmMessage()}\nResources:`, 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage().replace('\n', '\r\n'), 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage({ nonce: 'not-a-nonce' }), 'evm', EVM, app, now)).toBeNull();
    expect(parseFloFiSignIn(evmMessage(), 'evm', EVM, app, Date.parse(times.expirationTime))).toBeNull();
    expect(parseFloFiSignIn(solMessage({ expirationTime: times.issuedAt }), 'solana', SOL, app, now - 120_000)).toBeNull();
    expect(parseFloFiSignIn(evmMessage(), 'evm', EVM, { host: 'wallet.flofi.xyz', origin: 'https://wallet.flofi.xyz' }, now)).toBeNull();
  });
});
