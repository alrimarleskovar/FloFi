// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the product page's side of FloFi Wallet (a popup on the wallet origin; spec §1, F1).
 *
 * - Opening: browsers allow a popup only inside the person's click, and every signing request reaches this page several awaits after
 *   that click. So `openFloFiWallet()` is synchronous and is called at the gesture itself (Authorize, Continue, the account actions); it
 *   opens FloFi Wallet under a fresh random window name (a fixed name would let any page target or reuse it) or focuses the open one.
 * - Account binding: FloFi Wallet posts `ready`; only then does this page mint a single-use handoff (server action) and post it with
 *   `targetOrigin` = the configured wallet origin, never in a URL. FloFi Wallet accepts it only from its opener on the product origin.
 * - Messages: only messages from the configured wallet origin AND from the window this page opened are read, through the strict parsers of
 *   `wallet-app/protocol.ts`. One request at a time, each with a random id; requests are sent only after FloFi Wallet reported its lock
 *   state for the new session, so none races the handoff.
 * - No popup: a provider request made while FloFi Wallet is closed waits for a new gesture ("Continue in FloFi Wallet", or Cancel).
 *   Cancelling a request that FloFi Wallet never received is the person declining before Sign (`FLOFI_WALLET_REJECTED`).
 * - Lock state: FloFi Wallet's `locked`/`unlocked` notices are kept so Execute can ask for an unlock before Authorize (spec §9).
 * Nothing here signs, decodes or broadcasts; FloFi Wallet shows and signs, the server binds every signature to a reviewed attempt.
 */
import { isWalletNotice, parseWalletResponse, WALLET_PROTOCOL, type WalletOperation, type WalletResult } from '../wallet-app/protocol';
import { parseSigningContext, type SigningContext } from './flofi-signing';

export type FloFiWalletRequest = WalletOperation & { readonly signing?: SigningContext };
export type FloFiWalletLock = 'unknown' | 'locked' | 'unlocked';
export type FloFiWalletConfig = { readonly walletOrigin: string;
  /** Mints a single-use handoff for the current account session (`floFiWalletHandoff`). */
  readonly handoff: () => Promise<{ ok: true; value: { readonly token: string } } | { ok: false; code: string }> };
export type FloFiWalletSnapshot = { readonly configured: boolean; readonly open: boolean; readonly ready: boolean; readonly lock: FloFiWalletLock;
  /** A request waiting for the person to open FloFi Wallet (the Continue button), and what it is for. */
  readonly waiting: { readonly op: FloFiWalletRequest['op'] } | null;
  /** A request FloFi Wallet is handling (or about to receive). */
  readonly pending: boolean; readonly error: string | null };
type Settle = { resolve(result: WalletResult): void; reject(error: Error): void };
type Pending = Settle & { readonly id: string; readonly request: FloFiWalletRequest; sent: boolean; timer: ReturnType<typeof setTimeout> | null };
type Waiting = Settle & { readonly request: FloFiWalletRequest };

/** How long a request may wait for FloFi Wallet to load, take the handoff and report its lock state. */
export const FLOFI_WALLET_READY_TIMEOUT_MS = 45_000;
const POLL_MS = 500;
const SIGNING_OPS: ReadonlySet<string> = new Set(['evm_sign_transaction', 'solana_sign_transaction']);
const state = {
  config: null as FloFiWalletConfig | null, popup: null as Window | null, ready: false, lock: 'unknown' as FloFiWalletLock,
  pending: null as Pending | null, waiting: null as Waiting | null, error: null as string | null,
  watcher: null as ReturnType<typeof setInterval> | null, listening: false, generation: 0,
};
const listeners = new Set<() => void>();
let snapshot: FloFiWalletSnapshot = { configured: false, open: false, ready: false, lock: 'unknown', waiting: null, pending: false, error: null };
/** Managed addresses the FloFi Wallet providers are connected with on this page (for `usesFloFiWallet`). */
const accounts = new Set<string>();

function randomId(bytes = 16): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const isOpen = () => Boolean(state.popup && !state.popup.closed);
function notify(): void {
  snapshot = { configured: state.config !== null, open: isOpen(), ready: state.ready, lock: state.lock,
    waiting: state.waiting ? { op: state.waiting.request.op } : null, pending: state.pending !== null, error: state.error };
  for (const listener of [...listeners]) { try { listener(); } catch { /* a listener never breaks the channel */ } }
}
function settle(pending: Pending, outcome: { result: WalletResult } | { code: string }): void {
  if (state.pending !== pending) return;
  state.pending = null;
  if (pending.timer) clearTimeout(pending.timer);
  if ('result' in outcome) pending.resolve(outcome.result); else pending.reject(new Error(outcome.code));
  notify();
}
/** Sends the pending request once FloFi Wallet holds this page's handoff and has reported its lock state for it. */
function flush(): void {
  const pending = state.pending, popup = state.popup, config = state.config;
  if (!pending || pending.sent || !popup || popup.closed || !config || !state.ready || state.lock === 'unknown') return;
  pending.sent = true;
  if (pending.timer) { clearTimeout(pending.timer); pending.timer = null; }
  try { popup.postMessage({ protocol: WALLET_PROTOCOL, type: 'request', id: pending.id, request: pending.request }, config.walletOrigin); }
  catch { settle(pending, { code: 'FLOFI_WALLET_CLOSED' }); }
}
async function deliverHandoff(popup: Window, generation: number): Promise<void> {
  const config = state.config;
  if (!config) return;
  const handoff = await config.handoff().catch(() => ({ ok: false as const, code: 'FLOFI_WALLET_UNAVAILABLE' }));
  if (state.popup !== popup || state.generation !== generation || popup.closed) return;
  if (!handoff.ok) {
    state.error = /^[A-Z][A-Z0-9_]{2,80}$/.test(handoff.code) ? handoff.code : 'FLOFI_WALLET_UNAVAILABLE';
    // Nothing was sent: the request fails before FloFi Wallet could show it.
    if (state.pending && !state.pending.sent) settle(state.pending, { code: state.error });
    notify();
    return;
  }
  try { popup.postMessage({ protocol: WALLET_PROTOCOL, type: 'handoff', token: handoff.value.token }, config.walletOrigin); }
  catch { return; }
  state.ready = true; state.error = null;
  flush(); notify();
}
function onMessage(event: MessageEvent): void {
  const config = state.config, popup = state.popup;
  // Only the window this page opened, on the configured wallet origin; anything else is ignored without a reply.
  if (!config || !popup || event.origin !== config.walletOrigin || event.source !== popup) return;
  const data: unknown = event.data;
  if (isWalletNotice(data)) {
    if (data.type === 'ready') {
      // A new FloFi Wallet page (first load or reload): it holds no session from this page yet, and forgot any request it had.
      state.ready = false; state.lock = 'unknown'; state.generation += 1;
      if (state.pending?.sent) settle(state.pending, { code: 'FLOFI_WALLET_CLOSED' });
      void deliverHandoff(popup, state.generation);
    } else if (data.type === 'locked' || data.type === 'unlocked') { state.lock = data.type; flush(); }
    notify();
    return;
  }
  const response = parseWalletResponse(data), pending = state.pending;
  if (!response || !pending || !pending.sent || response.id !== pending.id) return;
  settle(pending, response.ok ? { result: response.result } : { code: response.code });
}
function watch(): void {
  if (state.watcher !== null) return;
  state.watcher = setInterval(() => {
    if (isOpen()) return;
    clearInterval(state.watcher!); state.watcher = null;
    state.popup = null; state.ready = false; state.lock = 'unknown';
    const pending = state.pending;
    if (pending && pending.sent) settle(pending, { code: 'FLOFI_WALLET_CLOSED' });
    else if (pending) {
      // FloFi Wallet never received it: it waits for the person to open FloFi Wallet again (or to cancel).
      state.pending = null;
      if (pending.timer) clearTimeout(pending.timer);
      state.waiting = { request: pending.request, resolve: pending.resolve, reject: pending.reject };
    }
    notify();
  }, POLL_MS);
}
function listen(): void {
  if (state.listening || typeof window === 'undefined') return;
  state.listening = true;
  window.addEventListener('message', onMessage as EventListener);
}
function start(request: FloFiWalletRequest, callbacks: Settle): void {
  const pending: Pending = { id: randomId(), request, sent: false, timer: null, ...callbacks };
  pending.timer = setTimeout(() => { if (!pending.sent) settle(pending, { code: 'FLOFI_WALLET_UNAVAILABLE' }); }, FLOFI_WALLET_READY_TIMEOUT_MS);
  state.pending = pending;
  flush(); notify();
}
/** The request exactly as protocol.ts accepts it: a binding only on transaction requests, which require one. */
function normalize(request: FloFiWalletRequest): FloFiWalletRequest | string {
  if (!request || typeof request !== 'object' || typeof request.op !== 'string') return 'FLOFI_WALLET_REQUEST_INVALID';
  const { signing, ...operation } = request;
  if (!SIGNING_OPS.has(request.op)) return operation as FloFiWalletRequest;
  const binding = parseSigningContext(signing);
  return binding ? { ...operation, signing: binding } as FloFiWalletRequest : 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED';
}

/** Where FloFi Wallet lives and how to mint a handoff; `null` makes FloFi Wallet unavailable on this page. */
export function configureFloFiWallet(config: FloFiWalletConfig | null): void {
  const origin = config ? (() => { try { return new URL(config.walletOrigin).origin; } catch { return null; } })() : null;
  if (config && origin !== config.walletOrigin) config = null;
  if (state.config?.walletOrigin === config?.walletOrigin && state.config?.handoff === config?.handoff) return;
  state.config = config;
  if (!config) {
    state.waiting?.reject(new Error('FLOFI_WALLET_UNAVAILABLE')); state.waiting = null;
    if (state.pending) settle(state.pending, { code: state.pending.sent ? 'FLOFI_WALLET_CLOSED' : 'FLOFI_WALLET_UNAVAILABLE' });
  }
  notify();
}
/**
 * Opens FloFi Wallet, or focuses it when it is already open. Synchronous: call it only inside the person's click handler, before any await.
 * A request waiting for FloFi Wallet is handed to it. Throws `FLOFI_WALLET_UNAVAILABLE` or `FLOFI_WALLET_POPUP_BLOCKED`.
 */
export function openFloFiWallet(): void {
  const config = state.config;
  if (!config || typeof window === 'undefined') throw new Error('FLOFI_WALLET_UNAVAILABLE');
  listen();
  if (!isOpen()) {
    const popup = window.open(`${config.walletOrigin}/wallet`, `flofi-wallet-${randomId(12).replace(/[^A-Za-z0-9]/g, '')}`, 'popup,width=440,height=760');
    if (!popup) { state.error = 'FLOFI_WALLET_POPUP_BLOCKED'; notify(); throw new Error('FLOFI_WALLET_POPUP_BLOCKED'); }
    state.popup = popup; state.ready = false; state.lock = 'unknown'; state.error = null; state.generation += 1;
    watch();
  } else {
    try { state.popup!.focus(); } catch { /* focusing is best effort; the window stays open */ }
    // A window that is locked, lost its session or never finished its handoff is bound again from this click: a fresh single-use
    // handoff (the same account session keeps a live unlock; another one starts locked). Requests wait until it has been sent.
    if (!state.ready || state.lock !== 'unlocked') { state.ready = false; state.generation += 1; void deliverHandoff(state.popup!, state.generation); }
  }
  const waiting = state.waiting;
  if (waiting && !state.pending) { state.waiting = null; start(waiting.request, waiting); }
  notify();
}
/**
 * One request to the open FloFi Wallet. Rejects with `Error(code)`: `FLOFI_WALLET_NOT_OPEN` when no FloFi Wallet window is open (call
 * `openFloFiWallet()` in the click first), `FLOFI_WALLET_BUSY` while another request is open, or FloFi Wallet's own code.
 */
export function requestFloFiWallet(request: FloFiWalletRequest): Promise<WalletResult> {
  return new Promise<WalletResult>((resolve, reject) => {
    const normalized = normalize(request);
    if (typeof normalized === 'string') return reject(new Error(normalized));
    if (!state.config) return reject(new Error('FLOFI_WALLET_UNAVAILABLE'));
    if (!isOpen()) return reject(new Error('FLOFI_WALLET_NOT_OPEN'));
    if (state.pending || state.waiting) return reject(new Error('FLOFI_WALLET_BUSY'));
    start(normalized, { resolve, reject });
  });
}
/**
 * For the FloFi Wallet providers, whose requests arrive without a gesture: sent at once when FloFi Wallet is open, otherwise held until the
 * person chooses "Continue in FloFi Wallet" (`continueInFloFiWallet`) or Cancel (`cancelFloFiWalletRequest`).
 */
export function requestThroughFloFiWallet(request: FloFiWalletRequest): Promise<WalletResult> {
  if (isOpen() || !state.config) return requestFloFiWallet(request);
  return new Promise<WalletResult>((resolve, reject) => {
    const normalized = normalize(request);
    if (typeof normalized === 'string') return reject(new Error(normalized));
    if (state.pending || state.waiting) return reject(new Error('FLOFI_WALLET_BUSY'));
    state.waiting = { request: normalized, resolve, reject };
    notify();
  });
}
/** The "Continue in FloFi Wallet" gesture: opens (or focuses) FloFi Wallet and hands it the waiting request. */
export function continueInFloFiWallet(): void { if (state.waiting) openFloFiWallet(); }
/** Cancel, before FloFi Wallet received the request: the person declined before Sign (`FLOFI_WALLET_REJECTED`). */
export function cancelFloFiWalletRequest(): void {
  const waiting = state.waiting, pending = state.pending;
  if (waiting) { state.waiting = null; waiting.reject(new Error('FLOFI_WALLET_REJECTED')); notify(); return; }
  if (pending && !pending.sent) settle(pending, { code: 'FLOFI_WALLET_REJECTED' });
}
export function floFiWalletSnapshot(): FloFiWalletSnapshot { return snapshot; }
export function subscribeFloFiWallet(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Records that a FloFi Wallet provider is (or is no longer) connected with `address` on this page. */
export function markFloFiAccount(address: string, connected: boolean): void {
  if (connected) accounts.add(address); else accounts.delete(address);
  notify();
}
/** Whether `account` (the wallet an execution will use) is a FloFi Wallet address connected on this page: its requests need FloFi Wallet open. */
export function usesFloFiWallet(account: string | null | undefined): boolean {
  return typeof account === 'string' && (accounts.has(account) || accounts.has(account.toLowerCase()));
}

/** How long a signing context set right before a send stays valid (it is consumed by that send). */
export const FLOFI_SIGNING_CONTEXT_TTL_MS = 120_000;
const targets = new WeakSet<object>();
const contexts = new WeakMap<object, { readonly context: SigningContext; readonly at: number }>();
/** Marks an object as a FloFi Wallet provider (EIP-1193 provider or Wallet Standard wallet) that accepts a signing context. */
export function registerFloFiSigningTarget(target: object): void { targets.add(target); }
export const isFloFiSigningTarget = (target: unknown): boolean => Boolean(target && typeof target === 'object' && targets.has(target as object));
/**
 * Names the reviewed run the NEXT transaction request to `target` belongs to. A store calls it right before its single send/sign call;
 * for any other wallet it does nothing. The context grants nothing: FloFi Wallet's server resolves and checks it.
 */
export function bindFloFiSigning(target: unknown, context: SigningContext | null): void {
  if (!isFloFiSigningTarget(target)) return;
  const parsed = parseSigningContext(context);
  if (parsed) contexts.set(target as object, { context: parsed, at: Date.now() }); else contexts.delete(target as object);
}
/** The context bound to `target` for this request (consumed: one send per binding), or null. */
export function takeFloFiSigning(target: object): SigningContext | null {
  const entry = contexts.get(target);
  contexts.delete(target);
  return entry && Date.now() - entry.at <= FLOFI_SIGNING_CONTEXT_TTL_MS ? entry.context : null;
}

