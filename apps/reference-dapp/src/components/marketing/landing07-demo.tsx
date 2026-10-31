// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { landing07Copy, type Landing07Locale } from './landing07-copy';
import styles from './landing07.module.css';

const LAST_STAGE = 6;

export function Landing07Demo({ locale }: { locale: Landing07Locale }) {
  const t = landing07Copy[locale];
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = demoRef.current;
    if (!element || !('IntersectionObserver' in window)) { setInView(true); return; }
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false), { threshold: .3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) { setStage(LAST_STAGE); setPlaying(false); }
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!inView || !playing || reducedMotion || stage >= LAST_STAGE) return;
    const timer = window.setTimeout(() => setStage(current => Math.min(current + 1, LAST_STAGE)), stage === 0 ? 650 : stage === 1 ? 1900 : 1450);
    return () => window.clearTimeout(timer);
  }, [inView, playing, reducedMotion, stage]);

  return <div ref={demoRef} className={styles.demoFrame} role="group" aria-label={t.demoLabel} data-demo-stage={stage}>
    <div className={styles.demoTopbar}>
      <span className={styles.demoWindowDots} aria-hidden="true"><i/><i/><i/></span>
      <span className={styles.demoTopTitle}><Image src="/brand/flofi-symbol-light.svg" alt="" width={20} height={20} /> FloFi / {t.demoBuilder}</span>
      <span className={styles.demoBadge}>{t.demoBadge}</span>
    </div>
    <div className={styles.demoSteps} aria-hidden="true"><span className={styles.demoStepActive}>01 {t.demoCreate}</span><span>02 {t.demoSimulate}</span><span>03 {t.demoExecute}</span></div>
    <div className={styles.demoWorkspace}>
      <div className={styles.demoChat}>
        <div className={styles.demoPanelHeading}><Image src="/brand/flofi-symbol-light.svg" alt="" width={23} height={23}/><strong>{t.demoAssistant}</strong><span className={styles.demoLiveDot}/></div>
        <div className={styles.demoMessageStack}>
          <div className={`${styles.demoUserMessage} ${stage >= 2 ? styles.demoShown : ''}`}><small>{locale === 'pt' ? 'Você' : 'You'}</small>{t.demoPrompt}</div>
          <div className={`${styles.demoAssistantMessage} ${stage >= 2 ? styles.demoShown : ''}`}><small>FloFi</small>{stage === 2 ? t.demoInterpreting : t.demoResponse}</div>
          <div className={`${styles.demoAssistantNote} ${stage >= 6 ? styles.demoShown : ''}`}><span aria-hidden="true">◇</span><span>{t.demoWallet}</span></div>
        </div>
        <div className={styles.demoComposer}><span className={stage === 1 ? styles.demoTyping : ''}>{stage === 0 ? t.demoPlaceholder : t.demoPrompt}</span><span aria-hidden="true">↗</span></div>
      </div>
      <div className={styles.demoCanvas}>
        <div className={styles.demoCanvasHeader}><span>{locale === 'pt' ? 'Seu fluxo' : 'Your flow'}</span><span>{stage >= 3 ? '01 / 01' : '00 / 01'}</span></div>
        <div className={styles.demoFlow}>
          <div className={`${styles.demoNode} ${stage >= 3 ? styles.demoShown : ''}`}><span className={styles.demoNodeIndex}>01</span><small>{t.demoOrigin}</small><div><Image src="/brand/crypto/usdc.png" alt="" width={32} height={32} /><strong>100 USDC</strong></div></div>
          <span className={`${styles.demoConnection} ${stage >= 4 ? styles.demoConnected : ''}`} aria-hidden="true"><i/></span>
          <div className={`${styles.demoNode} ${stage >= 4 ? styles.demoShown : ''}`}><span className={styles.demoNodeIndex}>02</span><small>{t.demoDestination}</small><div><Image src="/brand/crypto/ethereum.svg" alt="" width={32} height={32} /><strong>ETH</strong></div><em>{stage >= 5 ? t.demoQuote : t.demoPreparing}</em></div>
        </div>
        <div className={`${styles.demoReview} ${stage >= 5 ? styles.demoShown : ''}`}><span aria-hidden="true">✓</span>{stage >= 6 ? t.demoAuthorization : t.demoReview}</div>
      </div>
    </div>
    <div className={styles.demoControls}>
      <span>{t.demoBadge} · {String(stage).padStart(2, '0')} / 06</span>
      <div><button type="button" onClick={() => { setStage(reducedMotion ? LAST_STAGE : 0); setPlaying(!reducedMotion); }} aria-label={t.demoRestart} title={t.demoRestart}>↺</button><button type="button" onClick={() => { if (reducedMotion) { setStage(LAST_STAGE); setPlaying(false); return; } if (stage >= LAST_STAGE) setStage(0); setPlaying(current => !current); }} aria-label={playing && stage < LAST_STAGE ? t.demoPause : t.demoPlay}>{playing && stage < LAST_STAGE ? 'Ⅱ' : '▶'}</button></div>
    </div>
  </div>;
}
