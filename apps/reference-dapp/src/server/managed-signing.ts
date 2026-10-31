// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: resolves a FloFi Wallet signing request to the one reviewed FloFi attempt it may sign (spec §2, §3).
 *
 * The product origin is untrusted (no `script-src`), so FloFi Wallet must not sign bytes on its word, and it cannot judge router or
 * program calldata by decoding it. Instead the request names its run (`{flow, runId}`) and this resolver, given that run as the run's own
 * service loaded it, accepts the bytes only when ALL of these hold:
 *  - the flow is one FloFi can bind (`SIGNING_FLOWS`), else `FLOFI_WALLET_FLOW_NOT_SUPPORTED`;
 *  - the run is pending and authorized for its current Review, and its attempt is the pre-wallet one (PREPARED, or SUBMITTING after the
 *    durable handoff) with no signature or hash recorded yet;
 *  - the attempt's owner is a managed wallet saved to this FloFi account (the caller's `managed` check);
 *  - the bytes equal the attempt's exactly: Solana the reviewed v0 message; EVM chainId, from, to, value, data and gas, plus nonce and fees
 *    wherever the attempt binds them. Where FloFi's managed provider filled them (non-strict catalog swaps), the nonce must be the owner's
 *    pending nonce and the fee cap must stay within a bound of the network's current fees, so two signatures can never both be valid;
 *  - the Review has not expired.
 * The summary is built from the server's Review only (amounts, minimum received, recipients, fees, expiry), never from request fields.
 * Nothing here signs, broadcasts or writes; claims (one signature and one broadcast per attempt) are the caller's.
 */
import { JUPITER_SOLANA_MAINNET, SOLANA_MAINNET_TRANSFER } from '@defi-workflow-engine/action-registry';
import { erc7710, parseRlpInteger, rlpBytes, rlpDecode, rlpList } from '@defi-workflow-engine/reference-compiler';
import { isSigningFlow, SIGNING_FLOWS, type SigningContext, type SigningFlow, type SigningSummary } from '../wallet/flofi-signing.ts';
import type { WalletEcosystem } from '../wallet/wallet-registry.ts';
import type { JupiterRecord } from './jupiter-service.ts';
import type { SolanaTransferRecord } from './solana-transfer-service.ts';
import type { TransferRecord } from './robinhood-transfer-service.ts';
import type { PublicAttempt, PublicRun } from './public-testnet-service.ts';

/** A fully populated EIP-1559 transaction as FloFi Wallet would sign it. */
export type ManagedEvmTransaction = { readonly from: string; readonly to: string; readonly value: bigint; readonly data: string; readonly chainId: bigint;
  readonly nonce: bigint; readonly gas: bigint; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint };
export type ManagedSigningRequest = { readonly ecosystem: 'evm'; readonly tx: ManagedEvmTransaction }
  | { readonly ecosystem: 'solana'; readonly message: Uint8Array; readonly chain?: 'solana:mainnet'; readonly address?: string };
export type ManagedSigningDeps = {
  /** The run as its own service's `status` returns it; throws (any error) when it cannot be read. */
  readonly load: (flow: SigningFlow, runId: string) => Promise<unknown>;
  /** Whether `address` is a managed wallet saved to the requesting FloFi account. */
  readonly managed: (ecosystem: WalletEcosystem, address: string) => boolean | Promise<boolean>;
  /** EVM reads for provider-filled fields (non-strict catalog swaps); absent ⇒ such requests fail closed. */
  readonly pendingNonce?: (chainId: number, address: string) => Promise<bigint>;
  readonly fees?: (chainId: number) => Promise<{ readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint }>;
  readonly now?: () => number;
  /**
   * Broadcast of signed bytes only: the nonce and fees FloFi Wallet filled were bounded against the network when the relay granted this
   * attempt's single signature, so they are not re-derived from a newer read (a fee move after signing must not drop a valid signature).
   * Every field the attempt binds, the owner and the expiry are still checked.
   */
  readonly filledBoundedAtSigning?: boolean;
};
/** A matched attempt: what FloFi Wallet shows, and the identity the caller claims once (signature, broadcast). */
export type ManagedSigningMatch = { readonly summary: SigningSummary; readonly attempt: string; readonly owner: string; readonly expiresAtMs: number;
  /** EVM only: the attempt's chain and the exact fields FloFi will broadcast (the request's, after every check). */
  readonly evm?: { readonly chainId: number; readonly tx: ManagedEvmTransaction } };
export type ManagedSigningResult = { readonly ok: true; readonly value: ManagedSigningMatch } | { readonly ok: false; readonly code: string };

/** The fee cap a provider-filled request may carry, as a multiple of the network's current suggestion. */
export const FILLED_FEE_BOUND = 4n;
const EVM_NETWORKS: Readonly<Record<string, { readonly chainId: number; readonly network: string }>> = Object.freeze({
  robinhood: { chainId: 4663, network: 'Robinhood Chain' }, base: { chainId: 8453, network: 'Base' },
  arbitrum: { chainId: 42161, network: 'Arbitrum' }, ethereum: { chainId: 1, network: 'Ethereum' } });
const evmNetworkOf = (flow: SigningFlow) => EVM_NETWORKS[flow.split('-')[0]!] ?? null;
const ADDRESS = /^0x[0-9a-f]{40}$/, HEX = /^0x(?:[0-9a-f]{2})*$/;
const refuse = (code: string): ManagedSigningResult => ({ ok: false, code });
const NO_MATCH = 'FLOFI_WALLET_NO_MATCHING_REVIEW';
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const big = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^(?:0x[0-9a-fA-F]{1,64}|0|[1-9][0-9]{0,77})$/.test(value)) return BigInt(value);
  return null;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const fromBase64 = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try { return new Uint8Array(Buffer.from(value, 'base64')); } catch { return null; }
};
/** Base units as a decimal string: no rounding, no float. */
export function units(amount: unknown, decimals: number, symbol: string): string | null {
  const value = big(amount);
  if (value === null || value < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const padded = value.toString().padStart(decimals + 1, '0'), whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : '';
  return `${whole}${fraction ? `.${fraction}` : ''} ${symbol}`.trim();
}
const percent = (bps: unknown) => typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000 ? `${(bps / 100).toFixed(2)}%` : null;
const short = (value: string) => value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
type Line = { label: string; value: string };
const lines = (...entries: readonly (readonly [string, string | null | undefined])[]): Line[] | null =>
  entries.some(([, value]) => value === null) ? null : entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string').map(([label, value]) => ({ label, value }));

/** The message of an unsigned Solana wire transaction (every signature slot zero), or null. */
export function unsignedSolanaMessage(wire: Uint8Array): Uint8Array | null {
  const count = wire[0];
  if (count === undefined || count < 1 || count > 0x7f || wire.length <= 1 + 64 * count || wire.length > 1_232) return null;
  if (wire.subarray(1, 1 + 64 * count).some(byte => byte !== 0)) return null;
  return wire.subarray(1 + 64 * count);
}
/** Decodes an unsigned EIP-1559 (type 2) transaction; non-canonical encodings, access lists and any other type are refused. */
export function decodeUnsignedEip1559(hex: string): Omit<ManagedEvmTransaction, 'from'> | null {
  const value = hex.toLowerCase().startsWith('0x') ? hex.toLowerCase() : `0x${hex.toLowerCase()}`;
  if (!HEX.test(value) || value.length < 6 || value.length > 262_146 || !value.startsWith('0x02')) return null;
  try {
    const bytes = Buffer.from(value.slice(4), 'hex'), fields = rlpList(rlpDecode(new Uint8Array(bytes)));
    if (fields.length !== 9 || rlpList(fields[8]!).length !== 0) return null;
    const to = rlpBytes(fields[5]!);
    if (to.length !== 20) return null;
    const tx = { chainId: parseRlpInteger(fields[0]!), nonce: parseRlpInteger(fields[1]!), maxPriorityFeePerGas: parseRlpInteger(fields[2]!),
      maxFeePerGas: parseRlpInteger(fields[3]!), gas: parseRlpInteger(fields[4]!), to: `0x${Buffer.from(to).toString('hex')}`, value: parseRlpInteger(fields[6]!),
      data: `0x${Buffer.from(rlpBytes(fields[7]!)).toString('hex')}` };
    const canonical = erc7710.unsignedEip1559({ chainId: tx.chainId, nonce: tx.nonce, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, maxFeePerGas: tx.maxFeePerGas,
      gasLimit: tx.gas, to: tx.to, value: tx.value, data: tx.data });
    return `0x${Buffer.from(canonical).toString('hex')}` === value ? tx : null;
  } catch { return null; }
}
/** A signed EIP-1559 transaction's fields and recovered sender (canonical encoding and signature checked by the codec). */
export function decodeSignedEip1559(raw: string): { readonly tx: ManagedEvmTransaction; readonly hash: string } | null {
  if (typeof raw !== 'string' || !/^0x02(?:[0-9a-fA-F]{2}){1,131072}$/.test(raw)) return null;
  try {
    const decoded = erc7710.decodeSignedEip1559(raw.toLowerCase()), t = decoded.tx;
    return { hash: decoded.hash.toLowerCase(), tx: { from: decoded.from.toLowerCase(), to: t.to.toLowerCase(), value: t.value, data: t.data.toLowerCase(), chainId: t.chainId,
      nonce: t.nonce, gas: t.gasLimit, maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas } };
  } catch { return null; }
}

async function solanaSwap(flow: 'jupiter-swap', runId: string, run: JupiterRecord, request: ManagedSigningRequest, deps: ManagedSigningDeps, now: number): Promise<ManagedSigningResult> {
  const review = run.review;
  // Mainnet only: a Devnet swap record (another format, chain or cluster) never matches, whatever its run id.
  if (run.id !== runId || review?.format !== 'gryloo.jupiter-review.v1' || review.chain !== JUPITER_SOLANA_MAINNET.chain || review.cluster !== 'mainnet-beta') return refuse(NO_MATCH);
  const attempt = run.attempt;
  if (run.verdict !== 'PENDING' || run.notSubmitted || run.authorization !== review.commitment || attempt?.state !== 'PREPARED' || attempt.signature
    || attempt.transaction || attempt.messageHash !== review.messageHash) return refuse(NO_MATCH);
  return solanaMatch(flow, runId, review.owner, review.message, review.expiresAt, `${flow}:${runId}:${review.messageHash}`, request, deps, now, () => lines(
    ['You pay', units(review.amount, review.input.decimals, review.input.symbol)],
    ['Expected to receive', units(review.quote.outAmount, review.output.decimals, review.output.symbol)],
    ['Minimum received', units(review.quote.otherAmountThreshold, review.output.decimals, review.output.symbol)],
    ['Max slippage', percent(review.slippageBps)],
    ['Network fee (estimate)', units(review.estimatedFeeLamports, 9, 'SOL')],
    ['Provider', 'Jupiter']), 'Swap');
}
async function solanaTransfer(flow: 'solana-transfer', runId: string, run: SolanaTransferRecord, request: ManagedSigningRequest, deps: ManagedSigningDeps, now: number): Promise<ManagedSigningResult> {
  const review = run.review;
  if (run.id !== runId || review?.format !== 'gryloo.solana-transfer-review.v1' || review.chain !== SOLANA_MAINNET_TRANSFER.chain
    || review.cluster !== SOLANA_MAINNET_TRANSFER.cluster) return refuse(NO_MATCH);
  const attempt = run.attempt;
  if (run.verdict !== 'PENDING' || run.notSubmitted || run.authorization !== review.commitment || attempt?.state !== 'PREPARED' || attempt.signature
    || attempt.transaction || attempt.messageHash !== review.messageHash) return refuse(NO_MATCH);
  const symbol = review.asset.symbol === 'SPL token' && review.asset.mint ? short(review.asset.mint) : review.asset.symbol;
  return solanaMatch(flow, runId, review.owner, review.message, review.expiresAt, `${flow}:${runId}:${review.messageHash}`, request, deps, now, () => lines(
    ['You send', units(review.amount, review.asset.decimals, symbol)],
    ['Recipient', review.recipient],
    ['Token mint', review.asset.mint ?? undefined],
    ['Max network cost', units(review.maximumNetworkCostLamports, 9, 'SOL')]), 'Transfer');
}
async function solanaMatch(flow: SigningFlow, runId: string, owner: string, message: string, expiresAt: string, attempt: string, request: ManagedSigningRequest,
  deps: ManagedSigningDeps, now: number, build: () => Line[] | null, action: string): Promise<ManagedSigningResult> {
  if (request.ecosystem !== 'solana' || request.chain && request.chain !== 'solana:mainnet'
    || request.address !== undefined && request.address !== owner) return refuse(NO_MATCH);
  const reviewed = fromBase64(message);
  if (!reviewed || !same(reviewed, request.message)) return refuse(NO_MATCH);
  if (typeof owner !== 'string' || !await deps.managed('solana', owner)) return refuse(NO_MATCH);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return refuse('FLOFI_WALLET_REVIEW_EXPIRED');
  const summaryLines = build();
  if (!summaryLines) return refuse(NO_MATCH);
  return { ok: true, value: { attempt, owner, expiresAtMs: expires, summary: { flow: flow as SigningSummary['flow'], runId, network: 'Solana',
    chain: 'solana:mainnet', realFunds: true, action, owner, lines: summaryLines, expiresAt: new Date(expires).toISOString() } } };
}

/** The request's fields against the attempt's: every bound field equal; provider-filled nonce and fees checked against the chain now. */
async function evmFields(request: ManagedSigningRequest, bound: { from: string; to: string; value: string; data: string; chainId: number; gas: string;
  nonce?: string | undefined; maxFeePerGas?: string | undefined; maxPriorityFeePerGas?: string | undefined }, deps: ManagedSigningDeps): Promise<{ ok: true; tx: ManagedEvmTransaction; filled: boolean } | { ok: false; code: string }> {
  if (request.ecosystem !== 'evm') return { ok: false, code: NO_MATCH };
  const tx = request.tx, nonce = big(bound.nonce), maxFee = big(bound.maxFeePerGas), priority = big(bound.maxPriorityFeePerGas);
  if (tx.from !== bound.from.toLowerCase() || tx.to !== bound.to.toLowerCase() || tx.value !== big(bound.value) || tx.data !== bound.data.toLowerCase()
    || tx.chainId !== BigInt(bound.chainId) || tx.gas !== big(bound.gas) || tx.gas <= 0n || tx.maxPriorityFeePerGas > tx.maxFeePerGas) return { ok: false, code: NO_MATCH };
  if ((bound.nonce !== undefined && (nonce === null || tx.nonce !== nonce)) || (bound.maxFeePerGas !== undefined && (maxFee === null || tx.maxFeePerGas !== maxFee))
    || (bound.maxPriorityFeePerGas !== undefined && (priority === null || tx.maxPriorityFeePerGas !== priority))) return { ok: false, code: NO_MATCH };
  if (deps.filledBoundedAtSigning) return { ok: true, tx, filled: bound.nonce === undefined || bound.maxFeePerGas === undefined };
  if (bound.nonce === undefined) {
    if (!deps.pendingNonce) return { ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' };
    let pending: bigint;
    try { pending = await deps.pendingNonce(bound.chainId, tx.from); } catch { return { ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' }; }
    // Only the owner's next nonce: a second signature for the same attempt could otherwise be valid alongside the first.
    if (tx.nonce !== pending) return { ok: false, code: 'FLOFI_WALLET_NONCE_MISMATCH' };
  }
  if (bound.maxFeePerGas === undefined || bound.maxPriorityFeePerGas === undefined) {
    if (!deps.fees) return { ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' };
    let suggested: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    try { suggested = await deps.fees(bound.chainId); } catch { return { ok: false, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' }; }
    if (tx.maxFeePerGas > suggested.maxFeePerGas * FILLED_FEE_BOUND || tx.maxPriorityFeePerGas > suggested.maxPriorityFeePerGas * FILLED_FEE_BOUND + 1n)
      return { ok: false, code: 'FLOFI_WALLET_FEE_TOO_HIGH' };
  }
  return { ok: true, tx, filled: bound.nonce === undefined || bound.maxFeePerGas === undefined };
}
async function evmTransfer(flow: SigningFlow, runId: string, run: TransferRecord, request: ManagedSigningRequest, deps: ManagedSigningDeps, now: number): Promise<ManagedSigningResult> {
  const network = evmNetworkOf(flow), review = run.review, attempt = run.attempt;
  if (!network || run.id !== runId || review?.format !== 'gryloo.native-transfer-review.v1' || review.chainId !== network.chainId) return refuse(NO_MATCH);
  if (run.verdict !== 'PENDING' || run.notSubmitted || run.authorization !== review.commitment || !attempt || !['PREPARED', 'SUBMITTING'].includes(attempt.state)
    || attempt.transactionHash || attempt.nonce !== review.nonce) return refuse(NO_MATCH);
  const owner = review.account.toLowerCase(), t = attempt.transaction;
  if (!ADDRESS.test(owner) || t.from.toLowerCase() !== owner || BigInt(t.chainId) !== BigInt(network.chainId)) return refuse(NO_MATCH);
  const fields = await evmFields(request, { ...t, chainId: network.chainId, nonce: attempt.nonce }, deps);
  if (!fields.ok) return refuse(fields.code);
  if (!await deps.managed('evm', owner)) return refuse(NO_MATCH);
  const expires = Date.parse(review.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return refuse('FLOFI_WALLET_REVIEW_EXPIRED');
  const token = review.asset;
  const summaryLines = lines(
    ['You send', token ? units(review.value, token.decimals, `(token ${short(token.token)})`) : units(review.value, 18, 'ETH')],
    ['Token contract', token?.token],
    ['Recipient', review.recipient],
    ['Max network cost', units(review.feeBudget, 18, 'ETH')],
    ['Nonce', BigInt(attempt.nonce).toString()]);
  if (!summaryLines) return refuse(NO_MATCH);
  return { ok: true, value: { attempt: `${flow}:${runId}:TRANSFER:${attempt.nonce}`, owner, expiresAtMs: expires, evm: { chainId: network.chainId, tx: fields.tx },
    summary: { flow: flow as SigningSummary['flow'], runId, network: network.network, chain: `eip155:${network.chainId}`, realFunds: true, action: 'Transfer', owner,
      lines: summaryLines, expiresAt: new Date(expires).toISOString() } } };
}
const DECIMALS: Readonly<Record<string, number>> = Object.freeze({ ETH: 18, WETH: 18, USDC: 6 });
const sideDecimals = (decimals: number | undefined, symbol: string) => Number.isInteger(decimals) ? decimals! : DECIMALS[symbol] ?? null;
async function evmSwap(flow: SigningFlow, runId: string, run: PublicRun, request: ManagedSigningRequest, deps: ManagedSigningDeps, now: number): Promise<ManagedSigningResult> {
  const network = evmNetworkOf(flow), q = run.quote, attempt: PublicAttempt | undefined = run.attempts?.at(-1);
  if (!network || q?.executionId !== runId || q.chainId !== network.chainId || q.environment !== 'MAINNET' || run.reviewedManifestHash !== q.manifestHash
    || run.divergence || run.outcome || !attempt || attempt.executionId !== runId || attempt.state !== 'PREPARED' || attempt.txHash
    || attempt.manifestHash !== q.manifestHash || attempt.environment !== 'MAINNET' || attempt.chainId !== network.chainId) return refuse(NO_MATCH);
  const owner = attempt.account.toLowerCase(), t = attempt.tx;
  if (!ADDRESS.test(owner) || t.from.toLowerCase() !== owner || (q.ownerReview && q.ownerReview.account.toLowerCase() !== owner)) return refuse(NO_MATCH);
  const fields = await evmFields(request, { ...t, chainId: network.chainId }, deps);
  if (!fields.ok) return refuse(fields.code);
  if (!await deps.managed('evm', owner)) return refuse(NO_MATCH);
  const expires = Date.parse(q.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return refuse('FLOFI_WALLET_REVIEW_EXPIRED');
  const inDecimals = sideDecimals(q.inputDecimals, q.inputSymbol), outDecimals = sideDecimals(q.outputDecimals, q.outputSymbol);
  if (inDecimals === null || outDecimals === null) return refuse('FLOFI_WALLET_FLOW_NOT_SUPPORTED');
  // On Base (OP Stack) the L1 data fee is charged on top of gas × maxFeePerGas: the line says so instead of calling it a maximum.
  const fee = units(fields.tx.gas * fields.tx.maxFeePerGas, 18, 'ETH'), l1 = network.chainId === 8453 ? ' before the L1 data fee' : '';
  let summaryLines: Line[] | null;
  if (attempt.step === 'approval') {
    // An exact ERC-20 approve(spender, amount) of the reviewed input token, as the swap service built it.
    const data = fields.tx.data;
    if (!/^0x095ea7b3[0-9a-f]{128}$/.test(data) || fields.tx.to !== q.inputToken.toLowerCase() || fields.tx.value !== 0n) return refuse(NO_MATCH);
    const spender = `0x${data.slice(34, 74)}`, amount = BigInt(`0x${data.slice(74)}`);
    if (!/^0x0{24}/.test(`0x${data.slice(10, 34)}`) || amount !== BigInt(q.amountIn)) return refuse(NO_MATCH);
    summaryLines = lines(['Approve', units(amount, inDecimals, q.inputSymbol)], ['Spender', spender], ['For', `Swap ${q.inputSymbol} → ${q.outputSymbol}`],
      [`Max network fee${l1}${fields.filled ? ' (set by FloFi Wallet)' : ''}`, fee]);
  } else summaryLines = lines(
    ['You pay', units(q.amountIn, inDecimals, q.inputSymbol)],
    ['Expected to receive', units(q.expectedOut, outDecimals, q.outputSymbol)],
    ['Minimum received', units(q.minimumOut, outDecimals, q.outputSymbol)],
    ['Max slippage', percent(q.slippageBps)],
    [`Max network fee${l1}${fields.filled ? ' (set by FloFi Wallet)' : ''}`, fee],
    ['Nonce', fields.tx.nonce.toString()]);
  if (!summaryLines) return refuse(NO_MATCH);
  return { ok: true, value: { attempt: `${flow}:${attempt.attemptId}`, owner, expiresAtMs: expires, evm: { chainId: network.chainId, tx: fields.tx },
    summary: { flow: flow as SigningSummary['flow'], runId, network: network.network, chain: `eip155:${network.chainId}`, realFunds: true,
      action: attempt.step === 'approval' ? 'Token approval' : 'Swap', owner, lines: summaryLines, expiresAt: new Date(expires).toISOString() } } };
}

/**
 * The reviewed attempt `request` may be signed for, or the refusal. Unsupported flows are refused by name; every mismatch, foreign owner,
 * stale or already-signed attempt is `FLOFI_WALLET_NO_MATCHING_REVIEW` (the caller learns nothing about other runs).
 */
export async function resolveManagedSigning(context: SigningContext, request: ManagedSigningRequest, deps: ManagedSigningDeps): Promise<ManagedSigningResult> {
  const { flow, runId } = context;
  if (!isSigningFlow(flow)) return refuse('FLOFI_WALLET_FLOW_NOT_SUPPORTED');
  if (!SIGNING_FLOWS[flow].run.test(runId) || SIGNING_FLOWS[flow].ecosystem !== request.ecosystem) return refuse(NO_MATCH);
  let loaded: unknown;
  try { loaded = await deps.load(flow, runId); } catch { return refuse('FLOFI_WALLET_REVIEW_UNAVAILABLE'); }
  const run = record(loaded), now = (deps.now ?? Date.now)();
  if (!run) return refuse(NO_MATCH);
  try {
    if (flow === 'jupiter-swap') return await solanaSwap(flow, runId, run as unknown as JupiterRecord, request, deps, now);
    if (flow === 'solana-transfer') return await solanaTransfer(flow, runId, run as unknown as SolanaTransferRecord, request, deps, now);
    if (flow.endsWith('-mainnet-transfer')) return await evmTransfer(flow, runId, run as unknown as TransferRecord, request, deps, now);
    return await evmSwap(flow, runId, run as unknown as PublicRun, request, deps, now);
  } catch {
    // A record of an unexpected shape never matches (fail closed); it is not a read failure.
    return refuse(NO_MATCH);
  }
}

/**
 * A sign-context request body from FloFi Wallet's page: `{flow, runId}` and the exact operation it was asked to sign
 * (`{op:'evm_sign_transaction', address, tx}` with every EIP-1559 field, or `{op:'solana_sign_transaction', address, chain, transaction}` with
 * the unsigned wire transaction in base64). The binding may also travel as the operation's own `signing: {flow, runId}` (protocol.ts).
 */
export function parseSigningRequest(value: unknown): { readonly context: SigningContext; readonly request: ManagedSigningRequest } | null {
  const body = record(value), nested = body && record(body.signing);
  // Either `{flow, runId, op, …}` or the operation exactly as FloFi Wallet received it, with its `signing` binding.
  const r = nested ? Object.fromEntries(Object.entries(body!).filter(([key]) => key !== 'signing').concat(Object.entries(nested))) : body;
  if (!r || nested && (Object.keys(nested).length !== 2 || 'flow' in body! || 'runId' in body!)) return null;
  const flow = r.flow, runId = r.runId;
  if (typeof flow !== 'string' || typeof runId !== 'string') return null;
  const context = { flow, runId };
  if (r.op === 'evm_sign_transaction' && Object.keys(r).length === 5) {
    const tx = record(r.tx);
    const keys = ['from', 'to', 'value', 'data', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'];
    if (!tx || Object.keys(tx).length !== keys.length || !keys.every(key => typeof tx[key] === 'string')) return null;
    const lower = Object.fromEntries(keys.map(key => [key, (tx[key] as string).toLowerCase()])) as Record<string, string>;
    if (!ADDRESS.test(lower.from!) || !ADDRESS.test(lower.to!) || !HEX.test(lower.data!) || lower.data!.length > 262_146) return null;
    if (typeof r.address !== 'string' || r.address.toLowerCase() !== lower.from) return null;
    const quantity = (key: string) => /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(lower[key]!) ? BigInt(lower[key]!) : null;
    const fields = { value: quantity('value'), chainId: quantity('chainId'), nonce: quantity('nonce'), gas: quantity('gas'), maxFeePerGas: quantity('maxFeePerGas'),
      maxPriorityFeePerGas: quantity('maxPriorityFeePerGas') };
    if (Object.values(fields).some(field => field === null)) return null;
    return { context, request: { ecosystem: 'evm', tx: { from: lower.from!, to: lower.to!, data: lower.data!, ...fields as { [K in keyof typeof fields]: bigint } } } };
  }
  if (r.op === 'solana_sign_transaction' && Object.keys(r).length === 6 && r.chain === 'solana:mainnet'
    && typeof r.address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.address)) {
    const wire = fromBase64(r.transaction), message = wire && unsignedSolanaMessage(wire);
    return message ? { context, request: { ecosystem: 'solana', chain: r.chain, address: r.address, message } } : null;
  }
  return null;
}
