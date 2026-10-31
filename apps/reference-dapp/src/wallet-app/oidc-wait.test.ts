// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: a Google/Apple unlock is complete only when FloFi Wallet's own server says so; notices only speed it up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BroadcastNotice } from './channel';
import { OIDC_TIMEOUT_MS, waitForUnlock } from './oidc-wait';

function channel() {
  let listener: ((notice: BroadcastNotice) => void) | null = null;
  return { subscribe: (next: (notice: BroadcastNotice) => void) => { listener = next; return () => { listener = null; }; },
    post: (notice: BroadcastNotice) => listener?.(notice), get open() { return listener !== null; } };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('waiting for a Google/Apple unlock', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('polls the session every second until the server reports it unlocked', async () => {
    let calls = 0;
    const bus = channel(), check = vi.fn(async () => ++calls >= 3);
    const result = waitForUnlock({ check, subscribe: bus.subscribe });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: true });
    expect(bus.open).toBe(false);
  });
  it('re-checks at once on an unlocked notice, but a notice alone never unlocks', async () => {
    let unlocked = false;
    const bus = channel(), check = vi.fn(async () => unlocked);
    const result = waitForUnlock({ check, subscribe: bus.subscribe });
    bus.post({ type: 'unlocked' });
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    unlocked = true;
    bus.post({ type: 'unlocked' });
    await expect(result).resolves.toEqual({ ok: true });
  });
  it('ends with the error code of the result page unless the server says the session did unlock', async () => {
    const bus = channel();
    const failed = waitForUnlock({ check: async () => false, subscribe: bus.subscribe });
    bus.post({ type: 'error', code: 'WALLET_UNLOCK_IDENTITY_MISMATCH' });
    await expect(failed).resolves.toEqual({ ok: false, code: 'WALLET_UNLOCK_IDENTITY_MISMATCH' });
    const other = channel();
    const succeeded = waitForUnlock({ check: async () => true, subscribe: other.subscribe });
    other.post({ type: 'error', code: 'OIDC_CANCELLED' });
    await expect(succeeded).resolves.toEqual({ ok: true });
  });
  it('gives up after three minutes, counts a failed check as not yet, and stops on cancel', async () => {
    const bus = channel(), check = vi.fn(async () => { throw new Error('offline'); });
    const result = waitForUnlock({ check, subscribe: bus.subscribe });
    await vi.advanceTimersByTimeAsync(OIDC_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ ok: false, code: 'FLOFI_WALLET_UNLOCK_TIMEOUT' });
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(179);
    const controller = new AbortController(), cancelled = waitForUnlock({ check: async () => false, subscribe: channel().subscribe, signal: controller.signal });
    controller.abort();
    await expect(cancelled).resolves.toEqual({ ok: false, code: 'OIDC_CANCELLED' });
    const before = new AbortController(); before.abort();
    await expect(waitForUnlock({ check: async () => true, subscribe: channel().subscribe, signal: before.signal })).resolves.toEqual({ ok: false, code: 'OIDC_CANCELLED' });
  });
});
