// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import styles from './landing.module.css';
import type { LandingCopy } from './landing-copy';
import { CryptoMark, type CryptoName } from './crypto-visuals';
import { MascotDock, MASCOT_REACT_EVENT, mascotMotionEnabled, type MascotReaction } from './mascot-journey';
import { ActionIcon } from '../action-icon';
import { useTimeline, type TimelineState } from './scripted-steps';
import { DEMO_REACTIONS, DEMO_TICKS, demoFrame, type CardState, type Status } from './demo-timeline';

/** The owner's single example. Only the visitor's own amounts appear: no quote, rate, fee, balance, limit, hash or outcome. */
export const DEMO_WORKFLOW = [
  { action: 'supply', label: 'demoCardSupply', valueLabel: 'demoAmount', amount: '1', asset: 'ETH', note: null },
  { action: 'borrow', label: 'demoCardBorrow', valueLabel: 'demoRequested', amount: '500', asset: 'USDC', note: 'demoBorrowNote' },
] as const satisfies readonly { action: 'supply' | 'borrow'; label: keyof LandingCopy; valueLabel: keyof LandingCopy; amount: string; asset: CryptoName; note: keyof LandingCopy | null }[];
export const DEMO_PROTOCOL = { name: 'Aave', network: 'Ethereum' } as const;

function ControlIcon({ state }: { state: TimelineState }) {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {state === 'done' ? <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.8h2.8"/> : state === 'paused' ? <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor"/> : <path d="M5.5 3.5v9M10.5 3.5v9"/>}
  </svg>;
}

function DemoCard({ t, index, item, state, focus }: { t: LandingCopy; index: number; item: typeof DEMO_WORKFLOW[number]; state: CardState; focus: boolean }) {
  return <div className={styles.demoCard} data-demo-card={item.action} data-state={state} data-focus={focus || undefined}>
    <div className={styles.demoCardBody}>
      <p className={styles.demoCardTitle}><strong>{index + 1}. {t[item.label]}</strong><ActionIcon action={item.action}/></p>
      <p className={styles.demoCardProvider}><b>{DEMO_PROTOCOL.name}</b> · {DEMO_PROTOCOL.network}</p>
      <div className={styles.demoValue}>
        <small>{t[item.valueLabel]}</small>
        <span><strong>{item.amount}</strong><span className={styles.demoToken}><CryptoMark name={item.asset}/>{item.asset}</span></span>
      </div>
      {item.note && <p className={styles.demoCardNote}>{t[item.note]}</p>}
    </div>
  </div>;
}

function Progress({ status, line, children }: { status: Status; line?: string; children: string }) {
  return <li data-status={status} data-demo-line={line}><i aria-hidden="true"/><span>{children}</span></li>;
}

/**
 * BUILD-FLOFI-UX-UI-002 "How it works" (owner revision): one guided story on one timeline — the visitor's request is typed and sent,
 * the mascot reacts and FloFi answers while the Canvas builds Supply → Borrow, then Simulate and Execute unfold in the same Canvas. It
 * is a scripted illustration: no input, request, wallet, signature, storage or financial value. The animated picture is decorative for
 * assistive technology, which reads the equivalent summary; the pause control and the closing link stay operable.
 */
export function ConversationDemo({ t }: { t: LandingCopy }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const timeline = useTimeline(stageRef, DEMO_TICKS);
  const f = demoFrame(DEMO_TICKS[timeline.index]!);
  const playing = timeline.state === 'playing';
  // The existing journey controller answers only while this section's dock is its active dock.
  useEffect(() => {
    const state = DEMO_REACTIONS[f.cue];
    if (!playing || !state) return;
    window.dispatchEvent(new CustomEvent<MascotReaction>(MASCOT_REACT_EVENT, { detail: { scene: 'demo', state } }));
  }, [f.cue, playing]);
  const typed = t.demoPrompt.slice(0, Math.ceil(t.demoPrompt.length * f.typed));
  const control = timeline.state === 'done' ? [t.demoReplay, t.demoReplayLabel] : timeline.state === 'paused' ? [t.demoPlay, t.demoPlayLabel] : [t.demoPause, t.demoPauseLabel];
  const stages = [[t.demoStageBuild, f.stages.build], [t.demoStageSimulate, f.stages.simulate], [t.demoStageExecute, f.stages.execute]] as const;
  const checks = [t.demoCheckWorkflow, t.demoCheckCollateral, t.demoCheckCosts, t.demoCheckManifest];
  const steps = [t.demoStepReview, t.demoStepWallet, t.demoStepRun, t.demoStepStatus];
  return <section id="demo" className={styles.demoSection} aria-labelledby="demo-title">
    <div className={styles.container}>
      <div className={styles.scenariosHeading}><div><p className={styles.kicker}>{t.demoEyebrow}</p><h2 id="demo-title">{t.demoTitle}</h2></div><p>{t.demoBody}</p></div>
      <p className={styles.srOnly}>{t.demoSummary.replace('{0}', t.demoPrompt)}</p>
      <div ref={stageRef} className={styles.demoStage} data-demo-cue={f.cue} data-demo-stage={f.stage} data-demo-state={timeline.state}>
        <div className={styles.demoChat} data-demo-chat>
          <div className={styles.demoChatHead}>
            {mascotMotionEnabled ? <MascotDock scene="demo" compact/> : <span className={styles.demoAvatar}><Image src="/brand/flofi-symbol-light.svg" alt="" width={370} height={345} unoptimized/></span>}
            <div><strong>FloFi</strong><span className={styles.demoBadge}>{t.demoIllustration}</span></div>
            <button type="button" className={styles.demoControl} data-demo-control={timeline.state} aria-label={control[1]} hidden={timeline.state === 'static'} onClick={timeline.toggle}>
              <ControlIcon state={timeline.state}/><span>{control[0]}</span>
            </button>
          </div>
          <ol className={styles.demoThread} aria-hidden="true">
            <li className={styles.demoUser} data-shown={f.sent} data-demo-message="user">{t.demoPrompt}</li>
            <li className={styles.demoSlot}>
              <span className={styles.demoThinking} data-shown={f.thinking} data-demo-thinking><i/><i/><i/></span>
              <span className={styles.demoReply} data-shown={f.reply} data-demo-message="reply">{t.demoReply}</span>
            </li>
            <li className={styles.demoProgress}><ul><Progress status={f.supplyLine} line="supply">{t.demoAddSupply}</Progress><Progress status={f.borrowLine} line="borrow">{t.demoAddBorrow}</Progress></ul></li>
            <li className={styles.demoReply} data-shown={f.ready} data-demo-message="ready">{t.demoReady}</li>
            <li className={styles.demoProgress}><ul><Progress status={f.simulateLine} line="simulate">{t.demoSimulating}</Progress></ul></li>
            <li className={styles.demoReply} data-shown={f.handoff} data-demo-message="handoff">{t.demoHandoff}</li>
          </ol>
          <div className={styles.demoComposer} aria-hidden="true" data-composing={f.composing} data-sending={f.sending} data-demo-composer>
            <span className={styles.demoComposerText}>{f.composing ? <>{typed}<i className={styles.demoCaret}/></> : <span>{t.demoComposer}</span>}</span>
            <span className={styles.demoSend}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3m-4 4 4-4 4 4"/></svg></span>
          </div>
        </div>
        <div className={styles.demoCanvas} data-demo-canvas>
          <ol className={styles.demoStages} aria-hidden="true">
            {stages.map(([label, status], i) => <li key={i} data-status={status}><span>{i + 1}</span>{label}</li>)}
          </ol>
          <div className={styles.demoSurface} aria-hidden="true">
            <p className={styles.demoEmpty} data-shown={f.empty}>{t.demoCanvasEmpty}</p>
            <div className={styles.demoFlow}>
              <DemoCard t={t} index={0} item={DEMO_WORKFLOW[0]} state={f.supply} focus={f.focus.supply}/>
              <div className={styles.demoConnector} data-shown={f.connector} data-demo-connector><span>{t.demoAfterPrevious}</span><i/></div>
              <DemoCard t={t} index={1} item={DEMO_WORKFLOW[1]} state={f.borrow} focus={f.focus.borrow}/>
            </div>
            <div className={styles.demoPanels} data-stage={f.stage}>
              <div data-panel="build"><span className={styles.demoSimulateButton} data-state={f.simulateButton}>{t.demoSimulateButton}</span></div>
              <div data-panel="simulate"><p className={styles.demoPanelTitle}>{t.demoSimulation}</p><ul className={styles.demoChecks}>{checks.map((label, i) => <Progress key={i} status={f.checks[i]!}>{label}</Progress>)}</ul></div>
              <div data-panel="execute"><p className={styles.demoPanelTitle}>{t.demoExecution}</p><ol className={styles.demoSteps}>{steps.map((label, i) => <li key={i} data-status={f.steps[i]}><span>{i + 1}</span>{label}</li>)}</ol></div>
            </div>
          </div>
          <div className={styles.demoOutro}>
            <p>{t.demoNote}</p>
            <a href="/login" data-shown={f.done}>{t.demoCta} <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
