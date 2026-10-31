// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the end of a Google/Apple unlock, in the sign-in window FloFi Wallet opened. It tells the waiting FloFi
 * Wallet window (same origin, BroadcastChannel) to re-check its session, then closes itself. The notice is only a hint: the waiting
 * window believes its own server, never this page.
 */
import { useEffect } from 'react';
import { useLocale } from '../i18n/locale';
import { broadcast } from './channel';
import { walletMessage } from './wallet-messages';
import { WalletShell } from './wallet-shell';
import styles from './wallet.module.css';

export const DONE_CLOSE_DELAY_MS = 800;

export function WalletDone({ result }: { result: string }) {
  const { t } = useLocale();
  const unlocked = result === 'unlocked';
  useEffect(() => {
    broadcast(unlocked ? { type: 'unlocked' } : { type: 'error', code: result });
    const timer = setTimeout(() => { try { window.close(); } catch { /* the person closes it */ } }, DONE_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [result, unlocked]);
  return <WalletShell walletHost={null} account={null}>
    <section className={`${styles.card} ${styles.center}`} aria-labelledby="done-title">
      <h1 id="done-title" className={styles.heading}>{t(unlocked ? 'FloFi Wallet is unlocked' : 'Sign-in did not complete')}</h1>
      <p className={styles.lead} role={unlocked ? 'status' : 'alert'}>{unlocked ? t('You can close this window and return to FloFi Wallet.') : t(walletMessage(result))}</p>
      <button type="button" className={styles.outline} onClick={() => window.close()}>{t('Close window')}</button>
    </section>
  </WalletShell>;
}
