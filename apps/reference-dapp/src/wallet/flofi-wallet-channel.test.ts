// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: the product page opens FloFi Wallet only in a click, hands it the account by postMessage after it is ready,
// talks only to that window on the wallet origin, one request at a time, and never turns a doubtful outcome into a refusal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_PROTOCOL } from '../wallet-app/protocol';

const WALLET = 'https://wallet.flofi.test', TOKEN = 'h1.' + 'a'.repeat(40) + '.' + 'b'.repeat(43);
const ADDRESS = '0x' + '1'.repeat(40), SIGNING = { flow: 'base-swap', runId: 'bas-' + 'a'.repeat(24) };
const TX = { from: ADDRESS, to: '0x' + '2'.repeat(40), value: '0x0', data: '0x', chainId: '0x2105', nonce: '0x7', gas: '0x5208', maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1' };
type Popup = { closed: boolean; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
let target: EventTarget & { open: ReturnType<typeof vi.fn> }, popups: Popup[];

async function load() {
  vi.resetModules();
  popups = [];
  target = Object.assign(new EventTarget(), { open: vi.fn((): Popup | null => { const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() }; popups.push(popup); return popup; }) });
  Object.assign(target, { top: target, self: target });
  vi.stubGlobal('window', target);
  const channel = await import('./flofi-wallet-channel');
  const handoff = vi.fn(async () => ({ ok: true as const, value: { token: TOKEN } }));
  return { ...channel, handoff, configure: () => channel.configureFloFiWallet({ walletOrigin: WALLET, handoff }) };
}
function post(data: unknown, source: unknown = popups.at(-1), origin = WALLET) {
  const event = new Event('message');
  Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
  target.dispatchEvent(event);
}
const notice = (type: string) => ({ protocol: WALLET_PROTOCOL, type });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
/** Opens FloFi Wallet and completes the handshake: ready → handoff → lock notice. */
async function ready(api: Awaited<ReturnType<typeof load>>, lock: 'locked' | 'unlocked' = 'unlocked') {
  api.openFloFiWallet(); post(notice('ready')); await flush(); post(notice(lock));
}
const sentRequest = (popup = popups.at(-1)!) => popup.postMessage.mock.calls.map(call => call[0]).find(message => message.type === 'request');
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('opening FloFi Wallet', () => {
  it('is unavailable until configured, then opens the wallet origin under a fresh random name and focuses an open window', async () => {
    const api = await load();
    expect(() => api.openFloFiWallet()).toThrow('FLOFI_WALLET_UNAVAILABLE');
    api.configure();
    api.openFloFiWallet();
    expect(target.open).toHaveBeenCalledWith(`${WALLET}/wallet`, expect.stringMatching(/^flofi-wallet-[A-Za-z0-9]{8,}$/), 'popup,width=440,height=760');
    api.openFloFiWallet();
    expect(target.open).toHaveBeenCalledTimes(1);
    expect(popups[0]!.focus).toHaveBeenCalledTimes(1);
    popups[0]!.closed = true;
    api.openFloFiWallet();
    expect(target.open.mock.calls[1]![1]).not.toBe(target.open.mock.calls[0]![1]);
  });
  it('reports a blocked pop-up', async () => {
    const api = await load(); api.configure();
    target.open.mockReturnValueOnce(null);
    expect(() => api.openFloFiWallet()).toThrow('FLOFI_WALLET_POPUP_BLOCKED');
    expect(api.floFiWalletSnapshot().error).toBe('FLOFI_WALLET_POPUP_BLOCKED');
  });
  it('rejects a configuration whose origin is not exactly an origin', async () => {
    const api = await load();
    api.configureFloFiWallet({ walletOrigin: `${WALLET}/path`, handoff: async () => ({ ok: false, code: 'X' }) });
    expect(api.floFiWalletSnapshot().configured).toBe(false);
  });
});

describe('account handoff', () => {
  it('posts the single-use handoff only after the opened window says ready, to the wallet origin only', async () => {
    const api = await load(); api.configure(); api.openFloFiWallet();
    const popup = popups[0]!;
    post(notice('ready'), {}); post(notice('ready'), popup, 'https://evil.example'); await flush();
    expect(api.handoff).not.toHaveBeenCalled();
    post(notice('ready'), popup); await flush();
    expect(api.handoff).toHaveBeenCalledTimes(1);
    expect(popup.postMessage).toHaveBeenCalledWith({ protocol: WALLET_PROTOCOL, type: 'handoff', token: TOKEN }, WALLET);
    expect(api.floFiWalletSnapshot()).toMatchObject({ open: true, ready: true, lock: 'unknown' });
    post(notice('locked'), popup);
    expect(api.floFiWalletSnapshot().lock).toBe('locked');
    post(notice('unlocked'), popup);
    expect(api.floFiWalletSnapshot().lock).toBe('unlocked');
  });
  it('fails a waiting request with the server’s code when no handoff can be minted', async () => {
    const api = await load();
    api.configureFloFiWallet({ walletOrigin: WALLET, handoff: async () => ({ ok: false, code: 'FLOFI_WALLET_ACCOUNT_REQUIRED' }) });
    api.openFloFiWallet();
    const result = api.requestFloFiWallet({ op: 'connect' }).catch((error: Error) => error.message);
    post(notice('ready')); await flush();
    expect(await result).toBe('FLOFI_WALLET_ACCOUNT_REQUIRED');
    expect(popups[0]!.postMessage).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('requires an open window, sends after the handshake, and resolves only with the matching answer from that window', async () => {
    const api = await load(); api.configure();
    await expect(api.requestFloFiWallet({ op: 'connect' })).rejects.toThrow('FLOFI_WALLET_NOT_OPEN');
    api.openFloFiWallet();
    const result = api.requestFloFiWallet({ op: 'evm_sign_transaction', address: ADDRESS, tx: TX, signing: SIGNING });
    expect(sentRequest()).toBeUndefined();
    post(notice('ready')); await flush();
    expect(sentRequest()).toBeUndefined();
    post(notice('unlocked'));
    const sent = sentRequest();
    expect(sent).toEqual({ protocol: WALLET_PROTOCOL, type: 'request', id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
      request: { op: 'evm_sign_transaction', address: ADDRESS, tx: TX, signing: SIGNING } });
    expect(popups[0]!.postMessage.mock.calls.find(call => call[0].type === 'request')![1]).toBe(WALLET);
    post({ protocol: WALLET_PROTOCOL, type: 'response', id: 'otherrequest', ok: true, result: { signedTransaction: '0x02' } });
    post({ protocol: WALLET_PROTOCOL, type: 'response', id: sent.id, ok: true, result: { signedTransaction: '0x02ff' } }, {});
    post({ protocol: WALLET_PROTOCOL, type: 'response', id: sent.id, ok: true, result: { signedTransaction: '0x02aa' } });
    await expect(result).resolves.toEqual({ signedTransaction: '0x02aa' });
  });
  it('refuses a transaction request without its reviewed run, strips a binding from other requests, and allows one request at a time', async () => {
    const api = await load(); api.configure(); await ready(api);
    await expect(api.requestFloFiWallet({ op: 'evm_sign_transaction', address: ADDRESS, tx: TX })).rejects.toThrow('FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED');
    const first = api.requestFloFiWallet({ op: 'connect', signing: SIGNING } as never);
    expect(sentRequest().request).toEqual({ op: 'connect' });
    await expect(api.requestFloFiWallet({ op: 'manage' })).rejects.toThrow('FLOFI_WALLET_BUSY');
    post({ protocol: WALLET_PROTOCOL, type: 'response', id: sentRequest().id, ok: false, code: 'FLOFI_WALLET_REJECTED' });
    await expect(first).rejects.toThrow('FLOFI_WALLET_REJECTED');
  });
  it('treats a window closed or reloaded after it received the request as an unknown outcome, never a cancel', async () => {
    const api = await load(); api.configure(); await ready(api);
    const closed = api.requestFloFiWallet({ op: 'solana_sign_message', address: '7'.repeat(43), message: 'hi' });
    popups[0]!.closed = true; vi.advanceTimersByTime(600);
    await expect(closed).rejects.toThrow('FLOFI_WALLET_CLOSED');
    await ready(api);
    const reloaded = api.requestFloFiWallet({ op: 'connect' });
    post(notice('ready')); await flush();
    await expect(reloaded).rejects.toThrow('FLOFI_WALLET_CLOSED');
  });
  it('fails closed when FloFi Wallet never becomes ready', async () => {
    const api = await load(); api.configure(); api.openFloFiWallet();
    const result = api.requestFloFiWallet({ op: 'connect' });
    vi.advanceTimersByTime(api.FLOFI_WALLET_READY_TIMEOUT_MS + 1);
    await expect(result).rejects.toThrow('FLOFI_WALLET_UNAVAILABLE');
  });
});

describe('Continue in FloFi Wallet', () => {
  it('holds a provider request while FloFi Wallet is closed, sends it after the Continue click, and treats Cancel as a decline before Sign', async () => {
    const api = await load(); api.configure();
    const result = api.requestThroughFloFiWallet({ op: 'evm_sign_message', address: ADDRESS, message: 'hello' });
    expect(api.floFiWalletSnapshot().waiting).toEqual({ op: 'evm_sign_message' });
    expect(target.open).not.toHaveBeenCalled();
    api.continueInFloFiWallet();
    expect(target.open).toHaveBeenCalledTimes(1);
    expect(api.floFiWalletSnapshot()).toMatchObject({ waiting: null, pending: true });
    post(notice('ready')); await flush(); post(notice('locked'));
    post({ protocol: WALLET_PROTOCOL, type: 'response', id: sentRequest().id, ok: true, result: { signature: '0x' + 'a'.repeat(130) } });
    await expect(result).resolves.toEqual({ signature: '0x' + 'a'.repeat(130) });
    popups[0]!.closed = true; vi.advanceTimersByTime(600);
    const cancelled = api.requestThroughFloFiWallet({ op: 'evm_sign_message', address: ADDRESS, message: 'again' });
    api.cancelFloFiWalletRequest();
    await expect(cancelled).rejects.toThrow('FLOFI_WALLET_REJECTED');
  });
  it('returns a request FloFi Wallet never received to the Continue prompt when its window closes', async () => {
    const api = await load(); api.configure(); api.openFloFiWallet();
    const result = api.requestFloFiWallet({ op: 'connect' });
    popups[0]!.closed = true; vi.advanceTimersByTime(600);
    expect(api.floFiWalletSnapshot().waiting).toEqual({ op: 'connect' });
    api.cancelFloFiWalletRequest();
    await expect(result).rejects.toThrow('FLOFI_WALLET_REJECTED');
  });
  it('notifies subscribers of every change', async () => {
    const api = await load(), listener = vi.fn();
    const stop = api.subscribeFloFiWallet(listener);
    api.configure();
    expect(listener).toHaveBeenCalled();
    stop(); listener.mockClear(); api.openFloFiWallet();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('signing context and FloFi accounts', () => {
  it('binds a reviewed run only to FloFi Wallet providers, once, for a short time', async () => {
    const api = await load(), provider = {}, other = {};
    api.registerFloFiSigningTarget(provider);
    api.bindFloFiSigning(other, SIGNING); api.bindFloFiSigning(provider, SIGNING);
    expect(api.takeFloFiSigning(other)).toBeNull();
    expect(api.takeFloFiSigning(provider)).toEqual(SIGNING);
    expect(api.takeFloFiSigning(provider)).toBeNull();
    api.bindFloFiSigning(provider, SIGNING); vi.advanceTimersByTime(api.FLOFI_SIGNING_CONTEXT_TTL_MS + 1);
    expect(api.takeFloFiSigning(provider)).toBeNull();
    api.bindFloFiSigning(provider, { flow: 'BAD', runId: 'x' });
    expect(api.takeFloFiSigning(provider)).toBeNull();
  });
  it('knows which connected addresses are FloFi Wallet addresses', async () => {
    const api = await load();
    expect(api.usesFloFiWallet(ADDRESS)).toBe(false);
    api.markFloFiAccount(ADDRESS, true);
    expect(api.usesFloFiWallet(ADDRESS.toUpperCase().replace('0X', '0x'))).toBe(true);
    api.markFloFiAccount(ADDRESS, false);
    expect(api.usesFloFiWallet(ADDRESS)).toBe(false);
    expect(api.usesFloFiWallet(null)).toBe(false);
  });
});
