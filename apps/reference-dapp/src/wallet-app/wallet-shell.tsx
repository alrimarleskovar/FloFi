// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's frame: brand, language and theme, the FloFi account this window serves (always shown:
 * security review finding 6), its lock state, and a footer naming the only place codes are typed and signatures made. No product shell,
 * no workflow state. The theme is FloFi's dark-first choice (`flofi.theme` on this origin).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { THEME_KEY } from '../accounts/account-theme';
import { AccountIcon } from '../components/account/account-icons';
import { useLocale } from '../i18n/locale';
import styles from './wallet.module.css';

export { styles as walletStyles };

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
    <AccountIcon name={dark ? 'moon' : 'sun'} size={16}/></button>;
}
function LanguageSwitch() {
  const { t, language, setLanguage } = useLocale();
  return <div className={styles.language} role="group" aria-label={t('Language')}>
    <button type="button" lang="pt-BR" aria-pressed={language === 'PT'} onClick={() => setLanguage('PT')}>PT</button>
    <button type="button" lang="en" aria-pressed={language === 'EN'} onClick={() => setLanguage('EN')}>EN</button>
  </div>;
}

export type AccountBar = { readonly label: string; readonly unlocked: boolean; readonly minutesLeft: number | null; readonly onLock: (() => void) | null; readonly locking: boolean };
export function WalletShell({ walletHost, account, children }: { walletHost: string | null; account: AccountBar | null; children: ReactNode }) {
  const { t } = useLocale();
  return <div className={styles.root}>
    <div className={styles.frame}>
      <header className={styles.top}>
        <span className={styles.brand}><img src="/brand/flofi-symbol-dark.svg" alt="" width={28} height={28}/><span>FloFi <span>Wallet</span></span></span>
        <div className={styles.controls}><LanguageSwitch/><ThemeToggle/></div>
      </header>
      {account && <section className={styles.account} aria-label={t('FloFi account')}>
        <div><small>{t('FloFi account')}</small><strong title={account.label}>{account.label}</strong></div>
        <span className={`${styles.chip} ${account.unlocked ? styles.chipUnlocked : styles.chipLocked}`} role="status">
          {account.unlocked ? account.minutesLeft !== null ? t('Unlocked · {0} min left', account.minutesLeft) : t('Unlocked') : t('Locked')}
        </span>
        {account.onLock && <button type="button" className={styles.quiet} onClick={account.onLock} disabled={account.locking}>
          <AccountIcon name="lock" size={14}/>{t(account.locking ? 'Locking…' : 'Lock')}</button>}
      </section>}
      <main id="wallet-main" className={styles.main} tabIndex={-1}>{children}</main>
      <footer className={styles.foot}><AccountIcon name="shield" size={14}/>
        <span>{walletHost ? t('Codes are typed and signatures approved only here, at {0}. Nothing is signed without your click.', walletHost)
          : t('Nothing is signed without your click.')}</span></footer>
    </div>
  </div>;
}

/** Shown when this deployment has no FloFi Wallet (no wallet origin or no provider): nothing is simulated. */
export function WalletUnavailable({ appOrigin }: { appOrigin: string | null }) {
  const { t } = useLocale();
  return <WalletShell walletHost={null} account={null}>
    <section className={styles.card} aria-labelledby="wallet-unavailable">
      <p className={styles.eyebrow}>{t('FloFi Wallet')}</p>
      <h1 id="wallet-unavailable" className={styles.heading}>{t('FloFi Wallet isn’t available here')}</h1>
      <p className={styles.lead}>{t('This deployment has no FloFi Wallet configured, so it can’t create, unlock or sign anything. You can keep using MetaMask, Phantom or Solflare in FloFi.')}</p>
      {appOrigin && <a className={styles.outline} href={`${appOrigin}/app`}>{t('Go to FloFi')}</a>}
    </section>
  </WalletShell>;
}
