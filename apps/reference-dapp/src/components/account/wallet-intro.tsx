// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the wallet introduction shown once to new Google, Apple and email accounts. It explains the difference
 * between the account (how you sign in) and a wallet (what signs transactions), offers to add wallets, and can be skipped: FloFi
 * builds workflows without any wallet. Completing or skipping is remembered on the account, so it is not shown again.
 */
import { useState } from 'react';
import { useLocale } from '../../i18n/locale';
import { accountSignOut, setAccountOnboarding, type AccountState } from '../../app/account-action';
import { IDENTITY_LABEL, shortAddress } from '../../accounts/account-model';
import { AccountIcon } from './account-icons';
import { accountMessage } from './account-messages';
import { AccountShell, accountStyles as styles } from './account-shell';

/** Signs this browser out of FloFi (server-side revocation). FloFi Wallet's session is bound to it and ends with it. */
export async function signOutThisBrowser(): Promise<void> {
  await accountSignOut().catch(() => undefined);
}
export function accountDisplay(account: NonNullable<AccountState['account']>): { name: string; method: string } {
  const own = account.identities.find(identity => identity.kind === account.method) ?? account.identities[0];
  const label = own?.label ?? '';
  return { name: own?.kind === 'eip155' || own?.kind === 'solana' ? shortAddress(label) : label, method: IDENTITY_LABEL[account.method] };
}

export function WalletIntro({ state }: { state: AccountState }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = state.account!;
  const display = accountDisplay(account);
  async function leave(value: 'completed' | 'dismissed', path: string) {
    setBusy(true); setError(null);
    const result = await setAccountOnboarding(value).catch(() => ({ ok: false as const, code: 'ACCOUNTS_UNAVAILABLE' }));
    if (result.ok) window.location.assign(path); else { setBusy(false); setError(result.code); }
  }
  return <AccountShell showcase="wallets">
    <section className={styles.account} aria-label={t('Signed-in account')}>
      <span className={styles.avatar}><img src="/brand/flofi-droplet-wave-dark.svg" alt=""/></span>
      <p className={styles.accountName}>{display.name || t('FloFi account')}</p>
      <span className={styles.accountMeta}><AccountIcon name={account.method === 'google' ? 'google' : account.method === 'apple' ? 'apple' : account.method === 'email' ? 'email' : 'wallet'} size={14}/>{t(display.method)}</span>
      <code className={styles.accountId} title={account.accountId}>{account.accountId.slice(0, 12)}…{account.accountId.slice(-4)}</code>
      <button type="button" className={styles.quiet} disabled={busy} onClick={() => void signOutThisBrowser().then(() => window.location.assign('/login'))}>{t('Sign out')}</button>
    </section>
    <h1 className={styles.heading}>{t('Your wallets. One FloFi account.')}</h1>
    <p className={`${styles.lead} ${styles.center}`} style={{ textAlign: 'center' }}>{t('Your account is how you sign in. A wallet is what signs transactions — and only after you review them.')}</p>
    <ul className={styles.explain}>
      <li><AccountIcon name="plus"/><span><strong>{t('Create a new wallet.')}</strong> {t('Generated in seconds by our wallet provider, Turnkey. FloFi never sees the key.')} {t('It opens in FloFi Wallet, a separate secure window where you confirm every signature.')}</span></li>
      <li><AccountIcon name="import"/><span><strong>{t('Import one you have.')}</strong> {t('Your key is typed into Turnkey’s isolated secure field, never into FloFi.')} {t('It opens in FloFi Wallet, a separate secure window where you confirm every signature.')}</span></li>
      <li><AccountIcon name="wallet"/><span><strong>{t('Connect the wallet you use.')}</strong> {t('Keep MetaMask, Phantom or Solflare. Your keys stay in your wallet.')}</span></li>
    </ul>
    <a className={styles.primary} href="/onboarding/wallets" aria-disabled={busy || undefined}>{t('Add wallets')}</a>
    <div className={styles.row} style={{ justifyContent: 'center', marginTop: 16, gap: 22 }}>
      <button type="button" className={styles.textLink} disabled={busy} onClick={() => void leave('completed', '/app/credentials')}>{t('Connect a wallet I already use')}</button>
      <button type="button" className={styles.textLink} disabled={busy} onClick={() => void leave('dismissed', '/app')}>{t('Skip for now')}</button>
    </div>
    {error && <p className={styles.error} role="alert">{t(accountMessage(error))}</p>}
    <div className={styles.ecosystems} style={{ marginTop: 40 }}>
      <div className={styles.ecosystemRow}><span><span className={`${styles.dot} ${styles.dotEvm}`}/>EVM</span><span><span className={`${styles.dot} ${styles.dotSolana}`}/>Solana</span></div>
      <p className={styles.small}>{t('These are the ecosystems FloFi supports today. Add one or both — nothing is locked in, and adding a wallet authorizes nothing.')}</p>
    </div>
  </AccountShell>;
}
