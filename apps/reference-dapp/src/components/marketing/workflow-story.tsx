// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import styles from './landing.module.css';
import type { LandingCopy, LandingLocale } from './landing-copy';
import { MascotDock } from './mascot-journey';
import { WorkflowChannelIcon, workflowChannels } from './workflow-channel-icon';
import { SocialLinks } from './social-links';

function FlowIcon({ kind }: { kind: 'workflow' | 'review' | 'wallet' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'workflow' ? <><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v9h9M9 6h9v9"/></> : kind === 'review' ? <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 9 2 2 5-5M8 15h8M8 18h5"/></> : <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18M17 12h4v5h-4a2.5 2.5 0 0 1 0-5Z"/></>}
  </svg>;
}

export function WorkflowStory({ t, locale = 'en' }: { t: LandingCopy; locale?: LandingLocale }) {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    // One entrance per card. No scroll listener, timeline, measurements or React updates.
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).dataset.storySeen = 'true';
        observer.unobserve(entry.target);
      });
    }, { threshold: .18 });
    sectionRef.current?.querySelectorAll('[data-story-phase]').forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, []);
  const phases = [
    { id: 'Build', label: t.storyBuild, title: t.storyBuildTitle, body: t.storyBuildBody, note: t.storyBuildNote },
    { id: 'Review', label: t.storyReview, title: t.storyReviewTitle, body: t.storyReviewBody, note: t.storyReviewNote },
    { id: 'Execute', label: t.storyExecute, title: t.storyExecuteTitle, body: t.storyExecuteBody, note: t.storyExecuteNote },
  ];
  return <section id="workflow" ref={sectionRef} className={styles.workflowStory} aria-labelledby="workflow-title">
    <div className={styles.container}>
      <div className={styles.workflowHeading}>
        <div className={styles.workflowLead}>
          <p className={styles.kicker}>{t.heroEyebrow}</p>
          <h1 id="workflow-title" data-mascot-headline>{t.storyTitleFirst}<br/><span>{t.storyTitleSecond}</span></h1>
          <p>{t.storyBody}</p>
          <div className={styles.heroCtaRow}>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="/login" data-mascot-cta>{t.launch} <span aria-hidden="true">→</span></a>
              <a className={styles.secondaryButton} href="/docs">{t.exploreDocs} <span aria-hidden="true">→</span></a>
            </div>
            <SocialLinks t={t} variant="hero"/>
          </div>
        </div>
        <div className={styles.workflowHeroMascot}><MascotDock scene="hero"/></div>
      </div>
      <ol className={styles.workflowCards} aria-label={t.storyEyebrow}>
        {phases.map((phase, index) => <li key={phase.id} className={styles.workflowCard} data-story-phase={phase.id}>
          <div className={styles.workflowIntro}>
            <div className={styles.workflowCardTop}><span className={styles.workflowStep}><small>{String(index + 1).padStart(2, '0')}</small>{phase.label}</span><MascotDock scene="workflow" local compact locale={locale}/></div>
            <h3>{phase.title}</h3><p>{phase.body}</p>
          </div>
          <div className={styles.workflowVisual}>
            {index === 0 ? <>
              <div className={styles.workflowInputs}>{workflowChannels.map(source => <span key={source}><WorkflowChannelIcon channel={source}/>{source}</span>)}</div>
              <div className={styles.workflowMerge} aria-hidden="true"><svg viewBox="0 0 240 30" preserveAspectRatio="none" fill="none"><path d="M40 0C40 18 120 6 120 23M120 0V30M200 0C200 18 120 6 120 23" stroke="currentColor" strokeWidth="1.2"/></svg></div>
              <div className={styles.workflowModel}><Image src="/brand/flofi-symbol-light.svg" alt="" width={28} height={28}/><strong>{t.storyBuildModel}</strong></div>
            </> : index === 1 ? <div className={styles.workflowManifest}>
              <div className={styles.workflowVisualTitle}><FlowIcon kind="review"/><strong>Strategy Manifest</strong></div>
              <div className={styles.workflowChecks}>{[t.storySimulation, t.storyPermissions, t.storyLimits].map(label => <span key={label}><i aria-hidden="true">◇</i>{label}</span>)}</div>
              <div className={styles.workflowApproval}><span aria-hidden="true">◇</span>{t.storyApproval}</div>
            </div> : <div className={styles.workflowExecution}>
              <div className={styles.workflowSignature}><FlowIcon kind="wallet"/><strong>{t.storySignature}</strong></div>
              <div className={styles.workflowFollow}><FlowIcon kind="workflow"/><span>{t.storyRun}</span><span aria-hidden="true">↓</span></div>
              <p>{t.storyResult}<span aria-hidden="true">↗</span></p>
            </div>}
          </div>
          <p className={styles.workflowFootnote}>{phase.note}</p>
        </li>)}
      </ol>
    </div>
  </section>;
}
