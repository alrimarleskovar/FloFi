// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's own reading of an EVM transaction request (wallet origin only).
 *
 * The wallet page shows the person what the bytes do before Sign, from the bytes themselves, and builds the exact unsigned EIP-1559
 * envelope it asks the provider to sign. It never imports the workflow engine (its codec lives behind a barrel that pulls Ajv, which
 * needs `'unsafe-eval'`), so the RLP here is a small strict local copy; its unit test cross-checks it byte for byte against the engine's
 * `unsignedEip1559`. After signing, the provider's answer must be the same nine fields plus a well-formed signature, or it is discarded.
 *
 * Only the four catalog mainnets are signable here. Calldata is decoded only for ERC-20 `transfer`/`approve`/`transferFrom`/
 * `increaseAllowance`/`permit` and ERC-721/1155 `setApprovalForAll`, with exact ABI lengths; anything else is shown raw as undecoded.
 */
import type { EvmTransaction } from './protocol';

export type RlpItem = Uint8Array | readonly RlpItem[];
const fail = (code: string): never => { throw new Error(code); };
const INVALID = 'FLOFI_WALLET_TRANSACTION_INVALID';

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) fail(INVALID);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const concat = (...parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);
/** A non-negative integer as minimal big-endian bytes (zero is empty), the RLP form of a quantity. */
export function quantityBytes(value: bigint): Uint8Array {
  if (value < 0n) fail(INVALID);
  let hex = value.toString(16);
  if (value === 0n) return new Uint8Array(0);
  if (hex.length % 2) hex = `0${hex}`;
  return hexToBytes(hex);
}
const lengthPrefix = (length: number, short: number) => {
  if (length <= 55) return Uint8Array.of(short + length);
  const size = quantityBytes(BigInt(length));
  return concat(Uint8Array.of(short + 55 + size.length), size);
};
export function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) return item.length === 1 && item[0]! < 0x80 ? item : concat(lengthPrefix(item.length, 0x80), item);
  const body = concat(...item.map(rlpEncode));
  return concat(lengthPrefix(body.length, 0xc0), body);
}
/** Strict, canonical RLP: minimal lengths, single bytes below 0x80 never wrapped, nothing after the item. */
export function rlpDecode(bytes: Uint8Array): RlpItem {
  const read = (at: number): [RlpItem, number] => {
    const first = bytes[at];
    if (first === undefined) return fail(INVALID);
    if (first < 0x80) return [bytes.subarray(at, at + 1), at + 1];
    const list = first >= 0xc0, base = list ? 0xc0 : 0x80;
    let length: number, start: number;
    if (first - base <= 55) { length = first - base; start = at + 1; }
    else {
      const size = first - base - 55;
      if (bytes[at + 1] === 0 || at + 1 + size > bytes.length) fail(INVALID);
      length = Number(BigInt(`0x${bytesToHex(bytes.subarray(at + 1, at + 1 + size))}`));
      if (length <= 55 || !Number.isSafeInteger(length)) fail(INVALID);
      start = at + 1 + size;
    }
    const end = start + length;
    if (end > bytes.length) fail(INVALID);
    if (!list) {
      if (length === 1 && bytes[start]! < 0x80) fail(INVALID);
      return [bytes.subarray(start, end), end];
    }
    const items: RlpItem[] = [];
    for (let cursor = start; cursor < end;) { const [item, next] = read(cursor); items.push(item); cursor = next; }
    return [items, end];
  };
  const [item, end] = read(0);
  if (end !== bytes.length) fail(INVALID);
  return item;
}

/** The nine fields of a type-2 transaction, in signing order. */
function fields(tx: EvmTransaction): RlpItem[] {
  return [quantityBytes(BigInt(tx.chainId)), quantityBytes(BigInt(tx.nonce)), quantityBytes(BigInt(tx.maxPriorityFeePerGas)), quantityBytes(BigInt(tx.maxFeePerGas)),
    quantityBytes(BigInt(tx.gas)), hexToBytes(tx.to), quantityBytes(BigInt(tx.value)), hexToBytes(tx.data), []];
}
/** `0x02 ‖ rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, []])`: exactly what the person approves. */
export const unsignedEip1559 = (tx: EvmTransaction): Uint8Array => concat(Uint8Array.of(2), rlpEncode(fields(tx)));

/**
 * The provider's signed transaction, accepted only if it is canonical type-2 RLP whose first nine fields are byte-identical to what the
 * person approved and whose signature fields are well formed (yParity 0/1, r and s non-zero, ≤ 32 bytes). Returns `0x…`.
 */
export function verifySignedEip1559(tx: EvmTransaction, signedHex: string): string {
  const signed = hexToBytes(signedHex.toLowerCase());
  if (signed[0] !== 2) fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  let decoded: RlpItem;
  try { decoded = rlpDecode(signed.subarray(1)); } catch { return fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH'); }
  const expected = fields(tx);
  if (decoded instanceof Uint8Array || decoded.length !== 12) fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  const items = decoded as readonly RlpItem[];
  for (let i = 0; i < 9; i++) if (!equal(rlpEncode(items[i]!), rlpEncode(expected[i]!))) fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  const [yParity, r, s] = [items[9], items[10], items[11]];
  const scalar = (value: RlpItem | undefined) => value instanceof Uint8Array && value.length >= 1 && value.length <= 32 && value[0] !== 0;
  if (!(yParity instanceof Uint8Array) || !(yParity.length === 0 || (yParity.length === 1 && yParity[0] === 1)) || !scalar(r) || !scalar(s))
    fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  return `0x${bytesToHex(signed)}`;
}

// ── What the person sees ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `separateL1Fee`: an OP Stack chain (Base) also charges an L1 data fee that gas × maxFeePerGas does not bound. */
export type EvmChain = { readonly chainId: number; readonly name: string; readonly symbol: 'ETH'; readonly separateL1Fee?: true };
/** The catalog mainnets FloFi Wallet signs for (spec decision 6). Every other chain is refused before anything is shown as signable. */
export const FLOFI_WALLET_EVM_CHAINS: Readonly<Record<number, EvmChain>> = Object.freeze({
  1: { chainId: 1, name: 'Ethereum', symbol: 'ETH' }, 8453: { chainId: 8453, name: 'Base', symbol: 'ETH', separateL1Fee: true },
  42161: { chainId: 42161, name: 'Arbitrum One', symbol: 'ETH' }, 4663: { chainId: 4663, name: 'Robinhood Chain', symbol: 'ETH' },
});
export const evmChain = (chainIdHex: string): EvmChain | null => {
  const id = Number(BigInt(chainIdHex));
  return Object.hasOwn(FLOFI_WALLET_EVM_CHAINS, id) ? FLOFI_WALLET_EVM_CHAINS[id]! : null;
};

/** `value / 10^decimals` as a plain decimal string, trailing zeros removed, never rounded. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n, digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals), fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

const MAX_UINT256 = (1n << 256n) - 1n;
export type EvmCall =
  | { readonly kind: 'none' }
  | { readonly kind: 'erc20-transfer'; readonly to: string; readonly amount: bigint }
  | { readonly kind: 'erc20-transfer-from'; readonly from: string; readonly to: string; readonly amount: bigint }
  | { readonly kind: 'erc20-approve'; readonly spender: string; readonly amount: bigint; readonly unlimited: boolean }
  | { readonly kind: 'erc20-increase-allowance'; readonly spender: string; readonly amount: bigint; readonly unlimited: boolean }
  | { readonly kind: 'erc20-permit'; readonly owner: string; readonly spender: string; readonly amount: bigint; readonly deadline: bigint; readonly unlimited: boolean }
  | { readonly kind: 'set-approval-for-all'; readonly operator: string; readonly approved: boolean }
  | { readonly kind: 'unknown'; readonly selector: string; readonly bytes: number };
const SELECTORS = { transfer: 'a9059cbb', transferFrom: '23b872dd', approve: '095ea7b3', increaseAllowance: '39509351', permit: 'd505accf',
  setApprovalForAll: 'a22cb465' } as const;
/** An approval this large is unlimited in practice: the spender can take every token of this kind now and later. */
const unlimited = (amount: bigint) => amount >= MAX_UINT256 >> 1n;

/** Decodes the calldata of the known token calls, requiring the exact static ABI length; anything else is `unknown` (shown raw). */
export function decodeEvmCall(data: string): EvmCall {
  const body = data.toLowerCase().replace(/^0x/, '');
  if (body.length === 0) return { kind: 'none' };
  const selector = body.slice(0, 8), unknown: EvmCall = { kind: 'unknown', selector: `0x${selector.padEnd(8, '0')}`, bytes: body.length / 2 };
  const words = (count: number) => body.length === 8 + 64 * count ? Array.from({ length: count }, (_, i) => body.slice(8 + i * 64, 8 + (i + 1) * 64)) : null;
  const address = (word: string) => /^0{24}[0-9a-f]{40}$/.test(word) ? `0x${word.slice(24)}` : null;
  const uint = (word: string) => BigInt(`0x${word}`);
  const bool = (word: string) => /^0{63}[01]$/.test(word) ? word.endsWith('1') : null;
  switch (selector) {
    case SELECTORS.transfer: case SELECTORS.approve: case SELECTORS.increaseAllowance: {
      const w = words(2), target = w && address(w[0]!);
      if (!w || !target) return unknown;
      const amount = uint(w[1]!);
      if (selector === SELECTORS.transfer) return { kind: 'erc20-transfer', to: target, amount };
      return { kind: selector === SELECTORS.approve ? 'erc20-approve' : 'erc20-increase-allowance', spender: target, amount, unlimited: unlimited(amount) };
    }
    case SELECTORS.transferFrom: {
      const w = words(3), from = w && address(w[0]!), to = w && address(w[1]!);
      return w && from && to ? { kind: 'erc20-transfer-from', from, to, amount: uint(w[2]!) } : unknown;
    }
    case SELECTORS.permit: {
      const w = words(7), owner = w && address(w[0]!), spender = w && address(w[1]!);
      if (!w || !owner || !spender) return unknown;
      const amount = uint(w[2]!);
      return { kind: 'erc20-permit', owner, spender, amount, deadline: uint(w[3]!), unlimited: unlimited(amount) };
    }
    case SELECTORS.setApprovalForAll: {
      const w = words(2), operator = w && address(w[0]!), approved = w ? bool(w[1]!) : null;
      return w && operator && approved !== null ? { kind: 'set-approval-for-all', operator, approved } : unknown;
    }
    default: return unknown;
  }
}

export type EvmReview = { readonly chain: EvmChain; readonly from: string; readonly to: string; readonly value: bigint; readonly nonce: bigint;
  readonly gas: bigint; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint;
  /** value + gas × maxFeePerGas: the most this transaction can take from the sender in the native coin, except on a chain with
   * `separateL1Fee` (Base), where the L1 data fee comes on top and the figure is shown as such. */
  readonly maxTotalCost: bigint; readonly call: EvmCall; readonly data: string };
/** Everything the person needs to judge the transaction, or null when the chain is not one FloFi Wallet signs on. */
export function reviewEvmTransaction(tx: EvmTransaction): EvmReview | null {
  const chain = evmChain(tx.chainId);
  if (!chain) return null;
  const value = BigInt(tx.value), gas = BigInt(tx.gas), maxFeePerGas = BigInt(tx.maxFeePerGas);
  return { chain, from: tx.from, to: tx.to, value, nonce: BigInt(tx.nonce), gas, maxFeePerGas, maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    maxTotalCost: value + gas * maxFeePerGas, call: decodeEvmCall(tx.data), data: tx.data };
}
