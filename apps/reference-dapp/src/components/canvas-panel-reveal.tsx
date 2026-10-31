// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * Keeps an opened composer side panel (asset/bridge picker, Stocks, price strategies) clear of the canvas's floating bottom controls.
 *
 * Why: a side panel grows next to its card after the card was placed (a network choice, a token list that loads, a status line), so its
 * last options can end up under the canvas navigator, whose zoom slider then takes the click (seen in CI at 1440×900: 6 px of clearance
 * locally, none with other font metrics). The insertion fit keeps cards clear of that band, but runs only on insertion. When a panel
 * opens or changes size, the canvas now pans up just enough to lift the card and its panel above the band: never a zoom, never a pan
 * that would push the card's top past the canvas's top margin, and nothing happens when they already fit.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';

/** The margins the insertion fit keeps (`COMPOSER_FIT_PADDING`): 32 px at the top, 90 px for the bottom controls. */
export const PANEL_SAFE_TOP = 32, PANEL_SAFE_BOTTOM = 90;
/** Space kept between a panel and a floating control above which it is lifted. */
const CONTROL_GAP = 8;
type Box = { readonly top: number; readonly bottom: number; readonly left?: number; readonly right?: number };

/**
 * The upward pan (screen pixels, ≥ 0) that brings `box` (a card with its open panel) above `limit` (the lowest bottom edge it may reach),
 * without moving its top above `pane.top + safeTop`. A box taller than the free space is lifted as far as that allows.
 */
export function revealOffset(box: Box, pane: Box, limit: number, safeTop = PANEL_SAFE_TOP): number {
  const overflow = box.bottom - limit;
  if (!(overflow > 0)) return 0;
  return Math.max(0, Math.min(overflow, box.top - (pane.top + safeTop)));
}
/** The lowest bottom edge `box` may reach: the bottom margin, or above any bottom control that overlaps it horizontally. */
export function revealLimit(box: Box, pane: Box, controls: readonly Box[], safeBottom = PANEL_SAFE_BOTTOM): number {
  let limit = pane.bottom - safeBottom;
  for (const control of controls) {
    const overlaps = box.left === undefined || box.right === undefined || control.left === undefined || control.right === undefined
      || (control.left < box.right && control.right > box.left);
    if (overlaps && control.top > pane.top) limit = Math.min(limit, control.top - CONTROL_GAP);
  }
  return limit;
}

type Reveal = (panel: HTMLElement) => void;
const RevealContext = createContext<RefObject<Reveal | null> | null>(null);

/** Wraps the Build canvas so cards rendered by React Flow can ask it to reveal their open panel. */
export function PanelRevealProvider({ children }: { children: ReactNode }) {
  const reveal = useRef<Reveal | null>(null);
  return <RevealContext.Provider value={reveal}>{children}</RevealContext.Provider>;
}

/** Rendered inside `<ReactFlow>` (it needs the canvas's viewport): performs the pan for the provider above. */
export function PanelRevealer() {
  const reveal = useContext(RevealContext);
  const { getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  useEffect(() => {
    if (!reveal) return;
    reveal.current = panel => {
      const root = store.getState().domNode;
      if (!root || !panel.isConnected) return;
      const pane = root.getBoundingClientRect(), own = panel.getBoundingClientRect();
      const card = (panel.closest('.react-flow__node') ?? panel).getBoundingClientRect();
      const box = { top: Math.min(own.top, card.top), bottom: Math.max(own.bottom, card.bottom), left: Math.min(own.left, card.left), right: Math.max(own.right, card.right) };
      const controls = Array.from(root.querySelectorAll<HTMLElement>('.react-flow__panel.bottom'), control => control.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
      const offset = revealOffset(box, pane, revealLimit(box, pane, controls));
      if (offset < 1) return;
      const viewport = getViewport();
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      void setViewport({ ...viewport, y: viewport.y - offset }, { duration: reduced ? 0 : 180 });
    };
    return () => { reveal.current = null; };
  }, [reveal, getViewport, setViewport, store]);
  return null;
}

/** For a side panel: reveal it when it opens, when its size changes and when its opening animation ends. A no-op outside the Build canvas. */
export function useRevealPanel(panel: RefObject<HTMLElement | null>) {
  const reveal = useContext(RevealContext);
  useEffect(() => {
    const element = panel.current;
    if (!reveal || !element) return;
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => reveal.current?.(element)); };
    schedule();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(element);
    element.addEventListener('animationend', schedule);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); element.removeEventListener('animationend', schedule); };
  }, [reveal, panel]);
}
