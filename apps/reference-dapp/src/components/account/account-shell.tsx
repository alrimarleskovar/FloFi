// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the two-column frame of sign-in and wallet onboarding. Left: the task. Right: the FloFi brand panel
 * (decorative, hidden from assistive technology except its text). On phones the brand becomes a band above the task.
 * The theme defaults to dark here unless the person chose light; the choice is the same `flofi.theme` preference the app uses.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from '../../i18n/locale';
import { AccountIcon } from './account-icons';
import styles from './account.module.css';

import { THEME_KEY } from '../../accounts/account-theme';

function ThemeToggle() {
  const { t } = useLocale();
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.dataset.theme !== 'light'); }, []);
  function toggle() {
    const next = dark ? 'light' : 'dark';
    setDark(!dark);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* applies for this visit */ }
  }
  return <button type="button" role="switch" aria-checked={dark} aria-label={t('Dark theme')} className={styles.themeToggle} onClick={toggle}>
    <span><AccountIcon name={dark ? 'moon' : 'sun'} size={14}/></span></button>;
}
function LanguageSwitch() {
  const { t, language, setLanguage } = useLocale();
  return <div className={styles.language} role="group" aria-label={t('Language')}>
    <button type="button" lang="pt-BR" aria-pressed={language === 'PT'} onClick={() => setLanguage('PT')}>PT</button>
    <button type="button" lang="en" aria-pressed={language === 'EN'} onClick={() => setLanguage('EN')}>EN</button>
  </div>;
}

const CHIPS: readonly { label: string; x: string; y: string; color: string }[] = [
  { label: 'Build', x: '18%', y: '10%', color: '#93A6FF' }, { label: 'Simulate', x: '64%', y: '8%', color: '#5FD4F5' },
  { label: 'Copilot', x: '2%', y: '34%', color: '#F5B94A' }, { label: 'EVM', x: '82%', y: '32%', color: '#93A6FF' },
  { label: 'Dashboard', x: '0%', y: '62%', color: '#A4ABB8' }, { label: 'Solana', x: '80%', y: '62%', color: '#9C7BFF' },
  { label: 'AI agents (MCP)', x: '14%', y: '86%', color: '#4ADE80' }, { label: 'Execute', x: '62%', y: '88%', color: '#2343D9' },
];
type Slide = 'account' | 'wallets' | 'review';
const SLIDES: readonly Slide[] = ['account', 'wallets', 'review'];
const SLIDE_TEXT: Readonly<Record<Slide, { title: string; body: string }>> = {
  account: { title: 'One account. Every workflow.', body: 'Keep your workflows and wallets with one FloFi account. Your wallet still reviews and signs every transaction.' },
  wallets: { title: 'Your wallets, your keys.', body: 'Create or import wallets with our wallet provider, or keep using MetaMask, Phantom and Solflare. FloFi never holds a key.' },
  review: { title: 'Nothing moves without you.', body: 'Signing in never approves a transaction. Every one is simulated, reviewed and signed by your own wallet.' },
};

function Showcase({ initial }: { initial: Slide }) {
  const { t } = useLocale();
  const [slide, setSlide] = useState<Slide>(initial);
  const [paused, setPaused] = useState(false), [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (paused || stopped || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setSlide(current => SLIDES[(SLIDES.indexOf(current) + 1) % SLIDES.length]!), 8000);
    return () => clearInterval(timer);
  }, [paused, stopped]);
  const text = SLIDE_TEXT[slide];
  return <aside className={styles.showcase} aria-label={t('About FloFi accounts')} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    {slide === 'account' ? <div className={styles.orbit} aria-hidden="true">
      {CHIPS.map(chip => <span key={chip.label} className={styles.chip} style={{ left: chip.x, top: chip.y, ['--chip' as string]: chip.color }}>{t(chip.label)}</span>)}
      <div className={styles.orbitCore}><img src="/brand/flofi-droplet-wave-dark.svg" alt=""/><small>FLOFI</small><strong>{t('Your account')}</strong><span>{t('One account for FloFi')}</span></div>
    </div> : slide === 'wallets' ? <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewCard}><small>EVM</small><p>{t('FloFi wallet · Generated')}</p><p><code>0x7a3…e91c</code></p></div>
      <div className={styles.previewCard}><small>SOLANA</small><p>{t('Phantom · Connected')}</p><p><code>9xQe…4Lm2</code></p></div>
      <div className={styles.previewCard}><small>{t('PROTECTED BY TURNKEY')}</small><p>{t('Keys are created and kept by Turnkey, not by FloFi.')}</p></div>
    </div> : <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewCard}><small>{t('YOUR WORKFLOW')}</small><p>{t('Swap 500 USDC → ETH on Base')}</p>
        <div className={styles.steps}><span>{t('Build')}</span><span>{t('Simulate')}</span><span>{t('Execute')}</span></div></div>
      <div className={styles.previewCard}><small>{t('STRATEGY MANIFEST')}</small><p>{t('Review fees, route and limits — then your wallet signs.')}</p></div>
    </div>}
    <div className={styles.showcaseText}><h2>{t(text.title)}</h2><p>{t(text.body)}</p></div>
    <div className={styles.dots} role="group" aria-label={t('Highlights')}>
      {SLIDES.map((value, index) => <button key={value} type="button" aria-label={t('Highlight {0} of {1}', index + 1, SLIDES.length)}
        aria-current={value === slide ? 'true' : undefined} onClick={() => setSlide(value)}/>)}
      <button type="button" className={styles.pause} aria-pressed={stopped} onClick={() => setStopped(value => !value)}>{t(stopped ? 'Play highlights' : 'Pause highlights')}</button>
    </div>
  </aside>;
}

export function AccountShell({ children, showcase = 'account', start = false }: { children: ReactNode; showcase?: Slide; start?: boolean }) {
  const { t } = useLocale();
  return <div className={styles.shell}>
    <main className={styles.panel}>
      <div className={styles.top}>
        <a className={styles.brand} href="/" aria-label={t('FloFi home')}>
          <img className={styles.wordmarkDark} src="/brand/flofi-wordmark-dark.png" alt="FloFi" height={30}/>
          <img className={styles.wordmarkLight} src="/brand/flofi-wordmark-light.png" alt="FloFi" height={30}/>
        </a>
        <div className={styles.controls}><LanguageSwitch/><ThemeToggle/></div>
      </div>
      <div className={styles.mobileBrand} aria-hidden="true"><strong>{t(SLIDE_TEXT[showcase].title)}</strong><span>{t('One account for FloFi')}</span>
        <div className={styles.mobileChips}>{['EVM', 'Solana', 'Copilot', 'AI agents (MCP)'].map(label => <span key={label} className={styles.chip}>{t(label)}</span>)}</div></div>
      <div className={`${styles.content}${start ? ` ${styles.contentStart}` : ''}`}>{children}</div>
    </main>
    <Showcase initial={showcase}/>
  </div>;
}
export { styles as accountStyles };
