// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet, the window on the wallet origin that alone can unlock, create, import, sign and export
 * managed wallets (see src/accounts/wallet-origin.ts for why it is a separate origin).
 *
 * - Binding: this window serves the FloFi account named by a single-use handoff that only its opener, at the exact product origin, can
 *   deliver by postMessage after this window says `ready` (never through the URL). The bound account is always on screen. If another
 *   handoff or another wallet window switches the account, the current request is cancelled and this browser's wallet key is forgotten.
 * - Requests: one at a time; a second one is answered `FLOFI_WALLET_BUSY`; each is answered exactly once, to the product origin only.
 *   Closing the window before Sign answers "cancelled"; once a signing activity may exist, nothing here pretends it was refused.
 * - Lock state: shown with the remaining time when known, announced to the opener (`locked`/`unlocked`) so FloFi can ask for an unlock
 *   before a short-lived Review starts, and shared with other wallet windows (BroadcastChannel hints, re-read from the server).
 * - Lock: ends this browser's wallet session on the server and forgets the wallet key, so nothing can be stamped any more.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccountIcon } from '../components/account/account-icons';
import { useLocale } from '../i18n/locale';
import { PRE_SIGNATURE_CODES, REJECTED_CODE } from '../wallet/flofi-signing';
import { broadcast, classifyOpenerMessage, errorResponse, notice, okResponse, postToOpener, subscribeBroadcast } from './channel';
import { CreateRequest, ExportRequest, ImportRequest, WalletList } from './operations';
import type { WalletOperation, WalletResponse, WalletResult } from './protocol';
import { forgetWalletKey, walletPublicKey } from './provider-client';
import type { RequestEnv, WalletAppConfig } from './request-parts';
import { EvmTransactionRequest, SignMessageRequest, SolanaTransactionRequest } from './signing';
import { UnlockPanel, type Unlocked } from './unlock-panel';
import { walletApi, WalletApiError, type WalletContext } from './wallet-api';
import { codeOf, walletMessage } from './wallet-messages';
import { WalletShell } from './wallet-shell';
import styles from './wallet.module.css';

export type { WalletAppConfig } from './request-parts';
type Phase = 'starting' | 'connecting' | 'ready' | 'no-opener' | 'ended';
type Active = { readonly id: string; readonly operation: WalletOperation };
type Outcome = { readonly tone: 'done'; readonly text: string } | { readonly tone: 'refused'; readonly code: string } | { readonly tone: 'account'; readonly label: string } | null;
/** How long FloFi Wallet waits for its opener's handoff before it says the window is not connected. */
export const HANDOFF_WAIT_MS = 20_000;
const EXPORT_FRESH_SECONDS = 5 * 60;
const seconds = () => Math.floor(Date.now() / 1000);

export function WalletApp({ config }: { config: WalletAppConfig }) {
  const { t } = useLocale();
  const appHost = useMemo(() => new URL(config.appOrigin).host, [config.appOrigin]);
  const walletHost = useMemo(() => new URL(config.walletOrigin).host, [config.walletOrigin]);
  const [phase, setPhaseState] = useState<Phase>('starting'), [endedCode, setEndedCode] = useState<string | null>(null);
  const [context, setContextState] = useState<WalletContext | null>(null), [active, setActiveState] = useState<Active | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null), [signing, setSigningState] = useState(false), [locking, setLocking] = useState(false);
  const [local, setLocal] = useState<{ at: number | null; until: number | null }>({ at: null, until: null });
  const [forcedLock, setForcedLock] = useState(false), [ownKey, setOwnKey] = useState<string | null>(null), [now, setNow] = useState(() => Date.now());
  const [hasOpener, setHasOpener] = useState(false);
  const outcomeRef = useRef<HTMLDivElement>(null);
  // Event handlers registered once read the current state from here.
  const live = useRef({ phase: 'starting' as Phase, context: null as WalletContext | null, active: null as Active | null, bound: false, signing: false,
    redeeming: false, answered: new Set<string>(), previous: Promise.resolve(null as string | null) });

  const setPhase = (next: Phase) => { live.current.phase = next; setPhaseState(next); };
  const setContext = (next: WalletContext) => {
    live.current.context = next; setContextState(next);
    if (!next.unlocked) setLocal({ at: null, until: null });
  };
  const setActive = (next: Active | null) => { live.current.active = next; live.current.signing = false; setSigningState(false); setActiveState(next); };
  const setSigning = (value: boolean) => { live.current.signing = value; setSigningState(value); };
  /** The one exit of every request: answered once, to the product origin only. */
  const answer = (response: WalletResponse) => {
    const state = live.current;
    if (state.answered.has(response.id)) return;
    state.answered.add(response.id);
    postToOpener(window.opener, config.appOrigin, response);
    if (state.active?.id === response.id) setActive(null);
  };
  const succeed = (id: string, result: WalletResult, text: string) => { answer(okResponse(id, result)); setOutcome(text ? { tone: 'done', text } : null); };
  const refuse = (id: string, code: string, display = code) => { answer(errorResponse(id, code)); setOutcome({ tone: 'refused', code: display }); };
  /**
   * Cancels the open request unless a signing activity may already exist (that request finishes on its own, honestly). Nothing was signed,
   * so the answer is always one of the product's proven pre-signature codes; the person sees the precise reason.
   */
  const cancelActive = (code: string) => {
    const current = live.current.active;
    if (current && !live.current.signing) refuse(current.id, PRE_SIGNATURE_CODES.has(code) || code === REJECTED_CODE ? code : 'WALLET_SESSION_REQUIRED', code);
  };
  /**
   * Ends this window's binding. `rebind`: the bound session was lost (expired, revoked, signed out elsewhere), so FloFi is told this page
   * needs a new handoff (`ready`) and an open window recovers instead of refusing every later request. Never after the person's own Lock
   * or a failed handoff (no loop): those stay ended until FloFi opens the window again from a click.
   */
  const end = (code: string, options: { readonly rebind?: boolean } = {}) => {
    live.current.bound = false;
    cancelActive(code);
    setEndedCode(code); setPhase('ended');
    if (options.rebind && window.opener) postToOpener(window.opener, config.appOrigin, notice('ready'));
  };
  const accountChanged = async (next: WalletContext) => {
    const cancelled = live.current.active !== null && !live.current.signing;
    cancelActive('FLOFI_WALLET_ACCOUNT_MISMATCH');
    // Always said out loud: a handoff can rebind this window, and the person must see whose wallets these are before acting.
    if (!cancelled) setOutcome({ tone: 'account', label: next.label });
    setLocal({ at: null, until: null }); setForcedLock(false);
    // The key may hold a provider session for the previous account's organization: forget it.
    await forgetWalletKey(); setOwnKey(null);
    broadcast({ type: 'account', accountId: next.accountId });
  };
  const redeem = async (token: string) => {
    const state = live.current;
    if (state.redeeming) return;
    state.redeeming = true;
    try {
      const previous = state.context?.accountId ?? await state.previous;
      const next = await walletApi.redeem(token, config.appOrigin);
      if (previous && previous !== next.accountId) await accountChanged(next);
      state.bound = true;
      setContext(next); setEndedCode(null); setPhase('ready');
    } catch (cause) { end(codeOf(cause, 'WALLET_HANDOFF_INVALID')); }
    finally { state.redeeming = false; }
  };
  /** Re-reads the session after a notice from another wallet window (an unlock, a lock, another account). */
  const refresh = async () => {
    const state = live.current;
    if (!state.bound || !state.context) return;
    try {
      const next = await walletApi.session(config.appOrigin);
      if (next.accountId !== state.context.accountId) await accountChanged(next);
      setContext(next);
    } catch (cause) { if (cause instanceof WalletApiError && cause.status === 401) end('FLOFI_WALLET_LOCKED', { rebind: true }); }
  };

  useEffect(() => {
    const state = live.current, opener = window.opener as unknown;
    const onMessage = (event: MessageEvent) => {
      const message = classifyOpenerMessage(event, window.opener, config.appOrigin);
      if (!message) return;
      if (message.kind === 'handoff') { void redeem(message.handoff.token); return; }
      const id = message.kind === 'request' ? message.request.id : message.id;
      if (state.answered.has(id) || state.active?.id === id) return;
      if (message.kind === 'invalid-request') { answer(errorResponse(id, 'FLOFI_WALLET_REQUEST_INVALID')); return; }
      if (state.active) { answer(errorResponse(id, 'FLOFI_WALLET_BUSY')); return; }
      // While a new handoff is being redeemed the request waits for it (FloFi sends the handoff first, then the request).
      if (state.phase === 'ended' && !state.redeeming) { answer(errorResponse(id, 'WALLET_SESSION_REQUIRED')); return; }
      setOutcome(null); setActive({ id, operation: message.request.request });
      postToOpener(window.opener, config.appOrigin, notice('busy'));
      try { window.focus(); } catch { /* the browser decides */ }
    };
    // Closing this window before Sign is a cancellation; after Sign the product page must find out what happened, so nothing is said.
    const onPageHide = () => { const current = state.active; if (current && !state.signing) postToOpener(window.opener, config.appOrigin, errorResponse(current.id, 'FLOFI_WALLET_REJECTED')); };
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onPageHide);
    const unsubscribe = subscribeBroadcast(message => { if (message.type !== 'error') void refresh(); });
    void walletPublicKey().then(setOwnKey, () => setOwnKey(null));
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    let wait: ReturnType<typeof setTimeout> | undefined;
    setHasOpener(Boolean(opener));
    if (opener) {
      setPhase('connecting');
      state.previous = walletApi.session(config.appOrigin).then(previous => previous.accountId, () => null);
      postToOpener(opener, config.appOrigin, notice('ready'));
      wait = setTimeout(() => { if (!state.bound && !state.redeeming && state.phase === 'connecting') end('WALLET_SESSION_REQUIRED'); }, HANDOFF_WAIT_MS);
    } else {
      // Opened directly: show the wallets of an existing session (nothing can ask this window to sign without an opener).
      void walletApi.session(config.appOrigin).then(next => { state.bound = true; setContext(next); setPhase('ready'); }, () => setPhase('no-opener'));
    }
    return () => {
      window.removeEventListener('message', onMessage); window.removeEventListener('pagehide', onPageHide);
      unsubscribe(); clearInterval(tick); clearTimeout(wait);
    };
  }, []); // Registered once; handlers read `live`.

  const keyMismatch = Boolean(context?.unlockedKey && ownKey && context.unlockedKey !== ownKey);
  const until = local.until ?? context?.unlockedUntil ?? null, at = local.at ?? context?.unlockedAt ?? null;
  const unlocked = Boolean(context?.unlocked) && !forcedLock && !keyMismatch && (until === null || until * 1000 > now);
  const freshUnlock = !unlocked ? false : at === null ? null : now / 1000 - at <= EXPORT_FRESH_SECONDS;
  const minutesLeft = unlocked && until !== null ? Math.max(1, Math.ceil((until * 1000 - now) / 60_000)) : null;

  // FloFi learns the lock state so it can ask for an unlock before a short-lived Review starts (spec decision 9).
  useEffect(() => { if (phase === 'ready' && live.current.bound) postToOpener(window.opener, config.appOrigin, notice(unlocked ? 'unlocked' : 'locked')); },
    [phase, unlocked, config.appOrigin]);
  // `connect` and `manage` need no decision: the account's managed addresses are public data FloFi already shows.
  useEffect(() => {
    if (!active || phase !== 'ready' || !context || !live.current.bound) return;
    if (active.operation.op === 'connect')
      succeed(active.id, { wallets: context.wallets.map(wallet => ({ ecosystem: wallet.ecosystem, address: wallet.address, label: wallet.label })) },
        t('FloFi can now see the addresses of your FloFi Wallets.'));
    else if (active.operation.op === 'manage') succeed(active.id, { done: true }, '');
  }, [active, phase, context]); // Answers once per request (answer() is idempotent).
  useEffect(() => { if (!active && outcome) outcomeRef.current?.focus(); }, [active, outcome]);

  const onUnlocked = (value: Unlocked) => {
    setContext(value.context); setLocal({ at: seconds(), until: value.until }); setOwnKey(value.key); setForcedLock(false);
    broadcast({ type: 'unlocked' });
  };
  const onLockRequired = () => { setForcedLock(true); void refresh(); };
  async function lock() {
    setLocking(true);
    cancelActive('FLOFI_WALLET_REJECTED');
    // Even if the server cannot be reached, the key is forgotten: nothing can be stamped from this browser any more.
    await walletApi.lock().catch(() => undefined);
    await forgetWalletKey(); setOwnKey(null);
    broadcast({ type: 'locked' });
    postToOpener(window.opener, config.appOrigin, notice('locked'));
    setLocking(false); end('FLOFI_WALLET_LOCKED');
  }

  const account = phase === 'ready' && context
    ? { label: context.label, unlocked, minutesLeft, onLock: signing || locking ? null : () => void lock(), locking } : null;
  let body: ReactNode;
  if (phase === 'ready' && context && active && active.operation.op !== 'connect' && active.operation.op !== 'manage') {
    const id = active.id;
    const env: RequestEnv = { id, config, appHost, context, unlocked, freshUnlock, onUnlocked, onContext: setContext, onLockRequired, setSigning,
      succeed: (result, text) => succeed(id, result, text), refuse: (code, display) => refuse(id, code, display) };
    const operation = active.operation;
    body = operation.op === 'create' ? <CreateRequest key={id} env={env} ecosystem={operation.ecosystem}/>
      : operation.op === 'import' ? <ImportRequest key={id} env={env} ecosystem={operation.ecosystem}/>
      : operation.op === 'export' ? <ExportRequest key={id} env={env} walletId={operation.walletId} kind={operation.kind}/>
      : operation.op === 'evm_sign_message' ? <SignMessageRequest key={id} env={env} ecosystem="evm" address={operation.address} message={operation.message}/>
      : operation.op === 'solana_sign_message' ? <SignMessageRequest key={id} env={env} ecosystem="solana" address={operation.address} message={operation.message}/>
      : operation.op === 'evm_sign_transaction' ? <EvmTransactionRequest key={id} env={env} address={operation.address} tx={operation.tx} signing={operation.signing}/>
      : <SolanaTransactionRequest key={id} env={env} address={operation.address} chain={operation.chain} transaction={operation.transaction} signing={operation.signing}/>;
  } else if (phase === 'ready' && context) {
    body = <>
      {outcome && <div ref={outcomeRef} tabIndex={-1} className={outcome.tone === 'done' ? styles.match : outcome.tone === 'account' ? styles.warning : styles.error}
        role={outcome.tone === 'done' ? 'status' : 'alert'}>
        <AccountIcon name={outcome.tone === 'done' ? 'check' : 'warning'} size={18}/>
        <span>{outcome.tone === 'refused' ? t(walletMessage(outcome.code)) : outcome.tone === 'account'
          ? t('FloFi Wallet now serves another FloFi account: {0}. Check that it is yours before you continue.', outcome.label) : outcome.text}</span></div>}
      <section className={styles.card} aria-labelledby="wallets-title">
        <h1 id="wallets-title" className={styles.heading}>{t('Your FloFi Wallets')}</h1>
        <WalletList wallets={context.wallets}/>
        {hasOpener ? <p className={styles.hint}>{t('Return to FloFi to continue. This window asks you whenever FloFi needs a signature.')}</p> : null}
      </section>
      {!unlocked && <UnlockPanel config={config} context={context} onUnlocked={onUnlocked} title="Unlock now"
        reason="Unlock now so FloFi Wallet is ready when FloFi asks for a signature. Unlocking never signs anything by itself."/>}
    </>;
  } else if (phase === 'ended') {
    body = <section className={styles.card} aria-labelledby="ended-title">
      <h1 id="ended-title" className={styles.heading}>{t(endedCode === 'FLOFI_WALLET_LOCKED' ? 'FloFi Wallet is locked' : 'FloFi Wallet is not connected')}</h1>
      <p className={styles.lead} role="alert">{t(endedCode === 'FLOFI_WALLET_LOCKED' ? 'Nothing can be signed from this window now. To use FloFi Wallet again, open it from FloFi.'
        : walletMessage(endedCode ?? 'WALLET_SESSION_REQUIRED'))}</p>
      <button type="button" className={styles.outline} onClick={() => window.close()}>{t('Close window')}</button>
    </section>;
  } else if (phase === 'no-opener') {
    body = <section className={styles.card} aria-labelledby="open-title">
      <h1 id="open-title" className={styles.heading}>{t('Open FloFi Wallet from FloFi')}</h1>
      <p className={styles.lead}>{t('FloFi Wallet works together with FloFi. In FloFi, open Credentials → My wallets, or choose FloFi Wallet when you connect a wallet: FloFi opens this window for your account.')}</p>
      <p className={styles.hint}>{t('For your safety, this window never takes its account from a link.')}</p>
      <a className={styles.primary} href={`${config.appOrigin}/app`}>{t('Go to FloFi')}</a>
    </section>;
  } else {
    body = <section className={`${styles.card} ${styles.center}`} aria-busy="true">
      <span className={styles.spinner} aria-hidden="true"/>
      <p className={styles.status} role="status">{t(phase === 'connecting' ? 'Connecting to FloFi…' : 'Opening FloFi Wallet…')}</p>
    </section>;
  }
  return <WalletShell walletHost={walletHost} account={account}>{body}</WalletShell>;
}
