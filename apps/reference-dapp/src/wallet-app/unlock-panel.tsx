// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: unlocking FloFi Wallet, on the wallet origin only (security review findings 1, 3, 4, 5).
 *
 * - Email: the provider emails an 8-character FloFi Wallet code to the account's own address. The page encrypts the typed code with
 *   this window's key to the provider's enclave (the server never sees it), then signs the provider's login (and, the first time,
 *   sign-up) message that it builds itself from the verified token id, its own key and the address it showed. The person is told that
 *   this code is typed only here; a code prompt anywhere else is not FloFi Wallet.
 * - Google / Apple: a fresh sign-in in a child window opened inside the click (a window opened after an await is blocked), whose nonce
 *   commits to this window's key. The child's link back to this page is cut; this page asks its own server whether the unlock happened.
 * Nothing here holds a code, token or provider session after the step that needs it.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { encryptEmailCode } from '../accounts/otp-browser';
import { AccountIcon } from '../components/account/account-icons';
import { useLocale } from '../i18n/locale';
import { subscribeBroadcast } from './channel';
import { loginSignatureMessage, normalizeUnlockCode, signupSignatureMessage, UNLOCK_CODE_LENGTH, validUnlockCode } from './email-unlock';
import { waitForUnlock } from './oidc-wait';
import { clientSignatureOver, walletPublicKey } from './provider-client';
import { walletApi, type UnlockMethod, type WalletContext } from './wallet-api';
import { codeOf, walletMessage } from './wallet-messages';
import styles from './wallet.module.css';

export type UnlockConfig = { readonly appOrigin: string; readonly walletOrigin: string; readonly otpSignerPublicKey: string | null;
  readonly unlock: Readonly<Record<UnlockMethod, boolean>> };
export type Unlocked = { readonly context: WalletContext; readonly until: number | null; readonly key: string };
type Stage = 'choose' | 'sending' | 'code' | 'verifying' | 'oidc';
const LABEL: Readonly<Record<UnlockMethod, string>> = Object.freeze({ email: 'Email me a code', google: 'Continue with Google', apple: 'Continue with Apple' });

export function UnlockPanel({ config, context, onUnlocked, title, reason }: { config: UnlockConfig; context: WalletContext; onUnlocked: (value: Unlocked) => void;
  title?: string; reason?: string }) {
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>('choose');
  const [code, setCode] = useState(''), [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [provider, setProvider] = useState<'google' | 'apple' | null>(null);
  const pending = useRef<{ challengeId: string; email: string; targetBundle: string; key: string } | null>(null);
  const oidc = useRef<{ controller: AbortController; child: Window } | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const walletHost = new URL(config.walletOrigin).host;
  useEffect(() => () => { oidc.current?.controller.abort(); }, []);
  useEffect(() => { if (stage === 'code') codeInput.current?.focus(); }, [stage]);
  const methods = context.methods;

  async function sendCode() {
    setStage('sending'); setError(null);
    try {
      const key = await walletPublicKey(), started = await walletApi.emailStart(key);
      pending.current = { ...started, key };
      setEmail(started.email); setCode(''); setStage('code');
    } catch (cause) { setError(codeOf(cause, 'EMAIL_SIGN_IN_FAILED')); setStage('choose'); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    const started = pending.current, typed = normalizeUnlockCode(code);
    if (!started) return;
    if (!validUnlockCode(typed)) { setError('EMAIL_CODE_INVALID'); codeInput.current?.focus(); return; }
    setStage('verifying'); setError(null);
    try {
      const encrypted = await encryptEmailCode(typed, started.targetBundle, started.key, config.otpSignerPublicKey);
      const verified = await walletApi.emailVerify(started.challengeId, encrypted);
      // Sign only for the address shown to the person and the key the code was bound to (another window may have reset the key).
      if (verified.email !== started.email || await walletPublicKey() !== started.key) throw new Error('FLOFI_WALLET_UNLOCK_INVALID');
      const loginSignature = await clientSignatureOver(loginSignatureMessage(verified.tokenId, started.key));
      const signupSignature = verified.signup ? await clientSignatureOver(signupSignatureMessage(verified.tokenId, started.email)) : null;
      const finished = await walletApi.emailFinish(loginSignature, signupSignature);
      pending.current = null;
      onUnlocked({ context: finished.context, until: finished.unlockedUntil, key: started.key });
    } catch (cause) {
      const failure = codeOf(cause, 'EMAIL_SIGN_IN_FAILED');
      setError(failure);
      // The same code can be retried only while its challenge lives; any later failure needs a new code.
      if (failure === 'EMAIL_CODE_REJECTED' || failure === 'EMAIL_CODE_INVALID') { setStage('code'); setCode(''); }
      else { pending.current = null; setStage('choose'); }
    }
  }
  function startOidc(chosen: 'google' | 'apple') {
    setError(null);
    // Opened synchronously inside the click; the provider's URL is set once the server answers.
    const before = context.unlockedAt ?? 0;
    const child = window.open('about:blank', `flofi-wallet-signin-${crypto.randomUUID()}`, 'popup,width=480,height=720');
    if (!child) { setError('FLOFI_WALLET_SIGN_IN_WINDOW_BLOCKED'); return; }
    try { child.opener = null; } catch { /* already cut */ }
    const controller = new AbortController();
    oidc.current = { controller, child };
    setProvider(chosen); setStage('oidc');
    void (async () => {
      try {
        const key = await walletPublicKey(), url = await walletApi.oidcStart(chosen, key);
        if (controller.signal.aborted) return;
        child.location.replace(url);
        // Only a new unlock for this window's key counts: the session may already read "unlocked" (an older unlock, before an export's
        // fresh one), and an error notice must never turn into success because of that older state.
        const fresh = (session: WalletContext) => session.unlocked && session.unlockedKey === key && (session.unlockedAt ?? 0) > before;
        const result = await waitForUnlock({ check: async () => fresh(await walletApi.session(config.appOrigin)), subscribe: subscribeBroadcast, signal: controller.signal });
        if (!result.ok) throw new Error(result.code);
        const unlocked = await walletApi.session(config.appOrigin);
        if (!fresh(unlocked)) throw new Error('OIDC_SIGN_IN_FAILED');
        oidc.current = null;
        onUnlocked({ context: unlocked, until: unlocked.unlockedUntil, key });
      } catch (cause) {
        try { child.close(); } catch { /* closed */ }
        oidc.current = null;
        setError(codeOf(cause, 'OIDC_SIGN_IN_FAILED')); setStage('choose');
      }
    })();
  }
  function cancelOidc() { const current = oidc.current; current?.controller.abort(); try { current?.child.close(); } catch { /* closed */ } }

  return <section className={styles.card} aria-labelledby="unlock-title">
    <div>
      <p className={styles.eyebrow}>{t('Verify it’s you')}</p>
      <h2 id="unlock-title" className={styles.heading}>{t(title ?? 'Unlock FloFi Wallet')}</h2>
    </div>
    <p className={styles.lead}>{t(reason ?? 'Unlocking proves it’s you to the wallet provider. Your keys stay with Turnkey; FloFi never holds them.')}</p>
    {methods.length === 0 && <p className={styles.warning}><AccountIcon name="warning" size={18}/>
      <span>{t('This FloFi account has no sign-in that can unlock FloFi Wallet. Add Google, Apple or email to your account in FloFi first.')}</span></p>}
    {(stage === 'choose' || stage === 'sending') && methods.length > 0 && <div className={styles.actions} role="group" aria-label={t('Unlock methods')}>
      {methods.map(method => <button key={method} type="button" className={styles.method} disabled={!config.unlock[method] || stage === 'sending'}
        title={config.unlock[method] ? undefined : t('Not available on this deployment yet')}
        onClick={() => method === 'email' ? void sendCode() : startOidc(method)}>
        <AccountIcon name={method} size={20}/>{t(stage === 'sending' && method === 'email' ? 'Sending code…' : LABEL[method])}
        {!config.unlock[method] && <small>{t('Not available')}</small>}
      </button>)}
    </div>}
    {(stage === 'code' || stage === 'verifying') && email && <form className={styles.form} onSubmit={event => void verify(event)} noValidate>
      <p className={styles.lead}>{t('We emailed an 8-character FloFi Wallet code to {0}.', email)}</p>
      <label htmlFor="unlock-code">{t('FloFi Wallet code')}</label>
      <input ref={codeInput} id="unlock-code" className={`${styles.input} ${styles.code}`} value={code} onChange={event => setCode(event.target.value)}
        autoComplete="one-time-code" inputMode="text" autoCapitalize="characters" spellCheck={false} maxLength={UNLOCK_CODE_LENGTH + 2}
        aria-describedby="unlock-code-hint" aria-invalid={error === 'EMAIL_CODE_INVALID' || error === 'EMAIL_CODE_REJECTED'} disabled={stage === 'verifying'} required/>
      <p id="unlock-code-hint" className={styles.hint}>{t('Type this code only here, in FloFi Wallet at {0}. FloFi never asks for it anywhere else.', walletHost)}</p>
      <button type="submit" className={styles.primary} disabled={stage === 'verifying'}>{t(stage === 'verifying' ? 'Unlocking…' : 'Unlock')}</button>
      <button type="button" className={styles.textButton} onClick={() => void sendCode()} disabled={stage === 'verifying'}>{t('Send a new code')}</button>
    </form>}
    {stage === 'oidc' && provider && <div className={styles.form} role="status">
      <p className={styles.lead}>{t(provider === 'google' ? 'Finish signing in with Google in the window that opened.' : 'Finish signing in with Apple in the window that opened.')}</p>
      <button type="button" className={styles.outline} onClick={cancelOidc}>{t('Cancel')}</button>
    </div>}
    {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
  </section>;
}
