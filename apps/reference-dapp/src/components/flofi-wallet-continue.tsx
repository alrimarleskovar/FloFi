// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: "Continue in FloFi Wallet" (spec F1.4). A FloFi Wallet request that reaches the page while FloFi Wallet is
 * closed (a sign-in proof during Simulate, a window the person closed) cannot open a popup by itself: browsers allow that only inside a
 * click. This dialog asks for that click. Continue opens or focuses FloFi Wallet and hands it the request; Cancel (or Escape) declines it
 * before FloFi Wallet ever saw it, so nothing was signed. Also exports the lock-state hints the Execute surfaces show (spec §9).
 */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { useLocale } from '../i18n/locale';
import { cancelFloFiWalletRequest, continueInFloFiWallet, floFiWalletSnapshot, subscribeFloFiWallet, usesFloFiWallet, type FloFiWalletSnapshot } from '../wallet/flofi-wallet-channel';
import { floFiWalletMessage } from '../wallet/flofi-signing';

const PURPOSE: Readonly<Record<string, string>> = Object.freeze({
  evm_sign_transaction: 'FloFi Wallet needs to open to show the transaction you authorized.',
  solana_sign_transaction: 'FloFi Wallet needs to open to show the transaction you authorized.',
  evm_sign_message: 'FloFi Wallet needs to open to sign FloFi\'s sign-in message.',
  solana_sign_message: 'FloFi Wallet needs to open to sign FloFi\'s sign-in message.',
});
/** The channel's state, re-rendered on every change (the server render sees the initial, closed state). */
export function useFloFiWallet(): FloFiWalletSnapshot {
  return useSyncExternalStore(subscribeFloFiWallet, floFiWalletSnapshot, floFiWalletSnapshot);
}

export function FloFiWalletContinue() {
  const { t } = useLocale();
  const state = useFloFiWallet();
  const dialog = useRef<HTMLDialogElement>(null), primary = useRef<HTMLButtonElement>(null);
  const titleId = useId(), noteId = useId();
  const waiting = state.waiting !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!waiting || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    primary.current?.focus();
    return () => {
      if (element.open) element.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [waiting]);
  if (!state.waiting) return null;
  const error = state.error ? floFiWalletMessage(state.error) : null;
  function proceed() {
    // The click itself opens FloFi Wallet: no await may come before this call.
    try { continueInFloFiWallet(); } catch { /* the channel records why (blocked pop-up, unavailable); the dialog stays to retry or cancel */ }
  }
  return <dialog ref={dialog} className="wallet-selector flofi-wallet-continue" aria-labelledby={titleId} aria-describedby={noteId}
    onCancel={event => { event.preventDefault(); cancelFloFiWalletRequest(); }}>
    <div className="wallet-selector-panel">
      <div className="wallet-selector-head"><h2 id={titleId}>{t('Continue in FloFi Wallet')}</h2></div>
      <p id={noteId} className="wallet-selector-note">{t(PURPOSE[state.waiting.op] ?? 'FloFi Wallet needs to open to continue.')} {t('Nothing is signed until you confirm there.')}</p>
      {error && <p className="simulation-warning-blocking" role="alert">{t(error)}</p>}
      <div className="signing-actions-row">
        <button ref={primary} type="button" className="primary" onClick={proceed}>{t('Continue in FloFi Wallet')}</button>
        <button type="button" className="secondary" onClick={() => cancelFloFiWalletRequest()}>{t('Cancel')}</button>
      </div>
    </div>
  </dialog>;
}

/**
 * The FloFi Wallet hint next to an Authorize action: shown only when the wallet that will sign is a FloFi Wallet address. Authorize opens
 * FloFi Wallet; a locked FloFi Wallet must be unlocked first, so a short-lived Review (60 s on Solana) does not expire during an unlock.
 */
export function FloFiWalletLockHint({ account, issue }: { account: string | null | undefined; issue?: string | null }) {
  const { t } = useLocale();
  const state = useFloFiWallet();
  if (!usesFloFiWallet(account)) return null;
  const code = issue ?? (state.lock === 'locked' ? 'FLOFI_WALLET_LOCKED' : null);
  const text = code ? floFiWalletMessage(code) : !state.open ? 'Authorize opens FloFi Wallet, where you confirm the exact transaction.' : null;
  return text ? <p className="canvas-sequence-note" role="status" data-flofi-wallet-lock={state.lock}>{t(text)}</p> : null;
}
