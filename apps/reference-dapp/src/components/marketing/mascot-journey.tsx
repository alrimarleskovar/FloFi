// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef, useState } from 'react';
import type { LandingLocale } from './landing-copy';
import { FloFiMascot } from './flofi-mascot';
import { characterMotion, type MascotState } from './mascot-animations';
import styles from './mascot-motion.module.css';

/**
 * BUILD-FLOFI-UX-UI-002: the approved mascot journey is the landing's default (production had lost it because this build-time flag was
 * never set). `NEXT_PUBLIC_FLOFI_MASCOT_MOTION=false` remains an explicit off switch; reduced motion always shows the still landing.
 */
export const mascotMotionEnabled = process.env.NEXT_PUBLIC_FLOFI_MASCOT_MOTION !== 'false';
const enabled = mascotMotionEnabled;
/** A section's own scripted scene (the conversation demo) asks the existing controller for a reaction while its dock is active. */
export const MASCOT_REACT_EVENT = 'flofi:mascot-react';
export type MascotReaction = { readonly scene: Scene; readonly state: 'jump' | 'look' | 'celebrate' };
const introKey = 'flofi-alive-intro-v1';
const text = {
  en: { skip: 'Skip intro' },
  pt: { skip: 'Pular introdução' },
};

export type Scene = 'hero' | 'swap' | 'bridge' | 'lending' | 'automate' | 'multichain' | 'networks' | 'workflow' | 'review' | 'infrastructure' | 'cta' | 'demo' | 'assistants';

/** Space is reserved in the first render, so enabling motion never shifts content on hydration. */
export function MascotDock({ scene, compact = false, white = false, local = false }: { scene: Scene; compact?: boolean; white?: boolean; local?: boolean; locale?: LandingLocale }) {
  if (!enabled) return null;
  return <div className={`${styles.dock} ${compact ? styles.compact : ''} ${scene === 'hero' ? styles.hero : ''} ${white ? styles.dark : ''} ${local ? styles.local : ''}`} data-mascot-dock={scene} data-mascot-local={local || undefined}>
    <div className={styles.perch} data-mascot-perch><FloFiMascot white={white}/></div>
    <span className={styles.orbit} aria-hidden="true"><i/><i/><i/></span>
  </div>;
}

export function MascotJourney({ locale }: { locale: LandingLocale }) {
  return enabled ? <JourneyController locale={locale}/> : null;
}

function JourneyController({ locale }: { locale: LandingLocale }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const travelerRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});
  const [reduced, setReduced] = useState(false);
  const [intro, setIntro] = useState(false);
  const t = text[locale];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const traveler = travelerRef.current;
    const root = layer?.closest<HTMLElement>('[data-mascot-motion]');
    if (!root || !layer || !traveler) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Query the preference directly as well as React state: never start before hydration's media check.
    if (reduced || media.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) {
      root.dataset.alive = 'still';
      setIntro(false);
      return () => { delete root.dataset.alive; };
    }

    root.dataset.alive = 'running';
    const docks = [...root.querySelectorAll<HTMLElement>('[data-mascot-dock]:not([data-mascot-local])')];
    const mobile = window.matchMedia('(max-width: 760px)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const visible = new Set<HTMLElement>();
    const animations = new Set<Animation>();
    const disposers: (() => void)[] = [];
    let active: HTMLElement | null = null;
    let frame = 0;
    let disposed = false;
    let introducing = false;
    let introFinished = false;
    let lastReaction = 0;
    let position = { x: 0, y: 0 };
    let movement: Animation | null = null;
    let sequence: Animation | null = null;
    let character: HTMLElement | null = null;
    let preferred: HTMLElement | null = null;
    let row: HTMLElement[] = [];
    let rowIndex = 0;
    let rowTimer = 0;

    const animate = (element: Element, frames: Keyframe[], duration: number, done?: () => void) => {
      const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.68,.25,1)', fill: 'none' });
      animations.add(animation);
      animation.onfinish = () => { animations.delete(animation); if (!disposed) done?.(); };
      animation.oncancel = () => animations.delete(animation);
      return animation;
    };
    const pulse = (element: HTMLElement | null, emphasis = false) => {
      if (!element) return;
      // Shadows are short, event-driven accents; no layout or authorization state changes.
      animate(element, [{ boxShadow: '0 0 0 0 rgba(35,67,217,0)' }, { boxShadow: `0 0 0 ${emphasis ? 6 : 3}px rgba(147,166,255,.35)`, offset: .35 }, { boxShadow: '0 0 0 0 rgba(35,67,217,0)' }], 850);
    };
    const react = (state: Exclude<MascotState, 'idle' | 'travel'>, force = false) => {
      if (!character || document.hidden || introducing || (!force && performance.now() - lastReaction < 1500)) return;
      lastReaction = performance.now();
      sequence?.cancel();
      const body = character.querySelector<HTMLElement>('[data-mascot-body]')!;
      const shadow = character.querySelector<HTMLElement>('[data-mascot-shadow]')!;
      const motion = characterMotion(state, mobile.matches);
      character.dataset.state = state;
      sequence = animate(body, motion.frames, motion.duration, () => { character!.dataset.state = 'idle'; });
      animate(shadow, [{ transform: 'scaleX(1)', opacity: .2 }, { transform: 'scaleX(.6)', opacity: .09, offset: .45 }, { transform: 'scaleX(1)', opacity: .2 }], motion.duration);
    };
    const target = (dock: HTMLElement) => {
      const perch = dock.querySelector<HTMLElement>('[data-mascot-perch]')!.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      traveler.style.width = `${perch.width}px`;
      traveler.style.height = `${perch.height}px`;
      return { x: perch.left - box.left, y: perch.top - box.top };
    };
    const transform = (point: { x: number; y: number }) => `translate(${point.x}px,${point.y}px)`;
    const place = (dock: HTMLElement, travel: boolean) => {
      if (mobile.matches) {
        traveler.style.visibility = 'hidden';
        character = dock.querySelector<HTMLElement>('[data-mascot-character]');
        return;
      }
      const next = target(dock);
      const current = movement ? new DOMMatrix(getComputedStyle(traveler).transform) : null;
      const previous = current ? { x: current.m41, y: current.m42 } : position;
      movement?.cancel();
      position = next;
      traveler.style.transform = transform(next);
      traveler.style.visibility = 'visible';
      character = traveler.querySelector<HTMLElement>('[data-mascot-character]');
      character!.dataset.variant = dock.classList.contains(styles.dark!) ? 'white' : 'blue';
      if (travel && Math.hypot(previous.x - next.x, previous.y - next.y) > 12) {
        // Travel through the page margin, then enter the reserved dock; never a fixed corner overlay.
        const gutter = Math.max(8, (window.innerWidth - 1280) / 2 - 65);
        character!.dataset.state = 'travel';
        movement = animate(traveler, [
          { transform: transform(previous), opacity: .65, offset: 0 },
          { transform: `${transform({ x: gutter, y: previous.y - 24 })} rotate(-12deg)`, opacity: .35, offset: .22 },
          { transform: `${transform({ x: gutter, y: next.y - 48 })} rotate(8deg)`, opacity: .55, offset: .66 },
          { transform: `${transform(next)} rotate(0)`, opacity: 1, offset: 1 },
        ], 900, () => { movement = null; place(dock, false); sectionReaction(dock); });
      }
    };
    const sectionReaction = (dock: HTMLElement) => {
      const scene = dock.dataset.mascotDock;
      const section = dock.closest('section');
      const card = dock.closest<HTMLElement>('article');
      if (scene === 'swap' || scene === 'automate') { react(scene === 'swap' ? 'jump' : 'celebrate', true); pulse(card); }
      else if (scene === 'bridge' || scene === 'multichain') {
        sequence?.cancel();
        const body = character?.querySelector<HTMLElement>('[data-mascot-body]');
        const distance = mobile.matches ? 24 : 52;
        if (body) {
          character!.dataset.state = 'travel';
          sequence = animate(body, [
            { transform: 'translate(0,0) rotate(0) scale(1)', offset: 0 },
            { transform: `translate(-${distance}px,3px) rotate(-8deg) scale(1.08,.9)`, offset: .18 },
            { transform: `translate(0,-${mobile.matches ? 18 : 32}px) rotate(12deg) scale(.94,1.06)`, offset: .42 },
            { transform: `translate(${distance}px,2px) rotate(-6deg) scale(1.09,.9)`, offset: .66 },
            { transform: 'translate(0,0) rotate(0) scale(1)', offset: 1 },
          ], mobile.matches ? 1000 : 1400, () => { character!.dataset.state = 'idle'; });
        }
        const marks = card?.querySelectorAll<HTMLElement>('[data-crypto]');
        marks?.forEach((mark, i) => {
          animate(mark, [{ transform: 'translateY(0)' }, { transform: `translateY(-${mobile.matches ? 3 : 7}px)`, offset: .45 }, { transform: 'translateY(0)' }], 700 + i * 120);
        });
        pulse(card);
      } else if (scene === 'lending' || scene === 'review') { react('look', true); pulse(card ?? section?.querySelector<HTMLElement>('[data-mascot-review]') ?? null); }
      else if (scene === 'infrastructure') {
        react('look', true);
        pulse(section?.querySelector<HTMLElement>('[data-flow-core]') ?? null);
      } else if (scene === 'networks') {
        react('jump', true);
        // Upcoming Tempo is intentionally excluded from the supported-network reaction.
        section?.querySelectorAll<HTMLElement>('[data-network-current] [data-crypto]').forEach((mark, i) => animate(mark, [{ transform: 'translateY(0)' }, { transform: `translateY(-${mobile.matches ? 3 : 6}px)`, offset: .35 + i * .07 }, { transform: 'translateY(0)' }], 950));
      } else if (scene === 'cta') { react('celebrate', true); pulse(section?.querySelector<HTMLElement>('[data-mascot-cta]') ?? null, true); }
      else if (scene === 'demo') react('look', true);
      else if (scene === 'assistants') { react('jump', true); pulse(section?.querySelector<HTMLElement>('[role="tablist"]') ?? null); }
      else react('jump', true);
    };
    const update = () => {
      frame = 0;
      if (document.hidden || introducing) return;
      const candidates = [...visible].filter(dock => dock.getBoundingClientRect().width > 0);
      let best = candidates.sort((a, b) => Math.abs(a.getBoundingClientRect().top - window.innerHeight * .35) - Math.abs(b.getBoundingClientRect().top - window.innerHeight * .35))[0];
      if (!best) { traveler.style.visibility = 'hidden'; return; }
      const peers = best.closest('#scenarios') && !mobile.matches ? candidates.filter(dock => dock.closest('#scenarios') && Math.abs(dock.getBoundingClientRect().top - best!.getBoundingClientRect().top) < 8).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left) : [];
      if (peers.length > 1) {
        if (row[0] !== peers[0]) {
          window.clearTimeout(rowTimer);
          row = peers;
          rowIndex = 0;
          const next = () => {
            if (disposed || document.hidden || rowIndex >= row.length - 1) return;
            rowIndex++;
            schedule();
            rowTimer = window.setTimeout(next, 2400);
          };
          rowTimer = window.setTimeout(next, 2400);
        }
        best = preferred && peers.includes(preferred) ? preferred : row[Math.min(rowIndex, row.length - 1)]!;
      } else {
        window.clearTimeout(rowTimer);
        row = [];
        rowIndex = 0;
      }
      if (preferred && !candidates.includes(preferred)) preferred = null;
      if (active !== best) {
        if (active) { delete active.dataset.active; active.querySelector<HTMLElement>('[data-mascot-character]')!.dataset.state = 'idle'; }
        const previous = active;
        active = best;
        active.dataset.active = 'true';
        layer.dataset.scene = best.dataset.mascotDock;
        place(best, !!previous && !mobile.matches);
        if (!movement) sectionReaction(best);
      } else if (!movement) place(best, false);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target as HTMLElement) : visible.delete(entry.target as HTMLElement));
      schedule();
    }, { rootMargin: '-5% 0px -15% 0px', threshold: 0 });
    docks.forEach(dock => observer.observe(dock));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    root.addEventListener('animationend', schedule);
    const visibility = () => {
      root.dataset.aliveHidden = String(document.hidden);
      animations.forEach(animation => document.hidden ? animation.pause() : animation.play());
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', visibility);
    // Scripted section scenes request reactions; only the dock that is currently active answers, so nothing moves offscreen.
    const requested = (event: Event) => {
      const detail = (event as CustomEvent<MascotReaction>).detail;
      if (detail && active?.dataset.mascotDock === detail.scene && !movement) react(detail.state, true);
    };
    window.addEventListener(MASCOT_REACT_EVENT, requested);

    // Deliberate local pointer responses, never global cursor chasing. Touch devices use scroll choreography.
    root.querySelectorAll<HTMLElement>('article, [data-mascot-cta], [data-mascot-dock]:not([data-mascot-local])').forEach(element => {
      const enter = () => {
        if (!pointer.matches || !active || introducing) return;
        const cardDock = element.tagName === 'ARTICLE' ? element.querySelector<HTMLElement>('[data-mascot-dock]') : null;
        if (cardDock) {
          preferred = cardDock;
          window.clearTimeout(rowTimer);
          schedule();
        }
        const related = element.contains(active) || active.closest('section')?.contains(element) && element.hasAttribute('data-mascot-cta');
        if (related) react(element.hasAttribute('data-mascot-cta') ? 'jump' : 'look');
      };
      const move = (event: PointerEvent) => {
        if (!pointer.matches || !character || introducing) return;
        const box = character.getBoundingClientRect();
        if (Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) < 140) {
          character.style.setProperty('--look', `${Math.max(-5, Math.min(5, (event.clientX - box.left - box.width / 2) / 20))}deg`);
        }
      };
      const leave = () => character?.style.removeProperty('--look');
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointermove', move, { passive: true });
      element.addEventListener('pointerleave', leave);
      disposers.push(() => { element.removeEventListener('pointerenter', enter); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); });
    });

    const finishIntro = () => {
      if (introFinished) return;
      introFinished = true;
      introducing = false;
      animations.forEach(animation => animation.cancel());
      movement = null;
      sequence = null;
      if (character) character.dataset.state = 'idle';
      setIntro(false);
      root.dataset.intro = 'complete';
      schedule();
    };
    skipRef.current = finishIntro;
    let seen = false;
    try { seen = window.sessionStorage.getItem(introKey) === 'seen'; } catch { seen = true; /* Storage denied: prefer no replay. */ }
    const hero = docks.find(dock => dock.dataset.mascotDock === 'hero')!;
    const startIntro = () => {
    if (!seen && window.scrollY < 80) {
      // Mark before starting, including StrictMode cleanup/remount, skip, refresh and route navigation.
      try { window.sessionStorage.setItem(introKey, 'seen'); } catch { /* Optional storage. */ }
      active = hero;
      hero.dataset.active = 'true';
      layer.dataset.scene = 'hero';
      place(hero, false);
      introducing = true;
      setIntro(true);
      root.dataset.intro = 'playing';
      const body = character!.querySelector<HTMLElement>('[data-mascot-body]')!;
      character!.dataset.state = 'intro';
      const distance = mobile.matches ? 100 : Math.min(650, window.innerWidth * .55);
      sequence = animate(body, [
        { transform: `translate(-${distance}px,-60px) rotate(-38deg) scale(.85,1.08)`, opacity: 0, offset: 0 },
        { transform: 'translate(-25px,-18px) rotate(9deg) scale(.95,1.06)', opacity: 1, offset: .27 },
        { transform: 'translate(6px,5px) rotate(-4deg) scale(1.19,.78)', offset: .38 },
        { transform: 'translate(0,-8px) rotate(7deg) scale(.96,1.04)', offset: .49 },
        { transform: 'translate(-6px,0) rotate(-12deg) scale(1)', offset: .62 },
        { transform: 'translate(12px,-30px) rotate(14deg) scale(.94,1.06)', offset: .77 },
        { transform: 'translate(0,3px) rotate(-3deg) scale(1.12,.88)', offset: .9 },
        { transform: 'translate(0,0) rotate(0) scale(1)', offset: 1 },
      ], mobile.matches ? 1800 : 2600, finishIntro);
      animate(hero.querySelector(`.${styles.orbit}`)!, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1.2)', offset: .76 }, { opacity: .6, transform: 'scale(1)' }], mobile.matches ? 1800 : 2600);
      const accent = root.querySelector<HTMLElement>('[data-mascot-headline] > span');
      if (accent) animate(accent, [{ textShadow: '0 0 0 rgba(35,67,217,0)' }, { textShadow: '0 0 22px rgba(147,166,255,.7)', offset: .77 }, { textShadow: '0 0 0 rgba(35,67,217,0)' }], mobile.matches ? 1800 : 2600);
    } else { root.dataset.intro = 'skipped'; schedule(); }
    };
    // StrictMode's probe is cleaned up before this frame, so it cannot consume the tab's intro.
    const introFrame = requestAnimationFrame(startIntro);
    const scrollSkip = () => { if (introducing && window.scrollY > 80) finishIntro(); };
    window.addEventListener('scroll', scrollSkip, { passive: true });

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(introFrame);
      window.clearTimeout(rowTimer);
      animations.forEach(animation => animation.cancel());
      disposers.forEach(dispose => dispose());
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', scrollSkip);
      window.removeEventListener('resize', schedule);
      root.removeEventListener('animationend', schedule);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener(MASCOT_REACT_EVENT, requested);
      docks.forEach(dock => { delete dock.dataset.active; dock.querySelectorAll<HTMLElement>('[data-mascot-character]').forEach(item => { item.dataset.state = 'idle'; item.style.removeProperty('--look'); }); });
      delete root.dataset.alive;
      delete root.dataset.aliveHidden;
      delete root.dataset.intro;
      traveler.style.visibility = 'hidden';
    };
  }, [reduced]);

  return <div ref={layerRef} className={styles.layer} data-mascot-journey>
    <div ref={travelerRef} className={styles.traveler} data-mascot-traveler aria-hidden="true"><FloFiMascot/></div>
    {intro && <div className={styles.introSkip}>
      <button type="button" onClick={() => { layerRef.current?.closest('[data-mascot-motion]')?.querySelector<HTMLAnchorElement>('a[href="/login"]')?.focus(); skipRef.current(); }}>{t.skip}<span aria-hidden="true">↗</span></button>
    </div>}
  </div>;
}
