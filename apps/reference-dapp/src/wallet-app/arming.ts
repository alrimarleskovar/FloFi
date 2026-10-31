// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: when FloFi Wallet's Sign button may be pressed (spec decision 8, security review finding 7).
 *
 * The product page holds this window's handle and can bring it forward at a moment it chooses, so the second click of a double-click
 * on the product page could land on Sign for a request posted a moment earlier. Sign therefore arms only after the request has been on
 * screen in a visible, focused window for a full second, and disarms the instant the window loses focus or is hidden; it re-arms only
 * after another full second of attention. A new request starts the count again.
 */
import { useEffect, useState } from 'react';

export const ARMING_DELAY_MS = 1_000;
/** `since`: when the current request last became visible in a focused window (null while it is not). */
export type ArmingState = { readonly since: number | null };
export type Attention = { readonly visible: boolean; readonly focused: boolean };

export const arming = (previous: ArmingState, attention: Attention, now: number): ArmingState =>
  attention.visible && attention.focused ? { since: previous.since ?? now } : { since: null };
export const isArmed = (state: ArmingState, now: number, delay = ARMING_DELAY_MS): boolean => state.since !== null && now - state.since >= delay;

/** `{armed, attentive}` for the request named by `key` (null: nothing to sign). `attentive`: counting towards arming. */
export function useSignArming(key: string | null): { readonly armed: boolean; readonly attentive: boolean } {
  const [value, setValue] = useState({ armed: false, attentive: false });
  useEffect(() => {
    setValue({ armed: false, attentive: false });
    if (!key) return;
    let state: ArmingState = { since: null }, timer: ReturnType<typeof setTimeout> | undefined;
    const attention = (): Attention => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus() });
    const schedule = () => {
      clearTimeout(timer);
      if (state.since === null) { setValue({ armed: false, attentive: false }); return; }
      const now = performance.now();
      if (isArmed(state, now)) { setValue({ armed: true, attentive: true }); return; }
      setValue({ armed: false, attentive: true });
      timer = setTimeout(schedule, ARMING_DELAY_MS - (now - state.since));
    };
    const update = () => { state = arming(state, attention(), performance.now()); schedule(); };
    // Any loss of attention restarts the count from zero, even if focus comes straight back.
    const lose = () => { state = { since: null }; schedule(); };
    const visibility = () => { if (document.visibilityState !== 'visible') lose(); else update(); };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', lose);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', lose);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [key]);
  return value;
}
