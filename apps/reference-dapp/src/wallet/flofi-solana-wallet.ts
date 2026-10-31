// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet as a Wallet Standard wallet on the product page (spec §7). One wallet object per managed
 * Solana address ("FloFi Wallet", or "FloFi Wallet <address>" when the account has several), registered directly in `solana-wallet.ts`
 * (no global event), so selection stays explicit by name and identity stays the object.
 *
 * - `standard:connect` (silent included) returns the account's own managed address: connecting shares a public address the account
 *   already holds; nothing is signed.
 * - `solana:signTransaction` needs the reviewed run the store bound right before its single sign call (`bindFloFiSigning`). FloFi Wallet
 *   signs the exact v0 message after its server matched it to that run's PREPARED attempt; the result must be the same message with the
 *   owner's signature in slot 0, or it is refused here. FloFi's own `submit` stays the only broadcaster and verifies it again.
 * - `solana:signMessage`: FloFi's own Sign-In With Solana text only (FloFi Wallet and its relay refuse anything else).
 * - Errors: a cancel before Sign carries code 4001; a failure once FloFi Wallet may have signed never reads as a rejection.
 */
import { classifySigningFailure, FLOFI_WALLET_SOLANA_CHAIN } from './flofi-signing';
import { registerFloFiSigningTarget, takeFloFiSigning, type FloFiWalletRequest } from './flofi-wallet-channel';
import type { SolanaWalletAccount, SolanaWalletChain, StandardWallet } from './solana-wallet';
import type { WalletResult } from '../wallet-app/protocol';

export type FloFiSolanaDeps = { readonly request: (request: FloFiWalletRequest) => Promise<WalletResult>;
  readonly connected?: (address: string, connected: boolean) => void };
export type FloFiSolanaWallet = StandardWallet & { readonly version: '1.0.0'; readonly isFloFiWallet: true; readonly address: string };
/** Solana mainnet only: FloFi Wallet never advertises or signs for Devnet or Testnet (refused as FLOFI_WALLET_NETWORK_UNSUPPORTED). */
export const FLOFI_SOLANA_CHAINS: readonly SolanaWalletChain[] = Object.freeze(['solana:mainnet']);
export const FLOFI_WALLET_NAME = 'FloFi Wallet';
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FEATURES = ['solana:signTransaction', 'solana:signMessage'] as const;

/** A Wallet Standard error: `code` 4001 only for a cancel before Sign. */
export class FloFiWalletStandardError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) { super(message); this.name = 'FloFiWalletStandardError'; this.code = code; }
}
function failure(cause: unknown): Error {
  const code = cause instanceof Error ? cause.message : '';
  const kind = classifySigningFailure(code);
  return kind === 'rejected' ? new FloFiWalletStandardError(code, 4001) : new FloFiWalletStandardError(kind === 'refused' ? code : 'FLOFI_WALLET_SIGNATURE_UNKNOWN');
}
const toBase64 = (bytes: Uint8Array) => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); };
function fromBase64(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); } catch { return null; }
}
const copy = (value: unknown): Uint8Array | null => ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() : null;
/** Signature slots of a wire transaction (compact-u16 count, at most 127 here), or null. */
function slots(wire: Uint8Array): number | null {
  const count = wire[0];
  return count !== undefined && count >= 1 && count <= 0x7f && wire.length > 1 + 64 * count ? count : null;
}
/** Whether `signed` is `unsigned` with a non-zero signature in slot 0 and every other byte unchanged. */
export function signedSameTransaction(unsigned: Uint8Array, signed: Uint8Array): boolean {
  const count = slots(unsigned);
  if (count === null || signed.length !== unsigned.length || signed[0] !== unsigned[0]) return false;
  if (signed.subarray(1, 65).every(byte => byte === 0)) return false;
  for (let i = 65; i < signed.length; i++) if (signed[i] !== unsigned[i]) return false;
  return true;
}

export function createFloFiSolanaWallet(address: string, name: string, deps: FloFiSolanaDeps): FloFiSolanaWallet {
  if (!SOLANA_ADDRESS.test(address)) throw new Error('FLOFI_WALLET_REQUEST_INVALID');
  const account: SolanaWalletAccount = Object.freeze({ address, chains: FLOFI_SOLANA_CHAINS, features: FEATURES });
  let connected = false;
  const listeners = new Set<(event: { accounts?: readonly SolanaWalletAccount[] }) => void>();
  const emit = (event: { accounts?: readonly SolanaWalletAccount[] }) => { for (const listener of [...listeners]) { try { listener(event); } catch { /* never breaks the wallet */ } } };
  const assertAccount = (value: unknown) => {
    if (!connected || !value || typeof value !== 'object' || (value as SolanaWalletAccount).address !== address) throw new FloFiWalletStandardError('FLOFI_WALLET_ACCOUNT_MISMATCH');
  };
  const wallet: FloFiSolanaWallet = {
    version: '1.0.0', name, isFloFiWallet: true, address, chains: FLOFI_SOLANA_CHAINS,
    get accounts() { return connected ? [account] : []; },
    features: {
      'standard:connect': { version: '1.0.0', async connect() {
        if (!connected) { connected = true; deps.connected?.(address, true); emit({ accounts: [account] }); }
        return { accounts: [account] };
      } },
      'standard:disconnect': { version: '1.0.0', async disconnect() {
        if (!connected) return;
        connected = false; deps.connected?.(address, false); emit({ accounts: [] });
      } },
      'standard:events': { version: '1.0.0', on(event: string, listener: (event: { accounts?: readonly SolanaWalletAccount[] }) => void) {
        if (event !== 'change') return () => undefined;
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      } },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0],
        async signTransaction(...inputs: { account: SolanaWalletAccount; transaction: Uint8Array; chain?: string }[]) {
          // One transaction per request, bound to the reviewed run the store named right before this call.
          const signing = takeFloFiSigning(wallet);
          if (inputs.length !== 1) throw new FloFiWalletStandardError('FLOFI_WALLET_REQUEST_INVALID');
          if (!signing) throw new FloFiWalletStandardError('FLOFI_WALLET_FLOW_NOT_SUPPORTED');
          const input = inputs[0]!;
          assertAccount(input.account);
          const chain = input.chain ?? 'solana:mainnet', unsigned = copy(input.transaction);
          // Solana mainnet only: a Devnet or Testnet transaction is refused before FloFi Wallet is asked anything.
          if (chain !== FLOFI_WALLET_SOLANA_CHAIN) throw new FloFiWalletStandardError('FLOFI_WALLET_NETWORK_UNSUPPORTED');
          if (!unsigned || unsigned.length > 1_232 || slots(unsigned) === null) throw new FloFiWalletStandardError('FLOFI_WALLET_REQUEST_INVALID');
          let result: { signedTransaction?: unknown };
          try {
            result = await deps.request({ op: 'solana_sign_transaction', address, chain: FLOFI_WALLET_SOLANA_CHAIN, transaction: toBase64(unsigned), signing }) as typeof result;
          } catch (cause) { throw failure(cause); }
          const signed = fromBase64(result.signedTransaction);
          // Anything but the same transaction with the owner's signature is dropped (FloFi's submit would refuse it anyway).
          if (!signed || !signedSameTransaction(unsigned, signed)) throw new FloFiWalletStandardError('FLOFI_WALLET_SIGNATURE_UNKNOWN');
          return [{ signedTransaction: signed }];
        } },
      'solana:signMessage': { version: '1.0.0',
        async signMessage(...inputs: { account: SolanaWalletAccount; message: Uint8Array }[]) {
          if (inputs.length !== 1) throw new FloFiWalletStandardError('FLOFI_WALLET_REQUEST_INVALID');
          const input = inputs[0]!;
          assertAccount(input.account);
          const bytes = copy(input.message);
          let message: string;
          try { message = new TextDecoder('utf-8', { fatal: true }).decode(bytes ?? undefined); } catch { throw new FloFiWalletStandardError('FLOFI_WALLET_MESSAGE_UNSUPPORTED'); }
          if (!bytes || !message) throw new FloFiWalletStandardError('FLOFI_WALLET_MESSAGE_UNSUPPORTED');
          let result: { signature?: unknown };
          try { result = await deps.request({ op: 'solana_sign_message', address, message }) as typeof result; } catch (cause) { throw failure(cause); }
          const text = typeof result.signature === 'string' ? result.signature.replace(/^0x/i, '') : '';
          const signature = /^[0-9a-fA-F]{128}$/.test(text) ? Uint8Array.from(text.match(/../g)!, byte => parseInt(byte, 16)) : fromBase64(text);
          if (!signature || signature.length !== 64) throw new FloFiWalletStandardError('FLOFI_WALLET_SIGNATURE_UNKNOWN');
          return [{ signedMessage: bytes, signature }];
        } },
    },
  };
  registerFloFiSigningTarget(wallet);
  return wallet;
}
/** Ends this page's use of a wallet whose address left the account (or FloFi Wallet became unavailable). */
export async function retireFloFiSolanaWallet(wallet: FloFiSolanaWallet): Promise<void> {
  const disconnect = wallet.features['standard:disconnect'] as { disconnect(): Promise<void> };
  await disconnect.disconnect().catch(() => undefined);
}
