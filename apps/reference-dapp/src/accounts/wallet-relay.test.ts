// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's relay forwards only what its rules allow, and a transaction signature only with a binding to a
// reviewed FloFi attempt that the gate resolved and claimed for these exact bytes.
import { describe, expect, it, vi } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { floFiSignInMessage, stampPublicKey, walletRelayDecision, type WalletSigningGate } from './wallet-relay';
import type { AccountWallet } from './account-model';
import type { WalletSession } from './wallet-session';
import { SOLANA_SIGN_IN_STATEMENT, WALLET_SIGN_IN_STATEMENT } from '../server/wallet-session';

const NOW = new Date('2026-10-31T12:00:00.000Z'), T = Math.floor(NOW.getTime() / 1000);
const KEY = '02' + 'a'.repeat(64), OTHER_KEY = '03' + 'b'.repeat(64);
const EVM = '0x' + '1'.repeat(40), SOLANA = '11111111111111111111111111111111';
const ORG = { organizationId: 'org-1', userId: 'user-1' }, APP = { host: 'flofi.xyz', origin: 'https://flofi.xyz' };
const wallet = (ecosystem: 'evm' | 'solana', address: string, origin: AccountWallet['origin'] = 'generated'): AccountWallet => ({ id: `${ecosystem}:${address}`, ecosystem,
  address, origin, provider: origin === 'external' ? 'io.metamask' : 'turnkey', providerName: 'FloFi wallet', export: 'none', label: 'Main', addedAt: NOW.toISOString() });
const session = (patch: Partial<WalletSession> = {}): WalletSession => ({ account: { accountId: 'acct_' + '0'.repeat(32), sessionId: 'f'.repeat(32), method: 'email',
  authenticatedAt: T - 60, expiresAt: T + 3600 }, issuedAt: T - 60, expiresAt: T + 1800, unlockedKey: KEY, unlockedAt: T - 30, unlockedUntil: T + 600, ...patch });
const stamp = (publicKey = KEY) => Buffer.from(JSON.stringify({ publicKey, scheme: 'SIGNATURE_SCHEME_TK_API_P256', signature: '30' + '0'.repeat(140) })).toString('base64url');
const unsigned = (patch: Partial<erc7710.Eip1559> = {}) => Buffer.from(erc7710.unsignedEip1559({ chainId: 8453n, nonce: 7n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n,
  gasLimit: 21_000n, to: '0x' + '2'.repeat(40), value: 5n, data: '0x', ...patch })).toString('hex');
const solanaMessage = () => Buffer.from([0x80, 1, 0, 0, 1, ...new Array(32).fill(0), ...new Array(32).fill(7), 0]);
type Input = Parameters<typeof walletRelayDecision>[0];
function decide(path: string, parameters: Record<string, unknown>, patch: Partial<Input> = {}) {
  const body = JSON.stringify({ type: path === 'submit/sign_transaction' ? 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' : path === 'submit/sign_raw_payload' ? 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2'
    : path === 'submit/export_wallet' ? 'ACTIVITY_TYPE_EXPORT_WALLET' : 'ACTIVITY_TYPE_CREATE_WALLET', timestampMs: String(NOW.getTime()), organizationId: ORG.organizationId, parameters });
  return walletRelayDecision({ path, body, stamp: stamp(), message: null, app: APP, session: session(), organization: ORG, apiBaseUrl: 'https://api.turnkey.com',
    wallets: async () => [wallet('evm', EVM), wallet('solana', SOLANA), wallet('evm', '0x' + '9'.repeat(40), 'external')],
    managedResource: async () => ({ origin: 'generated', resource: 'wallet-123456' }), now: NOW, ...patch });
}
const allow = (): WalletSigningGate & ReturnType<typeof vi.fn> => vi.fn(async () => ({ ok: true as const })) as never;
const OK = { ok: true, url: 'https://api.turnkey.com/public/v1/submit/sign_transaction' };

describe('wallet relay: session, key, request shape and organization', () => {
  it('refuses without a provider, a wallet session, an organization, an allowlisted route or the unlocked key', async () => {
    expect(await decide('submit/create_wallet', {}, { apiBaseUrl: null })).toEqual({ ok: false, status: 503, code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
    expect(await decide('submit/create_wallet', {}, { session: null })).toEqual({ ok: false, status: 401, code: 'WALLET_SESSION_REQUIRED' });
    expect(await decide('submit/create_wallet', {}, { organization: null })).toEqual({ ok: false, status: 403, code: 'MANAGED_ORGANIZATION_MISSING' });
    expect(await decide('submit/eth_send_transaction', {})).toEqual({ ok: false, status: 404, code: 'PROVIDER_ROUTE_NOT_ALLOWED' });
    expect(await decide('submit/sol_send_transaction', {})).toEqual({ ok: false, status: 404, code: 'PROVIDER_ROUTE_NOT_ALLOWED' });
    expect(await decide('submit/create_wallet', {}, { stamp: stamp(OTHER_KEY) })).toEqual({ ok: false, status: 403, code: 'WALLET_UNLOCK_REQUIRED' });
    expect(await decide('submit/create_wallet', {}, { session: session({ unlockedUntil: T - 1 }) })).toEqual({ ok: false, status: 403, code: 'WALLET_UNLOCK_REQUIRED' });
    expect(stampPublicKey(stamp())).toBe(KEY);
  });
  it('requires the canonical JSON the page stamped and the account’s own organization', async () => {
    const body = '{"organizationId":"org-1", "type":"ACTIVITY_TYPE_CREATE_WALLET"}';
    expect(await walletRelayDecision({ path: 'submit/create_wallet', body, stamp: stamp(), message: null, app: APP, session: session(), organization: ORG,
      apiBaseUrl: 'https://api.turnkey.com', wallets: async () => [], managedResource: async () => null, now: NOW })).toEqual({ ok: false, status: 400, code: 'PROVIDER_REQUEST_NOT_CANONICAL' });
    const foreign = JSON.stringify({ type: 'ACTIVITY_TYPE_CREATE_WALLET', organizationId: 'org-2', parameters: {} });
    expect(await walletRelayDecision({ path: 'submit/create_wallet', body: foreign, stamp: stamp(), message: null, app: APP, session: session(), organization: ORG,
      apiBaseUrl: 'https://api.turnkey.com', wallets: async () => [], managedResource: async () => null, now: NOW })).toEqual({ ok: false, status: 403, code: 'PROVIDER_ORGANIZATION_MISMATCH' });
  });
  it('exports only with a recent unlock and an owned managed wallet', async () => {
    expect(await decide('submit/export_wallet', { walletId: 'wallet-123456', targetPublicKey: 'x' })).toMatchObject({ ok: true });
    expect(await decide('submit/export_wallet', { walletId: 'wallet-other', targetPublicKey: 'x' })).toEqual({ ok: false, status: 403, code: 'EXPORT_NOT_SUPPORTED' });
    expect(await decide('submit/export_wallet', { walletId: 'wallet-123456' }, { session: session({ unlockedAt: T - 301 }) })).toEqual({ ok: false, status: 403, code: 'WALLET_UNLOCK_REQUIRED' });
  });
});

describe('wallet relay: EVM transaction signatures are bound to a reviewed attempt', () => {
  const params = (patch: Record<string, unknown> = {}) => ({ signWith: EVM, unsignedTransaction: unsigned(), type: 'TRANSACTION_TYPE_ETHEREUM', ...patch });
  it('forwards the exact attempt bytes once the gate resolved them, decoded with the signer as sender', async () => {
    const gate = allow();
    expect(await decide('submit/sign_transaction', params(), { signing: `base-swap:bas-${'a'.repeat(24)}`, attempt: gate })).toEqual(OK);
    expect(gate).toHaveBeenCalledWith({ flow: 'base-swap', runId: `bas-${'a'.repeat(24)}` }, { ecosystem: 'evm', tx: { from: EVM, to: '0x' + '2'.repeat(40), value: 5n,
      data: '0x', chainId: 8453n, nonce: 7n, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } });
  });
  it('refuses every chain but FloFi Wallet’s four EVM mainnets before the attempt is looked up', async () => {
    for (const chainId of [1n, 42161n, 4663n]) {
      const gate = allow();
      expect(await decide('submit/sign_transaction', params({ unsignedTransaction: unsigned({ chainId }) }), { signing: `base-swap:bas-${'a'.repeat(24)}`, attempt: gate })).toEqual(OK);
    }
    for (const chainId of [84532n, 11155111n, 46630n, 421614n, 31337n]) {
      const gate = allow();
      expect(await decide('submit/sign_transaction', params({ unsignedTransaction: unsigned({ chainId }) }), { signing: `base-swap:bas-${'a'.repeat(24)}`, attempt: gate }))
        .toEqual({ ok: false, status: 403, code: 'FLOFI_WALLET_NETWORK_UNSUPPORTED' });
      expect(gate).not.toHaveBeenCalled();
    }
  });
  it('refuses without a binding or a gate, and passes on the gate’s refusal', async () => {
    expect(await decide('submit/sign_transaction', params())).toEqual({ ok: false, status: 403, code: 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' });
    expect(await decide('submit/sign_transaction', params(), { signing: 'base-swap:bas-' + 'a'.repeat(24) })).toEqual({ ok: false, status: 403, code: 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' });
    expect(await decide('submit/sign_transaction', params(), { signing: 'not a binding', attempt: allow() })).toEqual({ ok: false, status: 403, code: 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' });
    for (const code of ['FLOFI_WALLET_NO_MATCHING_REVIEW', 'FLOFI_WALLET_FLOW_NOT_SUPPORTED', 'FLOFI_WALLET_ALREADY_SIGNED']) {
      const gate = vi.fn(async () => ({ ok: false as const, code }));
      expect(await decide('submit/sign_transaction', params(), { signing: 'base-swap:bas-' + 'a'.repeat(24), attempt: gate })).toEqual({ ok: false, status: 403, code });
    }
  });
  it('keeps every local rule ahead of the gate: managed EVM signer, type 2 only, canonical encoding, no external signer', async () => {
    const gate = allow(), bound = { signing: 'base-swap:bas-' + 'a'.repeat(24), attempt: gate };
    expect(await decide('submit/sign_transaction', params({ signWith: '0x' + '9'.repeat(40) }), bound)).toEqual({ ok: false, status: 403, code: 'SIGNER_NOT_MANAGED' });
    expect(await decide('submit/sign_transaction', params({ unsignedTransaction: '04' + unsigned().slice(2) }), bound)).toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
    expect(await decide('submit/sign_transaction', params({ unsignedTransaction: unsigned() + '00' }), bound)).toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
    expect(await decide('submit/sign_transaction', params({ externalSignerPubkey: 'x' }), bound)).toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
    expect(await decide('submit/sign_transaction', params({ type: 'TRANSACTION_TYPE_SOLANA' }), bound)).toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
    expect(gate).not.toHaveBeenCalled();
  });
});

describe('wallet relay: Solana signatures', () => {
  const params = (payload: string) => ({ signWith: SOLANA, payload, encoding: 'PAYLOAD_ENCODING_HEXADECIMAL', hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE' });
  it('binds a transaction message (fee payer = signer) to its reviewed attempt', async () => {
    const gate = allow(), message = solanaMessage();
    expect(await decide('submit/sign_raw_payload', params(message.toString('hex')), { signing: `jupiter-swap:jupiter-${'c'.repeat(32)}`, attempt: gate }))
      .toEqual({ ok: true, url: 'https://api.turnkey.com/public/v1/submit/sign_raw_payload' });
    expect(gate).toHaveBeenCalledWith({ flow: 'jupiter-swap', runId: `jupiter-${'c'.repeat(32)}` }, { ecosystem: 'solana', address: SOLANA, message: new Uint8Array(message) });
    expect(await decide('submit/sign_raw_payload', params(message.toString('hex')))).toEqual({ ok: false, status: 403, code: 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' });
    const otherPayer = solanaMessage(); otherPayer[5] = 1;
    expect(await decide('submit/sign_raw_payload', params(otherPayer.toString('hex')), { signing: `jupiter-swap:jupiter-${'c'.repeat(32)}`, attempt: gate }))
      .toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
  });
  it('signs FloFi’s own sign-in messages without a run binding, and nothing else', async () => {
    const siws = `${APP.host} wants you to sign in with your Solana account:\n${SOLANA}\n\n${SOLANA_SIGN_IN_STATEMENT}\n\nURI: ${APP.origin}\nVersion: 1\nNonce: abc`;
    const gate = allow();
    expect(await decide('submit/sign_raw_payload', params(Buffer.from(siws).toString('hex')), { message: siws, attempt: gate })).toMatchObject({ ok: true });
    expect(gate).not.toHaveBeenCalled();
    const foreign = siws.replace(APP.host, 'evil.example');
    expect(await decide('submit/sign_raw_payload', params(Buffer.from(foreign).toString('hex')), { message: foreign })).toEqual({ ok: false, status: 400, code: 'SIGN_REQUEST_INVALID' });
    const siwe = (chain: number) => `${APP.host} wants you to sign in with your Ethereum account:\n${EVM}\n\n${WALLET_SIGN_IN_STATEMENT}\n\nURI: ${APP.origin}\nVersion: 1\nChain ID: ${chain}`;
    // EVM sign-in on FloFi Wallet's four mainnets only; a testnet chain (Base Sepolia, Sepolia, Robinhood Chain Testnet) is refused.
    for (const chain of [1, 8453, 42161, 4663]) expect(floFiSignInMessage(siwe(chain), 'evm', EVM, APP)).toBe(true);
    for (const chain of [84532, 11155111, 46630, 421614]) expect(floFiSignInMessage(siwe(chain), 'evm', EVM, APP)).toBe(false);
  });
});
