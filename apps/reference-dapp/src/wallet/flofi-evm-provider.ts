// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet as an EIP-1193 provider on the product page (spec §4, §5, §6). One provider object per
 * managed address, so changing address is changing provider identity (the Review binding retires, as with any wallet switch).
 *
 * Every store keeps its own gates unchanged (Review → Manifest → begin → handoff → send → report → observe); this object only replaces the
 * wallet behind `eth_sendTransaction`:
 * - Accounts and chain are local: the address is the account's own managed wallet; the chain is one of the four catalog mainnets (Base,
 *   Arbitrum, Ethereum, Robinhood Chain); any other chain is 4902 and `wallet_addEthereumChain` is refused.
 * - Reads the product page cannot do itself (pending nonce, fees) go to FloFi's server, for this account's own address only.
 * - `eth_sendTransaction` needs the reviewed run the store bound right before its send (`bindFloFiSigning`); without one the action is not
 *   supported by FloFi Wallet. Legacy `gasPrice` requests are refused. Missing nonce/fees are filled from FloFi's server and shown, and
 *   checked, by FloFi Wallet. The person signs in FloFi Wallet; FloFi broadcasts the signed bytes once, bound to the same attempt.
 * - Errors (spec §5): 4001 only when the person cancels before Sign; 4100 for a refusal proven to precede any signature; after that point
 *   every failure is a plain `FLOFI_WALLET_SUBMISSION_UNKNOWN` error (no EIP-1193 refusal code), so the store observes instead of
 *   cancelling, and the signed bytes are dropped here.
 */
import { classifySigningFailure, type SigningContext } from './flofi-signing';
import { registerFloFiSigningTarget, takeFloFiSigning, type FloFiWalletRequest } from './flofi-wallet-channel';
import type { EvmProvider } from './evm-discovery';
import type { WalletResult } from '../wallet-app/protocol';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
export type FloFiEvmDeps = {
  readonly request: (request: FloFiWalletRequest) => Promise<WalletResult>;
  readonly pendingNonce: (chainId: string, address: string) => Promise<Result<string>>;
  readonly fees: (chainId: string) => Promise<Result<{ readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string }>>;
  readonly broadcast: (signing: SigningContext, raw: string) => Promise<Result<{ readonly kind: 'HASH'; readonly hash: string } | { readonly kind: 'UNKNOWN'; readonly code: string }>>;
  /** Called when the page connects or disconnects this address (`markFloFiAccount`). */
  readonly connected?: (address: string, connected: boolean) => void;
};
export type FloFiEvmProvider = EvmProvider & { readonly isFloFiWallet: true; readonly address: string };
/** The four catalog mainnets FloFi Wallet signs on (Base first: the default chain before any switch). */
export const FLOFI_EVM_CHAINS: readonly string[] = Object.freeze(['0x2105', '0xa4b1', '0x1', '0x1237']);
export const FLOFI_WALLET_RDNS = 'xyz.flofi.wallet';

/** An EIP-1193 error object (`code`, `message`, `data`). */
export class FloFiProviderError extends Error {
  readonly code: number; readonly data: { readonly code: string };
  constructor(code: number, flofiCode: string) { super(flofiCode); this.name = 'FloFiProviderError'; this.code = code; this.data = { code: flofiCode }; }
}
const refused = (code: string) => new FloFiProviderError(4100, code);
const unsupported = (code = 'FLOFI_WALLET_METHOD_UNSUPPORTED') => new FloFiProviderError(4200, code);
/** A failure after FloFi Wallet may have signed: never a refusal code, never "rejected". */
const unknown = (code = 'FLOFI_WALLET_SUBMISSION_UNKNOWN') => new Error(code);
const ADDRESS = /^0x[0-9a-f]{40}$/, DATA = /^0x(?:[0-9a-f]{2})*$/;
function quantity(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  if (typeof value === 'bigint' && value >= 0n) return `0x${value.toString(16)}`;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return `0x${value.toString(16)}`;
  throw refused('FLOFI_WALLET_REQUEST_INVALID');
}
function utf8(value: unknown): string {
  if (typeof value !== 'string' || !value) throw refused('FLOFI_WALLET_REQUEST_INVALID');
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) return value;
  const bytes = Uint8Array.from(value.slice(2).match(/../g)!, byte => parseInt(byte, 16));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw refused('FLOFI_WALLET_MESSAGE_UNSUPPORTED'); }
}
/** Maps a FloFi Wallet failure to the provider's error: 4001 only for a cancel before Sign; 4100 only for proven pre-signature refusals. */
function failure(cause: unknown, unknownCode = 'FLOFI_WALLET_SUBMISSION_UNKNOWN'): Error {
  const code = cause instanceof Error ? cause.message : '';
  const kind = classifySigningFailure(code);
  return kind === 'rejected' ? new FloFiProviderError(4001, code) : kind === 'refused' ? refused(code) : unknown(unknownCode);
}

const retirers = new WeakMap<object, () => void>();
export function createFloFiEvmProvider(address: string, deps: FloFiEvmDeps): FloFiEvmProvider {
  const owner = address.toLowerCase();
  if (!ADDRESS.test(owner)) throw new Error('FLOFI_WALLET_REQUEST_INVALID');
  let chainId = FLOFI_EVM_CHAINS[0]!, connected = false, sending = false;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => { for (const listener of [...listeners.get(event) ?? []]) { try { listener(...args); } catch { /* a listener never breaks the provider */ } } };
  const own = (value: unknown) => typeof value === 'string' && value.toLowerCase() === owner;

  async function sendTransaction(input: unknown, provider: object): Promise<string> {
    // The reviewed run this send belongs to; a store that names none is a flow FloFi Wallet cannot bind yet.
    const signing = takeFloFiSigning(provider);
    if (!signing) throw refused('FLOFI_WALLET_FLOW_NOT_SUPPORTED');
    const tx = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
    if (!tx || !own(tx.from)) throw refused('FLOFI_WALLET_ACCOUNT_MISMATCH');
    if ('gasPrice' in tx) throw refused('FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED');
    if (tx.type !== undefined && quantity(tx.type) !== '0x2') throw refused('FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED');
    if ('accessList' in tx || 'authorizationList' in tx || 'maxFeePerBlobGas' in tx) throw refused('FLOFI_WALLET_REQUEST_INVALID');
    if (tx.chainId !== undefined && quantity(tx.chainId) !== chainId) throw refused('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    const to = typeof tx.to === 'string' ? tx.to.toLowerCase() : '', data = typeof tx.data === 'string' ? tx.data.toLowerCase() : tx.data === undefined ? '0x' : null;
    if (!ADDRESS.test(to) || data === null || !DATA.test(data) || tx.gas === undefined) throw refused('FLOFI_WALLET_REQUEST_INVALID');
    if ((tx.maxFeePerGas === undefined) !== (tx.maxPriorityFeePerGas === undefined)) throw refused('FLOFI_WALLET_REQUEST_INVALID');
    let nonce: string, maxFeePerGas: string, maxPriorityFeePerGas: string;
    if (tx.nonce !== undefined) nonce = quantity(tx.nonce);
    else { const read = await deps.pendingNonce(chainId, owner).catch(() => ({ ok: false as const, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' })); if (!read.ok) throw refused(read.code); nonce = quantity(read.value); }
    if (tx.maxFeePerGas !== undefined) { maxFeePerGas = quantity(tx.maxFeePerGas); maxPriorityFeePerGas = quantity(tx.maxPriorityFeePerGas); }
    else {
      const read = await deps.fees(chainId).catch(() => ({ ok: false as const, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' }));
      if (!read.ok) throw refused(read.code);
      maxFeePerGas = quantity(read.value.maxFeePerGas); maxPriorityFeePerGas = quantity(read.value.maxPriorityFeePerGas);
    }
    if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) throw refused('FLOFI_WALLET_REQUEST_INVALID');
    const request = { op: 'evm_sign_transaction' as const, address: owner, signing,
      tx: { from: owner, to, value: quantity(tx.value, '0x0'), data, chainId, nonce, gas: quantity(tx.gas), maxFeePerGas, maxPriorityFeePerGas } };
    let raw: string;
    try {
      const result = await deps.request(request) as { signedTransaction?: unknown };
      const signed = typeof result.signedTransaction === 'string' ? result.signedTransaction.toLowerCase().replace(/^(?:0x)?/, '0x') : '';
      if (!/^0x02(?:[0-9a-f]{2})+$/.test(signed)) throw unknown();
      raw = signed;
    } catch (cause) { throw failure(cause); }
    // From here a signature exists: FloFi broadcasts it once, bound to the same attempt; any doubt is UNKNOWN and the bytes are dropped.
    const sent = await deps.broadcast(signing, raw).catch(() => null);
    if (sent?.ok && sent.value.kind === 'HASH' && /^0x[0-9a-f]{64}$/.test(sent.value.hash)) return sent.value.hash;
    throw unknown();
  }

  const provider: FloFiEvmProvider = {
    isFloFiWallet: true, address: owner,
    async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
      const args = Array.isArray(params) ? params : [];
      switch (method) {
        case 'eth_requestAccounts':
          if (!connected) { connected = true; deps.connected?.(owner, true); emit('connect', { chainId }); emit('accountsChanged', [owner]); }
          return [owner];
        case 'eth_accounts': return connected ? [owner] : [];
        case 'eth_chainId': return chainId;
        case 'net_version': return BigInt(chainId).toString();
        case 'wallet_switchEthereumChain': {
          const target = args[0] && typeof args[0] === 'object' ? quantity((args[0] as { chainId?: unknown }).chainId) : '';
          if (!FLOFI_EVM_CHAINS.includes(target)) throw new FloFiProviderError(4902, 'FLOFI_WALLET_NETWORK_UNSUPPORTED');
          if (target !== chainId) { chainId = target; emit('chainChanged', chainId); }
          return null;
        }
        case 'wallet_addEthereumChain': throw unsupported('FLOFI_WALLET_NETWORK_UNSUPPORTED');
        case 'eth_getTransactionCount': {
          if (!own(args[0])) throw refused('FLOFI_WALLET_ACCOUNT_MISMATCH');
          if (args[1] !== 'pending') throw unsupported();
          const read = await deps.pendingNonce(chainId, owner).catch(() => ({ ok: false as const, code: 'FLOFI_WALLET_NETWORK_READ_FAILED' }));
          if (!read.ok) throw refused(read.code);
          return quantity(read.value);
        }
        case 'personal_sign': {
          if (!connected || !own(args[1])) throw refused('FLOFI_WALLET_ACCOUNT_MISMATCH');
          const message = utf8(args[0]);
          try {
            const result = await deps.request({ op: 'evm_sign_message', address: owner, message }) as { signature?: unknown };
            const signature = typeof result.signature === 'string' ? result.signature.toLowerCase().replace(/^(?:0x)?/, '0x') : '';
            if (!/^0x[0-9a-f]{130}$/.test(signature)) throw new Error('FLOFI_WALLET_RESPONSE_INVALID');
            return signature;
          } catch (cause) { throw failure(cause, 'FLOFI_WALLET_SIGNATURE_UNKNOWN'); }
        }
        case 'eth_sendTransaction': {
          if (!connected) throw refused('FLOFI_WALLET_ACCOUNT_MISMATCH');
          // One request at a time, like FloFi Wallet itself.
          if (sending) throw refused('FLOFI_WALLET_BUSY');
          sending = true;
          try { return await sendTransaction(args[0], provider); } finally { sending = false; }
        }
        default: throw unsupported();
      }
    },
    on(event, listener) { let set = listeners.get(event); if (!set) { set = new Set(); listeners.set(event, set); } set.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  registerFloFiSigningTarget(provider);
  retirers.set(provider, () => {
    if (!connected) return;
    connected = false; deps.connected?.(owner, false);
    emit('accountsChanged', []); emit('disconnect', new FloFiProviderError(4900, 'FLOFI_WALLET_UNAVAILABLE'));
  });
  return provider;
}
/** Ends this page's use of a provider whose address left the account (or FloFi Wallet became unavailable): its sessions see a disconnect. */
export function retireFloFiEvmProvider(provider: FloFiEvmProvider): void { retirers.get(provider)?.(); }
