// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's EIP-1193 provider passes the stores' existing checks, signs only for a bound reviewed run,
// fills only what the Review left to the wallet, and maps failures honestly (4001 only before Sign; UNKNOWN once a signature may exist).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindFloFiSigning } from './flofi-wallet-channel';
import { createFloFiEvmProvider, retireFloFiEvmProvider, type FloFiEvmDeps } from './flofi-evm-provider';
import { switchWalletNetwork } from './evm-networks';

const OWNER = '0x' + 'ab'.repeat(20), RECIPIENT = '0x' + '2'.repeat(40), HASH = '0x' + 'c'.repeat(64), RAW = '0x02' + 'f8'.repeat(40);
const SIGNING = { flow: 'robinhood-swap', runId: 'rhs-' + 'a'.repeat(24) };
function setup(patch: Partial<FloFiEvmDeps> = {}) {
  const deps = {
    request: vi.fn(async (): Promise<unknown> => ({ signedTransaction: RAW.slice(2) })),
    pendingNonce: vi.fn(async () => ({ ok: true as const, value: '0x7' })),
    fees: vi.fn(async () => ({ ok: true as const, value: { maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0xf4240' } })),
    broadcast: vi.fn(async () => ({ ok: true as const, value: { kind: 'HASH' as const, hash: HASH } })),
    connected: vi.fn(), ...patch };
  const provider = createFloFiEvmProvider(OWNER.toUpperCase().replace('0X', '0x'), deps as unknown as FloFiEvmDeps);
  return { provider, deps };
}
const send = (provider: ReturnType<typeof setup>['provider'], tx: Record<string, unknown>, bind = true) => {
  if (bind) bindFloFiSigning(provider, SIGNING);
  return provider.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: RECIPIENT, value: '0x0', data: '0x', chainId: '0x1237', gas: '0x30d40', ...tx }] });
};
async function connected(patch: Partial<FloFiEvmDeps> = {}) {
  const value = setup(patch);
  await value.provider.request({ method: 'eth_requestAccounts' });
  await value.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
  return value;
}
const failure = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as { code?: unknown; message: string }; } throw new Error('expected a failure'); };
afterEach(() => vi.restoreAllMocks());

describe('accounts and networks', () => {
  it('connects only on request, lowercases the managed address and reports the connection', async () => {
    const { provider, deps } = setup(), accounts = vi.fn();
    provider.on!('accountsChanged', accounts);
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([]);
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([OWNER]);
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([OWNER]);
    expect(accounts).toHaveBeenCalledWith([OWNER]);
    expect(deps.connected).toHaveBeenCalledWith(OWNER, true);
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x2105');
  });
  it('switches among the four catalog mainnets only and refuses to add any network', async () => {
    const { provider } = setup(), changed = vi.fn();
    provider.on!('chainChanged', changed);
    for (const chain of ['0xa4b1', '0x1', '0x1237', '0x2105']) await switchWalletNetwork(provider, chain);
    expect(changed.mock.calls.map(call => call[0])).toEqual(['0xa4b1', '0x1', '0x1237', '0x2105']);
    expect((await failure(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] }))).code).toBe(4902);
    // A testnet switch target is added only after 4902, and FloFi Wallet refuses the add.
    expect((await failure(switchWalletNetwork(provider, '0x14a34'))).code).toBe(4200);
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x2105');
  });
  it('reads the pending nonce of its own address only, and refuses methods it does not implement', async () => {
    const { provider, deps } = setup();
    expect(await provider.request({ method: 'eth_getTransactionCount', params: [OWNER, 'pending'] })).toBe('0x7');
    expect(deps.pendingNonce).toHaveBeenCalledWith('0x2105', OWNER);
    expect((await failure(provider.request({ method: 'eth_getTransactionCount', params: [RECIPIENT, 'pending'] }))).code).toBe(4100);
    for (const method of ['eth_signTypedData_v4', 'eth_sign', 'eth_signTransaction', 'wallet_sendCalls', 'eth_sendRawTransaction'])
      expect((await failure(provider.request({ method }))).code).toBe(4200);
  });
  it('disconnects its sessions when retired', async () => {
    const { provider, deps } = await connected(), accounts = vi.fn(), disconnect = vi.fn();
    provider.on!('accountsChanged', accounts); provider.on!('disconnect', disconnect);
    retireFloFiEvmProvider(provider);
    expect(accounts).toHaveBeenCalledWith([]); expect(disconnect).toHaveBeenCalledTimes(1);
    expect(deps.connected).toHaveBeenLastCalledWith(OWNER, false);
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([]);
  });
});

describe('eth_sendTransaction', () => {
  it('refuses a send no store bound to a reviewed run (a flow FloFi Wallet cannot sign yet) before asking FloFi Wallet', async () => {
    const { provider, deps } = await connected();
    const error = await failure(send(provider, {}, false));
    expect(error).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_FLOW_NOT_SUPPORTED' });
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('refuses legacy gas, another sender, another chain and contract creation as proven pre-signature refusals', async () => {
    const { provider, deps } = await connected();
    expect(await failure(send(provider, { gasPrice: '0x1' }))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED' });
    expect(await failure(send(provider, { type: '0x0' }))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED' });
    expect(await failure(send(provider, { from: RECIPIENT }))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_ACCOUNT_MISMATCH' });
    expect(await failure(send(provider, { chainId: '0x2105' }))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_NETWORK_UNSUPPORTED' });
    expect(await failure(send(provider, { to: undefined }))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_REQUEST_INVALID' });
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('fills the pending nonce and fees a non-strict Review left to the wallet, then broadcasts the signed bytes once through FloFi', async () => {
    const { provider, deps } = await connected();
    expect(await send(provider, {})).toBe(HASH);
    expect(deps.request).toHaveBeenCalledWith({ op: 'evm_sign_transaction', address: OWNER, signing: SIGNING, tx: { from: OWNER, to: RECIPIENT, value: '0x0', data: '0x',
      chainId: '0x1237', nonce: '0x7', gas: '0x30d40', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0xf4240' } });
    expect(deps.broadcast).toHaveBeenCalledWith(SIGNING, RAW);
    expect(deps.broadcast).toHaveBeenCalledTimes(1);
  });
  it('keeps every value the Review bound (nonce and fees) and reads nothing', async () => {
    const { provider, deps } = await connected();
    await send(provider, { nonce: '0x9', maxFeePerGas: '0x5', maxPriorityFeePerGas: '0x1' });
    expect(deps.pendingNonce).not.toHaveBeenCalled(); expect(deps.fees).not.toHaveBeenCalled();
    expect(((deps.request as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [{ tx: Record<string, string> }])[0].tx).toMatchObject({ nonce: '0x9', maxFeePerGas: '0x5', maxPriorityFeePerGas: '0x1' });
  });
  it('maps a cancel before Sign to 4001 and a proven refusal to 4100, with nothing broadcast', async () => {
    for (const [code, expected] of [['FLOFI_WALLET_REJECTED', 4001], ['FLOFI_WALLET_NO_MATCHING_REVIEW', 4100], ['FLOFI_WALLET_FLOW_NOT_SUPPORTED', 4100],
      ['WALLET_UNLOCK_REQUIRED', 4100], ['FLOFI_WALLET_NOT_OPEN', 4100]] as const) {
      const { provider, deps } = await connected({ request: vi.fn(async () => { throw new Error(code); }) });
      expect(await failure(send(provider, {}))).toMatchObject({ code: expected, message: code });
      expect(deps.broadcast).not.toHaveBeenCalled();
    }
  });
  it.each([
    ['FloFi Wallet closed after receiving the request', async () => { throw new Error('FLOFI_WALLET_CLOSED'); }],
    ['the provider activity did not complete', async () => { throw new Error('MANAGED_ACTIVITY_NOT_COMPLETED'); }],
    ['an unclassified failure', async () => { throw new TypeError('boom'); }],
    ['a malformed signed answer', async () => ({ signedTransaction: 'not hex' })],
  ])('treats %s as UNKNOWN: no refusal code, no "rejected" wording, nothing broadcast', async (_name, request) => {
    const { provider, deps } = await connected({ request: vi.fn(request) as never });
    const error = await failure(send(provider, {}));
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('FLOFI_WALLET_SUBMISSION_UNKNOWN');
    expect(error.message).not.toMatch(/reject|declin|denied|cancel/i);
    expect(deps.broadcast).not.toHaveBeenCalled();
  });
  it.each([
    ['FloFi refused to broadcast after signing', async () => ({ ok: false as const, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' })],
    ['the broadcast outcome is unknown', async () => ({ ok: true as const, value: { kind: 'UNKNOWN' as const, code: 'FLOFI_WALLET_BROADCAST_UNCONFIRMED' } })],
    ['the action itself failed', async () => { throw new Error('network'); }],
  ])('treats %s as UNKNOWN once signed bytes exist', async (_name, broadcast) => {
    const { provider } = await connected({ broadcast: vi.fn(broadcast) as never });
    const error = await failure(send(provider, {}));
    expect(error).toMatchObject({ message: 'FLOFI_WALLET_SUBMISSION_UNKNOWN' });
    expect(error.code).toBeUndefined();
  });
  it('refuses a read failure before signing as a refusal (nothing was signed)', async () => {
    const { provider, deps } = await connected({ pendingNonce: vi.fn(async () => ({ ok: false as const, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' })) });
    expect(await failure(send(provider, {}))).toMatchObject({ code: 4100, message: 'FLOFI_WALLET_NETWORK_READ_FAILED' });
    expect(deps.request).not.toHaveBeenCalled();
  });
});

describe('personal_sign', () => {
  it('asks FloFi Wallet to sign the decoded UTF-8 text for its own address and returns a 65-byte signature', async () => {
    const { provider, deps } = await connected({ request: vi.fn(async () => ({ signature: 'A'.repeat(130) })) as never });
    const text = 'flofi.xyz wants you to sign in with your Ethereum account:';
    const hex = '0x' + Buffer.from(text).toString('hex');
    expect(await provider.request({ method: 'personal_sign', params: [hex, OWNER] })).toBe('0x' + 'a'.repeat(130));
    expect(deps.request).toHaveBeenCalledWith({ op: 'evm_sign_message', address: OWNER, message: text });
    expect((await failure(provider.request({ method: 'personal_sign', params: [hex, RECIPIENT] }))).code).toBe(4100);
    expect((await failure(provider.request({ method: 'personal_sign', params: ['0xff', OWNER] }))).message).toBe('FLOFI_WALLET_MESSAGE_UNSUPPORTED');
  });
});
