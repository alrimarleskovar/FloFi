// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: the shared signing contract: strict bindings and summaries, and failure classes that never call a possible
// signature a refusal.
import { describe, expect, it } from 'vitest';
import { classifySigningFailure, floFiWalletMessage, FLOFI_WALLET_MESSAGES, isSigningFlow, parseSigningContext, parseSigningHeader, parseSigningSummary, PRE_SIGNATURE_CODES, signingContextOf, signingHeaderValue, SIGNING_FLOWS, FLOFI_WALLET_EVM_CHAIN_IDS, FLOFI_WALLET_SOLANA_CHAIN } from './flofi-signing';

const RUN = 'bas-' + 'a'.repeat(24);
describe('signing binding', () => {
  it('lists exactly the flows FloFi Wallet can bind, by run namespace', () => {
    expect(Object.keys(SIGNING_FLOWS).sort()).toEqual(['arbitrum-mainnet-transfer', 'arbitrum-swap', 'base-mainnet-transfer', 'base-swap', 'ethereum-mainnet-transfer',
      'ethereum-swap', 'jupiter-swap', 'robinhood-mainnet-transfer', 'robinhood-swap', 'solana-transfer']);
    // Mainnet only: the Devnet flows are not FloFi Wallet flows (their runs fall back to their own name, which is refused).
    for (const flow of ['solana-devnet-swap', 'solana-devnet-transfer', 'base-sepolia-swap', 'robinhood-transfer']) expect(isSigningFlow(flow)).toBe(false);
    expect([...FLOFI_WALLET_EVM_CHAIN_IDS].sort((a, b) => a - b)).toEqual([1, 4663, 8453, 42161]);
    expect(FLOFI_WALLET_SOLANA_CHAIN).toBe('solana:mainnet');
    expect(isSigningFlow('robinhood-transfer')).toBe(false);
    expect(signingContextOf(RUN, 'base-sepolia-swap')).toEqual({ flow: 'base-swap', runId: RUN });
    expect(signingContextOf('pub-' + 'a'.repeat(24), 'base-sepolia-swap')).toEqual({ flow: 'base-sepolia-swap', runId: 'pub-' + 'a'.repeat(24) });
    expect(signingContextOf('rhx-' + 'a'.repeat(32), 'robinhood-transfer').flow).toBe('robinhood-transfer');
    expect(signingContextOf('jupiter-' + 'a'.repeat(32), 'jupiter-swap').flow).toBe('jupiter-swap');
    expect(signingContextOf('orca-' + 'a'.repeat(32), 'solana-devnet-swap').flow).toBe('solana-devnet-swap');
  });
  it('parses bindings strictly and round-trips the relay header', () => {
    expect(parseSigningContext({ flow: 'base-swap', runId: RUN })).toEqual({ flow: 'base-swap', runId: RUN });
    for (const value of [null, { flow: 'base-swap' }, { flow: 'base-swap', runId: RUN, extra: 1 }, { flow: 'Base', runId: RUN }, { flow: 'base-swap', runId: 'bas:1' }])
      expect(parseSigningContext(value)).toBeNull();
    expect(parseSigningHeader(signingHeaderValue({ flow: 'base-swap', runId: RUN }))).toEqual({ flow: 'base-swap', runId: RUN });
    expect(parseSigningHeader(`base-swap:${RUN}:x`)).toBeNull();
    expect(parseSigningHeader(null)).toBeNull();
  });
  it('accepts a summary only in its exact shape', () => {
    const summary = { flow: 'base-swap', runId: RUN, network: 'Base', chain: 'eip155:8453', realFunds: true, action: 'Swap', owner: '0x' + '1'.repeat(40),
      lines: [{ label: 'You pay', value: '1 USDC' }], expiresAt: '2026-10-31T12:00:00.000Z' };
    expect(parseSigningSummary(summary)).toEqual(summary);
    expect(parseSigningSummary({ ...summary, flow: 'robinhood-transfer' })).toBeNull();
    expect(parseSigningSummary({ ...summary, runId: 'rhs-' + 'a'.repeat(24) })).toBeNull();
    expect(parseSigningSummary({ ...summary, lines: [{ label: 'x', value: 'line\nbreak' }] })).toBeNull();
    expect(parseSigningSummary({ ...summary, lines: [{ label: 'x', value: 'y', extra: 1 }] })).toBeNull();
  });
});

describe('failure classes (spec §5)', () => {
  it('maps only a cancel before Sign to a rejection, proven pre-signature refusals to refusals, and everything else to unknown', () => {
    expect(classifySigningFailure('FLOFI_WALLET_REJECTED')).toBe('rejected');
    for (const code of ['FLOFI_WALLET_NO_MATCHING_REVIEW', 'FLOFI_WALLET_FLOW_NOT_SUPPORTED', 'WALLET_UNLOCK_REQUIRED', 'SIGN_REQUEST_INVALID'])
      expect(classifySigningFailure(code)).toBe('refused');
    // The attempt was already signed once: whatever happened to that signature is unknown, so it is never treated as "nothing signed".
    for (const code of ['FLOFI_WALLET_ALREADY_SIGNED', 'FLOFI_WALLET_CLOSED', 'MANAGED_ACTIVITY_NOT_COMPLETED', 'MANAGED_RESPONSE_INVALID', 'FLOFI_WALLET_SUBMISSION_UNKNOWN', '', 'anything'])
      expect(classifySigningFailure(code)).toBe('unknown');
    expect(PRE_SIGNATURE_CODES.has('FLOFI_WALLET_REJECTED')).toBe(false);
  });
  it('has owner-facing text for every product-side code, without wording that reads as a decline for an unknown outcome', () => {
    for (const code of ['FLOFI_WALLET_NOT_OPEN', 'FLOFI_WALLET_LOCKED', 'FLOFI_WALLET_FLOW_NOT_SUPPORTED', 'FLOFI_WALLET_SUBMISSION_UNKNOWN', 'FLOFI_WALLET_SIGNATURE_UNKNOWN'])
      expect(floFiWalletMessage(code)).toBeTruthy();
    expect(FLOFI_WALLET_MESSAGES.FLOFI_WALLET_FLOW_NOT_SUPPORTED).toBe('FloFi Wallet can\'t sign this action yet — use MetaMask, Phantom or Solflare.');
    expect(FLOFI_WALLET_MESSAGES.FLOFI_WALLET_SUBMISSION_UNKNOWN).not.toMatch(/reject|declin|denied|cancel/i);
    expect(floFiWalletMessage('UNLISTED')).toBeNull();
  });
});
