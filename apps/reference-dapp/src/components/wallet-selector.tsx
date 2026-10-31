// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * The one wallet selector. Header → Connect Wallet, Credentials → Add wallet, execution panels and the approval page all
 * open it. It lists the wallets this browser exposes (with their ecosystem) and resolves with the owner's choice. It never
 * talks to a wallet: opening, browsing, Escape and clicking outside cannot invoke a provider. The caller connects only
 * the chosen wallet after this resolves.
 *
 * BUILD-FLOFI-AUTH-WALLETS-001: when the signed-in FloFi account holds managed wallets, FloFi Wallet is listed next to the detected wallets
 * (one entry per address, with its lock state) and the provider keeps those entries in step with the account. Choosing it is as explicit as
 * choosing any other wallet. The provider also mounts the "Continue in FloFi Wallet" prompt. Never inside an embedding frame.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { evmWalletEntries, incompatibleWalletMessage, requestEvmAnnouncements, subscribeEvmDiscovery } from '../wallet/evm-discovery';
import { solanaWalletChoices, subscribeSolanaDiscovery, type SolanaWalletChain } from '../wallet/solana-wallet';
import { useLocale } from '../i18n/locale';
import { ECOSYSTEM_LABEL, orderWalletChoices, undetectedWallets, walletPreference, WALLET_ECOSYSTEMS, type WalletChoice, type WalletEcosystem } from '../wallet/wallet-registry';
import { isFloFiWalletChoice, syncFloFiWallets } from '../wallet/flofi-wallet-sync';
import { FloFiWalletContinue, useFloFiWallet } from './flofi-wallet-continue';

export type WalletSelectorRequest = { readonly ecosystems?: readonly WalletEcosystem[]; readonly title?: string;
  /** The Solana cluster the caller will connect on; only wallets that can connect and sign there are offered. */
  readonly solanaChain?: SolanaWalletChain };
type Selector = { choose(request?: WalletSelectorRequest): Promise<WalletChoice | null>; readonly open: boolean };
type Pending = { readonly ecosystems: readonly WalletEcosystem[]; readonly title: string; readonly solanaChain: SolanaWalletChain | undefined;
  resolve(choice: WalletChoice | null): void };
const Context = createContext<Selector | null>(null);

export function detectedWalletChoices(ecosystems: readonly WalletEcosystem[], solanaChain?: SolanaWalletChain): WalletChoice[] {
  return orderWalletChoices([
    ...(ecosystems.includes('evm') ? evmWalletEntries().map(entry => entry.choice) : []),
    ...(ecosystems.includes('solana') ? solanaWalletChoices(solanaChain) : []),
  ], walletPreference());
}

export function WalletSelectorProvider({ children, embedded = false }: { children: ReactNode; embedded?: boolean }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const settle = useCallback((choice: WalletChoice | null) => {
    const request = current.current;
    current.current = null;
    setPending(null);
    request?.resolve(choice);
  }, []);
  const choose = useCallback((request: WalletSelectorRequest = {}) => new Promise<WalletChoice | null>(resolve => {
    // A newer request supersedes an open one, which resolves as cancelled.
    current.current?.resolve(null);
    const ecosystems = WALLET_ECOSYSTEMS.filter(ecosystem => (request.ecosystems ?? WALLET_ECOSYSTEMS).includes(ecosystem));
    const next = { ecosystems, title: request.title ?? 'Connect a wallet', solanaChain: request.solanaChain, resolve };
    current.current = next;
    setPending(next);
  }), []);
  useEffect(() => () => { current.current?.resolve(null); current.current = null; }, []);
  // FloFi Wallet entries follow the account (sign-in, new or removed managed wallets); refreshed when the page becomes visible again.
  useEffect(() => {
    if (embedded) return;
    void syncFloFiWallets({ force: true });
    const refresh = () => { if (document.visibilityState === 'visible') void syncFloFiWallets(); };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [embedded]);
  const value = useMemo(() => ({ choose, open: pending !== null }), [choose, pending]);
  return <Context.Provider value={value}>{children}{pending && <WalletSelectorDialog request={pending} embedded={embedded} onSettle={settle}/>}
    {!embedded && <FloFiWalletContinue/>}</Context.Provider>;
}
export function useWalletSelector(): Selector {
  const value = useContext(Context);
  if (!value) throw new Error('WALLET_SELECTOR_MISSING');
  return value;
}

function WalletGlyph() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3M3 6h15a2 2 0 0 1 2 2"/><path d="M16 9h5v7h-5a3.5 3.5 0 0 1 0-7Z"/><path d="M16 12.5h.01"/>
  </svg>;
}
/** Provider metadata icon when the wallet supplies one; otherwise a neutral glyph (no invented branding). */
export function WalletMark({ icon }: { icon: string | null }) {
  return <span className="wallet-mark" aria-hidden="true">{icon ? <img src={icon} width="28" height="28" alt=""/> : <WalletGlyph/>}</span>;
}

function WalletSelectorDialog({ request, onSettle, embedded }: { request: Pending; embedded: boolean; onSettle(choice: WalletChoice | null): void }) {
  const { t: tr } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const titleId = useId(), noteId = useId(), detectedId = useId(), otherId = useId();
  const [detected, setDetected] = useState<WalletChoice[]>(() => detectedWalletChoices(request.ecosystems, request.solanaChain));
  const [incompatible, setIncompatible] = useState<string | null>(null);
  const remembered = walletPreference();
  const floFi = useFloFiWallet();
  /** FloFi Wallet's state as the selector shows it: unlocked or locked when its window reported it, else that it opens on Authorize. */
  const floFiStatus = floFi.lock === 'unlocked' ? 'Unlocked' : floFi.lock === 'locked' ? 'Locked' : 'Opens on Authorize';
  useEffect(() => {
    const refresh = () => {
      setDetected(previous => {
        const next = detectedWalletChoices(request.ecosystems, request.solanaChain);
        return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
      });
      setIncompatible(request.ecosystems.includes('evm') ? incompatibleWalletMessage() : null);
    };
    refresh();
    requestEvmAnnouncements();
    if (!embedded) void syncFloFiWallets();
    const stopEvm = subscribeEvmDiscovery(refresh), stopSolana = subscribeSolanaDiscovery(refresh);
    // A legacy window.ethereum can appear without any event; a slow poll keeps the list truthful while open.
    const timer = window.setInterval(refresh, 1000);
    return () => { stopEvm(); stopSolana(); window.clearInterval(timer); };
  }, [request.ecosystems, request.solanaChain, embedded]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    (list.current?.querySelector<HTMLButtonElement>('[data-wallet-option]') ?? element.querySelector<HTMLButtonElement>('.wallet-selector-close'))?.focus();
    return () => {
      if (element.open) element.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  function move(event: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-wallet-option]') ?? [])];
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }
  const others = undetectedWallets(detected, request.ecosystems);
  return <dialog ref={dialog} className="wallet-selector" aria-labelledby={titleId} aria-describedby={noteId}
    onCancel={event => { event.preventDefault(); onSettle(null); }}
    onClick={event => { if (event.target === event.currentTarget) onSettle(null); }}>
    <div className="wallet-selector-panel">
      <div className="wallet-selector-head">
        <h2 id={titleId}>{tr(request.title)}</h2>
        <button type="button" className="wallet-selector-close" aria-label={tr("Close wallet selector")} onClick={() => onSettle(null)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <p id={noteId} className="wallet-selector-note">{tr("FloFi opens only the wallet you choose. Connecting shares your public address; it never approves a transaction.")}</p>
      <section aria-labelledby={detectedId}>
        <h3 id={detectedId} className="wallet-selector-group">{tr("Detected")}</h3>
        {detected.length ? <ul ref={list} className="wallet-selector-list" onKeyDown={move}>
          {detected.map(choice => { const managed = isFloFiWalletChoice(choice); return <li key={choice.id}>
            <button type="button" className="wallet-option" data-wallet-option="" data-ecosystem={choice.ecosystem} data-flofi-wallet={managed ? floFi.lock : undefined}
              aria-label={tr('{0} on {1}', choice.name, ECOSYSTEM_LABEL[choice.ecosystem])}
              aria-description={managed ? tr('Your FloFi account wallet. You confirm every signature in the FloFi Wallet window.') : undefined} onClick={() => onSettle(choice)}>
              <WalletMark icon={choice.icon}/>
              <span className="wallet-option-text"><strong>{choice.name}</strong><small>{ECOSYSTEM_LABEL[choice.ecosystem]}</small></span>
              <span className="wallet-option-status">{tr(managed ? floFiStatus : remembered[choice.ecosystem] === choice.key ? 'Last used' : 'Detected')}</span>
            </button>
          </li>; })}
        </ul> : <p className="wallet-selector-empty" role="status">{tr(incompatible ?? (embedded
          ? 'No compatible wallet is available inside this chat. This host or wallet does not expose a signer here. Nothing was authorized. Opening FloFi is an optional external fallback.'
          : 'No wallet detected in this browser. Install or enable a wallet extension, then refresh.'))}</p>}
      </section>
      {others.length > 0 && <section aria-labelledby={otherId}>
        <h3 id={otherId} className="wallet-selector-group">{tr("Other wallets")}</h3>
        <ul className="wallet-selector-list">
          {others.map(known => <li key={`${known.ecosystem}:${known.key}`} className="wallet-option wallet-option-unavailable" aria-label={tr('{0} on {1}, not detected', known.name, ECOSYSTEM_LABEL[known.ecosystem])}>
            <WalletMark icon={null}/>
            <span className="wallet-option-text"><strong>{known.name}</strong><small>{ECOSYSTEM_LABEL[known.ecosystem]}</small></span>
            <span className="wallet-option-status">{tr("Not detected")}</span>
          </li>)}
        </ul>
      </section>}
    </div>
  </dialog>;
}
