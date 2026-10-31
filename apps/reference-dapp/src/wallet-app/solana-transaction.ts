// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's own reading of a Solana transaction request (wallet origin only).
 *
 * FloFi's servers build every Solana transaction as one v0 message behind zeroed signature slots. FloFi Wallet parses those bytes itself
 * (strict compact-u16 lengths, v0 only, nothing left over), requires the managed wallet to be the fee payer and every slot to be empty,
 * and shows the fee payer, the programs, the System and SPL Token transfers, approvals, authority changes and account closures it can
 * decode, a durable-nonce warning and the message's SHA-256. It signs the exact message bytes (a raw payload: the provider cannot
 * re-encode them), writes the 64-byte signature into the fee payer's slot and checks the result still carries the same message.
 * Accounts that come from address lookup tables cannot be resolved without a network read and are shown as such, never guessed.
 */

const fail = (code: string): never => { throw new Error(code); };
const INVALID = 'FLOFI_WALLET_REQUEST_INVALID';
export const SOLANA_PACKET_LIMIT = 1_232;

// ── Encodings ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i]! << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const byte of bytes) { if (byte !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}
export function base58Decode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    let carry = ALPHABET.indexOf(character);
    if (carry < 0) fail(INVALID);
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i]! * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const character of text) { if (character !== '1') break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}
/** Strict standard base64 (padding required), at most `limit` decoded bytes. */
export function base64ToBytes(text: string, limit = SOLANA_PACKET_LIMIT): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) || text.length > Math.ceil(limit / 3) * 4) fail(INVALID);
  let binary: string;
  try { binary = atob(text); } catch { return fail(INVALID); }
  if (binary.length > limit) fail(INVALID);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export const bytesToBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  byte(): number { const value = this.bytes[this.offset]; if (value === undefined) return fail(INVALID); this.offset++; return value; }
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) fail(INVALID);
    const out = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return out;
  }
  /** Solana's shortvec: 1–3 bytes, little-endian 7-bit groups, minimal, at most 0xffff. */
  compact(): number {
    let value = 0;
    for (let shift = 0; shift <= 14; shift += 7) {
      const byte = this.byte();
      value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) {
        if (shift > 0 && byte === 0) fail(INVALID);
        if (value > 0xffff) fail(INVALID);
        return value;
      }
    }
    return fail(INVALID);
  }
}

// ── Wire format ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type SolanaWire = { readonly signatures: readonly Uint8Array[]; readonly messageOffset: number; readonly message: Uint8Array };
export type SolanaMessage = { readonly header: readonly [number, number, number]; readonly staticKeys: readonly string[]; readonly blockhash: string;
  readonly instructions: readonly { readonly programIdIndex: number; readonly accounts: readonly number[]; readonly data: Uint8Array }[];
  readonly lookups: readonly { readonly table: string; readonly writable: readonly number[]; readonly readonly: readonly number[] }[] };

export function parseWireTransaction(bytes: Uint8Array): SolanaWire {
  if (bytes.length > SOLANA_PACKET_LIMIT) fail(INVALID);
  const r = new Reader(bytes), count = r.compact();
  if (count < 1 || count > 16) fail(INVALID);
  const signatures = Array.from({ length: count }, () => r.take(64));
  if (r.offset >= bytes.length) fail(INVALID);
  return { signatures, messageOffset: r.offset, message: bytes.subarray(r.offset) };
}
/** A version-0 message only (FloFi builds no legacy messages), fully consumed, with a coherent header and in-range indices. */
export function parseMessageV0(bytes: Uint8Array): SolanaMessage {
  const r = new Reader(bytes);
  if (r.byte() !== 0x80) fail(INVALID);
  const header: [number, number, number] = [r.byte(), r.byte(), r.byte()];
  const staticKeys = Array.from({ length: r.compact() }, () => base58Encode(r.take(32)));
  const blockhash = base58Encode(r.take(32));
  const instructions = Array.from({ length: r.compact() }, () => ({ programIdIndex: r.byte(), accounts: [...r.take(r.compact())], data: r.take(r.compact()) }));
  const lookups = Array.from({ length: r.compact() }, () => ({ table: base58Encode(r.take(32)), writable: [...r.take(r.compact())], readonly: [...r.take(r.compact())] }));
  if (r.offset !== bytes.length || header[0] < 1 || header[0] > staticKeys.length || header[1] >= header[0] || header[2] > staticKeys.length - header[0]) fail(INVALID);
  const total = staticKeys.length + lookups.reduce((sum, lookup) => sum + lookup.writable.length + lookup.readonly.length, 0);
  if (total > 256 || new Set(staticKeys).size !== staticKeys.length) fail(INVALID);
  for (const ix of instructions) {
    // A program is always a static key (lookup-table entries cannot be invoked), and it is never the fee payer.
    if (ix.programIdIndex === 0 || ix.programIdIndex >= staticKeys.length || ix.accounts.some(index => index >= total)) fail(INVALID);
  }
  return { header, staticKeys, blockhash, instructions, lookups };
}

export type ParsedSolanaTransaction = { readonly wire: SolanaWire; readonly message: SolanaMessage; readonly feePayer: string };
/**
 * The transaction FloFi Wallet may sign for `signer`: unsigned (every slot zero), one slot per required signature, a v0 message, and
 * `signer` as fee payer (slot 0). Anything else is refused before it is shown as signable.
 */
export function parseUnsignedTransaction(base64: string, signer: string): ParsedSolanaTransaction {
  const wire = parseWireTransaction(base64ToBytes(base64)), message = parseMessageV0(wire.message);
  if (wire.signatures.length !== message.header[0] || wire.signatures.some(signature => signature.some(byte => byte !== 0))) fail(INVALID);
  if (message.staticKeys[0] !== signer) fail(INVALID);
  return { wire, message, feePayer: signer };
}
/** The wire transaction with `signature` in slot 0, re-parsed: it must still carry exactly the same message, and nothing else changed. */
export function withFeePayerSignature(base64: string, signature: Uint8Array): string {
  const original = base64ToBytes(base64), wire = parseWireTransaction(original);
  if (signature.length !== 64 || signature.every(byte => byte === 0)) fail('MANAGED_RESPONSE_INVALID');
  const signed = original.slice();
  signed.set(signature, wire.messageOffset - 64 * wire.signatures.length);
  const check = parseWireTransaction(signed);
  if (toHex(check.message) !== toHex(wire.message) || toHex(check.signatures[0]!) !== toHex(signature)
    || check.signatures.slice(1).some((slot, i) => toHex(slot) !== toHex(wire.signatures[i + 1]!))) fail('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  return bytesToBase64(signed);
}
export const messageHex = (parsed: ParsedSolanaTransaction): string => toHex(parsed.wire.message);
/** `0x`-prefixed SHA-256 of the message: the same identity FloFi's Review records (`messageHash`). */
export async function messageSha256(message: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', message.slice().buffer);
  return `0x${toHex(new Uint8Array(digest))}`;
}

// ── What the person sees ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const PROGRAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [SYSTEM_PROGRAM]: 'System Program', [TOKEN_PROGRAM]: 'SPL Token', [TOKEN_2022_PROGRAM]: 'SPL Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Account', [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo', Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: 'Memo (v1)',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter Aggregator v6', whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpools',
  L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: 'Lighthouse',
});
export const programName = (program: string): string | null => Object.hasOwn(PROGRAM_NAMES, program) ? PROGRAM_NAMES[program]! : null;

/** An account of an instruction: a static key, or an entry of a lookup table that only the network can resolve. */
export type SolanaAccountRef = { readonly address: string } | { readonly lookup: string; readonly index: number };
export type DecodedInstruction =
  | { readonly kind: 'sol-transfer'; readonly from: SolanaAccountRef; readonly to: SolanaAccountRef; readonly lamports: bigint }
  | { readonly kind: 'create-account'; readonly from: SolanaAccountRef; readonly account: SolanaAccountRef; readonly lamports: bigint; readonly owner: string }
  | { readonly kind: 'advance-nonce'; readonly nonceAccount: SolanaAccountRef }
  | { readonly kind: 'token-transfer'; readonly program: string; readonly source: SolanaAccountRef; readonly destination: SolanaAccountRef;
    readonly authority: SolanaAccountRef; readonly amount: bigint; readonly decimals: number | null; readonly mint: SolanaAccountRef | null }
  | { readonly kind: 'token-approve'; readonly program: string; readonly source: SolanaAccountRef; readonly delegate: SolanaAccountRef;
    readonly authority: SolanaAccountRef; readonly amount: bigint; readonly decimals: number | null; readonly unlimited: boolean }
  | { readonly kind: 'token-revoke'; readonly program: string; readonly source: SolanaAccountRef }
  | { readonly kind: 'token-set-authority'; readonly program: string; readonly account: SolanaAccountRef; readonly newAuthority: string | null }
  | { readonly kind: 'token-close-account'; readonly program: string; readonly account: SolanaAccountRef; readonly destination: SolanaAccountRef }
  | { readonly kind: 'compute-unit-limit'; readonly units: number }
  | { readonly kind: 'compute-unit-price'; readonly microLamports: bigint }
  | { readonly kind: 'other'; readonly program: string; readonly accounts: number; readonly dataBytes: number };

/** The most compute units a transaction can be charged for (larger limits are clamped by the runtime). */
export const MAX_COMPUTE_UNITS = 1_400_000;
/** Little-endian unsigned 32-bit (`| ` alone would turn values of 2^31 and more negative). */
const u32 = (data: Uint8Array, at: number) => ((data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16)) >>> 0) + data[at + 3]! * 0x1000000;
const u64 = (data: Uint8Array, at: number) => { let value = 0n; for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(data[at + i]!); return value; };
const U64_MAX = (1n << 64n) - 1n;

/** Decodes the instructions FloFi Wallet understands exactly (exact data lengths); every other instruction is `other`, by program. */
export function decodeInstructions(message: SolanaMessage): DecodedInstruction[] {
  const tables = message.lookups.flatMap(lookup => lookup.writable.map(index => ({ lookup: lookup.table, index })))
    .concat(message.lookups.flatMap(lookup => lookup.readonly.map(index => ({ lookup: lookup.table, index }))));
  const ref = (index: number): SolanaAccountRef => index < message.staticKeys.length ? { address: message.staticKeys[index]! } : tables[index - message.staticKeys.length]!;
  return message.instructions.map(ix => {
    const program = message.staticKeys[ix.programIdIndex]!, data = ix.data, a = ix.accounts.map(ref);
    const other: DecodedInstruction = { kind: 'other', program, accounts: ix.accounts.length, dataBytes: data.length };
    if (program === SYSTEM_PROGRAM && data.length >= 4) {
      const tag = u32(data, 0);
      if (tag === 2 && data.length === 12 && a.length >= 2) return { kind: 'sol-transfer', from: a[0]!, to: a[1]!, lamports: u64(data, 4) };
      if (tag === 0 && data.length === 52 && a.length >= 2) return { kind: 'create-account', from: a[0]!, account: a[1]!, lamports: u64(data, 4), owner: base58Encode(data.subarray(20, 52)) };
      if (tag === 4 && data.length === 4 && a.length >= 3) return { kind: 'advance-nonce', nonceAccount: a[0]! };
      return other;
    }
    if ((program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) && data.length >= 1) {
      const tag = data[0];
      if (tag === 3 && data.length === 9 && a.length >= 3) return { kind: 'token-transfer', program, source: a[0]!, destination: a[1]!, authority: a[2]!, amount: u64(data, 1), decimals: null, mint: null };
      if (tag === 12 && data.length === 10 && a.length >= 4)
        return { kind: 'token-transfer', program, source: a[0]!, mint: a[1]!, destination: a[2]!, authority: a[3]!, amount: u64(data, 1), decimals: data[9]! };
      if (tag === 4 && data.length === 9 && a.length >= 3) {
        const amount = u64(data, 1);
        return { kind: 'token-approve', program, source: a[0]!, delegate: a[1]!, authority: a[2]!, amount, decimals: null, unlimited: amount === U64_MAX };
      }
      if (tag === 13 && data.length === 10 && a.length >= 4) {
        const amount = u64(data, 1);
        return { kind: 'token-approve', program, source: a[0]!, delegate: a[2]!, authority: a[3]!, amount, decimals: data[9]!, unlimited: amount === U64_MAX };
      }
      if (tag === 5 && data.length === 1 && a.length >= 2) return { kind: 'token-revoke', program, source: a[0]! };
      if (tag === 6 && a.length >= 2 && ((data.length === 3 && data[2] === 0) || (data.length === 35 && data[2] === 1)))
        return { kind: 'token-set-authority', program, account: a[0]!, newAuthority: data[2] === 1 ? base58Encode(data.subarray(3, 35)) : null };
      if (tag === 9 && data.length === 1 && a.length >= 3) return { kind: 'token-close-account', program, account: a[0]!, destination: a[1]! };
      return other;
    }
    if (program === COMPUTE_BUDGET_PROGRAM) {
      if (data[0] === 2 && data.length === 5) return { kind: 'compute-unit-limit', units: u32(data, 1) };
      if (data[0] === 3 && data.length === 9) return { kind: 'compute-unit-price', microLamports: u64(data, 1) };
    }
    return other;
  });
}

export type SolanaReview = { readonly feePayer: string; readonly signatures: number; readonly programs: readonly { readonly address: string; readonly name: string | null }[];
  readonly instructions: readonly DecodedInstruction[]; readonly durableNonce: boolean; readonly lookupTables: number;
  /** The most the network can charge in fees: 5,000 lamports per signature plus the priority fee, when both compute-budget values are set. */
  readonly maxFeeLamports: bigint | null };
export function reviewSolanaTransaction(parsed: ParsedSolanaTransaction): SolanaReview {
  const instructions = decodeInstructions(parsed.message), programs: string[] = [];
  for (const ix of parsed.message.instructions) { const program = parsed.message.staticKeys[ix.programIdIndex]!; if (!programs.includes(program)) programs.push(program); }
  const limit = instructions.find(ix => ix.kind === 'compute-unit-limit'), price = instructions.find(ix => ix.kind === 'compute-unit-price');
  const base = 5_000n * BigInt(parsed.wire.signatures.length);
  // The runtime clamps a larger limit to 1,400,000 compute units and charges the priority fee on the clamped value.
  const priority = limit?.kind === 'compute-unit-limit' && price?.kind === 'compute-unit-price'
    ? (BigInt(Math.min(limit.units, MAX_COMPUTE_UNITS)) * price.microLamports + 999_999n) / 1_000_000n : null;
  return { feePayer: parsed.feePayer, signatures: parsed.wire.signatures.length, programs: programs.map(address => ({ address, name: programName(address) })), instructions,
    // A durable nonce makes the transaction valid until the nonce advances, not for about a minute like a blockhash.
    durableNonce: instructions[0]?.kind === 'advance-nonce', lookupTables: parsed.message.lookups.length,
    maxFeeLamports: priority === null && price ? null : base + (priority ?? 0n) };
}
