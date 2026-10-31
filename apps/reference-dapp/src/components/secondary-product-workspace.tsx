// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { SecondaryWorkspace } from '../domain/secondary-workspaces';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { YourWorkflows, type WorkflowNavigation } from './saved-workflows';
import { AutomationsWorkspace, type AutomationNavigation } from './automations-workspace';
import { ExecutionCredentials, PasskeysPanel, type DelegationAccess } from './delegation-credentials';
import { PrivacyControls } from './privacy-controls';
import { useJupiter } from '../state/jupiter-store';
import { brandLabel, LABEL_MAX, networkLabel, type SavedCard, type SavedWallet } from '../domain/credentials';
import { removeSavedCredential, renameSavedCredential, saveCardReference, saveWalletReference, useCredentials } from '../state/credentials-store';
import { evmNetworkRef, useWalletConnection, type ConnectedWallet } from '../state/wallet-connection';
import { evmWalletEntries } from '../wallet/evm-discovery';
import { solanaWalletChoices } from '../wallet/solana-wallet';
import { EVM_WALLET_NETWORKS } from '../wallet/evm-networks';
import { ECOSYSTEM_LABEL, type WalletEcosystem } from '../wallet/wallet-registry';
import { addProviderCard, cardProviderStatus, removeProviderCard } from '../app/card-action';
import type { CardProviderClient, CardProviderStatus } from '../server/card-provider';
import { loadMercadoPago, type MercadoPagoInstance, type MercadoPagoSecureField, type SecureFieldType } from './card-secure-fields';
import { AccountWalletsSection } from './account/account-wallets';

type IconName = 'wallet' | 'agent' | 'key' | 'plus' | 'copy' | 'card' | 'secret';
function WorkspaceIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'wallet' ? <><path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3M3 6h15a2 2 0 0 1 2 2"/><path d="M16 9h5v7h-5a3.5 3.5 0 0 1 0-7Z"/><path d="M16 12.5h.01"/></>
      : name === 'agent' ? <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M2 12h2m16 0h2M9 16h6M9 11v1m6-1v1"/></>
        : name === 'key' ? <><circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-3-3 3-3m-6 0 3-3"/></>
          : name === 'plus' ? <path d="M12 5v14M5 12h14"/>
            : name === 'copy' ? <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>
              : name === 'card' ? <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></>
                : <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/></>}
  </svg>;
}

function FutureAction({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { t: tr } = useLocale();
  return <button type="button" className={`workspace-action ${className}`} disabled title={tr("Coming soon")}>{children}</button>;
}

function AddAction({ children }: { children: ReactNode }) {
  return <FutureAction><WorkspaceIcon name="plus" size={16}/>{children}</FutureAction>;
}

const ecosystemIcons = { evm: '/brand/crypto/ethereum.svg', solana: '/brand/crypto/solana.svg' } as const;
const networkIcons: Record<string, string> = {
  'eip155:8453': '/brand/crypto/base.svg', 'eip155:84532': '/brand/crypto/base.svg', 'eip155:42161': '/brand/crypto/arbitrum.png',
  'eip155:1': '/brand/crypto/ethereum.svg', 'eip155:11155111': '/brand/crypto/ethereum.svg',
};
function credentialNetworkLabel(network: string | null): string {
  if (network?.startsWith('eip155:')) return EVM_WALLET_NETWORKS.find(candidate => candidate.chain === network)?.label ?? `Chain ${network.slice(7)}`;
  return networkLabel(network);
}

/** One wallet row: a saved reference, the active session, or both. Never a key or balance. */
type WalletEntry = { readonly saved: SavedWallet | null; readonly active: ConnectedWallet | null;
  readonly ecosystem: WalletEcosystem; readonly address: string; readonly providerKey: string; readonly providerName: string; readonly label: string;
  readonly network: string | null };
const sameWallet = (saved: SavedWallet, active: ConnectedWallet) => saved.ecosystem === active.ecosystem && saved.address === active.address &&
  saved.providerKey === active.providerKey;

function WalletCredentialCard({ entry, busy, onActivate, onDisconnect, onSave, onStatus }: {
  entry: WalletEntry; busy: boolean; onActivate(saved: SavedWallet): void; onDisconnect(): void; onSave(active: ConnectedWallet): void; onStatus(message: string): void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'remove'>('view');
  const [draft, setDraft] = useState(entry.label);
  const [renameError, setRenameError] = useState('');
  const renameId = useId();
  const { t: tr } = useLocale();
  async function copyAddress() {
    try { await navigator.clipboard.writeText(entry.address); onStatus('Address copied.'); } catch { onStatus('Address could not be copied.'); }
  }
  function rename() {
    if (!entry.saved) return;
    try { renameSavedCredential(entry.saved.id, draft); setMode('view'); setRenameError(''); onStatus('Wallet renamed.'); }
    catch { setRenameError(`Use 1–${LABEL_MAX} characters.`); }
  }
  function remove() {
    if (!entry.saved) return;
    if (entry.active) onDisconnect();
    removeSavedCredential(entry.saved.id); onStatus(`${entry.label} removed from FloFi. Your wallet and its funds are unchanged.`);
  }
  const status = entry.active && entry.saved ? 'Active' : entry.active ? 'Connected · not saved' : 'Saved';
  const icon = (entry.network && networkIcons[entry.network]) ?? ecosystemIcons[entry.ecosystem];
  return <article className="workspace-wallet-card" aria-label={`${entry.label}, ${ECOSYSTEM_LABEL[entry.ecosystem]}`} data-active={entry.active ? 'true' : 'false'}>
    <div className="workspace-wallet-heading">
      <span className="workspace-network-icon"><img src={icon} width="28" height="28" alt=""/></span>
      <div><h3>{entry.label}</h3><p>{entry.providerName} · {ECOSYSTEM_LABEL[entry.ecosystem]}</p></div>
      <span className={`workspace-wallet-status${entry.active ? ' workspace-wallet-status-active' : ''}`}>{tr(status)}</span>
    </div>
    <p className="workspace-wallet-network">{tr(credentialNetworkLabel(entry.network))}</p>
    <div className="workspace-wallet-address"><code title={entry.address}>{entry.address.slice(0, 6)}…{entry.address.slice(-4)}</code>
      <button type="button" className="workspace-copy" aria-label={tr('Copy {0} address', entry.label)} title={tr("Copy address")} onClick={() => void copyAddress()}><WorkspaceIcon name="copy" size={17}/></button>
    </div>
    {mode === 'rename' && entry.saved ? <form className="workspace-inline-form" onSubmit={event => { event.preventDefault(); rename(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setMode('view'); setDraft(entry.label); setRenameError(''); } }}>
      <label htmlFor={renameId}>{tr("Wallet name")}</label>
      <input id={renameId} value={draft} maxLength={LABEL_MAX} autoComplete="off" autoFocus aria-invalid={renameError ? 'true' : undefined}
        aria-describedby={renameError ? `${renameId}-error` : undefined} onChange={event => setDraft(event.currentTarget.value)}/>
      {renameError && <p id={`${renameId}-error`} className="workspace-inline-error" role="alert">{tr(renameError)}</p>}
      <div className="workspace-wallet-actions"><button type="submit" className="workspace-action">{tr("Save name")}</button>
        <button type="button" className="workspace-action" onClick={() => { setMode('view'); setDraft(entry.label); setRenameError(''); }}>{tr("Cancel")}</button></div>
    </form> : mode === 'remove' && entry.saved ? <div className="workspace-inline-form" role="group" aria-label={tr('Remove {0}', entry.label)}>
      <p>{tr('Remove {0} from FloFi?', entry.label)}{tr(entry.active ? ' This also disconnects it.' : '')}{tr(" Only FloFi's reference is removed; the wallet and its assets are not affected.")}</p>
      <div className="workspace-wallet-actions"><button type="button" className="workspace-action workspace-action-danger" onClick={remove}>{tr("Remove")}</button>
        <button type="button" className="workspace-action" onClick={() => setMode('view')}>{tr("Cancel")}</button></div>
    </div> : <div className="workspace-wallet-actions">
      {entry.saved && <button type="button" className="workspace-action" aria-label={tr('Rename {0}', entry.label)} onClick={() => { setDraft(entry.label); setMode('rename'); }}>{tr("Rename")}</button>}
      {!entry.saved && entry.active && <button type="button" className="workspace-action" aria-label={tr('Save {0}', entry.label)} onClick={() => onSave(entry.active!)}>{tr("Save")}</button>}
      {entry.active ? <button type="button" className="workspace-action" aria-label={tr('Disconnect {0}', entry.label)} disabled={busy} onClick={onDisconnect}>{tr("Disconnect")}</button>
        : entry.saved && <button type="button" className="workspace-action" aria-label={tr('Connect {0}', entry.label)} disabled={busy} onClick={() => onActivate(entry.saved!)}>{tr("Connect")}</button>}
      {entry.saved && <button type="button" className="workspace-action" aria-label={tr('Remove {0}', entry.label)} onClick={() => setMode('remove')}>{tr("Remove")}</button>}
    </div>}
  </article>;
}

/** Removal codes after which the saved reference can no longer be used at the provider: FloFi's copy is removed anyway. */
const CARD_REFERENCE_UNUSABLE = new Set(['CARD_TOKENIZATION_PROVIDER_REQUIRED', 'CARD_BINDING_INVALID', 'CARD_PROVIDER_NOT_FOUND']);
function CardCredential({ card, onStatus }: { card: SavedCard; onStatus(message: string): void }) {
  const { t: tr } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  async function remove() {
    setRemoving(true);
    // The saved-card reference at the provider goes first; the card itself is never affected.
    const removed = await removeProviderCard(card.binding).catch(() => ({ ok: false as const, code: 'CARD_PROVIDER_UNREACHABLE' }));
    setRemoving(false);
    if (!removed.ok && !CARD_REFERENCE_UNUSABLE.has(removed.code)) { onStatus('This card could not be removed right now. Try again.'); return; }
    removeSavedCredential(card.id); onStatus('Card removed from FloFi.');
  }
  return <article className="workspace-wallet-card workspace-card-credential" aria-label={card.label}>
    <div className="workspace-wallet-heading">
      <span className="workspace-network-icon"><WorkspaceIcon name="card" size={24}/></span>
      <div><h3>{card.label}</h3><p>{brandLabel(card.brand)} · {card.providerName}</p></div>
    </div>
    <p className="workspace-wallet-network"><span className="numeric">•••• {card.last4}</span>{tr(' · Expires {0}', `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`)}</p>
    {confirming ? <div className="workspace-inline-form" role="group" aria-label={tr('Remove {0}', card.label)}>
      <p>{tr("Remove this card from FloFi? The card itself is not affected.")}</p>
      <div className="workspace-wallet-actions"><button type="button" className="workspace-action workspace-action-danger" disabled={removing}
        onClick={() => void remove()}>{tr("Remove")}</button>
        <button type="button" className="workspace-action" onClick={() => setConfirming(false)}>{tr("Cancel")}</button></div>
    </div> : <div className="workspace-wallet-actions"><button type="button" className="workspace-action" aria-label={tr('Remove {0}', card.label)} onClick={() => setConfirming(true)}>{tr("Remove")}</button></div>}
  </article>;
}

const CARD_FIELDS: readonly { readonly type: SecureFieldType; readonly label: string; readonly placeholder: string }[] = [
  { type: 'cardNumber', label: 'Card number', placeholder: '1234 1234 1234 1234' },
  { type: 'expirationDate', label: 'Expiry', placeholder: 'MM/YY' },
  { type: 'securityCode', label: 'Security code', placeholder: 'CVC' },
];
const CARD_ERRORS: Readonly<Record<string, string>> = {
  CARD_EMAIL_INVALID: 'Enter a valid email address.',
  CARD_LIMIT_REACHED: 'This email already has the maximum number of saved cards.',
  CARD_REJECTED_BY_PROVIDER: 'The card could not be saved. Check the details and try again.',
  CARD_TOKEN_INVALID: 'The card could not be saved. Check the details and try again.',
};
/**
 * The provider's own secure fields inside the Add card dialog. The card number, expiry and security code are typed into the
 * provider's iframes; FloFi sends its server only the provider's one-time token and the email the provider saves the card
 * under. Adding a card never charges it.
 */
function SecureCardForm({ client, providerName, titleId, onClose, onAdded }: {
  client: CardProviderClient; providerName: string; titleId: string; onClose(): void; onAdded(label: string): void;
}) {
  const { t: tr } = useLocale();
  const baseId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const sdk = useRef<MercadoPagoInstance | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'unavailable'>('loading');
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const mounted: MercadoPagoSecureField[] = [];
    void (async () => {
      try {
        const MercadoPago = await loadMercadoPago(client.sdkUrl);
        if (!current) return;
        const instance = new MercadoPago(client.publicKey, { locale: client.locale });
        const tokens = getComputedStyle(document.documentElement);
        const style = { fontSize: '14px', color: tokens.getPropertyValue('--ink').trim() || '#10233f', placeholderColor: tokens.getPropertyValue('--muted').trim() || '#6b778c' };
        for (const field of CARD_FIELDS) mounted.push(instance.fields.create(field.type, { placeholder: field.placeholder, style }).mount(`${baseId}-${field.type}`));
        const types = (await instance.getIdentificationTypes()).map(type => type.id).filter((id): id is string => typeof id === 'string' && /^[A-Z]{2,10}$/.test(id));
        if (!current) return;
        if (!types.length) throw new Error('CARD_SDK_UNAVAILABLE');
        sdk.current = instance; setDocuments(types); setPhase('ready');
      } catch { if (current) setPhase('unavailable'); }
    })();
    return () => { current = false; sdk.current = null; for (const field of mounted) try { field.unmount(); } catch { /* already gone */ } };
  }, [baseId, client]);
  async function submit(form: HTMLFormElement) {
    const data = new FormData(form), text = (name: string) => String(data.get(name) ?? '').trim();
    const holder = text('cardholderName'), documentType = text('identificationType'), documentNumber = text('identificationNumber').replace(/\D/g, ''), email = text('email');
    if (!sdk.current || phase !== 'ready') return;
    if (!holder || !documentType || !documentNumber || !email) { setError('Fill in every field.'); return; }
    setError(''); setPhase('saving');
    let token: unknown;
    try { token = (await sdk.current.fields.createCardToken({ cardholderName: holder, identificationType: documentType, identificationNumber: documentNumber })).id; }
    catch { setPhase('ready'); setError('Check the card details and try again.'); return; }
    if (typeof token !== 'string') { setPhase('ready'); setError('Check the card details and try again.'); return; }
    const added = await addProviderCard({ token, email }).catch(() => ({ ok: false as const, code: 'CARD_PROVIDER_UNREACHABLE' }));
    if (!added.ok) { setPhase('ready'); setError(CARD_ERRORS[added.code] ?? 'The card could not be added. Nothing was saved.'); return; }
    try {
      const saved = saveCardReference(added.value).cards.find(card => card.providerCardId === added.value.providerCardId && card.provider === added.value.provider);
      onAdded(saved?.label ?? 'Card');
    } catch { setPhase('ready'); setError('The card could not be added. Nothing was saved.'); }
  }
  if (phase === 'unavailable') return <><div role="status" className="card-entry-body"><p>{tr("Secure card entry could not be loaded. Nothing was collected. Try again later.")}</p></div>
    <div className="wallet-selector-footer"><button type="button" className="workspace-action" onClick={onClose}>{tr("Close")}</button></div></>;
  return <form className="card-entry-form" aria-labelledby={titleId} aria-busy={phase !== 'ready'} noValidate onSubmit={event => { event.preventDefault(); void submit(event.currentTarget); }}>
    <p className="card-entry-note">{tr("Card details are entered in {0}'s secure fields. FloFi receives only a token, the brand, the last four digits and the expiry date.", providerName)}</p>
    {CARD_FIELDS.map(field => <div key={field.type} className={`card-entry-field card-entry-${field.type}`} role="group" aria-labelledby={`${baseId}-${field.type}-label`}>
      <span id={`${baseId}-${field.type}-label`}>{tr(field.label)}</span><div id={`${baseId}-${field.type}`} className="card-entry-secure" data-secure-field={field.type}/>
    </div>)}
    <label className="card-entry-field card-entry-holder">{tr("Name on card")}<input name="cardholderName" autoComplete="cc-name" maxLength={60} required/></label>
    <label className="card-entry-field card-entry-document-type">{tr("Document")}<select name="identificationType" required>{documents.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
    <label className="card-entry-field card-entry-document">{tr("Number")}<input name="identificationNumber" inputMode="numeric" autoComplete="off" maxLength={18} required/></label>
    <label className="card-entry-field card-entry-email">{tr("Email")}<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>
    {error && <p className="workspace-inline-error card-entry-error" role="alert">{tr(error)}</p>}
    <div className="wallet-selector-footer card-entry-actions"><button type="button" className="workspace-action" onClick={onClose}>{tr("Cancel")}</button>
      <button type="submit" className="workspace-action" disabled={phase !== 'ready'}>{tr(phase === 'saving' ? 'Adding…' : 'Add card')}</button></div>
  </form>;
}

/**
 * Add card opens the configured provider's secure entry. FloFi renders no card-number or security-code field of its own;
 * without a configured provider it states the prerequisite instead of collecting anything.
 */
function CardEntryDialog({ onClose, onAdded }: { onClose(): void; onAdded(label: string): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t: tr } = useLocale();
  const titleId = useId(), bodyId = useId();
  const [status, setStatus] = useState<CardProviderStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    let current = true;
    void cardProviderStatus().then(value => { if (current) setStatus(value); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; if (element?.open) element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const secure = status?.available && status.client.kind === 'mercado_pago_secure_fields' ? status : null;
  return <dialog ref={dialog} className="wallet-selector card-entry" aria-labelledby={titleId} aria-describedby={secure ? undefined : bodyId}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="wallet-selector-panel">
      <div className="wallet-selector-head"><h2 id={titleId}>{tr("Add a card")}</h2>
        <button type="button" className="wallet-selector-close" aria-label={tr("Close")} autoFocus onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button></div>
      {secure ? <SecureCardForm client={secure.client} providerName={secure.provider.name} titleId={titleId} onClose={onClose} onAdded={onAdded}/> : <>
        <div id={bodyId} role="status" className="card-entry-body">
          {failed ? <p>{tr("Card entry status could not be checked. Nothing was collected. Try again later.")}</p>
            : !status ? <p>{tr("Checking secure card entry…")}</p>
              : <><p><strong>{tr("Secure card entry isn't available yet.")}</strong></p>
                <p>{tr("FloFi never asks for your card number or security code in its own forms. Cards are added only through a certified card provider's secure entry, and no card provider is connected to FloFi yet.")}</p></>}
        </div>
        <div className="wallet-selector-footer"><button type="button" className="workspace-action" onClick={onClose}>{tr("Close")}</button></div></>}
    </div>
  </dialog>;
}

function CredentialsWorkspace({ access }: { access?: DelegationAccess | undefined }) {
  const { t: tr } = useLocale();
  const evm = useBuild009Wallet();
  const solana = useJupiter();
  const credentials = useCredentials();
  const connection = useWalletConnection();
  const [status, setStatus] = useState('');
  const [cardEntry, setCardEntry] = useState(false);
  const active: ConnectedWallet[] = [];
  if (evm.account) active.push({ ecosystem: 'evm', address: evm.account, providerKey: evm.provider?.key ?? 'injected', providerName: evm.provider?.name ?? 'Browser wallet', network: evmNetworkRef(evm.chainId) });
  if (solana.session) active.push({ ecosystem: 'solana', address: solana.session.account.address, providerKey: solana.session.wallet.name, providerName: solana.session.wallet.name, network: solana.session.chain });
  const entries: WalletEntry[] = [
    ...credentials.wallets.map(saved => {
      const live = active.find(wallet => sameWallet(saved, wallet)) ?? null;
      return { saved, active: live, ecosystem: saved.ecosystem, address: saved.address, providerKey: saved.providerKey, providerName: saved.providerName,
        label: saved.label, network: live?.network ?? saved.lastNetwork };
    }),
    ...active.filter(wallet => !credentials.wallets.some(saved => sameWallet(saved, wallet))).map(wallet => ({ saved: null, active: wallet,
      ecosystem: wallet.ecosystem, address: wallet.address, providerKey: wallet.providerKey, providerName: wallet.providerName,
      // ACCEPTANCE-FIXES-001: an unsaved session is the ecosystem's default identity; the provider stays visible beneath it.
      label: wallet.ecosystem === 'evm' ? 'EVM Default' : 'Solana Default', network: wallet.network })),
  ];
  const busy = evm.busy || solana.busy;
  function save(wallet: ConnectedWallet) {
    try { saveWalletReference(wallet); setStatus(`${wallet.providerName} saved to Credentials.`); } catch { setStatus('This wallet could not be saved.'); }
  }
  async function addWallet() {
    setStatus('');
    const connected = await connection.connect({ title: 'Add a wallet' });
    if (connected) save(connected);
  }
  function disconnect(wallet: WalletEntry) {
    if (wallet.ecosystem === 'evm') evm.reset(); else void solana.disconnect();
    setStatus(`${wallet.label} disconnected.`);
  }
  async function activate(saved: SavedWallet) {
    setStatus('');
    const mismatch = (address: string) => setStatus(`${saved.providerName} connected ${address.slice(0, 6)}…${address.slice(-4)}, not this saved wallet. Choose ${saved.address.slice(0, 6)}…${saved.address.slice(-4)} in ${saved.providerName} to use it.`);
    if (saved.ecosystem === 'evm') {
      const entry = evmWalletEntries().find(candidate => candidate.choice.key === saved.providerKey);
      if (!entry) { setStatus(`${saved.providerName} isn't detected in this browser.`); return; }
      const session = await evm.connectWith(entry.choice.id);
      if (session && session.account !== saved.address) mismatch(session.account);
      return;
    }
    if (!solanaWalletChoices().some(choice => choice.key === saved.providerKey)) { setStatus(`${saved.providerName} isn't detected in this browser.`); return; }
    const session = await solana.connectWith(saved.providerKey, connection.solanaChain);
    if (!session) setStatus(`${saved.providerName} did not connect.`);
    else if (session.account.address !== saved.address) mismatch(session.account.address);
  }
  return <>
    <header className="secondary-workspace-heading"><h1>{tr("Credentials")}</h1><p>{tr("Keep the wallets and cards you use with FloFi in one place. Saved credentials are references only: they never approve a transaction or a payment.")}</p></header>
    <p className="workspace-notice" role="status">{tr(status || connection.error || '')}</p>
    {/* BUILD-FLOFI-AUTH-WALLETS-001: wallets saved to the signed-in FloFi account (server-side, per account). The device-local
        references below keep their own storage and semantics. */}
    <AccountWalletsSection active={active.map(wallet => ({ ecosystem: wallet.ecosystem, address: wallet.address }))}/>
    <section className="workspace-section" aria-labelledby="credentials-wallets">
      <div className="workspace-section-heading"><div><WorkspaceIcon name="wallet"/><h2 id="credentials-wallets">{tr("Wallets")}</h2><span className="workspace-count">{entries.length}</span></div>
        <button type="button" className="workspace-action" disabled={busy} onClick={() => void addWallet()}><WorkspaceIcon name="plus" size={16}/>{tr("Add wallet")}</button></div>
      {entries.length ? <div className="workspace-wallet-grid">{entries.map(entry => <WalletCredentialCard key={entry.saved?.id ?? `active:${entry.ecosystem}:${entry.address}`}
        entry={entry} busy={busy} onActivate={saved => void activate(saved)} onDisconnect={() => disconnect(entry)} onSave={save} onStatus={setStatus}/>)}</div>
        : <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="wallet" size={28}/></span><h3>{tr("No wallets yet")}</h3><p>{tr("Add a wallet to save its public address here. FloFi never holds your keys.")}</p></div>}
    </section>
    <section className="workspace-section" aria-labelledby="credentials-cards">
      <div className="workspace-section-heading"><div><WorkspaceIcon name="card"/><h2 id="credentials-cards">{tr("Cards")}</h2><span className="workspace-count">{credentials.cards.length}</span></div>
        <button type="button" className="workspace-action" onClick={() => setCardEntry(true)}><WorkspaceIcon name="plus" size={16}/>{tr("Add card")}</button></div>
      {credentials.cards.length ? <div className="workspace-wallet-grid">{credentials.cards.map(card => <CardCredential key={card.id} card={card} onStatus={setStatus}/>)}</div>
        : <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="card" size={28}/></span><h3>{tr("No cards yet")}</h3><p>{tr("Cards are added through a certified card provider's secure entry. FloFi never sees or stores your card number or security code.")}</p></div>}
    </section>
    <section className="workspace-section" aria-labelledby="credentials-payments">
      <div className="workspace-section-heading"><div><WorkspaceIcon name="key"/><h2 id="credentials-payments">{tr("Payment connections")}</h2><span className="workspace-count">0</span></div></div>
      <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="key" size={28}/></span><h3>{tr("No payment provider connected")}</h3><p>{tr("Pix and boleto payments need a connected payment provider. None is connected yet.")}</p></div>
    </section>
    {/* BUILD-AUTOMATION-002: execution Credentials (only where delegated execution is enabled; otherwise nothing renders). */}
    <ExecutionCredentials access={access}/>
    <div className="workspace-secondary-actions"><FutureAction><WorkspaceIcon name="plus" size={16}/><WorkspaceIcon name="secret" size={18}/>{tr("Add secret")}</FutureAction></div>
    {cardEntry && <CardEntryDialog onClose={() => setCardEntry(false)} onAdded={label => { setCardEntry(false); setStatus(`${label} added to Credentials.`); }}/>}
  </>;
}

function AgentsWorkspace() {
  const { t: tr } = useLocale();
  return <>
    <header className="secondary-workspace-heading"><h1>{tr("Agents")}</h1><p>{tr("Connect AI agents and integrations to FloFi with explicit permissions and your authorization.")}</p></header>
    <section className="workspace-connect-panel" aria-labelledby="connect-agent"><h2 id="connect-agent">{tr("CONNECT AN AGENT")}</h2>
      <div className="workspace-provider-list">{[
        { name: 'Claude', light: '/brand/providers/claude-spark.svg', dark: null },
        { name: 'ChatGPT', light: '/brand/providers/openai-blossom-black.svg', dark: '/brand/providers/openai-blossom-white.svg' },
      ].map(provider => <FutureAction key={provider.name} className="workspace-provider"><span className="workspace-provider-mark" aria-hidden="true">
        <img src={provider.light} className={provider.dark ? 'provider-mark-light' : undefined} width={provider.dark ? 56 : 28} height={provider.dark ? 56 : 28} alt={tr("")}/>
        {provider.dark && <img src={provider.dark} className="provider-mark-dark" width="56" height="56" alt={tr("")}/>}
      </span><span>{tr("Connect with ")}{provider.name}</span><span className="workspace-provider-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-5-5 5 5-5 5"/></svg></span></FutureAction>)}</div>
    </section>
    <section className="workspace-section" aria-labelledby="agent-clients"><div className="workspace-section-heading"><div><WorkspaceIcon name="agent"/><h2 id="agent-clients">{tr("Agents")}</h2><span className="workspace-count">{tr("0 active")}</span></div><AddAction>{tr("Create client")}</AddAction></div>
      <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="agent" size={28}/></span><h3>{tr("No agent clients yet.")}</h3><AddAction>{tr("Create client")}</AddAction></div>
    </section>
  </>;
}

function PasskeysWorkspace({ access }: { access?: DelegationAccess | undefined }) {
  const { t: tr } = useLocale();
  // BUILD-AUTOMATION-002: the passkey manager where delegated execution is enabled; this placeholder everywhere else.
  return <PasskeysPanel access={access} placeholder={<>
    <header className="secondary-workspace-heading"><h1>{tr("Passkeys")}</h1><p>{tr("Manage device passkeys associated with your FloFi account or session.")}</p></header>
    <section className="workspace-passkey-control" aria-labelledby="passkey-unlock"><button type="button" role="switch" className="workspace-passkey-switch" aria-checked="false" aria-labelledby="passkey-unlock" aria-describedby="passkey-help" disabled title={tr("Coming soon")}><span/></button>
      <div><h2 id="passkey-unlock">{tr("Unlock with a passkey")}</h2><p id="passkey-help">{tr("Turn on to add a passkey.")}</p></div>
    </section>
    <section className="workspace-empty workspace-passkey-empty" aria-label={tr("Passkeys")}><span className="workspace-empty-icon"><WorkspaceIcon name="key" size={28}/></span><p>{tr("No passkeys yet. Add one to get started.")}</p></section>
  </>}/>;
}

export function SecondaryProductWorkspace({ workspace, workflows, automations }: { workspace: SecondaryWorkspace['id']; workflows?: WorkflowNavigation | undefined;
  automations?: AutomationNavigation | undefined }) {
  const access: DelegationAccess | undefined = automations?.proof ? { owner: automations.owner ?? null, proof: automations.proof } : undefined;
  return workspace === 'workflows' ? <YourWorkflows {...workflows}/> : workspace === 'automations' ? <AutomationsWorkspace {...automations}/>
    : workspace === 'credentials' ? <CredentialsWorkspace access={access}/> : workspace === 'agents' ? <AgentsWorkspace/>
      // BUILD-CHAT-LEARNING-002: the Copilot's privacy controls, reached from Settings.
      : workspace === 'privacy' ? <PrivacyControls proof={automations?.proof}/> : <PasskeysWorkspace access={access}/>;
}
