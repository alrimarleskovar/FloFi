// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the message protocol between a FloFi product page and FloFi Wallet (a popup on the wallet origin).
 *
 * Both sides check the other's exact origin (configured, never taken from a message) and, in FloFi Wallet, that the message comes from
 * its own opener. A request carries data to show the person, never authority: FloFi Wallet decodes the bytes itself, shows them and signs
 * only after the person's click in the wallet page. Responses carry public data (addresses, signatures, signed bytes), never a key or
 * phrase. Every field is validated strictly; anything else is dropped.
 *
 * This module is imported by the wallet origin's pages: it must stay free of the workflow engine (no Ajv, no eval).
 */
import type { WalletEcosystem } from '../wallet/wallet-registry';
import { parseSigningContext, signingHeaderValue, type SigningContext } from '../wallet/flofi-signing';

export const WALLET_PROTOCOL = 'flofi-wallet/1';
/** Solana mainnet only: a Devnet or Testnet request is not a FloFi Wallet request at all. */
export type SolanaWalletChain = 'solana:mainnet';
/** A fully populated EIP-1559 transaction, as hex quantities (FloFi Wallet signs exactly these fields). */
export type EvmTransaction = { readonly from: string; readonly to: string; readonly value: string; readonly data: string; readonly chainId: string;
  readonly nonce: string; readonly gas: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string };
/**
 * The FloFi attempt a transaction request belongs to (spec decision 2): FloFi Wallet asks its own server for that run's prepared attempt
 * and reviewed summary before it offers Sign, and its relay requires the same binding. A transaction request without one is refused.
 * The shape and its validation are the shared contract in `src/wallet/flofi-signing.ts`.
 */
export type SigningBinding = SigningContext;
export type WalletOperation =
  | { readonly op: 'connect' }
  | { readonly op: 'manage' }
  | { readonly op: 'create'; readonly ecosystem: WalletEcosystem }
  | { readonly op: 'import'; readonly ecosystem: WalletEcosystem }
  | { readonly op: 'export'; readonly walletId: string; readonly kind: 'recovery-phrase' | 'private-key' }
  | { readonly op: 'evm_sign_transaction'; readonly address: string; readonly tx: EvmTransaction; readonly signing?: SigningBinding }
  | { readonly op: 'evm_sign_message'; readonly address: string; readonly message: string }
  | { readonly op: 'solana_sign_transaction'; readonly address: string; readonly chain: SolanaWalletChain; readonly transaction: string;
    readonly signing?: SigningBinding }
  | { readonly op: 'solana_sign_message'; readonly address: string; readonly message: string };
export type WalletRequest = { readonly protocol: typeof WALLET_PROTOCOL; readonly type: 'request'; readonly id: string; readonly request: WalletOperation };
export type ManagedWalletInfo = { readonly ecosystem: WalletEcosystem; readonly address: string; readonly label: string };
export type WalletResult =
  | { readonly wallets: readonly ManagedWalletInfo[] }
  | { readonly wallet: ManagedWalletInfo }
  | { readonly done: true }
  | { readonly signedTransaction: string }
  | { readonly signature: string };
export type WalletResponse = { readonly protocol: typeof WALLET_PROTOCOL; readonly type: 'response'; readonly id: string }
  & ({ readonly ok: true; readonly result: WalletResult } | { readonly ok: false; readonly code: string });
/** FloFi Wallet → product page: 'ready' (listening; send the handoff), 'busy' (waiting for the person), 'locked' (needs an unlock). */
export type WalletNotice = { readonly protocol: typeof WALLET_PROTOCOL; readonly type: 'ready' | 'busy' | 'locked' | 'unlocked' };
/** Product page → FloFi Wallet, once after 'ready': the single-use handoff naming the product page's account session. */
export type WalletHandoff = { readonly protocol: typeof WALLET_PROTOCOL; readonly type: 'handoff'; readonly token: string };

const ID = /^[A-Za-z0-9_-]{8,64}$/, CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/, DATA = /^0x(?:[0-9a-f]{2}){0,65536}$/, EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, BASE64 = /^[A-Za-z0-9+/]{4,2048}={0,2}$/;
const WALLET_ID = /^(?:evm:0x[0-9a-f]{40}|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const MAX_MESSAGE = 4_096;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const ecosystemOf = (value: unknown): WalletEcosystem | null => value === 'evm' || value === 'solana' ? value : null;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);

/** A run binding `{flow, runId}` (exact keys, FloFi's own flow and run-id shapes), or null. */
export const parseSigningBinding = (value: unknown): SigningBinding | null => parseSigningContext(value);
/** The relay header value naming that attempt: `<flow>:<runId>` (neither part can contain `:`). */
export const signingHeader = (binding: SigningBinding): string => signingHeaderValue(binding);
/** Exactly `keys`, or `keys` plus a valid `signing` binding: the binding is optional in the message and required by FloFi Wallet to sign. */
function withBinding(r: Record<string, unknown>, keys: readonly string[]): { ok: boolean; signing: SigningBinding | null } {
  if (exactKeys(r, keys)) return { ok: true, signing: null };
  const signing = parseSigningBinding(r.signing);
  return { ok: signing !== null && exactKeys(r, [...keys, 'signing']), signing };
}

export function parseEvmTransaction(value: unknown): EvmTransaction | null {
  const tx = record(value);
  const keys = ['from', 'to', 'value', 'data', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const;
  if (!tx || !exactKeys(tx, keys)) return null;
  const lower = Object.fromEntries(keys.map(key => [key, typeof tx[key] === 'string' ? (tx[key] as string).toLowerCase() : null])) as Record<typeof keys[number], string | null>;
  if (!lower.from || !EVM_ADDRESS.test(lower.from) || !lower.to || !EVM_ADDRESS.test(lower.to) || !lower.data || !DATA.test(lower.data)) return null;
  for (const key of ['value', 'chainId', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) if (!lower[key] || !QUANTITY.test(lower[key]!)) return null;
  if (BigInt(lower.maxPriorityFeePerGas!) > BigInt(lower.maxFeePerGas!) || BigInt(lower.gas!) === 0n || BigInt(lower.chainId!) === 0n) return null;
  return lower as EvmTransaction;
}
function parseOperation(value: unknown): WalletOperation | null {
  const r = record(value);
  if (!r) return null;
  const message = typeof r.message === 'string' && r.message.length > 0 && r.message.length <= MAX_MESSAGE && !r.message.includes('\0') ? r.message : null;
  switch (r.op) {
    case 'connect': case 'manage': return exactKeys(r, ['op']) ? { op: r.op } : null;
    case 'create': case 'import': { const ecosystem = ecosystemOf(r.ecosystem); return ecosystem && exactKeys(r, ['op', 'ecosystem']) ? { op: r.op, ecosystem } : null; }
    case 'export': return exactKeys(r, ['op', 'walletId', 'kind']) && typeof r.walletId === 'string' && WALLET_ID.test(r.walletId)
      && (r.kind === 'recovery-phrase' || r.kind === 'private-key') ? { op: 'export', walletId: r.walletId, kind: r.kind } : null;
    case 'evm_sign_transaction': {
      const tx = parseEvmTransaction(r.tx), address = typeof r.address === 'string' ? r.address.toLowerCase() : '', keys = withBinding(r, ['op', 'address', 'tx']);
      return keys.ok && tx && EVM_ADDRESS.test(address) && tx.from === address
        ? { op: r.op, address, tx, ...keys.signing ? { signing: keys.signing } : {} } : null;
    }
    case 'evm_sign_message': {
      const address = typeof r.address === 'string' ? r.address.toLowerCase() : '';
      return exactKeys(r, ['op', 'address', 'message']) && EVM_ADDRESS.test(address) && message ? { op: r.op, address, message } : null;
    }
    case 'solana_sign_transaction': {
      const keys = withBinding(r, ['op', 'address', 'chain', 'transaction']);
      return keys.ok && typeof r.address === 'string' && SOLANA_ADDRESS.test(r.address)
        && r.chain === 'solana:mainnet' && typeof r.transaction === 'string' && BASE64.test(r.transaction)
        ? { op: r.op, address: r.address, chain: r.chain, transaction: r.transaction, ...keys.signing ? { signing: keys.signing } : {} } : null;
    }
    case 'solana_sign_message':
      return exactKeys(r, ['op', 'address', 'message']) && typeof r.address === 'string' && SOLANA_ADDRESS.test(r.address) && message
        ? { op: r.op, address: r.address, message } : null;
    default: return null;
  }
}
export function parseWalletRequest(data: unknown): WalletRequest | null {
  const r = record(data);
  if (!r || r.protocol !== WALLET_PROTOCOL || r.type !== 'request' || typeof r.id !== 'string' || !ID.test(r.id) || !exactKeys(r, ['protocol', 'type', 'id', 'request'])) return null;
  const request = parseOperation(r.request);
  return request ? { protocol: WALLET_PROTOCOL, type: 'request', id: r.id, request } : null;
}
function parseWalletInfo(value: unknown): ManagedWalletInfo | null {
  const r = record(value), ecosystem = ecosystemOf(r?.ecosystem);
  if (!r || !ecosystem || typeof r.address !== 'string' || typeof r.label !== 'string' || r.label.length > 80) return null;
  return (ecosystem === 'evm' ? EVM_ADDRESS : SOLANA_ADDRESS).test(r.address) ? { ecosystem, address: r.address, label: r.label } : null;
}
export function parseWalletResponse(data: unknown): WalletResponse | null {
  const r = record(data);
  if (!r || r.protocol !== WALLET_PROTOCOL || r.type !== 'response' || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  if (r.ok === false) return typeof r.code === 'string' && CODE.test(r.code) ? { protocol: WALLET_PROTOCOL, type: 'response', id: r.id, ok: false, code: r.code } : null;
  const result = record(r.result);
  if (r.ok !== true || !result) return null;
  let parsed: WalletResult | null = null;
  if (Array.isArray(result.wallets)) { const wallets = result.wallets.map(parseWalletInfo); parsed = wallets.every(Boolean) ? { wallets: wallets as ManagedWalletInfo[] } : null; }
  else if (result.wallet) { const wallet = parseWalletInfo(result.wallet); parsed = wallet ? { wallet } : null; }
  else if (result.done === true) parsed = { done: true };
  else if (typeof result.signedTransaction === 'string' && result.signedTransaction.length <= 140_000) parsed = { signedTransaction: result.signedTransaction };
  else if (typeof result.signature === 'string' && result.signature.length <= 200) parsed = { signature: result.signature };
  return parsed ? { protocol: WALLET_PROTOCOL, type: 'response', id: r.id, ok: true, result: parsed } : null;
}
export const isWalletNotice = (data: unknown): data is WalletNotice => {
  const r = record(data);
  return !!r && r.protocol === WALLET_PROTOCOL && (r.type === 'ready' || r.type === 'busy' || r.type === 'locked' || r.type === 'unlocked');
};
export function parseWalletHandoff(data: unknown): WalletHandoff | null {
  const r = record(data);
  return r && r.protocol === WALLET_PROTOCOL && r.type === 'handoff' && exactKeys(r, ['protocol', 'type', 'token']) && typeof r.token === 'string'
    && /^h1\.[A-Za-z0-9_-]{20,1200}\.[A-Za-z0-9_-]{43}$/.test(r.token) ? { protocol: WALLET_PROTOCOL, type: 'handoff', token: r.token } : null;
}
