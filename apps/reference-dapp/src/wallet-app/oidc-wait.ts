// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: waiting for a Google/Apple unlock that finishes in another window (feasibility review F7).
 *
 * The sign-in runs in a child window; the provider's pages may cut the window relationship (cross-origin opener policy), so FloFi
 * Wallet neither reads that window nor waits for it to close. It asks its own server once a second, for at most three minutes, whether
 * the session is unlocked, and also re-asks at once when the result page (or another wallet window) posts a notice. Only the server's
 * answer unlocks; an error notice ends the wait with that code (the person can start again).
 */
import type { BroadcastNotice } from './channel';

export const OIDC_POLL_MS = 1_000;
export const OIDC_TIMEOUT_MS = 3 * 60_000;
export type UnlockWait = { readonly ok: true } | { readonly ok: false; readonly code: string };

export function waitForUnlock(input: {
  /** Whether the server now reports this wallet session unlocked (a failure counts as "not yet"). */
  readonly check: () => Promise<boolean>;
  readonly subscribe: (listener: (notice: BroadcastNotice) => void) => () => void;
  readonly signal?: AbortSignal; readonly intervalMs?: number; readonly timeoutMs?: number;
}): Promise<UnlockWait> {
  const interval = input.intervalMs ?? OIDC_POLL_MS, timeout = input.timeoutMs ?? OIDC_TIMEOUT_MS;
  return new Promise(resolve => {
    let done = false, checking = false, again = false, unsubscribe = () => {};
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (result: UnlockWait) => {
      if (done) return;
      done = true; timers.forEach(clearTimeout); unsubscribe(); input.signal?.removeEventListener('abort', abort); resolve(result);
    };
    const check = async () => {
      if (done) return;
      if (checking) { again = true; return; }
      checking = true;
      const unlocked = await input.check().catch(() => false);
      checking = false;
      if (unlocked) finish({ ok: true });
      else if (again) { again = false; void check(); }
    };
    const tick = () => { if (done) return; void check(); timers.push(setTimeout(tick, interval)); };
    const abort = () => finish({ ok: false, code: 'OIDC_CANCELLED' });
    if (input.signal?.aborted) { abort(); return; }
    unsubscribe = input.subscribe(notice => {
      if (notice.type === 'error') {
        // Confirm with the server first: a stale error notice never overrides a session that did unlock.
        void input.check().catch(() => false).then(unlocked => finish(unlocked ? { ok: true } : { ok: false, code: notice.code }));
      } else if (notice.type === 'unlocked') void check();
    });
    input.signal?.addEventListener('abort', abort);
    timers.push(setTimeout(() => finish({ ok: false, code: 'FLOFI_WALLET_UNLOCK_TIMEOUT' }), timeout));
    timers.push(setTimeout(tick, interval));
  });
}
