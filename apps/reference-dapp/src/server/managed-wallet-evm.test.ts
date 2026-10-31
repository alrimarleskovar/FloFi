// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's EVM network side serves the four catalog mainnets only, broadcasts exactly the re-resolved
// attempt's owner-signed transaction once, and decides an unclear send by reading the network, never by sending again.
import { describe, expect, it, vi } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { memorySignerProvider } from '@defi-workflow-engine/reference-executor';
import { CATALOG_NETWORKS, type CatalogNetworkRuntime } from './catalog-networks';
import { createManagedWalletEvm, expectedBroadcast, managedEvmNetwork, MANAGED_EVM_READ_METHODS, rawTransactionSender } from './managed-wallet-evm';
import { decodeSignedEip1559 } from './managed-signing';
import { FLOWS, flowMode } from '../../backend/flows';

const keys = memorySignerProvider();
async function signed(patch: Partial<erc7710.Eip1559> = {}) {
  const key = await keys.create('eip155');
  const tx: erc7710.Eip1559 = { chainId: 8453n, nonce: 7n, maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 2_000_000_000n, gasLimit: 21_000n,
    to: '0x' + '2'.repeat(40), value: 10n ** 15n, data: '0x', ...patch };
  const sig = await keys.signEvmDigest(key.ref, erc7710.bytesOf(erc7710.eip1559SigningHash(tx)));
  const { raw, hash } = erc7710.signedEip1559(tx, sig.yParity, sig.r, sig.s);
  return { raw, hash, owner: key.address.toLowerCase(), decoded: decodeSignedEip1559(raw)! };
}
type Mode = 'live' | 'harness' | 'off';
function chain(overrides: Record<string, (params: readonly unknown[]) => unknown> = {}) {
  const calls: string[] = [];
  const read = vi.fn((network: CatalogNetworkRuntime) => async (method: string, params: readonly unknown[]) => {
    if (network.chainId !== 8453) throw new Error('only Base in this test');
    calls.push(method);
    if (overrides[method]) return overrides[method]!(params);
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x3b9aca00' };
    if (method === 'eth_maxPriorityFeePerGas') return '0xf4240';
    if (method === 'eth_getTransactionByHash') return null;
    throw new Error('unexpected ' + method);
  });
  return { calls, read };
}
const service = (options: { mode?: Mode; env?: Record<string, string>; read: ReturnType<typeof chain>['read']; send?: (raw: string) => Promise<{ ok: true; result: unknown } | { ok: false; definite: boolean }> }) =>
  createManagedWalletEvm({ env: options.env ?? { GRYLOO_BASE_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' }, mode: () => options.mode ?? 'live', read: options.read,
    ...options.send ? { send: () => options.send! } : {} });

describe('managed EVM reads', () => {
  it('serves only the four catalog mainnets', () => {
    expect(['0x2105', '0xa4b1', '0x1', '0x1237', 8453].map(id => managedEvmNetwork(id)?.id)).toEqual(['base', 'arbitrum-one', 'ethereum', 'robinhood', 'base']);
    for (const id of ['0x14a34', '0xaa36a7', '0xb626', '0x7a69', 'base', '0x']) expect(managedEvmNetwork(id)).toBeNull();
  });
  it('reads the pending nonce and builds EIP-1559 fees from the latest base fee', async () => {
    const { read, calls } = chain(), s = service({ read });
    expect(await s.pendingNonce('0x2105', '0x' + 'A'.repeat(40))).toBe('0x7');
    // 2 × base fee (1 gwei) + priority fee (0.001 gwei).
    expect(await s.fees('0x2105')).toEqual({ maxFeePerGas: `0x${(2_001_000_000n).toString(16)}`, maxPriorityFeePerGas: '0xf4240' });
    expect(calls.filter(method => method === 'eth_chainId').length).toBe(2);
  });
  it('fails closed on an unsupported or disabled network and on unreadable answers', async () => {
    const { read } = chain({ eth_getBlockByNumber: () => ({}) });
    await expect(service({ read }).pendingNonce('0x14a34', '0x' + '1'.repeat(40))).rejects.toThrow('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    await expect(service({ read, mode: 'off' }).fees('0x2105')).rejects.toThrow('BASE_MAINNET_NOT_ENABLED');
    await expect(service({ read }).fees('0x2105')).rejects.toThrow('FLOFI_WALLET_NETWORK_READ_FAILED');
    await expect(service({ read }).pendingNonce('0x2105', 'not-an-address')).rejects.toThrow('FLOFI_WALLET_REQUEST_INVALID');
  });
  it('builds each network’s read client with exactly its read methods (never a send method)', () => {
    expect(MANAGED_EVM_READ_METHODS).not.toContain('eth_sendRawTransaction');
    expect(() => CATALOG_NETWORKS.base.rpc('live', {}, MANAGED_EVM_READ_METHODS)).not.toThrow();
  });
});

describe('attempt-bound broadcast', () => {
  it('sends the exact attempt once and returns its hash', async () => {
    const tx = await signed(), send = vi.fn(async () => ({ ok: true as const, result: tx.hash }));
    const result = await service({ read: chain().read, send }).broadcast('0x2105', tx.raw, expectedBroadcast(tx.decoded.tx, tx.decoded.hash));
    expect(result).toEqual({ kind: 'HASH', hash: tx.hash });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(tx.raw);
  });
  it('refuses before sending anything: another field, another sender, another chain, or no owner-execution opt-in', async () => {
    const tx = await signed(), send = vi.fn(async () => ({ ok: true as const, result: tx.hash })), s = service({ read: chain().read, send });
    const expected = expectedBroadcast(tx.decoded.tx, tx.decoded.hash);
    for (const patch of [{ nonce: '0x8' }, { to: '0x' + '3'.repeat(40) }, { value: '0x1' }, { from: '0x' + '9'.repeat(40) }, { hash: '0x' + '0'.repeat(64) }, { maxFeePerGas: '0x1' }])
      await expect(s.broadcast('0x2105', tx.raw, { ...expected, ...patch })).rejects.toThrow('FLOFI_WALLET_SIGNER_MISMATCH');
    await expect(s.broadcast('0xa4b1', tx.raw, expected)).rejects.toThrow('OWNER_EXECUTION_NOT_ENABLED');
    await expect(service({ read: chain().read, send, env: {} }).broadcast('0x2105', tx.raw, expected)).rejects.toThrow('OWNER_EXECUTION_NOT_ENABLED');
    await expect(s.broadcast('0x2105', tx.raw.slice(0, -2), expected)).rejects.toThrow('FLOFI_WALLET_SIGNED_TRANSACTION_INVALID');
    expect(send).not.toHaveBeenCalled();
  });
  it('decides an unclear send by the network, never by a second send', async () => {
    const tx = await signed(), expected = expectedBroadcast(tx.decoded.tx, tx.decoded.hash);
    const lost = vi.fn(async () => ({ ok: false as const, definite: false }));
    const known = chain({ eth_getTransactionByHash: () => ({ hash: tx.hash }) });
    expect(await service({ read: known.read, send: lost }).broadcast('0x2105', tx.raw, expected)).toEqual({ kind: 'HASH', hash: tx.hash });
    const refused = vi.fn(async () => ({ ok: false as const, definite: true }));
    expect(await service({ read: chain().read, send: refused }).broadcast('0x2105', tx.raw, expected)).toEqual({ kind: 'UNKNOWN', code: 'FLOFI_WALLET_BROADCAST_REFUSED' });
    const silent = vi.fn(async () => ({ ok: false as const, definite: false }));
    expect(await service({ read: chain().read, send: silent }).broadcast('0x2105', tx.raw, expected)).toEqual({ kind: 'UNKNOWN', code: 'FLOFI_WALLET_BROADCAST_UNCONFIRMED' });
    const odd = vi.fn(async () => ({ ok: true as const, result: '0x' + '0'.repeat(64) }));
    expect(await service({ read: chain().read, send: odd }).broadcast('0x2105', tx.raw, expected)).toEqual({ kind: 'UNKNOWN', code: 'FLOFI_WALLET_BROADCAST_RESULT_INVALID' });
    for (const sender of [lost, refused, silent, odd]) expect(sender).toHaveBeenCalledTimes(1);
  });
  it('sends through a transport that carries eth_sendRawTransaction only', async () => {
    const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xabc' })));
    expect(await rawTransactionSender('https://rpc.example', transport as unknown as typeof fetch)('0x02aa')).toEqual({ ok: true, result: '0xabc' });
    expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x02aa'] });
    expect(transport.mock.calls[0]![1]!.redirect).toBe('error');
    const failing = vi.fn(async () => { throw new Error('reset'); });
    expect(await rawTransactionSender('https://rpc.example', failing as unknown as typeof fetch)('0x02aa')).toEqual({ ok: false, definite: false });
    const error = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nonce too low' } })));
    expect(await rawTransactionSender('https://rpc.example', error as unknown as typeof fetch)('0x02aa')).toEqual({ ok: false, definite: true });
  });
});

describe('the managed-wallet-evm cloud flow', () => {
  const flow = FLOWS['managed-wallet-evm'];
  it('validates its arguments strictly and keeps no runs', async () => {
    const tx = await signed(), expected = expectedBroadcast(tx.decoded.tx, tx.decoded.hash);
    expect(flow.methods.pendingNonce!.validate(['0x2105', '0x' + '1'.repeat(40)])).toBe(true);
    expect(flow.methods.pendingNonce!.validate(['8453', '0x' + '1'.repeat(40)])).toBe(false);
    expect(flow.methods.fees!.validate(['0x2105'])).toBe(true);
    expect(flow.methods.broadcast!.validate(['0x2105', tx.raw, expected])).toBe(true);
    expect(flow.methods.broadcast!.validate(['0x2105', tx.raw, { ...expected, extra: '1' }])).toBe(false);
    expect(flow.methods.broadcast!.validate(['0x2105', '0x01aa', expected])).toBe(false);
    expect(flow.needsObservation({})).toBe(false);
    expect(flow.projector('x.jsonl', new Uint8Array())).toBeNull();
    expect(flow.ownership).toBeUndefined();
  });
  it('is on wherever a catalog mainnet is, and never on a hosted loopback harness', () => {
    expect(flowMode('managed-wallet-evm', {})).toBe('off');
    expect(flowMode('managed-wallet-evm', { GRYLOO_BASE_MAINNET: 'live' })).toBe('live');
    expect(flowMode('managed-wallet-evm', { GRYLOO_BASE_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' })).toBe('harness');
    expect(flowMode('managed-wallet-evm', { GRYLOO_BASE_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', VERCEL: '1' })).toBe('off');
  });
});
