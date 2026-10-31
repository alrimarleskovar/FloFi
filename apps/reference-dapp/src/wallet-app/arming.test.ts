// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: Sign arms only after one full second of a visible, focused window, disarms on any loss of attention and
// counts again from zero; a new request starts over.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookHarness } from '../test-utils/hook-harness';
import { arming, isArmed, useSignArming } from './arming';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));

describe('arming rule', () => {
  it('counts from the moment of attention and restarts after any loss of it', () => {
    let state = arming({ since: null }, { visible: true, focused: true }, 100);
    expect(state).toEqual({ since: 100 });
    expect(isArmed(state, 1_099)).toBe(false);
    expect(isArmed(state, 1_100)).toBe(true);
    state = arming(state, { visible: true, focused: true }, 1_500);
    expect(state).toEqual({ since: 100 });
    state = arming(state, { visible: true, focused: false }, 1_600);
    expect(state).toEqual({ since: null });
    expect(arming(state, { visible: false, focused: true }, 1_700)).toEqual({ since: null });
    expect(arming(state, { visible: true, focused: true }, 1_800)).toEqual({ since: 1_800 });
  });
});

describe('useSignArming', () => {
  const listeners = { window: new Map<string, () => void>(), document: new Map<string, () => void>() };
  const page = { visible: true, focused: true };
  let host: HookHarness;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    host = new HookHarness();
    vi.stubGlobal('window', { addEventListener: (type: string, fn: () => void) => listeners.window.set(type, fn), removeEventListener: (type: string) => listeners.window.delete(type) });
    vi.stubGlobal('document', { get visibilityState() { return page.visible ? 'visible' : 'hidden'; }, hasFocus: () => page.focused,
      addEventListener: (type: string, fn: () => void) => listeners.document.set(type, fn), removeEventListener: (type: string) => listeners.document.delete(type) });
    page.visible = true; page.focused = true;
  });
  afterEach(() => { host.unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); listeners.window.clear(); listeners.document.clear(); });
  const read = (key: string | null) => host.render(() => useSignArming(key));

  it('arms after one second of attention and disarms on blur until another full second', () => {
    expect(read('req-1')).toEqual({ armed: false, attentive: true });
    vi.advanceTimersByTime(999);
    expect(read('req-1').armed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(read('req-1')).toEqual({ armed: true, attentive: true });
    page.focused = false; listeners.window.get('blur')!();
    expect(read('req-1')).toEqual({ armed: false, attentive: false });
    page.focused = true; listeners.window.get('focus')!();
    vi.advanceTimersByTime(500);
    expect(read('req-1').armed).toBe(false);
    vi.advanceTimersByTime(500);
    expect(read('req-1').armed).toBe(true);
  });
  it('does not count while the window is hidden or unfocused, and starts over for a new request', () => {
    page.focused = false;
    expect(read('req-1')).toEqual({ armed: false, attentive: false });
    vi.advanceTimersByTime(5_000);
    expect(read('req-1').armed).toBe(false);
    page.focused = true; listeners.window.get('focus')!();
    vi.advanceTimersByTime(1_000);
    expect(read('req-1').armed).toBe(true);
    page.visible = false; listeners.document.get('visibilitychange')!();
    expect(read('req-1').armed).toBe(false);
    page.visible = true; listeners.document.get('visibilitychange')!();
    expect(read('req-2')).toEqual({ armed: false, attentive: true });
    vi.advanceTimersByTime(1_000);
    expect(read('req-2').armed).toBe(true);
    expect(read(null)).toEqual({ armed: false, attentive: false });
    expect(listeners.window.size).toBe(0);
  });
});
