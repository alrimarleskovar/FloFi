// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: creating, importing and exporting managed wallets in FloFi Wallet (wallet origin only).
 *
 * - Create: the provider generates the wallet in its enclave; FloFi Wallet saves only its public address to the account after the
 *   server confirmed with the provider that it is in this person's organization, then answers FloFi with that address.
 * - Import: the key is typed only into the provider's own frame (another origin); FloFi Wallet never sees it.
 * - Export: needs an unlock in the last 5 minutes (the server and the relay enforce it too), an explicit warning the person
 *   acknowledges, and a second of attention before Show; the phrase or key is decrypted and shown only inside the provider's frame.
 */
import { useEffect, useRef, useState } from 'react';
import { canonicalAddress, exportActions, shortAddress, type AccountWallet } from '../accounts/account-model';
import { AccountIcon } from '../components/account/account-icons';
import { useLocale } from '../i18n/locale';
import type { WalletEcosystem } from '../wallet/wallet-registry';
import { createWallet, openExportFrame, openImportFrame } from './provider-client';
import { RequestHeading, SignControls, type RequestEnv } from './request-parts';
import { UnlockPanel } from './unlock-panel';
import { walletApi } from './wallet-api';
import { codeOf, walletMessage } from './wallet-messages';
import styles from './wallet.module.css';

const NAME: Readonly<Record<WalletEcosystem, string>> = Object.freeze({ evm: 'EVM', solana: 'Solana' });

export function WalletList({ wallets }: { wallets: readonly AccountWallet[] }) {
  const { t } = useLocale();
  if (!wallets.length) return <p className={styles.lead}>{t('No FloFi Wallet yet. Create or import one from FloFi.')}</p>;
  return <ul className={styles.list} aria-label={t('Your FloFi Wallets')}>
    {wallets.map(wallet => <li key={wallet.id}>
      <span className={styles.wallet}><span className={`${styles.dot} ${wallet.ecosystem === 'evm' ? styles.dotEvm : styles.dotSolana}`} aria-hidden="true"/>
        <span><strong>{wallet.label}</strong> <span className={styles.badge}>{NAME[wallet.ecosystem]}</span></span></span>
      <span className={styles.mono}>{wallet.address}</span>
    </li>)}
  </ul>;
}

/** Saves `address` to the account (server-checked with the provider) and answers with its public data. */
async function saveAndAnswer(env: RequestEnv, ecosystem: WalletEcosystem, address: string, outcome: string) {
  const { saved, context } = await walletApi.saveWallets([`${ecosystem}:${address}`]);
  env.onContext(context);
  const wallet = saved.find(entry => entry.ecosystem === ecosystem && entry.address === address)
    ?? context.wallets.find(entry => entry.ecosystem === ecosystem && entry.address === address);
  if (!wallet) throw new Error('ACCOUNT_WALLET_SAVE_FAILED');
  env.succeed({ wallet: { ecosystem, address, label: wallet.label } }, outcome);
}
function useUnlockFailure(env: RequestEnv) {
  return (cause: unknown, fallback: string): string => {
    const code = codeOf(cause, fallback);
    if (code === 'WALLET_UNLOCK_REQUIRED') env.onLockRequired();
    return code;
  };
}

export function CreateRequest({ env, ecosystem }: { env: RequestEnv; ecosystem: WalletEcosystem }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const created = useRef<string | null>(null), failure = useUnlockFailure(env);
  async function create() {
    setBusy(true); setError(null);
    try {
      const organization = env.context.organization;
      if (!organization) throw new Error('MANAGED_ORGANIZATION_MISSING');
      // A wallet already created in this request is saved again, never created twice.
      created.current ??= canonicalAddress(ecosystem, await createWallet(organization.organizationId, ecosystem)) ?? null;
      if (!created.current) throw new Error('MANAGED_RESPONSE_INVALID');
      await saveAndAnswer(env, ecosystem, created.current, t('{0} wallet created: {1}', NAME[ecosystem], shortAddress(created.current)));
    } catch (cause) { setError(failure(cause, 'MANAGED_ACTIVITY_NOT_COMPLETED')); }
    finally { setBusy(false); }
  }
  const cancel = () => created.current ? env.refuse(error ?? 'ACCOUNT_WALLET_SAVE_FAILED') : env.refuse('FLOFI_WALLET_REJECTED');
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('New wallet')} title={t('Create a {0} wallet', NAME[ecosystem])} from={env.appHost}/>
    <p className={styles.lead}>{t('Turnkey generates the wallet in its secure enclave. FloFi saves only its public address to your account; you can export its recovery phrase here later.')}</p>
    {!env.unlocked ? <UnlockPanel config={env.config} context={env.context} onUnlocked={env.onUnlocked}/> : null}
    {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    <div className={styles.row}>
      <button type="button" className={styles.outline} onClick={cancel} disabled={busy}>{t('Cancel')}</button>
      <button type="button" className={styles.primary} onClick={() => void create()} disabled={busy || !env.unlocked}>{t(busy ? 'Creating…' : 'Create wallet')}</button>
    </div>
  </section>;
}

export function ImportRequest({ env, ecosystem }: { env: RequestEnv; ecosystem: WalletEcosystem }) {
  const { t } = useLocale();
  const container = useRef<HTMLDivElement>(null), controller = useRef<{ submit(): Promise<string>; close(): void } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'importing' | 'failed'>('loading'), [error, setError] = useState<string | null>(null);
  const imported = useRef<string | null>(null), failure = useUnlockFailure(env);
  const organization = env.context.organization, frameTitle = t('Turnkey secure key field');
  useEffect(() => {
    if (!env.unlocked || !organization || !container.current) return;
    let current = true;
    setPhase('loading'); setError(null);
    void openImportFrame(env.config.frames, organization.organizationId, organization.userId, ecosystem, container.current).then(opened => {
      if (!current) { opened.close(); return; }
      container.current?.querySelector('iframe')?.setAttribute('title', frameTitle);
      controller.current = opened; setPhase('ready');
    }, cause => { if (current) { setPhase('failed'); setError(failure(cause, 'MANAGED_IMPORT_UNAVAILABLE')); } });
    return () => { current = false; controller.current?.close(); controller.current = null; };
    // The frame is opened once per unlock and organization; a language change does not reopen it.
  }, [env.unlocked, organization?.organizationId, organization?.userId, ecosystem, env.config.frames]);
  async function submit() {
    if (!controller.current && !imported.current) return;
    setPhase('importing'); setError(null);
    try {
      imported.current ??= canonicalAddress(ecosystem, await controller.current!.submit()) ?? null;
      if (!imported.current) throw new Error('MANAGED_RESPONSE_INVALID');
      await saveAndAnswer(env, ecosystem, imported.current, t('{0} key imported: {1}', NAME[ecosystem], shortAddress(imported.current)));
    } catch (cause) { setPhase('ready'); setError(failure(cause, 'MANAGED_ACTIVITY_NOT_COMPLETED')); }
  }
  const cancel = () => imported.current ? env.refuse(error ?? 'ACCOUNT_WALLET_SAVE_FAILED') : env.refuse('FLOFI_WALLET_REJECTED');
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('Import')} title={t('Import a {0} key', NAME[ecosystem])} from={env.appHost}/>
    {!env.unlocked ? <UnlockPanel config={env.config} context={env.context} onUnlocked={env.onUnlocked}/> : <>
      <p className={styles.lead}>{t(ecosystem === 'evm' ? 'Paste the private key (64 hexadecimal characters) of the wallet you want to bring.'
        : 'Paste the private key (base58) of the Solana wallet you want to bring.')}</p>
      <p className={styles.warning}><AccountIcon name="warning" size={18}/><span>{t('Type or paste it only into the secure field below. It belongs to Turnkey, on its own domain: FloFi cannot read it, and it is encrypted before it leaves this field.')}</span></p>
      <div ref={container} className={styles.providerFrame} role="group" aria-label={frameTitle} aria-busy={phase === 'loading'}/>
      {phase === 'loading' && <p className={styles.status} role="status">{t('Opening the secure field…')}</p>}
    </>}
    {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    <div className={styles.row}>
      <button type="button" className={styles.outline} onClick={cancel} disabled={phase === 'importing'}>{t('Cancel')}</button>
      <button type="button" className={styles.primary} onClick={() => void submit()} disabled={!env.unlocked || (phase !== 'ready' && !imported.current)}>
        {t(phase === 'importing' ? 'Importing…' : 'Import wallet')}</button>
    </div>
  </section>;
}

export function ExportRequest({ env, walletId, kind }: { env: RequestEnv; walletId: string; kind: 'recovery-phrase' | 'private-key' }) {
  const { t } = useLocale();
  const wallet = env.context.wallets.find(entry => entry.id === walletId) ?? null;
  const container = useRef<HTMLDivElement>(null), frame = useRef<{ close(): void } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [stage, setStage] = useState<'confirm' | 'revealing' | 'shown'>('confirm');
  const [error, setError] = useState<string | null>(null), [stale, setStale] = useState(false);
  const what = t(kind === 'recovery-phrase' ? 'recovery phrase' : 'private key'), frameTitle = t('Turnkey secure export');
  useEffect(() => () => { frame.current?.close(); frame.current = null; }, []);
  useEffect(() => {
    if (!wallet) env.refuse('ACCOUNT_WALLET_NOT_FOUND');
    else if (!exportActions(wallet).includes(kind)) env.refuse('EXPORT_NOT_SUPPORTED');
  }, []); // Checked once, when the request arrives.
  if (!wallet || !exportActions(wallet).includes(kind)) return null;
  const needsUnlock = !env.unlocked || stale || env.freshUnlock === false;
  async function reveal() {
    setStage('revealing'); setError(null);
    try {
      const grant = await walletApi.exportGrant(wallet!, kind);
      frame.current = await openExportFrame(env.config.frames, grant, container.current!);
      container.current?.querySelector('iframe')?.setAttribute('title', frameTitle);
      setStage('shown');
    } catch (cause) {
      const code = codeOf(cause, 'MANAGED_EXPORT_UNAVAILABLE');
      // The server or the relay found the unlock too old: unlock again here, then show.
      if (code === 'WALLET_UNLOCK_REQUIRED') setStale(true);
      setError(code); setStage('confirm');
    }
  }
  const unlocked = (value: Parameters<RequestEnv['onUnlocked']>[0]) => { setStale(false); setError(null); env.onUnlocked(value); };
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('Export')} title={t('Show the {0} of {1}', what, wallet.label)} from={env.appHost}/>
    <dl className={styles.fields}><dt>{t('Wallet')}</dt><dd className={styles.mono}>{wallet.address}</dd></dl>
    {needsUnlock ? <UnlockPanel config={env.config} context={env.context} onUnlocked={unlocked} title="Unlock again to export"
      reason="Export needs an unlock in the last 5 minutes. Unlock again with your email code, Google or Apple."/> : null}
    {!needsUnlock && stage !== 'shown' && <>
      <p className={styles.warning}><AccountIcon name="warning" size={18}/><span>{t('Anyone who sees this {0} can take everything in this wallet, on every network. FloFi and Turnkey can’t undo that. Make sure no one can see your screen.', what)}</span></p>
      <label className={styles.check}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>
        <span>{t('I understand, and I’m in a private place.')}</span></label>
    </>}
    <div ref={container} className={styles.providerFrame} hidden={stage === 'confirm'} role="group" aria-label={frameTitle} aria-busy={stage === 'revealing'}/>
    {stage === 'shown' && <p className={styles.hint}>{t('Write it down and keep it offline. Choose Done to hide it.')}</p>}
    {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    {stage === 'shown'
      ? <button type="button" className={styles.primary} onClick={() => { frame.current?.close(); frame.current = null; env.succeed({ done: true }, t('Export closed.')); }}>{t('Done')}</button>
      : <SignControls id={`${env.id}-export`} ready={!needsUnlock && acknowledged} busy={stage === 'revealing'} label={`Show ${kind === 'recovery-phrase' ? 'recovery phrase' : 'private key'}`}
        busyLabel="Opening…" onSign={() => void reveal()} onCancel={() => env.refuse('FLOFI_WALLET_REJECTED')}/>}
  </section>;
}
