// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: create or import wallets (EVM and Solana) in FloFi Wallet.
 *
 * FloFi Wallet is a separate window on its own origin (src/accounts/wallet-origin.ts). It alone holds the provider session that can
 * create, import, sign or export, after the person unlocks it there with their email code or Google/Apple sign-in. This page never
 * holds a wallet key or provider session: each button opens FloFi Wallet inside the click (popups need the gesture) and asks it to
 * create or import. FloFi Wallet saves the new wallet to the account only after the provider confirms it belongs to this person, and
 * answers with its public address. Import happens in the provider's own frame inside FloFi Wallet. When this deployment cannot do it,
 * the screen says why and nothing is simulated.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/locale';
import { setAccountOnboarding, type AccountState } from '../../app/account-action';
import { canonicalAddress, isManagedLogin, shortAddress } from '../../accounts/account-model';
import { openFloFiWallet, requestFloFiWallet } from '../../wallet/flofi-wallet-channel';
import { syncFloFiWallets } from '../../wallet/flofi-wallet-sync';
import { useFloFiWallet } from '../flofi-wallet-continue';
import type { WalletEcosystem } from '../../wallet/wallet-registry';
import { AccountIcon } from './account-icons';
import { accountMessage } from './account-messages';
import { AccountShell, accountStyles as styles } from './account-shell';

type Readiness = 'ready' | 'not-configured' | 'needs-identity';
type Added = { readonly ecosystem: WalletEcosystem; readonly address: string; readonly origin: 'generated' | 'imported' };

/** Whether this account can use FloFi Wallet on this deployment. Unlocking happens in FloFi Wallet itself. */
export function managedReadiness(state: AccountState | null): Readiness {
  if (!state?.account || !state.availability.managedWallets) return 'not-configured';
  // The identity the account was created with must be Google, Apple or email (wallet-service.ts methodsOf): a later link cannot become the
  // root of FloFi Wallet.
  const created = state.account.identities[0];
  return created && isManagedLogin(created.kind) ? 'ready' : 'needs-identity';
}

/**
 * Whether FloFi Wallet can be opened from this page now: this account can use it, and the page has learned FloFi Wallet's origin from the
 * server (the window must open synchronously inside the click, so it cannot wait for that read then).
 */
export function useFloFiWalletReady(readiness: Readiness): boolean {
  const wallet = useFloFiWallet();
  useEffect(() => { if (readiness === 'ready') void syncFloFiWallets({ force: true }); }, [readiness]);
  return readiness === 'ready' && wallet.configured;
}

export function AddWallets({ state }: { state: AccountState }) {
  const { t } = useLocale();
  const readiness = managedReadiness(state);
  const [added, setAdded] = useState<Added[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const ready = useFloFiWalletReady(readiness);
  /** Opens FloFi Wallet synchronously in this click, then asks it to create or import; it saves the wallet itself. */
  function ask(ecosystem: WalletEcosystem, kind: 'create' | 'import') {
    setBusy(`${kind}:${ecosystem}`); setError(null); setStatus(t('Continue in FloFi Wallet…'));
    try { openFloFiWallet(); } catch (cause) { setBusy(null); setStatus(''); setError(cause instanceof Error ? cause.message : 'FLOFI_WALLET_NOT_OPEN'); return; }
    void requestFloFiWallet({ op: kind, ecosystem }).then(result => {
      const wallet = 'wallet' in result ? result.wallet : null, address = wallet ? canonicalAddress(ecosystem, wallet.address) : null;
      if (!wallet || wallet.ecosystem !== ecosystem || !address) throw new Error('MANAGED_RESPONSE_INVALID');
      setAdded(current => current.some(entry => entry.ecosystem === ecosystem && entry.address === address) ? current
        : [...current, { ecosystem, address, origin: kind === 'create' ? 'generated' : 'imported' }]);
      setStatus(t(kind === 'create' ? '{0} wallet created: {1}' : '{0} key imported: {1}', ecosystem === 'evm' ? 'EVM' : 'Solana', shortAddress(address)));
      // The new address becomes a FloFi Wallet entry in the wallet selectors at once.
      void syncFloFiWallets({ force: true });
    }).catch(cause => { setStatus(''); setError(cause instanceof Error ? cause.message : 'MANAGED_ACTIVITY_NOT_COMPLETED'); })
      .finally(() => setBusy(null));
  }
  async function finish() {
    setBusy('save'); setError(null);
    await setAccountOnboarding('completed').catch(() => undefined);
    window.location.assign('/app');
  }
  const tile = (ecosystem: WalletEcosystem, kind: 'create' | 'import') => {
    const done = added.filter(wallet => wallet.ecosystem === ecosystem && wallet.origin === (kind === 'create' ? 'generated' : 'imported'));
    return <button type="button" className={`${styles.tile}${done.length ? ` ${styles.tileDone}` : ''}`} disabled={!ready || busy !== null}
      aria-label={`${t(kind === 'create' ? 'Create {0} wallet' : 'Import {0} key', ecosystem === 'evm' ? 'EVM' : 'Solana')}${done.length
        ? ` — ${t(kind === 'create' ? 'created: {0}' : 'imported: {0}', done.map(wallet => shortAddress(wallet.address)).join(', '))}` : ''}`}
      onClick={() => ask(ecosystem, kind)}>
      <strong><AccountIcon name={done.length ? 'check' : kind === 'create' ? 'plus' : 'import'} size={16}/>{t(kind === 'create' ? 'Create wallet' : 'Import key')}</strong>
      {done.length ? <code>{done.map(wallet => shortAddress(wallet.address)).join(', ')}</code>
        : <small>{t(busy === `${kind}:${ecosystem}` ? 'Waiting for FloFi Wallet…' : kind === 'create' ? 'Generate a fresh wallet in seconds, ready to use right away'
          : 'Bring an existing wallet with its private key, entered in Turnkey’s secure field')}</small>}
    </button>;
  };
  return <AccountShell showcase="wallets" start>
    <p className={styles.crumbs}><a href="/onboarding">{t('Account')}</a> / <span aria-current="page">{t('Add wallets')}</span></p>
    <h1 className={styles.heading} style={{ marginTop: 28 }}>{t('Add your wallets')}</h1>
    <p className={`${styles.lead} ${styles.center}`} style={{ textAlign: 'center' }}>{t('Create a new wallet or import one you already have. Keys are created and kept by our wallet provider, Turnkey — FloFi never sees or stores them.')}</p>
    <div className={styles.notice} role="note" data-managed-wallet="flofi-wallet"><span className={styles.noticeIcon}><AccountIcon name="shield" size={18}/></span><div>
      <strong>{t('Your wallets open in FloFi Wallet')}</strong>
      <p>{t('FloFi Wallet is a separate secure window. You unlock it with your email code or Google/Apple sign-in, and you confirm every signature there, after reviewing it in FloFi. FloFi’s own pages never hold your wallet.')}</p></div></div>
    {readiness === 'not-configured' && <div className={styles.banner} role="status"><strong>{t("Creating and importing wallets isn't available on this deployment yet.")}</strong>
      <p>{t('You can still connect MetaMask, Phantom or Solflare in Credentials and use them with FloFi.')}</p></div>}
    {readiness === 'ready' && !ready && <p className={styles.status} role="status">{t('Connecting to FloFi Wallet…')}</p>}
    {readiness === 'needs-identity' && <div className={styles.banner} role="status"><strong>{t('You signed in with a wallet.')}</strong>
      <p>{t('FloFi Wallet needs a FloFi account created with Google, Apple or email, which also protects its recovery. A sign-in linked later cannot take that role. Your connected wallet keeps working as it is.')}</p></div>}
    <section className={`${styles.ecosystem} ${styles.ecosystemEvm}`} aria-label="EVM">
      <div className={styles.ecosystemTab}><img src="/brand/crypto/ethereum.svg" alt=""/><span>EVM</span></div>
      <div className={styles.tiles}>{tile('evm', 'create')}{tile('evm', 'import')}</div>
    </section>
    <section className={`${styles.ecosystem} ${styles.ecosystemSolana}`} aria-label="Solana">
      <div className={styles.ecosystemTab}><img src="/brand/crypto/solana.svg" alt=""/><span>Solana</span></div>
      <div className={styles.tiles}>{tile('solana', 'create')}{tile('solana', 'import')}</div>
    </section>
    {added.length > 0 && <ul className={styles.pending} aria-label={t('Wallets saved to your account')}>{added.map(wallet => <li key={`${wallet.ecosystem}:${wallet.address}`}>
      <span>{wallet.ecosystem === 'evm' ? 'EVM' : 'Solana'} · <code title={wallet.address}>{shortAddress(wallet.address)}</code></span>
      <span className={`${styles.badge} ${styles.badgeGreen}`}>{t(wallet.origin === 'generated' ? 'Newly created' : 'Newly imported')}</span></li>)}</ul>}
    <p className={styles.status} role="status">{status}</p>
    {error && <p className={styles.error} role="alert">{t(accountMessage(error))}</p>}
    <div className={styles.saveRow}>
      <button type="button" className={styles.outline} disabled={added.length === 0 || busy !== null} onClick={() => void finish()}>{t(busy === 'save' ? 'Opening FloFi…' : 'Continue to FloFi')}</button>
      <div className={styles.row} style={{ justifyContent: 'center', gap: 22 }}>
        <a className={styles.textLink} href="/app/credentials">{t('Connect an existing wallet instead')}</a>
        <button type="button" className={styles.textLink} disabled={busy !== null} onClick={() => void setAccountOnboarding('dismissed').finally(() => window.location.assign('/app'))}>
          {t('Skip for now')}</button>
      </div>
      <p className={styles.small}>{t('Adding a wallet authorizes nothing. Every transaction is still simulated, reviewed and signed by you.')}</p>
    </div>
  </AccountShell>;
}
