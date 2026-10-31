// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's local EVM codec equals the engine's byte for byte, refuses altered signed answers, and decodes
// only the token calls it can prove (exact ABI lengths); everything else stays raw.
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import type { EvmTransaction } from './protocol';
import { bytesToHex, decodeEvmCall, formatUnits, hexToBytes, reviewEvmTransaction, rlpDecode, rlpEncode, unsignedEip1559, verifySignedEip1559 } from './evm-transaction';

const FROM = '0x' + '1'.repeat(40), TOKEN = '0x' + 'a'.repeat(40), SPENDER = '0x' + 'b'.repeat(40);
const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const tx = (patch: Partial<EvmTransaction> = {}): EvmTransaction => ({ from: FROM, to: TOKEN, value: '0x0', data: '0x', chainId: '0x2105', nonce: '0x7',
  gas: '0x5208', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x0', ...patch });
const engine = (t: EvmTransaction): erc7710.Eip1559 => ({ chainId: BigInt(t.chainId), nonce: BigInt(t.nonce), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas),
  maxFeePerGas: BigInt(t.maxFeePerGas), gasLimit: BigInt(t.gas), to: t.to, value: BigInt(t.value), data: t.data });

describe('unsigned EIP-1559 envelope', () => {
  const cases: EvmTransaction[] = [
    tx(),
    tx({ chainId: '0x1', nonce: '0x0', value: '0xde0b6b3a7640000', maxPriorityFeePerGas: '0x77359400', maxFeePerGas: '0x174876e800', gas: '0x30d40' }),
    tx({ chainId: '0xa4b1', data: `0x095ea7b3${word(SPENDER)}${'f'.repeat(64)}` }),
    tx({ chainId: '0x1237', nonce: '0x7f', gas: '0x80', data: '0x' + 'ab'.repeat(300) }),
    tx({ nonce: '0xffffffffffffffff', value: '0x' + 'f'.repeat(64), data: '0x00' }),
  ];
  it.each(cases.map((value, i) => [i, value] as const))('case %i equals the engine’s unsignedEip1559', (_i, value) => {
    expect(bytesToHex(unsignedEip1559(value))).toBe(bytesToHex(erc7710.unsignedEip1559(engine(value))));
  });
  it('round-trips through the strict decoder and refuses non-canonical RLP', () => {
    const body = unsignedEip1559(cases[3]!).subarray(1);
    expect(bytesToHex(rlpEncode(rlpDecode(body)))).toBe(bytesToHex(body));
    expect(() => rlpDecode(hexToBytes('8105'))).toThrow('FLOFI_WALLET_TRANSACTION_INVALID'); // single byte below 0x80 wrapped
    expect(() => rlpDecode(hexToBytes('b80100'))).toThrow('FLOFI_WALLET_TRANSACTION_INVALID'); // long form for a short string
    expect(() => rlpDecode(hexToBytes('c0c0'))).toThrow('FLOFI_WALLET_TRANSACTION_INVALID'); // trailing bytes
    expect(() => rlpDecode(hexToBytes('83aabb'))).toThrow('FLOFI_WALLET_TRANSACTION_INVALID'); // truncated
  });
});

describe('the provider’s signed answer', () => {
  const value = tx({ data: `0xa9059cbb${word(SPENDER)}${word('0x3e8')}` });
  const signed = (t: EvmTransaction, y: 0 | 1 = 1) => erc7710.signedEip1559(engine(t), y, 0x1234n, 0x5678n).raw;
  it('is accepted only as the same nine fields with a well-formed signature', () => {
    expect(verifySignedEip1559(value, signed(value).slice(2))).toBe(signed(value));
    expect(verifySignedEip1559(value, signed(value, 0))).toBe(signed(value, 0));
  });
  it('is discarded when any approved field changed', () => {
    for (const patch of [{ to: SPENDER }, { value: '0x1' }, { nonce: '0x8' }, { gas: '0x5209' }, { maxFeePerGas: '0x1' }, { chainId: '0x1' },
      { data: `0xa9059cbb${word(SPENDER)}${word('0x3e9')}` }] satisfies Partial<EvmTransaction>[])
      expect(() => verifySignedEip1559(value, signed({ ...value, ...patch }))).toThrow('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
  });
  it('is discarded when it is not a well-formed signed type-2 transaction', () => {
    const unsigned = bytesToHex(unsignedEip1559(value));
    expect(() => verifySignedEip1559(value, unsigned)).toThrow('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
    expect(() => verifySignedEip1559(value, '01' + unsigned.slice(2))).toThrow('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH');
    const fields = rlpDecode(hexToBytes(signed(value)).subarray(1)) as Uint8Array[];
    const reencode = (items: readonly (Uint8Array | readonly never[])[]) => '02' + bytesToHex(rlpEncode(items));
    expect(() => verifySignedEip1559(value, reencode([...fields.slice(0, 9), Uint8Array.of(2), fields[10]!, fields[11]!]))).toThrow('MISMATCH');
    expect(() => verifySignedEip1559(value, reencode([...fields.slice(0, 10), new Uint8Array(0), fields[11]!]))).toThrow('MISMATCH');
    expect(() => verifySignedEip1559(value, reencode([...fields.slice(0, 11), new Uint8Array(33).fill(1)]))).toThrow('MISMATCH');
    expect(() => verifySignedEip1559(value, signed(value) + '00')).toThrow('MISMATCH');
  });
});

describe('what the person sees', () => {
  it('decodes ERC-20 transfer and approvals, flagging unlimited allowances', () => {
    expect(decodeEvmCall(`0xa9059cbb${word(SPENDER)}${word('0x3e8')}`)).toEqual({ kind: 'erc20-transfer', to: SPENDER, amount: 1000n });
    expect(decodeEvmCall(`0x095ea7b3${word(SPENDER)}${'f'.repeat(64)}`)).toEqual({ kind: 'erc20-approve', spender: SPENDER, amount: (1n << 256n) - 1n, unlimited: true });
    expect(decodeEvmCall(`0x095ea7b3${word(SPENDER)}${word('0x64')}`)).toMatchObject({ kind: 'erc20-approve', amount: 100n, unlimited: false });
    expect(decodeEvmCall(`0x39509351${word(SPENDER)}${word('0x64')}`)).toMatchObject({ kind: 'erc20-increase-allowance', spender: SPENDER });
    expect(decodeEvmCall(`0x23b872dd${word(FROM)}${word(SPENDER)}${word('0x5')}`)).toEqual({ kind: 'erc20-transfer-from', from: FROM, to: SPENDER, amount: 5n });
    expect(decodeEvmCall(`0xa22cb465${word(SPENDER)}${word('0x1')}`)).toEqual({ kind: 'set-approval-for-all', operator: SPENDER, approved: true });
    expect(decodeEvmCall(`0xd505accf${word(FROM)}${word(SPENDER)}${'f'.repeat(64)}${word('0x10')}${word('0x1b')}${word('0x1')}${word('0x2')}`))
      .toMatchObject({ kind: 'erc20-permit', owner: FROM, spender: SPENDER, unlimited: true, deadline: 16n });
    expect(decodeEvmCall('0x')).toEqual({ kind: 'none' });
  });
  it('leaves anything it cannot prove raw: other selectors, wrong lengths, dirty address words, non-boolean flags', () => {
    expect(decodeEvmCall('0x12345678')).toEqual({ kind: 'unknown', selector: '0x12345678', bytes: 4 });
    expect(decodeEvmCall(`0xa9059cbb${word(SPENDER)}${word('0x1')}00`)).toMatchObject({ kind: 'unknown', selector: '0xa9059cbb' });
    expect(decodeEvmCall(`0xa9059cbb${'1' + word(SPENDER).slice(1)}${word('0x1')}`)).toMatchObject({ kind: 'unknown' });
    expect(decodeEvmCall(`0xa22cb465${word(SPENDER)}${word('0x2')}`)).toMatchObject({ kind: 'unknown' });
    expect(decodeEvmCall('0xab')).toMatchObject({ kind: 'unknown', selector: '0xab000000', bytes: 1 });
  });
  it('shows the chain, the fee fields and the maximum total cost; other chains are not signable', () => {
    const review = reviewEvmTransaction(tx({ value: '0xde0b6b3a7640000', gas: '0x5208', maxFeePerGas: '0x3b9aca00' }))!;
    expect(review.chain.name).toBe('Base');
    expect(review.maxTotalCost).toBe(10n ** 18n + 21000n * 10n ** 9n);
    expect(formatUnits(review.maxTotalCost, 18)).toBe('1.000021');
    expect(formatUnits(1234567890n, 0)).toBe('1,234,567,890');
    expect(formatUnits(10n ** 9n, 9)).toBe('1');
    expect(formatUnits(5n, 18)).toBe('0.000000000000000005');
    expect(['0x1', '0x2105', '0xa4b1', '0x1237'].map(chainId => reviewEvmTransaction(tx({ chainId }))?.chain.name)).toEqual(['Ethereum', 'Base', 'Arbitrum One', 'Robinhood Chain']);
    for (const chainId of ['0x14a34', '0xaa36a7', '0x7a69', '0x89']) expect(reviewEvmTransaction(tx({ chainId }))).toBeNull();
  });
});
