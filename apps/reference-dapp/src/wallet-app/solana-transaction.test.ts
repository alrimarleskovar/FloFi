// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet parses v0 transactions exactly as the engine builds them, refuses anything it may not sign,
// decodes only what it can prove, and signs by writing the fee payer's slot without touching the message.
import { describe, expect, it } from 'vitest';
import { base58Decode as engineDecode, base58Encode as engineEncode, compileMessageV0, parseMessageV0 as engineParse, serializeMessageV0,
  serializeSignedTransaction, serializeTransaction, type SolanaInstruction } from '@defi-workflow-engine/reference-compiler';
import { base58Decode, base58Encode, base64ToBytes, bytesToBase64, COMPUTE_BUDGET_PROGRAM, messageHex, messageSha256, parseMessageV0,
  parseUnsignedTransaction, parseWireTransaction, reviewSolanaTransaction, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, withFeePayerSignature } from './solana-transaction';

const key = (n: number) => engineEncode(new Uint8Array(32).fill(n));
const OWNER = key(7), OTHER = key(8), MINT = key(9), DESTINATION = key(10), DELEGATE = key(11), BLOCKHASH = key(12), TABLE = key(13), FAR = key(14);
const le = (value: bigint, bytes: number) => Array.from({ length: bytes }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));
const meta = (pubkey: string, isSigner = false, isWritable = true) => ({ pubkey, isSigner, isWritable });
const transfer: SolanaInstruction = { programId: SYSTEM_PROGRAM, accounts: [meta(OWNER, true), meta(OTHER)], data: Uint8Array.from([2, 0, 0, 0, ...le(1_500_000_000n, 8)]) };
const checked: SolanaInstruction = { programId: TOKEN_PROGRAM, accounts: [meta(OTHER), meta(MINT, false, false), meta(DESTINATION), meta(OWNER, true, false)],
  data: Uint8Array.from([12, ...le(2_500_000n, 8), 6]) };
const approve: SolanaInstruction = { programId: TOKEN_2022_PROGRAM, accounts: [meta(OTHER), meta(DELEGATE, false, false), meta(OWNER, true, false)],
  data: Uint8Array.from([4, ...le((1n << 64n) - 1n, 8)]) };
const limit: SolanaInstruction = { programId: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Uint8Array.from([2, ...le(200_000n, 4)]) };
const price: SolanaInstruction = { programId: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Uint8Array.from([3, ...le(1_000_000n, 8)]) };
const message = (instructions: SolanaInstruction[], tables: Record<string, string[]> = {}) => serializeMessageV0(compileMessageV0(OWNER, instructions, BLOCKHASH, tables));
const unsigned = (bytes: Uint8Array) => bytesToBase64(serializeTransaction(null, bytes));

describe('encodings', () => {
  it('base58 and base64 match the engine and refuse malformed input', () => {
    for (const bytes of [new Uint8Array(32), new Uint8Array(32).fill(255), Uint8Array.from([0, 0, 1, 2, 3]), Uint8Array.from({ length: 64 }, (_, i) => i * 3)]) {
      expect(base58Encode(bytes)).toBe(engineEncode(bytes));
      expect([...base58Decode(engineEncode(bytes))]).toEqual([...bytes]);
    }
    expect(engineDecode(OWNER)).toEqual(base58Decode(OWNER));
    expect(() => base58Decode('0OIl')).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect([...base64ToBytes(bytesToBase64(Uint8Array.from([1, 2, 3, 250])))]).toEqual([1, 2, 3, 250]);
    for (const bad of ['AQ', 'AQ=', 'A===', '****']) expect(() => base64ToBytes(bad)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => base64ToBytes(bytesToBase64(new Uint8Array(1_233)))).toThrow('FLOFI_WALLET_REQUEST_INVALID');
  });
});

describe('v0 message parsing', () => {
  it('reads exactly what the engine compiled, lookup tables included', () => {
    const bytes = message([limit, price, transfer, checked], { [TABLE]: [FAR, DESTINATION] });
    const ours = parseMessageV0(bytes), theirs = engineParse(bytes);
    expect({ ...ours, instructions: ours.instructions.map(ix => ({ ...ix, data: [...ix.data] })) })
      .toEqual({ ...theirs, instructions: theirs.instructions.map(ix => ({ ...ix, data: [...ix.data] })) });
    expect(ours.lookups).toEqual([{ table: TABLE, writable: [1], readonly: [] }]);
  });
  it('refuses legacy messages, trailing bytes, non-minimal lengths, bad headers and out-of-range indices', () => {
    const bytes = message([transfer]);
    expect(() => parseMessageV0(bytes.subarray(1))).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => parseMessageV0(Uint8Array.from([...bytes, 0]))).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    const header = bytes.slice(); header[1] = 0; expect(() => parseMessageV0(header)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    const shortvec = Uint8Array.from([...bytes.subarray(0, 4), 0x83, 0x00, ...bytes.subarray(5)]);
    expect(() => parseMessageV0(shortvec)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    const parsed = engineParse(bytes);
    const program = serializeMessageV0({ ...parsed, instructions: [{ ...parsed.instructions[0]!, programIdIndex: 0 }] });
    expect(() => parseMessageV0(program)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    const account = serializeMessageV0({ ...parsed, instructions: [{ ...parsed.instructions[0]!, accounts: [0, 9] }] });
    expect(() => parseMessageV0(account)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
  });
});

describe('what FloFi Wallet may sign', () => {
  it('accepts an unsigned transaction whose fee payer is the managed wallet', () => {
    const bytes = message([transfer]), parsed = parseUnsignedTransaction(unsigned(bytes), OWNER);
    expect(parsed.feePayer).toBe(OWNER);
    expect(messageHex(parsed)).toBe(Buffer.from(bytes).toString('hex'));
  });
  it('refuses another fee payer, a filled slot, a slot count that differs from the header, and oversized packets', () => {
    const bytes = message([transfer]);
    expect(() => parseUnsignedTransaction(unsigned(bytes), OTHER)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => parseUnsignedTransaction(bytesToBase64(serializeTransaction(new Uint8Array(64).fill(1), bytes)), OWNER)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => parseUnsignedTransaction(bytesToBase64(serializeSignedTransaction([null, null], bytes)), OWNER)).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => parseWireTransaction(new Uint8Array(1_300))).toThrow('FLOFI_WALLET_REQUEST_INVALID');
    expect(() => parseWireTransaction(Uint8Array.from([0]))).toThrow('FLOFI_WALLET_REQUEST_INVALID');
  });
  it('writes the signature into slot 0 only and keeps the message byte for byte', () => {
    const second: SolanaInstruction = { ...transfer, accounts: [meta(OWNER, true), meta(DELEGATE, true)] };
    const bytes = message([second]), base64 = bytesToBase64(serializeSignedTransaction([null, null], bytes));
    const parsed = parseUnsignedTransaction(base64, OWNER);
    expect(parsed.wire.signatures).toHaveLength(2);
    const signature = Uint8Array.from({ length: 64 }, (_, i) => i + 1), signed = base64ToBytes(withFeePayerSignature(base64, signature));
    expect([...signed]).toEqual([...serializeSignedTransaction([signature, null], bytes)]);
    expect(() => withFeePayerSignature(base64, new Uint8Array(64))).toThrow('MANAGED_RESPONSE_INVALID');
    expect(() => withFeePayerSignature(base64, new Uint8Array(63).fill(1))).toThrow('MANAGED_RESPONSE_INVALID');
  });
  it('hashes the message like FloFi’s Review (0x-prefixed SHA-256)', async () => {
    const bytes = message([transfer]);
    expect(await messageSha256(bytes)).toBe('0x' + (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('what the person sees', () => {
  it('decodes SOL and token transfers, unlimited approvals and the priority fee', () => {
    const review = reviewSolanaTransaction(parseUnsignedTransaction(unsigned(message([limit, price, transfer, checked, approve])), OWNER));
    expect(review.programs.map(program => program.name)).toEqual(['Compute Budget', 'System Program', 'SPL Token', 'SPL Token-2022']);
    expect(review.instructions).toEqual([
      { kind: 'compute-unit-limit', units: 200_000 }, { kind: 'compute-unit-price', microLamports: 1_000_000n },
      { kind: 'sol-transfer', from: { address: OWNER }, to: { address: OTHER }, lamports: 1_500_000_000n },
      { kind: 'token-transfer', program: TOKEN_PROGRAM, source: { address: OTHER }, mint: { address: MINT }, destination: { address: DESTINATION },
        authority: { address: OWNER }, amount: 2_500_000n, decimals: 6 },
      { kind: 'token-approve', program: TOKEN_2022_PROGRAM, source: { address: OTHER }, delegate: { address: DELEGATE }, authority: { address: OWNER },
        amount: (1n << 64n) - 1n, decimals: null, unlimited: true },
    ]);
    expect(review.maxFeeLamports).toBe(5_000n + 200_000n);
    expect(review.durableNonce).toBe(false);
  });
  it('reads compute limits of 2^31 and more as unsigned, and bounds the fee with the runtime’s 1.4M clamp', () => {
    const huge: SolanaInstruction = { ...limit, data: Uint8Array.from([2, ...le(0xffff_ffffn, 4)]) };
    const review = reviewSolanaTransaction(parseUnsignedTransaction(unsigned(message([huge, price, transfer])), OWNER));
    expect(review.instructions[0]).toEqual({ kind: 'compute-unit-limit', units: 0xffff_ffff });
    expect(review.maxFeeLamports).toBe(5_000n + 1_400_000n);
  });
  it('flags a durable nonce, names lookup-table accounts honestly and leaves unknown programs undecoded', () => {
    const nonce: SolanaInstruction = { programId: SYSTEM_PROGRAM, accounts: [meta(OTHER), meta(key(15), false, false), meta(OWNER, true, false)], data: Uint8Array.from([4, 0, 0, 0]) };
    const unknown: SolanaInstruction = { programId: key(16), accounts: [meta(FAR)], data: Uint8Array.from([1, 2, 3]) };
    const toFar: SolanaInstruction = { ...transfer, accounts: [meta(OWNER, true), meta(FAR)] };
    const review = reviewSolanaTransaction(parseUnsignedTransaction(unsigned(message([nonce, toFar, unknown], { [TABLE]: [DESTINATION, FAR] })), OWNER));
    expect(review.durableNonce).toBe(true);
    expect(review.lookupTables).toBe(1);
    expect(review.instructions[1]).toEqual({ kind: 'sol-transfer', from: { address: OWNER }, to: { lookup: TABLE, index: 1 }, lamports: 1_500_000_000n });
    expect(review.instructions[2]).toEqual({ kind: 'other', program: key(16), accounts: 1, dataBytes: 3 });
    expect(review.programs.find(program => program.address === key(16))?.name).toBeNull();
    expect(review.maxFeeLamports).toBe(5_000n);
  });
  it('does not decode token data of the wrong length', () => {
    const odd: SolanaInstruction = { ...checked, data: Uint8Array.from([12, ...le(1n, 8)]) };
    expect(reviewSolanaTransaction(parseUnsignedTransaction(unsigned(message([odd])), OWNER)).instructions[0]).toMatchObject({ kind: 'other', program: TOKEN_PROGRAM });
  });
});
