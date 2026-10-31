// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: "My wallets" in Credentials — the wallets saved to the signed-in FloFi account, beside the existing
 * device-local wallet references (whose localStorage schema and semantics are unchanged).
 *
 * Each wallet shows its name, ecosystem, public address, provider and type (generated, imported or external) and, for external
 * wallets, whether it is connected in this browser. Removing a wallet removes FloFi's association only. Export is offered only for
 * FloFi-managed wallets whose provider supports it, and happens entirely in FloFi Wallet (its own origin): a fresh unlock there, an
 * explicit confirmation there, and the secret shown only inside the provider's frame there. This page never holds a wallet key.
 * MetaMask, Phantom and other external wallets never offer key export: FloFi never held their keys.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n/locale';
import { accountState, deleteFloFiAccount, linkAccountWallet, removeAccountWallet, renameAccountWallet, type AccountState } from '../../app/account-action';
import { openFloFiWallet, requestFloFiWallet } from '../../wallet/flofi-wallet-channel';
import { exportActions, shortAddress, WALLET_LABEL_MAX, type AccountWallet } from '../../accounts/account-model';
import { ECOSYSTEM_LABEL } from '../../wallet/wallet-registry';
import { useWalletProof, walletProofMessage, type Namespace } from '../wallet-proof';
import { AccountIcon } from './account-icons';
import { accountMessage } from './account-messages';
import { managedReadiness, useFloFiWalletReady } from './add-wallets';
import styles from './account.module.css';

export type ActiveWallet = { readonly ecosystem: 'evm' | 'solana'; readonly address: string };
const ORIGIN_LABEL = { generated: 'Generated', imported: 'Imported', external: 'External' } as const;

/**
 * The export entry point on the product page. It shows no secret and asks for no confirmation of its own: export happens in FloFi Wallet
 * (another origin), which asks for a fresh unlock and the explicit confirmation, then shows the secret only inside Turnkey's frame.
 */
export function ExportWalletDialog({ wallet, state, onClose }: { wallet: AccountWallet; state: AccountState; onClose(): void }) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const readiness = managedReadiness(state), ready = useFloFiWalletReady(readiness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const actions = exportActions(wallet);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  /** Opens FloFi Wallet in this click (popups need the gesture), then asks it to export there. */
  function open(kind: 'private-key' | 'recovery-phrase') {
    if (busy) return;
    setBusy(true); setError(null); setDone(false);
    try { openFloFiWallet(); } catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : 'FLOFI_WALLET_NOT_OPEN'); return; }
    void requestFloFiWallet({ op: 'export', walletId: wallet.id, kind }).then(() => setDone(true),
      cause => setError(cause instanceof Error ? cause.message : 'MANAGED_EXPORT_UNAVAILABLE')).finally(() => setBusy(false));
  }
  return <dialog ref={dialog} className={styles.frameDialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.frameBody}>
      <button type="button" className={styles.close} aria-label={t('Close')} onClick={onClose}><AccountIcon name="close" size={16}/></button>
      <h2 id={titleId}>{t('Export wallet')}</h2>
      <p>{t(actions.includes('recovery-phrase') ? 'Copy either your private key or recovery phrase to use this wallet in another app.' : 'Copy your private key to use this wallet in another app.')}</p>
      <div className={styles.warning} role="note"><AccountIcon name="warning" size={18}/><span>{t('Never share your private key or recovery phrase with anyone. Whoever has it controls this wallet and its funds. FloFi will never ask for it.')}</span></div>
      <div className={styles.walletBox}><span>{t('Your wallet')}</span>
        <div className={styles.walletLine}><span><strong>{wallet.label}</strong><br/><code title={wallet.address}>{shortAddress(wallet.address)}</code></span></div></div>
      <p className={styles.small}>{t('Export happens in FloFi Wallet, a separate secure window: you unlock it again there, confirm, and the secret is shown only inside Turnkey’s secure frame. This page never sees it.')}</p>
      {readiness !== 'ready' && <p className={styles.small} role="status">
        {t(accountMessage(readiness === 'needs-identity' ? 'MANAGED_WALLETS_NEED_SOCIAL_SIGN_IN' : 'MANAGED_WALLETS_NOT_CONFIGURED'))}</p>}
      <div className={styles.exportActions}>
        {actions.includes('private-key') && <button type="button" className={styles.primary} disabled={busy || !ready} onClick={() => open('private-key')}>
          <AccountIcon name="key" size={18}/>{t('Export private key in FloFi Wallet')}</button>}
        {actions.includes('recovery-phrase') && <button type="button" className={styles.primary} disabled={busy || !ready} onClick={() => open('recovery-phrase')}>
          <AccountIcon name="phrase" size={18}/>{t('Export recovery phrase in FloFi Wallet')}</button>}
      </div>
      {busy && <p className={styles.status} role="status">{t('Continue in FloFi Wallet…')}</p>}
      {done && <p className={styles.status} role="status">{t('Export finished in FloFi Wallet.')}</p>}
      {error && <p className={styles.error} role="alert">{t(accountMessage(error))}</p>}
      <p className={styles.protected}><AccountIcon name="lock" size={14}/>{t('Protected by')} <strong>Turnkey</strong></p>
    </div>
  </dialog>;
}

function AccountWalletCard({ wallet, active, state, signIn, onChanged, onStatus }: { wallet: AccountWallet; active: boolean; state: AccountState; signIn: boolean;
  onChanged(): void; onStatus(text: string): void }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<'view' | 'rename' | 'remove'>('view');
  const [draft, setDraft] = useState(wallet.label);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const inputId = useId();
  const managed = wallet.origin !== 'external';
  async function rename() {
    const result = await renameAccountWallet(wallet.id, draft).catch(() => ({ ok: false as const, code: 'ACCOUNTS_UNAVAILABLE' }));
    if (!result.ok) { setError(result.code); return; }
    setMode('view'); setError(null); onStatus(t('Wallet renamed.')); onChanged();
  }
  async function remove() {
    const result = await removeAccountWallet(wallet.id).catch(() => ({ ok: false as const, code: 'ACCOUNTS_UNAVAILABLE' }));
    if (!result.ok) { setError(result.code); return; }
    onStatus(t(managed ? '{0} removed from your FloFi account. The wallet still exists at Turnkey and its funds are unchanged.'
      : '{0} removed from your FloFi account. Your wallet and its funds are unchanged.', wallet.label)); onChanged();
  }
  const state_ = managed ? t('Managed by Turnkey') : t(active ? 'Connected' : 'Not connected');
  return <article className="workspace-wallet-card" aria-label={`${wallet.label}, ${ECOSYSTEM_LABEL[wallet.ecosystem]}`} data-origin={wallet.origin} data-active={active ? 'true' : 'false'}>
    <div className="workspace-wallet-heading">
      <span className="workspace-network-icon"><img src={wallet.ecosystem === 'evm' ? '/brand/crypto/ethereum.svg' : '/brand/crypto/solana.svg'} width="28" height="28" alt=""/></span>
      <div><h3>{wallet.label}</h3><p>{wallet.providerName} · {ECOSYSTEM_LABEL[wallet.ecosystem]} · {t(ORIGIN_LABEL[wallet.origin])}</p></div>
      <span className={`workspace-wallet-status${active ? ' workspace-wallet-status-active' : ''}`}>{state_}</span>
    </div>
    {managed && <p className="workspace-wallet-signing" data-managed-signing="flofi-wallet">{t('Signs in FloFi Wallet, after you review the transaction in FloFi.')}</p>}
    <div className="workspace-wallet-address"><code title={wallet.address}>{shortAddress(wallet.address)}</code>
      <button type="button" className="workspace-copy" aria-label={t('Copy {0} address', wallet.label)} title={t('Copy address')}
        onClick={() => void navigator.clipboard.writeText(wallet.address).then(() => onStatus(t('Address copied.')), () => onStatus(t('Address could not be copied.')))}>
        <AccountIcon name="copy" size={17}/></button></div>
    {mode === 'rename' ? <form className="workspace-inline-form" onSubmit={event => { event.preventDefault(); void rename(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setMode('view'); setDraft(wallet.label); setError(null); } }}>
      <label htmlFor={inputId}>{t('Wallet name')}</label>
      <input id={inputId} value={draft} maxLength={WALLET_LABEL_MAX} autoComplete="off" autoFocus onChange={event => setDraft(event.currentTarget.value)}/>
      <div className="workspace-wallet-actions"><button type="submit" className="workspace-action">{t('Save name')}</button>
        <button type="button" className="workspace-action" onClick={() => { setMode('view'); setDraft(wallet.label); setError(null); }}>{t('Cancel')}</button></div>
    </form> : mode === 'remove' ? <div className="workspace-inline-form" role="group" aria-label={t('Remove {0}', wallet.label)}>
      <p>{t(managed ? 'Remove {0} from your FloFi account? The wallet is not deleted: it stays with Turnkey, and its funds are unchanged. Export it first if you want to keep using it elsewhere.'
        : 'Remove {0} from your FloFi account? Only FloFi’s association is removed; the wallet and its assets are not affected.', wallet.label)}
        {signIn ? ` ${t('You will no longer be able to sign in with this wallet, unless it is your only way to sign in.')}` : ''}</p>
      <div className="workspace-wallet-actions"><button type="button" className="workspace-action workspace-action-danger" onClick={() => void remove()}>{t('Remove')}</button>
        <button type="button" className="workspace-action" onClick={() => setMode('view')}>{t('Cancel')}</button></div>
    </div> : <div className="workspace-wallet-actions">
      <button type="button" className="workspace-action" aria-label={t('Rename {0}', wallet.label)} onClick={() => { setDraft(wallet.label); setMode('rename'); }}>{t('Rename')}</button>
      {exportActions(wallet).length > 0 && <button type="button" className="workspace-action" aria-label={t('Export {0}', wallet.label)} onClick={() => setExporting(true)}>{t('Export')}</button>}
      <button type="button" className="workspace-action" aria-label={t('Remove {0}', wallet.label)} onClick={() => setMode('remove')}>{t('Remove')}</button>
    </div>}
    {error && <p className="workspace-inline-error" role="alert">{t(accountMessage(error))}</p>}
    {exporting && <ExportWalletDialog wallet={wallet} state={state} onClose={() => setExporting(false)}/>}
  </article>;
}

/** Link buttons: mounted only for a signed-in account, so the wallet proof (and its selector) is never needed otherwise. */
function LinkWalletButtons({ onStatus, onLinked }: { onStatus(text: string): void; onLinked(): void }) {
  const { t } = useLocale();
  const [linking, setLinking] = useState(false);
  const evm = useWalletProof('eip155'), solana = useWalletProof('solana');
  /** Links exactly this proof (a new signature in the chosen wallet). Closing the chooser cancels; nothing else is linked. */
  async function link(value: Namespace) {
    onStatus(''); setLinking(true);
    const outcome = await (value === 'eip155' ? evm.proveEvm(true) : solana.proveSolana(true));
    if (!outcome.account) { setLinking(false); if (outcome.error) onStatus(t(walletProofMessage(outcome.error, value))); return; }
    const result = await linkAccountWallet(value, outcome.wallet?.key ?? 'injected', outcome.wallet?.name ?? (value === 'eip155' ? 'EVM wallet' : 'Solana wallet'))
      .catch(() => ({ ok: false as const, code: 'ACCOUNTS_UNAVAILABLE' }));
    setLinking(false);
    onStatus(result.ok ? t('{0} linked to your FloFi account. It is also your active wallet in FloFi now.', result.value.label) : t(accountMessage(result.code)));
    if (result.ok) onLinked();
  }
  return <>
    <button type="button" className="workspace-action" disabled={linking} onClick={() => void link('eip155')}>{t('Link EVM wallet')}</button>
    <button type="button" className="workspace-action" disabled={linking} onClick={() => void link('solana')}>{t('Link Solana wallet')}</button>
  </>;
}

/** Deleting the FloFi account: explicit confirmation, a recent sign-in, and an honest statement of what is and is not deleted. */
function DeleteAccount({ state }: { state: AccountState }) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managed = state.account?.wallets.some(wallet => wallet.origin !== 'external') ?? false;
  async function remove() {
    const result = await deleteFloFiAccount().catch(() => ({ ok: false as const, code: 'ACCOUNTS_UNAVAILABLE' }));
    if (!result.ok) { setError(result.code); return; }
    window.location.assign('/login');
  }
  return <div className="workspace-inline-form" role="group" aria-label={t('Delete FloFi account')}>
    {confirming ? <>
      <p>{t('Delete your FloFi account? Your sign-in identities, sessions and saved wallet addresses are deleted from FloFi.')}{' '}
        {t(managed ? 'Wallets created or imported with Turnkey are not deleted and FloFi can no longer show or export them: export them first if you want to keep using them.'
          : 'Your wallets and their funds are not affected.')}</p>
      <div className="workspace-wallet-actions"><button type="button" className="workspace-action workspace-action-danger" onClick={() => void remove()}>{t('Delete account')}</button>
        <button type="button" className="workspace-action" onClick={() => { setConfirming(false); setError(null); }}>{t('Cancel')}</button></div>
      {error === 'ACCOUNT_REAUTHENTICATION_REQUIRED' ? <p className="workspace-inline-error" role="alert">{t(accountMessage(error))}{' '}
        <a className="workspace-action" style={{ textDecoration: 'none' }} href="/login?returnTo=%2Fapp%2Fcredentials">{t('Sign in again')}</a></p>
        : error && <p className="workspace-inline-error" role="alert">{t(accountMessage(error))}</p>}
    </> : <div className="workspace-wallet-actions"><button type="button" className="workspace-action workspace-action-danger" onClick={() => setConfirming(true)}>{t('Delete FloFi account')}</button></div>}
  </div>;
}

/** Credentials → My wallets (FloFi account). `active` lists the wallets connected in this browser right now. */
export function AccountWalletsSection({ active }: { active: readonly ActiveWallet[] }) {
  const { t } = useLocale();
  const [state, setState] = useState<AccountState | null>(null);
  const [status, setStatus] = useState('');
  const load = useCallback(() => { void accountState().then(setState, () => setState(null)); }, []);
  useEffect(() => { load(); }, [load]);
  // A Google/Apple/email link that failed returns here with a classified code.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('account_error');
    if (code && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)) setStatus(t(accountMessage(code)));
  }, [t]);
  if (!state || !state.availability.accounts) return null;
  if (!state.account) return <section className="workspace-section" aria-labelledby="credentials-account">
    <div className="workspace-section-heading"><div><AccountIcon name="shield"/><h2 id="credentials-account">{t('My wallets')}</h2></div></div>
    <div className="workspace-empty"><span className="workspace-empty-icon"><AccountIcon name="wallet" size={28}/></span><h3>{t('Keep your wallets with your FloFi account')}</h3>
      <p>{t('Sign in to save wallet addresses to your account and find them on any device. Wallets saved only on this device are listed below.')}</p>
      <a className="workspace-action" style={{ textDecoration: 'none' }} href="/login?returnTo=%2Fapp%2Fcredentials">{t('Sign in')}</a></div>
  </section>;
  const wallets = state.account.wallets;
  const isActive = (wallet: AccountWallet) => active.some(entry => entry.ecosystem === wallet.ecosystem && entry.address === wallet.address);
  const signIn = (wallet: AccountWallet) => state.account!.identities.some(identity => (identity.kind === 'eip155' || identity.kind === 'solana') && identity.label === wallet.address);
  return <section className="workspace-section" aria-labelledby="credentials-account">
    <div className="workspace-section-heading"><div><AccountIcon name="shield"/><h2 id="credentials-account">{t('My wallets')}</h2><span className="workspace-count">{wallets.length}</span></div>
      <div className="workspace-wallet-actions">
        <a className="workspace-action" style={{ textDecoration: 'none' }} href="/onboarding/wallets"><AccountIcon name="plus" size={16}/>{t('Create or import')}</a>
        <LinkWalletButtons onStatus={setStatus} onLinked={load}/>
      </div></div>
    <p className="workspace-notice" role="status">{status}</p>
    {wallets.length ? <div className="workspace-wallet-grid">{wallets.map(wallet => <AccountWalletCard key={wallet.id} wallet={wallet} active={isActive(wallet)} state={state}
      signIn={signIn(wallet)} onChanged={load} onStatus={setStatus}/>)}</div>
      : <div className="workspace-empty"><span className="workspace-empty-icon"><AccountIcon name="wallet" size={28}/></span><h3>{t('No wallets in your account yet')}</h3>
        <p>{t('Create or import a wallet, or link one you already use. Linking asks your wallet to sign a message; it approves no transaction.')}</p></div>}
    <DeleteAccount state={state}/>
  </section>;
}
