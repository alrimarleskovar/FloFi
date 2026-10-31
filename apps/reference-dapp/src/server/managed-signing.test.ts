// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs only the exact bytes of a reviewed, pre-wallet attempt of a supported flow whose owner is a
// managed wallet of the account; everything else is refused by name or as "no matching review".
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, SOLANA_DEVNET_TRANSFER, SOLANA_MAINNET_TRANSFER } from '@defi-workflow-engine/action-registry';
import { decodeUnsignedEip1559, FILLED_FEE_BOUND, parseSigningRequest, resolveManagedSigning, unsignedSolanaMessage, units, type ManagedEvmTransaction,
  type ManagedSigningDeps, type ManagedSigningRequest } from './managed-signing';

const NOW = Date.parse('2026-10-31T12:00:00.000Z'), LATER = '2026-10-31T12:01:00.000Z', EARLIER = '2026-10-31T11:59:00.000Z';
const OWNER = '0x' + '1'.repeat(40), RECIPIENT = '0x' + '2'.repeat(40), TOKEN = '0x' + '3'.repeat(40), ROUTER = '0x' + '4'.repeat(40);
const SOL_OWNER = '7'.repeat(32) + 'abcd', SOL_RECIPIENT = '8'.repeat(32) + 'efgh';
const deps = (record: unknown, patch: { [K in keyof ManagedSigningDeps]?: ManagedSigningDeps[K] | undefined } = {}): ManagedSigningDeps => ({
  load: async () => structuredClone(record), managed: (ecosystem, address) => ecosystem === 'evm' ? address === OWNER : address === SOL_OWNER,
  pendingNonce: async () => 7n, fees: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }), now: () => NOW, ...patch } as ManagedSigningDeps);
const evm = (tx: ManagedEvmTransaction): ManagedSigningRequest => ({ ecosystem: 'evm', tx });

// ── EVM transfer (Base mainnet, `bat-` run, attempt SUBMITTING after the durable handoff) ──────────────────────────────────────────
const TRANSFER_ID = 'bat-' + 'a'.repeat(32);
const transferTx = { from: OWNER, to: RECIPIENT, value: '0xde0b6b3a7640000', data: '0x', chainId: '0x2105', gas: '0x5208', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0xf4240' };
const transferRecord = (patch: Record<string, unknown> = {}, attempt: Record<string, unknown> = {}) => ({
  id: TRANSFER_ID, verdict: 'PENDING', authorization: '0xc', notSubmitted: false,
  review: { format: 'gryloo.native-transfer-review.v1', chainId: 8453, chain: 'eip155:8453', account: OWNER, recipient: RECIPIENT, value: '1000000000000000000',
    nonce: '7', transaction: transferTx, feeBudget: '21000000000000', expiresAt: LATER, commitment: '0xc' },
  attempt: { state: 'SUBMITTING', nonce: '7', transaction: transferTx, transactionHash: null, preparedAtBlock: 1, reconciled: false, ...attempt }, ...patch });
const signedTransfer: ManagedEvmTransaction = { from: OWNER, to: RECIPIENT, value: 10n ** 18n, data: '0x', chainId: 8453n, nonce: 7n, gas: 21_000n,
  maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n };

// ── Catalog swap (Robinhood Chain `rhs-` run, non-strict: nonce and fees are filled by FloFi Wallet's provider) ──────────────────
const SWAP_ID = 'rhs-' + 'b'.repeat(24);
const swapQuote = (patch: Record<string, unknown> = {}) => ({ executionId: SWAP_ID, chainId: 4663, environment: 'MAINNET', manifestHash: '0xm', inputToken: TOKEN,
  outputToken: '0x' + '5'.repeat(40), inputSymbol: 'USDC', outputSymbol: 'TSLA', inputDecimals: 6, outputDecimals: 18, amountIn: '2500000', expectedOut: '10000000000000000',
  minimumOut: '9900000000000000', slippageBps: 100, expiresAt: LATER, ...patch });
const swapAttempt = (patch: Record<string, unknown> = {}) => ({ attemptId: `${SWAP_ID}.swap.1`, executionId: SWAP_ID, step: 'swap', state: 'PREPARED', account: OWNER, chainId: 4663,
  environment: 'MAINNET', manifestHash: '0xm', txHash: null, tx: { chainId: '0x1237', from: OWNER, to: ROUTER, data: '0x04e45aaf' + '0'.repeat(64), value: '0x0', gas: '0x30d40' }, ...patch });
const swapRun = (quote: Record<string, unknown> = {}, attempt: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) =>
  ({ quote: swapQuote(quote), reviewedManifestHash: '0xm', attempts: [swapAttempt(attempt)], outcome: null, ...patch });
const signedSwap: ManagedEvmTransaction = { from: OWNER, to: ROUTER, value: 0n, data: '0x04e45aaf' + '0'.repeat(64), chainId: 4663n, nonce: 7n, gas: 200_000n,
  maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };

// ── Solana mainnet (Jupiter `jupiter-` run and transfer `soltx-` run, attempt PREPARED) ────────────────────────────────────
const MESSAGE = Uint8Array.from([0x80, 1, 0, 1, 2, ...new Array(64).fill(9)]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const JUPITER_ID = 'jupiter-' + 'c'.repeat(32), SOLTX_ID = 'soltx-' + 'd'.repeat(32), SOLTD_ID = 'soltd-' + 'd'.repeat(32), ORCA_ID = 'orca-' + 'e'.repeat(32);
const jupiterRecord = (attempt: Record<string, unknown> = {}, review: Record<string, unknown> = {}) => ({ id: JUPITER_ID, verdict: 'PENDING', authorization: '0xr',
  review: { format: 'gryloo.jupiter-review.v1', chain: JUPITER_SOLANA_MAINNET.chain, cluster: 'mainnet-beta', owner: SOL_OWNER, message: b64(MESSAGE), messageHash: '0xh',
    amount: '1500000', input: { symbol: 'USDC', decimals: 6 }, output: { symbol: 'SOL', decimals: 9 }, quote: { outAmount: '10000000', otherAmountThreshold: '9950000' },
    slippageBps: 50, estimatedFeeLamports: '5000', expiresAt: LATER, commitment: '0xr', ...review },
  attempt: { state: 'PREPARED', messageHash: '0xh', signature: null, transaction: null, ...attempt } });
const solanaTransferRecord = (review: Record<string, unknown> = {}, id = SOLTX_ID) => ({ id, verdict: 'PENDING', authorization: '0xs',
  review: { format: 'gryloo.solana-transfer-review.v1', chain: SOLANA_MAINNET_TRANSFER.chain, cluster: SOLANA_MAINNET_TRANSFER.cluster, owner: SOL_OWNER, recipient: SOL_RECIPIENT, amount: '250000000',
    asset: { symbol: 'SOL', mint: null, decimals: 9 }, maximumNetworkCostLamports: '2044280', message: b64(MESSAGE), messageHash: '0xh', expiresAt: LATER, commitment: '0xs', ...review },
  attempt: { state: 'PREPARED', messageHash: '0xh', signature: null, transaction: null } });

describe('the signing binding refuses what it cannot bind', () => {
  it.each(['robinhood-transfer', 'base-sepolia-swap', 'aave-supply', 'crosschain-router', 'crosschain-universal', 'orca-liquidity-mainnet', 'nonsense'])(
    'refuses %s by name before reading anything', async flow => {
      let read = false;
      const result = await resolveManagedSigning({ flow, runId: TRANSFER_ID }, evm(signedTransfer), deps(null, { load: async () => { read = true; return null; } }));
      expect(result).toEqual({ ok: false, code: 'FLOFI_WALLET_FLOW_NOT_SUPPORTED' });
      expect(read).toBe(false);
    });
  it('refuses a run id outside the flow’s namespace, the wrong ecosystem and an unreadable run', async () => {
    expect(await resolveManagedSigning({ flow: 'robinhood-mainnet-transfer', runId: TRANSFER_ID }, evm(signedTransfer), deps(transferRecord()))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    expect(await resolveManagedSigning({ flow: 'base-mainnet-transfer', runId: TRANSFER_ID }, { ecosystem: 'solana', message: MESSAGE }, deps(transferRecord()))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    expect(await resolveManagedSigning({ flow: 'base-mainnet-transfer', runId: TRANSFER_ID }, evm(signedTransfer), deps(null, { load: async () => { throw new Error('BASE_MAINNET_NOT_ENABLED'); } })))
      .toEqual({ ok: false, code: 'FLOFI_WALLET_REVIEW_UNAVAILABLE' });
  });
});

describe('EVM transfer attempts', () => {
  const context = { flow: 'base-mainnet-transfer', runId: TRANSFER_ID };
  it.each(['PREPARED', 'SUBMITTING'])('matches the exact %s attempt and summarizes the server Review', async state => {
    const result = await resolveManagedSigning(context, evm(signedTransfer), deps(transferRecord({}, { state })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempt).toBe(`base-mainnet-transfer:${TRANSFER_ID}:TRANSFER:7`);
    expect(result.value.evm).toEqual({ chainId: 8453, tx: signedTransfer });
    expect(result.value.summary).toMatchObject({ flow: 'base-mainnet-transfer', network: 'Base', chain: 'eip155:8453', realFunds: true, action: 'Transfer', owner: OWNER, expiresAt: LATER });
    expect(result.value.summary.lines).toEqual([{ label: 'You send', value: '1 ETH' }, { label: 'Recipient', value: RECIPIENT },
      { label: 'Max network cost', value: '0.000021 ETH' }, { label: 'Nonce', value: '7' }]);
  });
  it.each([
    ['another recipient', { to: TOKEN }], ['another value', { value: 1n }], ['other calldata', { data: '0x00' }], ['another nonce', { nonce: 8n }],
    ['another gas limit', { gas: 21_001n }], ['other fees', { maxFeePerGas: 2_000_000_000n }], ['another chain', { chainId: 4663n }], ['another sender', { from: RECIPIENT }],
  ] as const)('refuses %s', async (_name, patch) => {
    expect(await resolveManagedSigning(context, evm({ ...signedTransfer, ...patch }), deps(transferRecord()))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it.each([
    ['a recorded hash', {}, { transactionHash: '0x' + 'f'.repeat(64) }], ['a refused attempt', {}, { state: 'CANCELLED' }], ['an unknown result', {}, { state: 'SUBMISSION_RESULT_UNKNOWN' }],
    ['a replaced authorization', { authorization: '0xother' }, {}], ['a terminal run', { verdict: 'RECONCILED' }, {}], ['a not-submitted run', { notSubmitted: true }, {}],
  ] as const)('refuses %s', async (_name, run, attempt) => {
    expect(await resolveManagedSigning(context, evm(signedTransfer), deps(transferRecord(run, attempt)))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it('refuses an owner that is not a managed wallet of this account, and an expired Review', async () => {
    expect(await resolveManagedSigning(context, evm(signedTransfer), deps(transferRecord(), { managed: () => false }))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    const expired = transferRecord(); expired.review.expiresAt = EARLIER;
    expect(await resolveManagedSigning(context, evm(signedTransfer), deps(expired))).toEqual({ ok: false, code: 'FLOFI_WALLET_REVIEW_EXPIRED' });
  });
});

describe('catalog swap attempts', () => {
  const context = { flow: 'robinhood-swap', runId: SWAP_ID };
  it('accepts provider-filled nonce and fees only at the pending nonce and within the fee bound, and says who set them', async () => {
    const result = await resolveManagedSigning(context, evm(signedSwap), deps(swapRun()));
    expect(result.ok && result.value.summary).toMatchObject({ action: 'Swap', network: 'Robinhood Chain', lines: [
      { label: 'You pay', value: '2.5 USDC' }, { label: 'Expected to receive', value: '0.01 TSLA' }, { label: 'Minimum received', value: '0.0099 TSLA' },
      { label: 'Max slippage', value: '1.00%' }, { label: 'Max network fee (set by FloFi Wallet)', value: '0.0004 ETH' }, { label: 'Nonce', value: '7' }] });
    expect(await resolveManagedSigning(context, evm({ ...signedSwap, nonce: 8n }), deps(swapRun()))).toEqual({ ok: false, code: 'FLOFI_WALLET_NONCE_MISMATCH' });
    expect(await resolveManagedSigning(context, evm({ ...signedSwap, maxFeePerGas: 1_000_000_000n * FILLED_FEE_BOUND + 1n }), deps(swapRun())))
      .toEqual({ ok: false, code: 'FLOFI_WALLET_FEE_TOO_HIGH' });
    // At broadcast the filled values were bounded when the relay granted the signature: a newer fee or nonce read cannot drop it, while
    // every bound field is still compared.
    const later = { ...deps(swapRun()), filledBoundedAtSigning: true, fees: async () => { throw new Error('not read'); }, pendingNonce: async () => { throw new Error('not read'); } };
    expect((await resolveManagedSigning(context, evm({ ...signedSwap, maxFeePerGas: 1_000_000_000n * FILLED_FEE_BOUND + 1n }), later)).ok).toBe(true);
    expect(await resolveManagedSigning(context, evm({ ...signedSwap, value: 1n }), later)).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    expect(await resolveManagedSigning(context, evm(signedSwap), deps(swapRun(), { pendingNonce: undefined }))).toEqual({ ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' });
    expect(await resolveManagedSigning(context, evm(signedSwap), deps(swapRun(), { fees: async () => { throw new Error('down'); } }))).toEqual({ ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' });
  });
  it('requires the reviewed nonce and fees exactly on a strict (owner-bound) swap, without reading the chain', async () => {
    const strict = swapRun({ ownerReview: { account: OWNER } }, { tx: { ...swapAttempt().tx, nonce: '0x7', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0xf4240' } });
    const reads = deps(strict, { pendingNonce: async () => { throw new Error('not read'); }, fees: async () => { throw new Error('not read'); } });
    const result = await resolveManagedSigning(context, evm(signedSwap), reads);
    expect(result.ok && result.value.summary.lines.find(line => line.label.startsWith('Max network fee'))?.label).toBe('Max network fee');
    expect(await resolveManagedSigning(context, evm({ ...signedSwap, maxFeePerGas: 1_999_999_999n }), reads)).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it('shows an exact approval of the reviewed amount and refuses any other approval', async () => {
    const data = `0x095ea7b3${ROUTER.slice(2).padStart(64, '0')}${(2_500_000n).toString(16).padStart(64, '0')}`;
    const run = swapRun({}, { attemptId: `${SWAP_ID}.approval.1`, step: 'approval', tx: { ...swapAttempt().tx, to: TOKEN, data } });
    const result = await resolveManagedSigning(context, evm({ ...signedSwap, to: TOKEN, data }), deps(run));
    expect(result.ok && result.value.summary).toMatchObject({ action: 'Token approval', lines: [{ label: 'Approve', value: '2.5 USDC' }, { label: 'Spender', value: ROUTER },
      { label: 'For', value: 'Swap USDC → TSLA' }, { label: 'Max network fee (set by FloFi Wallet)', value: '0.0004 ETH' }] });
    const unlimited = `0x095ea7b3${ROUTER.slice(2).padStart(64, '0')}${'f'.repeat(64)}`;
    const other = swapRun({}, { step: 'approval', tx: { ...swapAttempt().tx, to: TOKEN, data: unlimited } });
    expect(await resolveManagedSigning(context, evm({ ...signedSwap, to: TOKEN, data: unlimited }), deps(other))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it.each([
    ['an unreviewed manifest', {}, {}, { reviewedManifestHash: null }], ['a reported hash', {}, { state: 'HASH', txHash: '0x' + '1'.repeat(64) }, {}],
    ['another network’s run', { chainId: 8453 }, {}, {}], ['a divergent run', {}, {}, { divergence: 'X' }], ['another owner', {}, { account: RECIPIENT }, {}],
  ] as const)('refuses %s', async (_name, quote, attempt, patch) => {
    expect(await resolveManagedSigning(context, evm(signedSwap), deps(swapRun(quote, attempt, patch)))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
});

describe('Solana attempts', () => {
  it('matches the exact reviewed v0 message of a Jupiter attempt and summarizes it', async () => {
    const result = await resolveManagedSigning({ flow: 'jupiter-swap', runId: JUPITER_ID }, { ecosystem: 'solana', chain: 'solana:mainnet', address: SOL_OWNER, message: MESSAGE },
      deps(jupiterRecord()));
    expect(result.ok && result.value).toMatchObject({ attempt: `jupiter-swap:${JUPITER_ID}:0xh`, owner: SOL_OWNER, summary: { network: 'Solana', chain: 'solana:mainnet',
      realFunds: true, action: 'Swap', lines: [{ label: 'You pay', value: '1.5 USDC' }, { label: 'Expected to receive', value: '0.01 SOL' },
        { label: 'Minimum received', value: '0.00995 SOL' }, { label: 'Max slippage', value: '0.50%' }, { label: 'Network fee (estimate)', value: '0.000005 SOL' },
        { label: 'Provider', value: 'Jupiter' }] } });
  });
  it.each([
    ['another message', { message: Uint8Array.from([...MESSAGE.slice(0, -1), 1]) }, {}, {}],
    ['another signer', { address: SOL_RECIPIENT }, {}, {}], ['a signed attempt', {}, { signature: 'sig' }, {}], ['a submitted attempt', {}, { state: 'SUBMITTING' }, {}],
    ['a Devnet review', {}, {}, { chain: ORCA_WHIRLPOOLS_DEVNET.chain, cluster: 'devnet' }],
  ] as const)('refuses %s', async (_name, request, attempt, review) => {
    const base = { ecosystem: 'solana' as const, chain: 'solana:mainnet' as const, address: SOL_OWNER, message: MESSAGE };
    expect(await resolveManagedSigning({ flow: 'jupiter-swap', runId: JUPITER_ID }, { ...base, ...request }, deps(jupiterRecord(attempt, review))))
      .toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it('matches a Solana mainnet transfer with real funds', async () => {
    const result = await resolveManagedSigning({ flow: 'solana-transfer', runId: SOLTX_ID }, { ecosystem: 'solana', chain: 'solana:mainnet', message: MESSAGE },
      deps(solanaTransferRecord()));
    expect(result.ok && result.value.summary).toMatchObject({ network: 'Solana', chain: 'solana:mainnet', realFunds: true, action: 'Transfer', lines: [{ label: 'You send', value: '0.25 SOL' },
      { label: 'Recipient', value: SOL_RECIPIENT }, { label: 'Max network cost', value: '0.00204428 SOL' }] });
  });
});

describe('request decoding', () => {
  const tx: erc7710.Eip1559 = { chainId: 8453n, nonce: 7n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gasLimit: 21_000n, to: RECIPIENT, value: 5n, data: '0xabcd' };
  it('decodes exactly the canonical unsigned EIP-1559 bytes and nothing else', () => {
    const hex = Buffer.from(erc7710.unsignedEip1559(tx)).toString('hex');
    expect(decodeUnsignedEip1559(hex)).toEqual({ chainId: 8453n, nonce: 7n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gas: 21_000n, to: RECIPIENT, value: 5n, data: '0xabcd' });
    expect(decodeUnsignedEip1559(`0x${hex}`)).not.toBeNull();
    expect(decodeUnsignedEip1559(`03${hex.slice(2)}`)).toBeNull();
    expect(decodeUnsignedEip1559(`${hex}00`)).toBeNull();
  });
  it('reads the message of an unsigned wire transaction only when every signature slot is empty', () => {
    const wire = Uint8Array.from([1, ...new Array(64).fill(0), ...MESSAGE]);
    expect(unsignedSolanaMessage(wire)).toEqual(MESSAGE);
    wire[5] = 1;
    expect(unsignedSolanaMessage(wire)).toBeNull();
  });
  it('parses the sign-context body in both binding forms and refuses extra or inconsistent fields', () => {
    const op = { op: 'evm_sign_transaction', address: OWNER, tx: { from: OWNER, to: RECIPIENT, value: '0x0', data: '0x', chainId: '0x2105', nonce: '0x7', gas: '0x5208',
      maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1' } };
    expect(parseSigningRequest({ flow: 'base-swap', runId: SWAP_ID, ...op })?.context).toEqual({ flow: 'base-swap', runId: SWAP_ID });
    expect(parseSigningRequest({ ...op, signing: { flow: 'base-swap', runId: SWAP_ID } })?.request).toMatchObject({ ecosystem: 'evm', tx: { nonce: 7n, chainId: 8453n } });
    expect(parseSigningRequest({ flow: 'base-swap', runId: SWAP_ID, ...op, extra: 1 })).toBeNull();
    expect(parseSigningRequest({ flow: 'base-swap', runId: SWAP_ID, ...op, address: RECIPIENT })).toBeNull();
    expect(parseSigningRequest({ ...op, flow: 'x', signing: { flow: 'base-swap', runId: SWAP_ID } })).toBeNull();
    const wire = b64(Uint8Array.from([1, ...new Array(64).fill(0), ...MESSAGE]));
    expect(parseSigningRequest({ flow: 'jupiter-swap', runId: JUPITER_ID, op: 'solana_sign_transaction', address: SOL_OWNER, chain: 'solana:mainnet', transaction: wire })?.request)
      .toEqual({ ecosystem: 'solana', chain: 'solana:mainnet', address: SOL_OWNER, message: MESSAGE });
  });
  it('formats base units without floating point', () => {
    expect(units('1', 18, 'ETH')).toBe('0.000000000000000001 ETH');
    expect(units('123456789000', 6, 'USDC')).toBe('123456.789 USDC');
    expect(units('-1', 6, 'USDC')).toBeNull();
  });
});

describe('mainnet only (owner requirement): Devnet and testnets are refused at the signing boundary', () => {
  it('refuses the former Devnet flows by name, and Devnet records under mainnet flows', async () => {
    const request = { ecosystem: 'solana' as const, chain: 'solana:mainnet' as const, address: SOL_OWNER, message: MESSAGE };
    for (const [flow, runId] of [['solana-devnet-swap', ORCA_ID], ['solana-devnet-transfer', SOLTD_ID]] as const)
      expect(await resolveManagedSigning({ flow, runId }, request, deps(solanaTransferRecord()))).toEqual({ ok: false, code: 'FLOFI_WALLET_FLOW_NOT_SUPPORTED' });
    // A Devnet record (chain/cluster) never matches, even behind a mainnet flow name and a mainnet-shaped run id.
    expect(await resolveManagedSigning({ flow: 'solana-transfer', runId: SOLTX_ID }, request,
      deps(solanaTransferRecord({ chain: SOLANA_DEVNET_TRANSFER.chain, cluster: SOLANA_DEVNET_TRANSFER.cluster })))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    expect(await resolveManagedSigning({ flow: 'jupiter-swap', runId: JUPITER_ID }, request,
      deps(jupiterRecord({}, { chain: ORCA_WHIRLPOOLS_DEVNET.chain, cluster: 'devnet', format: 'gryloo.orca-devnet-review.v1' })))).toEqual({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  });
  it('parses no Devnet or Testnet Solana request', () => {
    const wire = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from(MESSAGE)]).toString('base64');
    for (const chain of ['solana:devnet', 'solana:testnet'])
      expect(parseSigningRequest({ flow: 'jupiter-swap', runId: JUPITER_ID, op: 'solana_sign_transaction', address: SOL_OWNER, chain, transaction: wire })).toBeNull();
    expect(parseSigningRequest({ flow: 'jupiter-swap', runId: JUPITER_ID, op: 'solana_sign_transaction', address: SOL_OWNER, chain: 'solana:mainnet', transaction: wire })).not.toBeNull();
  });
});
