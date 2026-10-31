// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet hears only its opener at the product origin, answers only to the product origin, and treats
// notices from other wallet windows as strictly shaped hints.
import { describe, expect, it, vi } from 'vitest';
import { classifyOpenerMessage, errorResponse, notice, okResponse, parseBroadcast, postToOpener } from './channel';
import { WALLET_PROTOCOL } from './protocol';

const APP = 'https://flofi.xyz', opener = { postMessage: vi.fn() };
const handoff = { protocol: WALLET_PROTOCOL, type: 'handoff', token: `h1.${'a'.repeat(40)}.${'b'.repeat(43)}` };
const request = { protocol: WALLET_PROTOCOL, type: 'request', id: 'req_12345678', request: { op: 'connect' } };
const event = (data: unknown, patch: Partial<{ source: unknown; origin: string }> = {}) => ({ source: opener, origin: APP, data, ...patch });

describe('the opener channel', () => {
  it('accepts a handoff and requests from the opener at the exact product origin', () => {
    expect(classifyOpenerMessage(event(handoff), opener, APP)).toEqual({ kind: 'handoff', handoff });
    expect(classifyOpenerMessage(event(request), opener, APP)).toEqual({ kind: 'request', request });
  });
  it('ignores other windows, other origins, a missing opener and foreign data', () => {
    expect(classifyOpenerMessage(event(handoff, { source: {} }), opener, APP)).toBeNull();
    expect(classifyOpenerMessage(event(handoff, { origin: 'https://wallet.flofi.xyz' }), opener, APP)).toBeNull();
    expect(classifyOpenerMessage(event(handoff, { origin: 'https://evil.example' }), opener, APP)).toBeNull();
    expect(classifyOpenerMessage(event(handoff, { origin: 'https://flofi.xyz.evil.example' }), opener, APP)).toBeNull();
    expect(classifyOpenerMessage(event(handoff, { source: null }), null, APP)).toBeNull();
    expect(classifyOpenerMessage(event({ type: 'handoff', token: handoff.token }), opener, APP)).toBeNull();
    expect(classifyOpenerMessage(event('hello'), opener, APP)).toBeNull();
  });
  it('refuses a malformed request explicitly when it names an id, so the product page never waits forever', () => {
    expect(classifyOpenerMessage(event({ ...request, request: { op: 'drain' } }), opener, APP)).toEqual({ kind: 'invalid-request', id: 'req_12345678' });
    expect(classifyOpenerMessage(event({ ...request, id: 'x' }), opener, APP)).toBeNull();
  });
  it('answers only with the product origin as target', () => {
    expect(postToOpener(opener, APP, okResponse('req_12345678', { done: true }))).toBe(true);
    expect(opener.postMessage).toHaveBeenLastCalledWith({ protocol: WALLET_PROTOCOL, type: 'response', id: 'req_12345678', ok: true, result: { done: true } }, APP);
    postToOpener(opener, APP, notice('locked'));
    expect(opener.postMessage).toHaveBeenLastCalledWith({ protocol: WALLET_PROTOCOL, type: 'locked' }, APP);
    expect(postToOpener(null, APP, notice('ready'))).toBe(false);
    expect(postToOpener({ postMessage: () => { throw new Error('closed'); } }, APP, notice('ready'))).toBe(false);
    expect(errorResponse('req_12345678', 'not a code')).toMatchObject({ ok: false, code: 'FLOFI_WALLET_SIGNATURE_UNKNOWN' });
    expect(errorResponse('req_12345678', 'FLOFI_WALLET_REJECTED')).toMatchObject({ ok: false, code: 'FLOFI_WALLET_REJECTED' });
  });
});

describe('notices between FloFi Wallet windows', () => {
  it('parses only exact shapes', () => {
    expect(parseBroadcast({ type: 'unlocked' })).toEqual({ type: 'unlocked' });
    expect(parseBroadcast({ type: 'locked' })).toEqual({ type: 'locked' });
    expect(parseBroadcast({ type: 'error', code: 'OIDC_CANCELLED' })).toEqual({ type: 'error', code: 'OIDC_CANCELLED' });
    expect(parseBroadcast({ type: 'account', accountId: `acct_${'0'.repeat(32)}` })).toEqual({ type: 'account', accountId: `acct_${'0'.repeat(32)}` });
    for (const bad of [null, 'unlocked', { type: 'unlocked', key: '02' }, { type: 'error', code: '<b>' }, { type: 'account', accountId: 'x' }, { type: 'sign' }])
      expect(parseBroadcast(bad)).toBeNull();
  });
});
