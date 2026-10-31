// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Landing07Demo } from './landing07-demo';
import { landing07Copy, type Landing07Locale } from './landing07-copy';
import styles from './landing07.module.css';

const CONTACT_URL = 'https://x.com/FloFi_xyz'; // Existing owner-supplied contact destination.

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true" className={styles.arrow}>{diagonal ? '↗' : '→'}</span>;
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <span className={styles.brand}>
    <Image src={`/brand/flofi-symbol-${inverse ? 'dark' : 'light'}.svg`} alt="" width={36} height={36} priority={!inverse}/>
    <Image src={`/brand/flofi-wordmark-${inverse ? 'dark' : 'light'}.png`} alt="FloFi" width={95} height={37} priority={!inverse}/>
  </span>;
}

function FeatureArt({ kind }: { kind: 'swap' | 'transfer' | 'strategy' }) {
  const artwork = {
    swap: '/landing07/swap-sculpture.png',
    transfer: '/landing07/transfer-sculpture.png',
    strategy: '/landing07/strategy-sculpture.png',
  }[kind];
  return <div className={styles.possibilityArt} aria-hidden="true"><Image src={artwork} alt="" fill sizes="(max-width: 700px) 100vw, 33vw" /></div>;
}

export default function Landing07Page() {
  const [locale, setLocale] = useState<Landing07Locale>('pt');
  const t = landing07Copy[locale];
  const ribbonScene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('flofi-landing-language');
      if (saved === 'pt' || saved === 'en') setLocale(saved);
    } catch { /* Optional local preference. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
    document.title = locale === 'pt' ? 'FloFi — DeFi sem complicação' : 'FloFi — DeFi, made clearer';
    document.querySelector('meta[name="description"]')?.setAttribute('content', `${t.heroBody} ${t.demoBody}`);
  }, [locale, t]);

  useEffect(() => {
    const root = ribbonScene.current;
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (reduced.matches) { root.style.setProperty('--ribbon-shift', '0px'); root.style.setProperty('--ribbon-tilt', '0deg'); return; }
      const bounds = root.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height - window.innerHeight)));
      root.style.setProperty('--ribbon-shift', `${Math.round(progress * Math.min(95, window.innerHeight * .12))}px`);
      root.style.setProperty('--ribbon-tilt', `${(progress * 2.2).toFixed(1)}deg`);
    };
    const request = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    reduced.addEventListener('change', request);
    return () => { window.removeEventListener('scroll', request); window.removeEventListener('resize', request); reduced.removeEventListener('change', request); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const elements = document.querySelectorAll<HTMLElement>('[data-landing07-reveal]');
    if (reduced.matches || !('IntersectionObserver' in window)) { elements.forEach(element => element.dataset.revealed = 'true'); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.revealed = 'true'; observer.unobserve(entry.target); } }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const changeLocale = (next: Landing07Locale) => {
    setLocale(next);
    try { window.localStorage.setItem('flofi-landing-language', next); } catch { /* Optional local preference. */ }
  };

  return <div className={styles.root} lang={locale === 'pt' ? 'pt-BR' : 'en'}>
    <a href="#main" className={styles.skipLink}>{t.skip}</a>
    <header className={styles.header}><div className={styles.headerInner}>
      <a href="/" aria-label="FloFi" className={styles.brandLink}><Brand /></a>
      <nav aria-label={locale === 'pt' ? 'Navegação principal' : 'Main navigation'}><a href="#como-funciona">{t.navHow}</a><a href="/docs">{t.navDocs}</a><a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{t.navBusiness}</a></nav>
      <div className={styles.headerActions}><div className={styles.localeSwitch} role="group" aria-label={locale === 'pt' ? 'Idioma' : 'Language'}><button type="button" lang="pt-BR" aria-pressed={locale === 'pt'} onClick={() => changeLocale('pt')}>PT</button><span>/</span><button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button></div><a className={styles.headerButton} href="/login"><span className={styles.headerButtonFull}>{t.navStart}</span><span className={styles.headerButtonShort}>{t.navStartShort}</span><Arrow diagonal /></a></div>
    </div></header>

    <main id="main" tabIndex={-1}>
      <div ref={ribbonScene} className={styles.ribbonScene}>
        <div className={styles.ribbonArtwork} aria-hidden="true"><Image src="/landing07/ribbon-reference-v2.png" alt="" width={1672} height={941} priority sizes="(max-width: 700px) 900px, 100vw" /><i className={styles.ribbonSpark}/><i className={styles.ribbonSpark}/></div>
        <div className={styles.heroMascot} aria-hidden="true"><Image src="/landing07/mascot-reference-v2.png" alt="" width={1516} height={1038} priority sizes="(max-width: 700px) 120px, 18vw" /></div>
        <div className={styles.heroBubble} aria-hidden="true"><Image src="/landing07/bubble-reference-v2.png" alt="" width={1536} height={1024} priority sizes="(max-width: 700px) 80px, 12vw" /></div>
        <section className={styles.hero} id="inicio" aria-labelledby="hero-title"><div className={styles.heroBackdrop} aria-hidden="true"/><div className={styles.heroInner}>
          <h1 id="hero-title" className={`${styles.heroWord} ${styles.heroWordBehind}`}>FLOFI</h1>
          <span className={`${styles.heroWord} ${styles.heroWordAbove}`} aria-hidden="true"><span className={styles.heroHiddenF}>F</span>LOFI</span>
          <div className={styles.heroBottom}><h2>{t.heroTitle}</h2><p>{t.heroBody}</p><div className={styles.heroActions}><a href="/login" className={styles.primaryButton}>{t.heroStart}<Arrow /></a><a href="#como-funciona" className={styles.secondaryButton}>{t.heroHow}<Arrow diagonal /></a></div><small>{t.heroNote}</small></div>
        </div><span className={styles.heroIndex}>01 / 06</span><span className={styles.scrollHint} aria-hidden="true">SCROLL ↓</span></section>
        <section className={styles.evolution} aria-labelledby="evolution-title"><div className={styles.evolutionInner}>
          <p className={styles.sectionNumber}>02 / 06</p>
          <h2 id="evolution-title"><span data-landing07-reveal>{t.evolutionOne}</span><span data-landing07-reveal>{t.evolutionTwo}</span></h2>
          <p className={styles.evolutionBody} data-landing07-reveal>{t.evolutionBody}</p>
        </div></section>
      </div>

      <section className={styles.demoSection} id="como-funciona" aria-labelledby="demo-title"><div className={styles.container}><div className={styles.demoGrid}>
        <div className={styles.demoEditorial} data-landing07-reveal><span className={styles.sectionNumber}>{t.demoKicker}</span><h2 id="demo-title">{t.demoTitle}</h2><p>{t.demoBody}</p><a href="/login" className={styles.textLink}>{t.demoExplore}<Arrow diagonal /></a><div className={styles.editorialRule}/></div>
        <div data-landing07-reveal><Landing07Demo locale={locale}/></div>
      </div></div></section>

      <section className={styles.possibilitiesSection} id="possibilidades" aria-labelledby="possibilities-title"><div className={styles.container}>
        <div className={styles.possibilitiesRail}><Image src="/brand/flofi-symbol-light.svg" alt="" width={28} height={28}/><span/><a href="/login">{locale === 'pt' ? 'ABRIR FLOFI' : 'LAUNCH APP'} <Arrow /></a></div>
        <div className={styles.possibilitiesIntro} data-landing07-reveal><span className={styles.sectionNumber}>04 / {locale === 'pt' ? 'POSSIBILIDADES' : 'POSSIBILITIES'}</span><h2 id="possibilities-title">{t.possibilitiesTitle.split('\n').map((line, index) => <span key={line} className={index === 1 ? styles.possibilitiesTitleSecond : undefined}>{line}</span>)}</h2><span className={styles.possibilitiesTopNote}>{locale === 'pt' ? 'Exemplos ilustrativos' : 'Illustrative examples'}</span></div>
        <div className={styles.possibilityGrid}>
          <article className={`${styles.possibilityCard} ${styles.swapCard}`} data-landing07-reveal><h3>{t.swapTitle}</h3><FeatureArt kind="swap"/><div className={styles.possibilityCopy}><p>{t.swapBody}</p><a href="/login" aria-label={locale === 'pt' ? 'Explorar trocas no FloFi' : 'Explore swaps in FloFi'}><Arrow /></a></div></article>
          <article className={`${styles.possibilityCard} ${styles.transferCard}`} data-landing07-reveal><h3>{t.transferTitle}</h3><FeatureArt kind="transfer"/><div className={styles.possibilityCopy}><p>{t.transferBody}</p><a href="/login" aria-label={locale === 'pt' ? 'Explorar transferências no FloFi' : 'Explore transfers in FloFi'}><Arrow /></a></div></article>
          <article className={`${styles.possibilityCard} ${styles.strategyCard}`} data-landing07-reveal><h3>{locale === 'pt' ? <>ESTRA<br/>TÉGIAS</> : <>STRATE<br/>GIES</>}</h3><FeatureArt kind="strategy"/><div className={styles.possibilityCopy}><p>{t.strategyBody}</p><a href="/login" aria-label={locale === 'pt' ? 'Explorar estratégias no FloFi' : 'Explore strategies in FloFi'}><Arrow /></a></div></article>
        </div><p className={styles.possibilitiesNote}>{t.possibilitiesNote}</p>
      </div></section>

      <section className={styles.benefitsSection} aria-label={locale === 'pt' ? 'Mais tempo e clareza' : 'More time and clarity'}><div className={styles.container}>
        <div className={styles.lessPanel}><div data-landing07-reveal><span className={styles.sectionNumber}>05 / 06</span><h2>{t.lessTitle}</h2><p>{t.lessBody}</p></div><div className={styles.clockArt} aria-hidden="true"><Image src="/landing07/clock.webp" alt="" width={1254} height={1254} sizes="(max-width: 700px) 80vw, 38vw" /></div></div>
        <div className={styles.clarityPanel}><div className={styles.clarityVisual} aria-hidden="true"><div className={styles.clarityVisualTop}><Image src="/brand/flofi-symbol-light.svg" alt="" width={27} height={27}/><span>FloFi / {locale === 'pt' ? 'Seu fluxo' : 'Your flow'}</span><span>01—03</span></div><div className={styles.clarityFlow}><div><b>01</b><span>{locale === 'pt' ? 'Descreva' : 'Describe'}</span></div><i>→</i><div><b>02</b><span>{locale === 'pt' ? 'Revise' : 'Review'}</span></div><i>→</i><div><b>03</b><span>{locale === 'pt' ? 'Simule' : 'Simulate'}</span></div></div><p>{locale === 'pt' ? 'Você decide como continuar.' : 'You decide what happens next.'}</p></div><div data-landing07-reveal><span className={styles.sectionNumber}>FLOFI / 05</span><h2>{t.clarityTitle}</h2><p>{t.clarityBody}</p><a className={styles.textLink} href="#como-funciona">{t.clarityCta}<Arrow diagonal /></a></div></div>
      </div></section>

      <section className={styles.faqSection} id="faq" aria-labelledby="faq-title"><div className={styles.container}><div className={styles.faqGrid}>
        <div data-landing07-reveal><span className={styles.sectionNumber}>06 / 06</span><h2 id="faq-title">{t.faqTitle}</h2><p>{t.faqBody}</p></div>
        <div className={styles.faqList} data-landing07-reveal>{t.faq.map(([question, answer], index) => <details key={question} className={styles.faqItem}><summary><span className={styles.faqIndex}>0{index + 1}</span><span>{question}</span><span className={styles.faqPlus} aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </div></div></section>

      <section className={styles.ctaSection} aria-labelledby="ready-title"><div className={styles.container}><div className={styles.ctaInner}><span className={styles.ctaOrbit} aria-hidden="true"/><div><p className={styles.ctaEyebrow}>FLOFI / 07</p><h2 id="ready-title">{t.readyTitle}</h2><p>{t.readyBody}</p></div><a href="/login" className={styles.ctaButton}>{t.readyCta}<Arrow diagonal /></a></div></div></section>
    </main>

    <footer className={styles.footer}><div className={styles.container}><div className={styles.footerTop}><a href="/" aria-label="FloFi" className={styles.brandLink}><Brand inverse /></a><p>{t.footerTagline}</p><nav aria-label={locale === 'pt' ? 'Navegação do rodapé' : 'Footer navigation'}><a href="#como-funciona">{t.navHow}</a><a href="/docs">{t.navDocs}</a><a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{t.navContact}<Arrow diagonal /></a></nav></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} FloFi</span><p>{t.footerRisk}</p></div></div></footer>
  </div>;
}
