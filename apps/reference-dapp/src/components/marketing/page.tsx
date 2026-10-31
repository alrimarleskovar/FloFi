// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import styles from './landing.module.css';
import { LandingMotion } from './landing-motion';
import { EarthAtmosphere } from './earth-atmosphere';
import { ConnectedFlow } from './connected-flow';
import { WorkflowStory } from './workflow-story';
import { CryptoMark } from './crypto-visuals';
import { SupportedNetworks } from './supported-networks';
import { MascotDock, MascotJourney, mascotMotionEnabled } from './mascot-journey';
import { SocialLinks } from './social-links';
import { ConversationDemo } from './conversation-demo';
import { AssistantOnboarding } from './assistant-onboarding';
import { landingText, type LandingCopy, type LandingLocale } from './landing-copy';


function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={styles.arrow}>
    {diagonal ? <path d="M5 15 15 5M6 5h9v9" /> : <path d="M3 10h13m-5-5 5 5-5 5" />}
  </svg>;
}

function Brand({ light = false }: { light?: boolean }) {
  return <span className={light ? styles.brandLight : styles.brand}>
    <Image src={`/brand/flofi-symbol-${light ? 'dark' : 'light'}.svg`} alt="" width={370} height={345} unoptimized />
    <Image className={styles.wordmark} src={`/brand/flofi-wordmark-${light ? 'dark' : 'light'}.png`} alt="FloFi" width={738} height={280} unoptimized />
  </span>;
}

function SectionKicker({ children }: { children: ReactNode }) {
  return <p className={styles.kicker}>{children}</p>;
}

function SourceIcon({ source }: { source: 'wallet' | 'app' | 'agent' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    {source === 'wallet' && <><path d="M19 8V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 6.5"/><path d="M21 12h-5a2 2 0 0 0 0 4h5"/><circle cx="16.5" cy="14" r=".8" fill="currentColor" stroke="none"/></>}
    {source === 'app' && <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M8 13h3v3H8zM15 13h1M15 16h1"/></>}
    {source === 'agent' && <><path d="m12 4 2.2 5.8L20 12l-5.8 2.2L12 20l-2.2-5.8L4 12l5.8-2.2L12 4Z"/><path d="M20 3v4M18 5h4M4 17v4M2 19h4"/></>}
  </svg>;
}

function FlowDiagram({ t }: { t: LandingCopy }) {
  const sources = [{ source: 'wallet', label: t.diagramWallet }, { source: 'app', label: t.diagramApp }, { source: 'agent', label: t.diagramAgent }] as const;
  return <ConnectedFlow className={styles.diagram} label={t.executionInfrastructure}>
    <div className={styles.diagramInputs} data-flow-nodes>
      {sources.map(({ source, label }) => <div className={styles.diagramSource} data-flow-source={source} key={source}>
        <span className={styles.diagramSourceIcon}><SourceIcon source={source}/></span>
        <span>{label}</span>
        <span className={`${styles.diagramPort} ${styles.diagramSourcePort}`} data-flow-port aria-hidden="true"/>
      </div>)}
    </div>
    <div className={styles.diagramCore} data-flow-core>
      <span className={`${styles.diagramPort} ${styles.diagramCoreInput}`} data-flow-port="input" aria-hidden="true"/>
      <Brand /><span className={styles.diagramCoreLabel}>{t.executionInfrastructure}</span>
      <div><span>{t.stageStrategy}</span><span>{t.stageReview}</span><span>{t.diagramAuthorization}</span><span>{t.diagramVerification}</span></div>
      <span className={`${styles.diagramPort} ${styles.diagramCoreOutput}`} data-flow-port="output" aria-hidden="true"/>
    </div>
    <div className={styles.diagramOutputs} data-flow-nodes>
      <p className={styles.diagramOutputLabel}>{t.diagramProtocols}</p>
      <div className={styles.diagramDestination} data-flow-destination="orca"><span className={`${styles.diagramPort} ${styles.diagramDestinationPort}`} data-flow-port aria-hidden="true"/><CryptoMark name="SOL"/><span><strong>Orca · Solana</strong><small>{t.illustrativeScenario}</small></span></div>
      <div className={styles.diagramDestination} data-flow-destination="aave"><span className={`${styles.diagramPort} ${styles.diagramDestinationPort}`} data-flow-port aria-hidden="true"/><CryptoMark name="ETH"/><span><strong>Aave · Ethereum</strong><small>{t.illustrativeScenario}</small></span></div>
      <p className={styles.diagramMore}>{t.more} <small>{t.ecosystemDirection}</small></p>
    </div>
  </ConnectedFlow>;
}

function VisionVisual({ t }: { t: LandingCopy }) {
  const sources = [{ source: 'agent', label: t.diagramAgent }, { source: 'wallet', label: t.diagramWallet }, { source: 'app', label: t.diagramApp }] as const;
  return <ConnectedFlow className={styles.visionVisual} label={t.visionEyebrow} variant="dark">
    <div className={styles.visionSources} data-flow-nodes>{sources.map(({ source, label }) => <div className={styles.visionSource} data-flow-source={source} key={source}>
      <span className={styles.diagramSourceIcon}><SourceIcon source={source}/></span><span>{label}</span>
      <span className={`${styles.diagramPort} ${styles.diagramSourcePort}`} data-flow-port aria-hidden="true"/>
    </div>)}</div>
    <div className={styles.visionCore} data-flow-core>
      <span className={`${styles.diagramPort} ${styles.diagramCoreInput}`} data-flow-port="input" aria-hidden="true"/>
      <Image src="/brand/flofi-symbol-dark.svg" alt="" width={55} height={55}/><strong>FloFi</strong><small>{t.executionLayer}</small>
      <span className={`${styles.diagramPort} ${styles.diagramCoreOutput}`} data-flow-port="output" aria-hidden="true"/>
    </div>
    <div className={styles.visionDestination} data-flow-destination="onchain">
      <span className={`${styles.diagramPort} ${styles.diagramDestinationPort}`} data-flow-port aria-hidden="true"/>
      {t.onchainFinance}
    </div>
  </ConnectedFlow>;
}

export default function LandingPage() {
  const [locale, setLocale] = useState<LandingLocale>('en');
  const t = landingText[locale];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('flofi-landing-language');
      if (saved === 'pt' || saved === 'en') setLocale(saved);
    } catch { /* The language selector still works without storage. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
    document.title = t.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.pageDescription);
  }, [locale, t]);

  const changeLocale = (next: LandingLocale) => {
    setLocale(next);
    try { window.localStorage.setItem('flofi-landing-language', next); } catch { /* Optional preference. */ }
  };

  return <div className={styles.root} lang={locale === 'pt' ? 'pt-BR' : 'en'} data-mascot-motion={mascotMotionEnabled ? 'true' : undefined}>
    <LandingMotion />
    <a className={styles.skipLink} href="#main">{t.skip}</a>
    <MascotJourney locale={locale}/>
    <header className={styles.siteHeader}><div className={styles.headerInner}>
      <a href="/" className={styles.brandLink} aria-label={t.brandHome}><Brand /></a>
      <nav aria-label={t.mainNavigation}><a href="#workflow">{t.navProduct}</a><a href="#networks">{t.navNetworks}</a><a href="#developers">{t.navDevelopers}</a><a href="/docs">{t.navDocs}</a></nav>
      <div className={styles.headerActions}><div className={styles.languageSwitch} role="group" aria-label={t.language}><button type="button" lang="pt-BR" aria-pressed={locale === 'pt'} onClick={() => changeLocale('pt')}>PT</button><span aria-hidden="true">/</span><button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button></div><a className={styles.headerCta} href="/login">{t.headerLaunch} <Arrow /></a></div>
    </div></header>

    <main id="main" tabIndex={-1}>
      <WorkflowStory t={t} locale={locale}/>
      <SupportedNetworks t={t}/>
      <ConversationDemo t={t}/>
      <AssistantOnboarding t={t}/>

      <section className={styles.developerSection} id="developers" aria-labelledby="developers-title" data-landing-reveal><div className={styles.container}>
        <div className={styles.centerHeading}><SectionKicker>{t.buildersEyebrow}</SectionKicker><h2 id="developers-title">{t.buildersTitleFirst}<br />{t.buildersTitleSecond}</h2><p>{t.buildersBody}</p></div>
        <MascotDock scene="infrastructure"/>
        <FlowDiagram t={t} />
        <div className={styles.developerStatement}><strong>{t.oneIntegration}</strong><span>{t.partnerBody}</span></div>
        <div className={styles.developerValues}><div><strong>{t.uxYours}</strong><span>{t.uxYoursBody}</span></div><div><strong>{t.executionStructured}</strong><span>{t.executionStructuredBody}</span></div><div><strong>{t.outcomesInspectable}</strong><span>{t.outcomesInspectableBody}</span></div></div>
        <a className={styles.primaryButton} href="/docs/developer-api">{t.buildWith} <Arrow /></a>
        <div id="documentation" className={styles.documentation}><strong><a href="/docs">{t.developerDocs} <Arrow /></a></strong><span>{t.developerDocsBody}</span><a href="/login">{t.openBuilder} <Arrow /></a></div>
      </div></section>

      <section className={styles.closingSection} id="about" aria-labelledby="vision-title" data-landing-reveal><EarthAtmosphere/><div className={styles.container}><div className={styles.closingGrid}>
        <div><SectionKicker>{t.visionEyebrow}</SectionKicker><h2 id="vision-title">{t.visionTitleFirst}<br /><span>{t.visionTitleSecond}</span></h2><p>{t.visionBody}</p><MascotDock scene="cta" white/><div className={styles.heroActions}><a className={styles.primaryButton} href="/login" data-mascot-cta>{t.launch} <Arrow /></a><a className={styles.darkSecondaryButton} href="/docs/developer-api">{t.buildWith}</a></div><p className={styles.closingFootnote}>{t.visionFootnote}</p></div>
        <VisionVisual t={t} />
      </div></div></section>
    </main>
    <footer className={styles.footer}><div className={styles.container}><a href="/" className={styles.brandLink} aria-label={t.brandHome}><Brand light /></a><SocialLinks t={t} variant="footer"/><nav aria-label={t.footerNavigation}><a href="#workflow">{t.navProduct}</a><a href="#developers">{t.navDevelopers}</a><a href="/docs">{t.navDocs}</a><a href="#networks">{t.navNetworks}</a><a href="https://github.com/alrimarleskovar/gryloo">{t.sourceCode}</a><a href="https://github.com/alrimarleskovar/gryloo/blob/main/LICENSE">{t.license}</a></nav><span>{t.footerLine}</span></div></footer>
  </div>;
}
