// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's gate reads runs through each flow's own action, counts only managed wallets of the account,
// and lets the relay claim each reviewed attempt's signature exactly once.
import { describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({ jupiter: vi.fn(), devnet: vi.fn(), solanaTransfer: vi.fn(), transfer: vi.fn(), swap: vi.fn() }));
vi.mock('./jupiter-action', () => ({ jupiterStatus: status.jupiter }));
vi.mock('./solana-devnet-action', () => ({ solanaDevnetStatus: status.devnet }));
vi.mock('./solana-transfer-action', () => ({ solanaTransferStatus: status.solanaTransfer }));
vi.mock('./robinhood-transfer-action', () => ({ transferStatus: status.transfer }));
vi.mock('./public-testnet-action', () => ({ publicStatus: status.swap }));
const { claimAttempt, claimDigest, loadSigningRun, managedWallets, RELEASABLE_PROVIDER_STATUSES, releaseAttempt, signingDeps, signingGate } = await import('./flofi-wallet-signing');
import type { AccountWallet } from '../accounts/account-model';
import type { ManagedSigningDeps } from '../server/managed-signing';

const EVM = '0x' + '1'.repeat(40), SOLANA = '7'.repeat(32) + 'abcd';
const wallet = (ecosystem: 'evm' | 'solana', address: string, origin: AccountWallet['origin'] = 'generated', provider = 'turnkey'): AccountWallet => ({ id: `${ecosystem}:${address}`,
  ecosystem, address, origin, provider, providerName: 'x', export: 'none', label: 'x', addedAt: '2026-10-31T00:00:00.000Z' });

describe('runs and wallets', () => {
  it('reads each supported flow through its own status action and surfaces the flow’s refusal', async () => {
    status.jupiter.mockResolvedValue({ ok: true, value: 'j' }); status.devnet.mockResolvedValue({ ok: true, value: 'd' });
    status.solanaTransfer.mockResolvedValue({ ok: true, value: 's' }); status.transfer.mockResolvedValue({ ok: true, value: 't' });
    status.swap.mockResolvedValue({ ok: false, code: 'BASE_MAINNET_NOT_ENABLED' });
    expect(await loadSigningRun('jupiter-swap', 'jupiter-1')).toBe('j');
    expect(await loadSigningRun('solana-transfer', 'soltx-1')).toBe('s');
    expect(status.solanaTransfer).toHaveBeenCalledWith('mainnet', 'soltx-1');
    // FloFi Wallet is mainnet only: no Devnet status is ever read.
    expect(status.devnet).not.toHaveBeenCalled();
    expect(await loadSigningRun('base-mainnet-transfer', 'bat-1')).toBe('t');
    await expect(loadSigningRun('base-swap', 'bas-1')).rejects.toThrow('BASE_MAINNET_NOT_ENABLED');
  });
  it('counts only managed (generated or imported) wallets of the account', async () => {
    const wallets = [wallet('evm', EVM), wallet('solana', SOLANA, 'imported'), wallet('evm', '0x' + '2'.repeat(40), 'external', 'io.metamask')];
    expect(managedWallets(wallets).map(item => item.address)).toEqual([EVM, SOLANA]);
    const deps = signingDeps(wallets);
    expect(await deps.managed('evm', EVM.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(await deps.managed('evm', '0x' + '2'.repeat(40))).toBe(false);
    expect(await deps.managed('solana', SOLANA)).toBe(true);
    expect(await deps.managed('evm', SOLANA)).toBe(false);
  });
});

describe('signing gate', () => {
  const transferRecord = { id: 'bat-' + 'a'.repeat(32), verdict: 'PENDING', authorization: '0xc', review: { format: 'gryloo.native-transfer-review.v1', chainId: 8453, account: EVM,
    recipient: EVM, value: '1', nonce: '7', feeBudget: '1', expiresAt: '2999-01-01T00:00:00.000Z', commitment: '0xc' },
    attempt: { state: 'SUBMITTING', nonce: '7', transactionHash: null, transaction: { from: EVM, to: EVM, value: '0x1', data: '0x', chainId: '0x2105', gas: '0x5208',
      maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1' } } };
  const request = { ecosystem: 'evm' as const, tx: { from: EVM, to: EVM, value: 1n, data: '0x', chainId: 8453n, nonce: 7n, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n } };
  const deps: ManagedSigningDeps = { load: async () => structuredClone(transferRecord), managed: (_e, address) => address === EVM };
  const context = { flow: 'base-mainnet-transfer', runId: transferRecord.id };
  it('summarizes without claiming for the sign-context route', async () => {
    const store = { consumeProof: vi.fn(async () => true) };
    expect((await signingGate(store, [], { claim: false }, deps)(context, request)).ok).toBe(true);
    expect(store.consumeProof).not.toHaveBeenCalled();
  });
  it('claims the attempt’s single signature for the relay and refuses a second one', async () => {
    const claimed = new Set<string>(), store = { consumeProof: vi.fn(async (digest: string) => !claimed.has(digest) && Boolean(claimed.add(digest))) };
    const gate = signingGate(store, [], { claim: true }, deps);
    expect((await gate(context, request)).ok).toBe(true);
    expect(await gate(context, request)).toEqual({ ok: false, code: 'FLOFI_WALLET_ALREADY_SIGNED' });
    expect(store.consumeProof.mock.calls[0]![0]).toBe(claimDigest('signature', `base-mainnet-transfer:${transferRecord.id}:TRANSFER:7`));
    expect(await signingGate({ consumeProof: async () => { throw new Error('db'); } }, [], { claim: true }, deps)(context, request))
      .toEqual({ ok: false, code: 'FLOFI_WALLET_REVIEW_UNAVAILABLE' });
  });
  it('gives the claim back only when the provider provably created no activity, so the person can sign that attempt again', async () => {
    const claimed = new Set<string>();
    const store = { consumeProof: vi.fn(async (digest: string) => !claimed.has(digest) && Boolean(claimed.add(digest))),
      releaseProof: vi.fn(async (digest: string) => { claimed.delete(digest); }) };
    const gate = signingGate(store, [], { claim: true }, deps), first = await gate(context, request);
    expect(first.ok).toBe(true);
    await releaseAttempt(store, (first as { value: { attempt: string } }).value.attempt);
    expect((await gate(context, request)).ok).toBe(true);
    expect([...RELEASABLE_PROVIDER_STATUSES].sort()).toEqual([400, 401, 403]); // never 5xx or a missing answer: those may have signed
  });
  it('never claims a refused request', async () => {
    const store = { consumeProof: vi.fn(async () => true) };
    expect(await signingGate(store, [], { claim: true }, deps)(context, { ...request, tx: { ...request.tx, nonce: 8n } })).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    expect(store.consumeProof).not.toHaveBeenCalled();
  });
  it('keeps signature and broadcast claims separate and outliving the Review', async () => {
    const store = { consumeProof: vi.fn(async () => true) }, now = new Date('2026-10-31T12:00:00.000Z');
    await claimAttempt(store, 'broadcast', 'a', now.getTime() - 1, now);
    expect(store.consumeProof).toHaveBeenCalledWith(claimDigest('broadcast', 'a'), new Date(now.getTime() + 24 * 3600 * 1000), now);
    expect(claimDigest('broadcast', 'a')).not.toBe(claimDigest('signature', 'a'));
  });
});
