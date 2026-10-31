// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's two message channels (spec decisions 1 and 8; security review findings 6 and 7).
 *
 * 1. The product page that opened this window. FloFi Wallet listens only to `window.opener`, and only to messages whose origin is exactly
 *    the configured product origin (never a value taken from a message or the URL). The account handoff arrives this way and no other:
 *    a handoff in the URL could be planted by any website. Every answer goes to the opener with `targetOrigin` = the product origin, so
 *    no other page that may have replaced the opener can read a signature or an address. A malformed request that still names an id
 *    gets an explicit refusal, so the product page never waits forever.
 * 2. Other FloFi Wallet windows of this browser (`BroadcastChannel('flofi-wallet')`, same origin only): unlocks, locks and account
 *    changes, including the result page of a Google/Apple sign-in window. A notice is only a hint to re-read the session from the
 *    server; it never unlocks, locks or switches anything by itself.
 */
import { parseWalletHandoff, parseWalletRequest, WALLET_PROTOCOL, type WalletHandoff, type WalletNotice, type WalletRequest, type WalletResponse, type WalletResult } from './protocol';

export const WALLET_BROADCAST = 'flofi-wallet';
const ID = /^[A-Za-z0-9_-]{8,64}$/, CODE = /^[A-Z][A-Z0-9_]{2,80}$/, ACCOUNT = /^acct_[0-9a-f]{32}$/;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export type OpenerMessage =
  | { readonly kind: 'handoff'; readonly handoff: WalletHandoff }
  | { readonly kind: 'request'; readonly request: WalletRequest }
  | { readonly kind: 'invalid-request'; readonly id: string };
type MessageLike = { readonly source: unknown; readonly origin: string; readonly data: unknown };

/** What a `message` event from the opener carries, or null for anything not from the opener at the product origin, or not ours. */
export function classifyOpenerMessage(event: MessageLike, opener: unknown, appOrigin: string): OpenerMessage | null {
  if (!opener || event.source !== opener || event.origin !== appOrigin) return null;
  const handoff = parseWalletHandoff(event.data);
  if (handoff) return { kind: 'handoff', handoff };
  const request = parseWalletRequest(event.data);
  if (request) return { kind: 'request', request };
  const r = record(event.data);
  return r && r.protocol === WALLET_PROTOCOL && r.type === 'request' && typeof r.id === 'string' && ID.test(r.id) ? { kind: 'invalid-request', id: r.id } : null;
}

export const okResponse = (id: string, result: WalletResult): WalletResponse => ({ protocol: WALLET_PROTOCOL, type: 'response', id, ok: true, result });
export const errorResponse = (id: string, code: string): WalletResponse =>
  ({ protocol: WALLET_PROTOCOL, type: 'response', id, ok: false, code: CODE.test(code) ? code : 'FLOFI_WALLET_SIGNATURE_UNKNOWN' });
export const notice = (type: WalletNotice['type']): WalletNotice => ({ protocol: WALLET_PROTOCOL, type });

type PostTarget = { postMessage(message: unknown, targetOrigin: string): void };
/** Posts to the opener at the product origin only. Returns false when there is no opener to answer (it was closed). */
export function postToOpener(opener: unknown, appOrigin: string, message: WalletResponse | WalletNotice): boolean {
  const target = opener as PostTarget | null;
  if (!target || typeof target.postMessage !== 'function') return false;
  try { target.postMessage(message, appOrigin); return true; } catch { return false; }
}

export type BroadcastNotice =
  | { readonly type: 'unlocked' } | { readonly type: 'locked' }
  | { readonly type: 'error'; readonly code: string }
  | { readonly type: 'account'; readonly accountId: string };
export function parseBroadcast(data: unknown): BroadcastNotice | null {
  const r = record(data);
  if (!r) return null;
  if ((r.type === 'unlocked' || r.type === 'locked') && Object.keys(r).length === 1) return { type: r.type };
  if (r.type === 'error' && typeof r.code === 'string' && CODE.test(r.code) && Object.keys(r).length === 2) return { type: 'error', code: r.code };
  if (r.type === 'account' && typeof r.accountId === 'string' && ACCOUNT.test(r.accountId) && Object.keys(r).length === 2) return { type: 'account', accountId: r.accountId };
  return null;
}
/** Tells the other FloFi Wallet windows of this browser to re-read the session. Best effort: a browser without BroadcastChannel just polls. */
export function broadcast(message: BroadcastNotice): void {
  if (typeof BroadcastChannel !== 'function') return;
  try { const channel = new BroadcastChannel(WALLET_BROADCAST); channel.postMessage(message); channel.close(); } catch { /* best effort */ }
}
/** Listens for notices from other FloFi Wallet windows; returns the unsubscribe function. */
export function subscribeBroadcast(listener: (notice: BroadcastNotice) => void): () => void {
  if (typeof BroadcastChannel !== 'function') return () => {};
  const channel = new BroadcastChannel(WALLET_BROADCAST);
  channel.onmessage = event => { const parsed = parseBroadcast(event.data); if (parsed) listener(parsed); };
  return () => channel.close();
}
