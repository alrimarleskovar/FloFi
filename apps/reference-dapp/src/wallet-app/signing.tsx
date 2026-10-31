// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's signing screens (spec decisions 2, 5, 8; security review findings 2, 7, 9, 10).
 *
 * A transaction is signable only when (1) it names its FloFi run, (2) the signer is a managed wallet of this account, (3) FloFi Wallet's
 * own server matched the exact bytes to that run's prepared attempt and returned the Review summary ("Matches your reviewed FloFi
 * strategy"), and (4) the person, having seen the summary and FloFi Wallet's own decoding of the bytes, presses an armed Sign. Anything
 * else is refused before signing, with its reason. The page builds the exact bytes it asks the provider to sign (EVM: the type-2 RLP;
 * Solana: the v0 message) and checks the provider's answer is the same transaction before it leaves this window. A failure after the
 * signing activity reached the provider is answered as unknown, never as a refusal, and the bytes are discarded.
 * Messages: only FloFi's own, unexpired sign-in message for this wallet and this product host, shown in full.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccountIcon } from '../components/account/account-icons';
import { useLocale } from '../i18n/locale';
import { PRE_SIGNATURE_CODES, REJECTED_CODE, type SigningSummary } from '../wallet/flofi-signing';
import { bytesToHex, formatUnits, reviewEvmTransaction, unsignedEip1559, verifySignedEip1559, type EvmCall, type EvmReview } from './evm-transaction';
import type { EvmTransaction, SigningBinding, SolanaWalletChain, WalletResult } from './protocol';
import { signEvmTransaction, signSignInMessage, signSolanaMessage, WalletSigningError } from './provider-client';
import { managedWallet, RequestHeading, SignControls, type RequestEnv } from './request-parts';
import { parseFloFiSignIn } from './sign-in-message';
import { messageHex, messageSha256, parseUnsignedTransaction, reviewSolanaTransaction, withFeePayerSignature, type DecodedInstruction, type SolanaAccountRef,
  type SolanaReview } from './solana-transaction';
import { UnlockPanel } from './unlock-panel';
import { walletApi } from './wallet-api';
import { codeOf, walletMessage } from './wallet-messages';
import styles from './wallet.module.css';

type Translate = ReturnType<typeof useLocale>['t'];
const SOL_DECIMALS = 9, GWEI = 9, ETH = 18;

/**
 * Answers a refusal that happened before any signing activity reached the provider. FloFi's product side treats only its closed set of
 * pre-signature codes as proof that nothing was signed (`PRE_SIGNATURE_CODES`); any other code it would read as unknown. So a refusal
 * outside that set is answered with the closest code inside it, and the person still sees the precise reason here.
 */
function refuseBeforeSigning(env: RequestEnv, code: string, fallback: string) {
  // This request reached nothing, but the attempt's single signature already exists: FloFi must reconcile that one, so the code goes
  // through as it is (FloFi reads it as unknown, never as "nothing was signed").
  if (code === 'FLOFI_WALLET_ALREADY_SIGNED') { env.refuse(code, code); return; }
  env.refuse(PRE_SIGNATURE_CODES.has(code) || code === REJECTED_CODE ? code : fallback, code);
}
/** The FloFi page that asked is gone: nothing could receive a signature, so nothing is signed (or announced as sent). */
const openerGone = () => { try { return !window.opener || (window.opener as Window).closed; } catch { return true; } };
/** Delivers a signature only while the FloFi page that asked can still receive it; otherwise says honestly that it was discarded. */
function deliver(env: RequestEnv, result: WalletResult, text: string) {
  if (openerGone()) env.refuse('FLOFI_WALLET_SIGNATURE_UNKNOWN', 'FLOFI_WALLET_OPENER_CLOSED_AFTER_SIGNING');
  else env.succeed(result, text);
}
/** The one way a signing attempt ends badly: retry after an unlock, a refusal proven before signing, or unknown. */
function signingFailed(env: RequestEnv, cause: unknown, retry: (code: string) => void) {
  env.setSigning(false);
  if (cause instanceof WalletSigningError && !cause.submitted) {
    if (cause.message === 'WALLET_UNLOCK_REQUIRED') { env.onLockRequired(); retry(cause.message); return; }
    refuseBeforeSigning(env, cause.message, 'SIGN_REQUEST_INVALID'); return;
  }
  const display = codeOf(cause, 'FLOFI_WALLET_SIGNATURE_UNKNOWN');
  env.refuse('FLOFI_WALLET_SIGNATURE_UNKNOWN', display === 'FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH' ? display : 'FLOFI_WALLET_SIGNATURE_UNKNOWN');
}

// ── Sign-in messages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function SignMessageRequest({ env, ecosystem, address, message }: { env: RequestEnv; ecosystem: 'evm' | 'solana'; address: string; message: string }) {
  const { t } = useLocale();
  const app = useMemo(() => ({ host: env.appHost, origin: env.config.appOrigin }), [env.appHost, env.config.appOrigin]);
  // Parsed once, when the request arrives: if the message expires while it is on screen the card stays (with Cancel) and the click
  // re-checks it and refuses, instead of the request vanishing with no answer to FloFi.
  const [parsed] = useState(() => parseFloFiSignIn(message, ecosystem, address, app));
  const wallet = managedWallet(env.context, ecosystem, address);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wallet) env.refuse('SIGNER_NOT_MANAGED');
    else if (!parsed) env.refuse('FLOFI_WALLET_MESSAGE_UNSUPPORTED');
  }, []); // Checked once, when the request arrives.
  if (!wallet || !parsed) return null;
  async function sign() {
    const organization = env.context.organization;
    // Re-checked at the click: the message may have expired while it was on screen.
    if (!organization || !parseFloFiSignIn(message, ecosystem, address, app)) { env.refuse('FLOFI_WALLET_MESSAGE_UNSUPPORTED'); return; }
    if (openerGone()) { env.refuse('FLOFI_WALLET_REJECTED', 'FLOFI_WALLET_OPENER_CLOSED'); return; }
    setBusy(true); setError(null); env.setSigning(true);
    try {
      const signature = await signSignInMessage(organization.organizationId, wallet!.address, ecosystem, message);
      deliver(env, { signature: ecosystem === 'evm' ? `0x${signature}` : signature }, t('Signed in to FloFi with {0}.', wallet!.label));
    } catch (cause) { signingFailed(env, cause, setError); }
    finally { setBusy(false); }
  }
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('Sign-in')} title={t('Sign in to FloFi with {0}', wallet.label)} from={env.appHost}/>
    <p className={styles.match}><AccountIcon name="shield" size={18}/><span><strong>{t('FloFi’s own sign-in message')}</strong>
      {t('It proves you control this wallet. It authorizes no transaction and moves no funds.')}</span></p>
    <dl className={styles.fields}>
      <dt>{t('Website')}</dt><dd className={styles.mono}>{parsed.domain}</dd>
      <dt>{t('Wallet')}</dt><dd className={styles.mono}>{wallet.address}</dd>
      {parsed.chainId !== null && <><dt>{t('Chain ID')}</dt><dd className={styles.mono}>{parsed.chainId}</dd></>}
      <dt>{t('Expires')}</dt><dd>{new Date(parsed.expirationTime).toLocaleTimeString()}</dd>
    </dl>
    <div><p className={styles.eyebrow}>{t('Full message')}</p><pre className={styles.pre}>{message}</pre></div>
    {!env.unlocked && <UnlockPanel config={env.config} context={env.context} onUnlocked={env.onUnlocked}/>}
    {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    <SignControls id={env.id} ready={env.unlocked} busy={busy} label="Sign" busyLabel="Signing…" onSign={() => void sign()} onCancel={() => env.refuse('FLOFI_WALLET_REJECTED')}/>
  </section>;
}

// ── The server's Review summary ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Loads the Review for a transaction request; refuses (answers) the request when the server finds no match. */
function useReviewSummary(env: RequestEnv, binding: SigningBinding | undefined, address: string, request: Record<string, unknown> | null) {
  const [summary, setSummary] = useState<SigningSummary | null>(null), [failure, setFailure] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const body = useRef(request);
  useEffect(() => {
    if (!binding || !body.current) return;
    let current = true;
    setFailure(null);
    walletApi.signingContext(binding, address, body.current).then(value => { if (current) setSummary(value); }, cause => {
      if (!current) return;
      const code = codeOf(cause, 'FLOFI_WALLET_REVIEW_UNAVAILABLE');
      // A refusal is final; an unreachable server can be retried by the person.
      if (code === 'FLOFI_WALLET_REVIEW_UNAVAILABLE') setFailure(code); else refuseBeforeSigning(env, code, 'FLOFI_WALLET_NO_MATCHING_REVIEW');
    });
    return () => { current = false; };
  }, [attempt]); // One request per attempt; the request itself never changes.
  return { summary, failure, retry: () => setAttempt(value => value + 1) };
}
function SummaryCard({ summary }: { summary: SigningSummary }) {
  const { t } = useLocale();
  // What the server verified, and no more: these exact bytes are the ones FloFi prepared for this run. It cannot prove who reviewed it,
  // so the person is asked to check the lines below here, where the product page cannot reach.
  return <div className={styles.match} role="group" aria-label={t('Prepared by FloFi')}>
    <AccountIcon name="shield" size={18}/>
    <div className={styles.matchBody}>
      <strong>{t('Exactly the transaction FloFi prepared for this strategy')}</strong>
      <span>{summary.action} · {t('Check every line below before you sign.')}</span>
      <dl className={styles.fields}>
        <dt>{t('Network')}</dt><dd>{summary.network} {summary.realFunds && <span className={`${styles.badge} ${styles.badgeReal}`}>{t('Real funds')}</span>}</dd>
        {summary.lines.map((line, index) => <Row key={index} label={t(line.label)}>{line.value}</Row>)}
        {summary.expiresAt && <Row label={t('Review expires')}>{new Date(summary.expiresAt).toLocaleTimeString()}</Row>}
      </dl>
    </div>
  </div>;
}
function ReviewGate({ binding, summary, failure, retry, children }: { binding: SigningBinding | undefined; summary: SigningSummary | null; failure: string | null;
  retry: () => void; children: ReactNode }) {
  const { t } = useLocale();
  if (!binding) return null;
  if (failure) return <div className={styles.actions}><p className={styles.error} role="alert">{t(walletMessage(failure))}</p>
    <button type="button" className={styles.outline} onClick={retry}>{t('Try again')}</button></div>;
  if (!summary) return <p className={styles.status} role="status">{t('Checking this request against your Review in FloFi…')}</p>;
  return <>{children}</>;
}
const expired = (summary: SigningSummary | null) => summary?.expiresAt !== null && summary?.expiresAt !== undefined && Date.parse(summary.expiresAt) <= Date.now();

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return <><dt>{label}</dt><dd className={mono ? styles.mono : undefined}>{children}</dd></>;
}

// ── EVM ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function callRows(call: EvmCall, token: string, t: Translate): ReactNode {
  const units = (amount: bigint) => t('{0} (token base units)', amount.toString());
  switch (call.kind) {
    case 'none': return <Row label={t('Action')}>{t('Plain transfer, no contract call')}</Row>;
    case 'erc20-transfer': return <><Row label={t('Action')}>{t('Token transfer')}</Row><Row label={t('Token contract')} mono>{token}</Row>
      <Row label={t('Recipient')} mono>{call.to}</Row><Row label={t('Amount')}>{units(call.amount)}</Row></>;
    case 'erc20-transfer-from': return <><Row label={t('Action')}>{t('Token transfer from another address')}</Row><Row label={t('Token contract')} mono>{token}</Row>
      <Row label={t('From')} mono>{call.from}</Row><Row label={t('Recipient')} mono>{call.to}</Row><Row label={t('Amount')}>{units(call.amount)}</Row></>;
    case 'erc20-approve': case 'erc20-increase-allowance': case 'erc20-permit':
      return <><Row label={t('Action')}>{t(call.kind === 'erc20-approve' ? 'Token approval' : call.kind === 'erc20-permit' ? 'Token permit' : 'Allowance increase')}</Row>
        <Row label={t('Token contract')} mono>{token}</Row><Row label={t('Spender')} mono>{call.spender}</Row>
        <Row label={t('Allowance')}>{call.unlimited ? <strong>{t('Unlimited')}</strong> : units(call.amount)}</Row></>;
    case 'set-approval-for-all': return <><Row label={t('Action')}>{t(call.approved ? 'Approval for all items' : 'Revoke approval for all items')}</Row>
      <Row label={t('Collection')} mono>{token}</Row><Row label={t('Operator')} mono>{call.operator}</Row></>;
    case 'unknown': return <><Row label={t('Action')}>{t('Contract call (not decoded)')}</Row><Row label={t('Function selector')} mono>{call.selector}</Row>
      <Row label={t('Call data')}>{t('{0} bytes', call.bytes)}</Row></>;
  }
}
export function EvmDetails({ review }: { review: EvmReview }) {
  const { t } = useLocale();
  const coin = (value: bigint) => `${formatUnits(value, ETH)} ${review.chain.symbol}`;
  const approval = review.call.kind === 'erc20-approve' || review.call.kind === 'erc20-increase-allowance' || review.call.kind === 'erc20-permit';
  return <div className={styles.actions}>
    <p className={styles.eyebrow}>{t('What you are signing')}</p>
    {approval && 'unlimited' in review.call && review.call.unlimited && <p className={styles.warning}><AccountIcon name="warning" size={18}/>
      <span>{t('This gives the spender unlimited access to this token in your wallet, now and later.')}</span></p>}
    {review.call.kind === 'set-approval-for-all' && review.call.approved && <p className={styles.warning}><AccountIcon name="warning" size={18}/>
      <span>{t('This lets the operator move every item of this collection in your wallet.')}</span></p>}
    <dl className={styles.fields}>
      <Row label={t('Network')}>{review.chain.name} ({review.chain.chainId})</Row>
      <Row label={t('From')} mono>{review.from}</Row>
      <Row label={t('To')} mono>{review.to}</Row>
      <Row label={t('Sends')}>{coin(review.value)}</Row>
      {callRows(review.call, review.to, t)}
      <Row label={t('Nonce')} mono>{review.nonce.toString()}</Row>
      <Row label={t('Gas limit')} mono>{review.gas.toString()}</Row>
      <Row label={t('Max fee per gas')}>{formatUnits(review.maxFeePerGas, GWEI)} gwei</Row>
      <Row label={t('Max priority fee')}>{formatUnits(review.maxPriorityFeePerGas, GWEI)} gwei</Row>
      <Row label={t(review.chain.separateL1Fee ? 'Maximum cost before the L1 data fee' : 'Maximum total cost')}><strong>{coin(review.maxTotalCost)}</strong></Row>
    </dl>
    {review.call.kind === 'unknown' && <details className={styles.details}><summary>{t('Show call data')}</summary><pre className={styles.pre}>{review.data}</pre></details>}
  </div>;
}

export function EvmTransactionRequest({ env, address, tx, signing }: { env: RequestEnv; address: string; tx: EvmTransaction; signing: SigningBinding | undefined }) {
  const { t } = useLocale();
  const wallet = managedWallet(env.context, 'evm', address), review = useMemo(() => reviewEvmTransaction(tx), [tx]);
  const refusal = !signing ? 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' : !wallet ? 'SIGNER_NOT_MANAGED' : !review ? 'FLOFI_WALLET_NETWORK_UNSUPPORTED' : null;
  const { summary, failure, retry } = useReviewSummary(env, refusal ? undefined : signing, address, refusal ? null : { op: 'evm_sign_transaction', tx });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (refusal) env.refuse(refusal); }, []); // Checked once, when the request arrives.
  if (refusal || !review || !wallet || !signing) return null;
  async function sign() {
    const organization = env.context.organization;
    if (!organization) { env.refuse('MANAGED_ORGANIZATION_MISSING'); return; }
    if (expired(summary)) { env.refuse('FLOFI_WALLET_REVIEW_EXPIRED'); return; }
    if (openerGone()) { env.refuse('FLOFI_WALLET_REJECTED', 'FLOFI_WALLET_OPENER_CLOSED'); return; }
    setBusy(true); setError(null); env.setSigning(true);
    try {
      const signed = await signEvmTransaction(organization.organizationId, wallet!.address, bytesToHex(unsignedEip1559(tx)), signing!);
      let raw: string;
      try { raw = verifySignedEip1559(tx, signed); } catch { throw new WalletSigningError('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH', true); }
      deliver(env, { signedTransaction: raw }, t('Signed. FloFi sends the transaction and records the result.'));
    } catch (cause) { signingFailed(env, cause, setError); }
    finally { setBusy(false); }
  }
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('Transaction')} title={t('Sign a transaction on {0}', review.chain.name)} from={env.appHost}/>
    <ReviewGate binding={signing} summary={summary} failure={failure} retry={retry}>
      {summary && <SummaryCard summary={summary}/>}
      <EvmDetails review={review}/>
      {!env.unlocked && <UnlockPanel config={env.config} context={env.context} onUnlocked={env.onUnlocked}/>}
      {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    </ReviewGate>
    <SignControls id={env.id} ready={env.unlocked && summary !== null} busy={busy} label="Sign" busyLabel="Signing…" onSign={() => void sign()}
      onCancel={() => env.refuse('FLOFI_WALLET_REJECTED')}/>
  </section>;
}

// ── Solana ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function account(ref: SolanaAccountRef, t: Translate): string {
  return 'address' in ref ? ref.address : t('Lookup table account #{0}', ref.index);
}
function instructionText(ix: DecodedInstruction, t: Translate): { text: string; detail: string | null; warn: boolean } {
  const sol = (lamports: bigint) => `${formatUnits(lamports, SOL_DECIMALS)} SOL`;
  const amount = (value: bigint, decimals: number | null) => decimals === null ? t('{0} (token base units)', value.toString()) : formatUnits(value, decimals);
  switch (ix.kind) {
    case 'sol-transfer': return { text: t('Send {0}', sol(ix.lamports)), detail: `${account(ix.from, t)} → ${account(ix.to, t)}`, warn: false };
    case 'create-account': return { text: t('Create an account funded with {0}', sol(ix.lamports)), detail: account(ix.account, t), warn: false };
    case 'advance-nonce': return { text: t('Use a durable nonce'), detail: account(ix.nonceAccount, t), warn: true };
    case 'token-transfer': return { text: t('Token transfer of {0}', amount(ix.amount, ix.decimals)), detail: `${account(ix.source, t)} → ${account(ix.destination, t)}`, warn: false };
    case 'token-approve': return { text: ix.unlimited ? t('Token approval: unlimited') : t('Token approval of {0}', amount(ix.amount, ix.decimals)),
      detail: t('Delegate: {0}', account(ix.delegate, t)), warn: true };
    case 'token-revoke': return { text: t('Revoke a token approval'), detail: account(ix.source, t), warn: false };
    case 'token-set-authority': return { text: t('Change a token account’s authority'), detail: ix.newAuthority ?? t('No authority (removed)'), warn: true };
    case 'token-close-account': return { text: t('Close a token account'), detail: t('Rent goes to {0}', account(ix.destination, t)), warn: false };
    case 'compute-unit-limit': return { text: t('Compute limit: {0} units', ix.units), detail: null, warn: false };
    case 'compute-unit-price': return { text: t('Priority fee: {0} micro-lamports per unit', ix.microLamports.toString()), detail: null, warn: false };
    case 'other': return { text: t('Instruction (not decoded)'), detail: t('{0} accounts, {1} bytes of data', ix.accounts, ix.dataBytes), warn: false };
  }
}
export function SolanaDetails({ review, hash }: { review: SolanaReview; hash: string | null }) {
  const { t } = useLocale();
  return <div className={styles.actions}>
    <p className={styles.eyebrow}>{t('What you are signing')}</p>
    {review.durableNonce && <p className={styles.warning}><AccountIcon name="warning" size={18}/>
      <span>{t('This transaction uses a durable nonce: it stays valid until it is used, not for about a minute like most transactions.')}</span></p>}
    <dl className={styles.fields}>
      <Row label={t('Fee payer')} mono>{review.feePayer}</Row>
      <Row label={t('Signatures')}>{review.signatures}</Row>
      {review.maxFeeLamports !== null && <Row label={t('Maximum network fee')}>{formatUnits(review.maxFeeLamports, SOL_DECIMALS)} SOL</Row>}
      <Row label={t('Message SHA-256')} mono>{hash ?? '…'}</Row>
      <Row label={t('Programs')}>{review.programs.map(program => <span key={program.address} className={`${styles.mono} ${styles.block}`}>
        {program.name ? `${program.name} · ` : `${t('Unknown program')} · `}{program.address}</span>)}</Row>
    </dl>
    <ol className={styles.list} aria-label={t('Instructions')}>
      {review.instructions.map((ix, index) => { const line = instructionText(ix, t); return <li key={index}>
        <span className={line.warn ? styles.strong : undefined}>{line.warn && <AccountIcon name="warning" size={14}/>} {line.text}</span>
        {line.detail && <span className={styles.mono}>{line.detail}</span>}
      </li>; })}
    </ol>
    {review.lookupTables > 0 && <p className={styles.hint}>{t('Some accounts come from address lookup tables; the network resolves them. FloFi checked them against your Review.')}</p>}
  </div>;
}

export function SolanaTransactionRequest({ env, address, chain, transaction, signing }: { env: RequestEnv; address: string; chain: SolanaWalletChain; transaction: string;
  signing: SigningBinding | undefined }) {
  const { t } = useLocale();
  const wallet = managedWallet(env.context, 'solana', address);
  const parsed = useMemo(() => { try { return parseUnsignedTransaction(transaction, address); } catch { return null; } }, [transaction, address]);
  const review = useMemo(() => parsed ? reviewSolanaTransaction(parsed) : null, [parsed]);
  const refusal = !signing ? 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' : !wallet ? 'SIGNER_NOT_MANAGED' : !parsed ? 'FLOFI_WALLET_REQUEST_INVALID' : null;
  const { summary, failure, retry } = useReviewSummary(env, refusal ? undefined : signing, address, refusal ? null : { op: 'solana_sign_transaction', chain, transaction });
  const [hash, setHash] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (refusal) { env.refuse(refusal); return; }
    if (parsed) void messageSha256(parsed.wire.message).then(setHash, () => setHash(null));
  }, []); // Checked once, when the request arrives.
  if (refusal || !parsed || !review || !wallet || !signing) return null;
  async function sign() {
    const organization = env.context.organization;
    if (!organization) { env.refuse('MANAGED_ORGANIZATION_MISSING'); return; }
    if (expired(summary)) { env.refuse('FLOFI_WALLET_REVIEW_EXPIRED'); return; }
    if (openerGone()) { env.refuse('FLOFI_WALLET_REJECTED', 'FLOFI_WALLET_OPENER_CLOSED'); return; }
    setBusy(true); setError(null); env.setSigning(true);
    try {
      const signature = await signSolanaMessage(organization.organizationId, wallet!.address, messageHex(parsed!), signing!);
      const bytes = Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16));
      let signed: string;
      try { signed = withFeePayerSignature(transaction, bytes); } catch { throw new WalletSigningError('FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH', true); }
      deliver(env, { signedTransaction: signed }, t('Signed. FloFi sends the transaction and records the result.'));
    } catch (cause) { signingFailed(env, cause, setError); }
    finally { setBusy(false); }
  }
  return <section className={`${styles.card} ${styles.cardGlow}`} aria-labelledby="request-title">
    <RequestHeading eyebrow={t('Transaction')} title={t('Sign a Solana transaction')} from={env.appHost}/>
    <ReviewGate binding={signing} summary={summary} failure={failure} retry={retry}>
      {summary && <SummaryCard summary={summary}/>}
      <SolanaDetails review={review} hash={hash}/>
      {!env.unlocked && <UnlockPanel config={env.config} context={env.context} onUnlocked={env.onUnlocked}/>}
      {error && <p className={styles.error} role="alert">{t(walletMessage(error))}</p>}
    </ReviewGate>
    <SignControls id={env.id} ready={env.unlocked && summary !== null} busy={busy} label="Sign" busyLabel="Signing…" onSign={() => void sign()}
      onCancel={() => env.refuse('FLOFI_WALLET_REJECTED')}/>
  </section>;
}
