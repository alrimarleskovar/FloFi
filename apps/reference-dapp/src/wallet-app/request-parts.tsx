// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: what every FloFi Wallet request screen shares: the environment it receives from the wallet root, its
 * heading (focused when the request appears, so a screen reader announces it), and the Sign controls that arm only after a second of
 * attention (arming.ts) and accept only a real click. A request answers exactly once, through `succeed` or `refuse`.
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import type { AccountWallet } from '../accounts/account-model';
import { useLocale } from '../i18n/locale';
import type { WalletEcosystem } from '../wallet/wallet-registry';
import { useSignArming } from './arming';
import type { WalletResult } from './protocol';
import type { TurnkeyFrames } from './provider-client';
import type { Unlocked, UnlockConfig } from './unlock-panel';
import type { WalletContext } from './wallet-api';
import styles from './wallet.module.css';

export type WalletAppConfig = UnlockConfig & { readonly frames: TurnkeyFrames };
export type RequestEnv = {
  readonly id: string; readonly config: WalletAppConfig; readonly appHost: string; readonly context: WalletContext; readonly unlocked: boolean;
  /** Whether the unlock is recent enough to export (5 minutes); null when this window does not know when it happened. */
  readonly freshUnlock: boolean | null;
  readonly onUnlocked: (value: Unlocked) => void;
  readonly onContext: (context: WalletContext) => void;
  /** The relay said the unlock is gone (expired, or another window's key): show the unlock panel again. */
  readonly onLockRequired: () => void;
  /** While true, a lock or account change elsewhere does not cancel this request: its signing activity may already exist. */
  readonly setSigning: (signing: boolean) => void;
  readonly succeed: (result: WalletResult, outcome: string) => void;
  /** Answers with `code`; shows `display` (default: the same code) to the person. */
  readonly refuse: (code: string, display?: string) => void;
};

/** The managed wallet of this account at `address` (EVM case-insensitive), or null. */
export function managedWallet(context: WalletContext, ecosystem: WalletEcosystem, address: string): AccountWallet | null {
  const wanted = ecosystem === 'evm' ? address.toLowerCase() : address;
  return context.wallets.find(wallet => wallet.ecosystem === ecosystem && wallet.address === wanted) ?? null;
}

export function RequestHeading({ eyebrow, title, from }: { eyebrow: string; title: string; from: string | null }) {
  const { t } = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: false }); }, []);
  return <div>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1 ref={heading} id="request-title" className={styles.heading} tabIndex={-1}>{title}</h1>
    {from && <p className={styles.hint}>{t('Requested by {0}', from)}</p>}
  </div>;
}

/** Sign (or another confirming action) and Cancel. Sign arms after one second of attention, re-arms after every focus change. */
export function SignControls({ id, ready, busy, label, busyLabel, onSign, onCancel, children }: { id: string; ready: boolean; busy: boolean; label: string;
  busyLabel: string; onSign: () => void; onCancel: () => void; children?: ReactNode }) {
  const { t } = useLocale();
  const { armed, attentive } = useSignArming(ready ? id : null);
  const click = (event: MouseEvent<HTMLButtonElement>) => { if (event.nativeEvent.isTrusted && armed && ready && !busy) onSign(); };
  return <div className={styles.actions}>
    {children}
    {ready && <div className={`${styles.arming} ${armed ? styles.armingDone : attentive ? styles.armingActive : ''}`} aria-hidden="true"><span/></div>}
    <p id={`${id}-arming`} className={styles.hint} aria-live="polite">
      {!ready ? '' : armed ? t('Review everything above, then sign.') : attentive ? t('Sign becomes available in a moment.') : t('Click this window to continue.')}</p>
    <div className={styles.row}>
      <button type="button" className={styles.outline} onClick={onCancel} disabled={busy}>{t('Cancel')}</button>
      <button type="button" className={styles.primary} onClick={click} disabled={!ready || !armed || busy} aria-describedby={`${id}-arming`}>
        {t(busy ? busyLabel : label)}</button>
    </div>
  </div>;
}
