// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { catalogSwapAvailability, publicAvailability, publicBegin, publicObserve, publicPrepare, publicRefresh, publicReport, publicReview, publicStatus } from '../app/public-testnet-action';
import { CATALOG_NETWORK_IDENTITIES } from '../domain/network-registry';
import type { PublicRun } from '../server/public-testnet-service';
import { swapWalletRequestMatches, ownerBoundSwapReview, swapProfile } from '../domain/public-testnet-swap';
import { injected, useBuild009Wallet } from './build009-wallet-store';
import { useWorkflow } from './workflow-store';
import { watchWalletResponse } from './wallet-request-lifecycle';
import { bindFloFiSigning } from '../wallet/flofi-wallet-channel';
import { floFiWalletMessage, PRE_SIGNATURE_CODES, signingContextOf } from '../wallet/flofi-signing';

const KEY = 'gryloo:public-testnet-execution-id';
/**
 * BUILD-SOLANA-MAINNET-001 (requirement E): this browser tab's own run (sessionStorage survives a reload of the tab, not a new visit). A new visit
 * starts with an empty Canvas; only an execution that still needs the owner (in progress or uncertain) is brought back to continue or observe.
 */
const TAB_KEY = KEY + ':tab';
const markTab = (id: string) => { try { sessionStorage.setItem(TAB_KEY, id); } catch { /* the tab marker is a convenience only */ } };
const tabRun = () => { try { return sessionStorage.getItem(TAB_KEY); } catch { return null; } };
/** An execution the owner must still continue or observe: no settled outcome yet, and an attempt that was prepared, sent or confirmed. */
export const publicRunInProgress = (run: Pick<PublicRun, 'outcome' | 'attempts'>) =>
  !run.outcome && run.attempts.some(attempt => ['PREPARED', 'HASH', 'PENDING', 'UNKNOWN', 'CONFIRMED'].includes(attempt.state));
type Store = { readonly available: boolean;
  /** BUILD-BASE-001: whether this instance serves a catalog network's mainnet swaps (live or the MOCKED loopback harness). */
  readonly catalogAvailable: (chain: string) => boolean;
  /** BUILD-FLOFI-CHAT-E2E-FIX-002: whether this instance serves swaps on `chain` at all (a catalog network, or a test-network pair). */
  readonly chainAvailable: (chain: string) => boolean;
  /** BUILD-FLOFI-CHAT-E2E-FIX-002: false until this instance's availability answered (until then "not available" is not yet known). */
  readonly availabilityKnown: boolean;
  readonly run: PublicRun | null; readonly recoveryOnly: boolean;
  readonly retired: boolean; readonly busy: string | null; readonly signing: boolean; readonly error: string | null;
  simulate(): void; review(): void; execute(): void; observe(): void; switchNetwork(): void };
const Context = createContext<Store | null>(null);
function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const floFi = code.startsWith('FLOFI_WALLET_') ? floFiWalletMessage(code) : null;
  if (floFi) return floFi;
  const messages: Record<string, string> = {
    PUBLIC_RECORDING_OFF: 'Public testnet recording is not enabled on this app instance.',
    ROBINHOOD_MAINNET_NOT_ENABLED: 'Robinhood Chain is not enabled on this app instance.',
    BASE_MAINNET_NOT_ENABLED: 'Base mainnet is not enabled on this app instance.', BASE_STORAGE_NOT_CONFIGURED: 'Base mainnet is not enabled on this app instance.',
    BASE_TOKEN_LIST_UNAVAILABLE: 'The Base token list is unavailable. Try again later.',
    ETHEREUM_MAINNET_NOT_ENABLED: 'Ethereum Mainnet is not enabled on this app instance.',
    ETHEREUM_STORAGE_NOT_CONFIGURED: 'Ethereum Mainnet execution storage is not configured on this app instance.',
    ETHEREUM_TOKEN_LIST_UNAVAILABLE: 'The Ethereum token list is unavailable. Try again later.',
    ASSET_CATALOG_UNAVAILABLE: 'The network\'s official asset catalog is unavailable. Try again later.',
    TOKEN_METADATA_MISMATCH: 'A token\'s decimals on chain differ from its catalog entry. Nothing was prepared.',
    TOKEN_DEPLOYMENT_MISMATCH: 'A token\'s deployment could not be verified. Nothing was prepared.',
    ROBINHOOD_STORAGE_NOT_CONFIGURED: 'Robinhood Chain is not enabled on this app instance.',
    OWNER_EXECUTION_NOT_ENABLED: 'Real-funds execution is not enabled on this app instance. Review is available; nothing was sent.',
    STOCK_REGISTRY_UNAVAILABLE: 'The official Robinhood asset registry is unavailable. Try again later.',
    STOCK_MULTIPLIER_CHANGED_REVIEW_REQUIRED: 'A corporate action changed the shares per token. Review the updated swap before executing.',
    STOCK_MULTIPLIER_CHANGE_PENDING: 'A corporate action will change the shares per token before this Review could be used. Try again after it takes effect.',
    STOCK_MULTIPLIER_MISMATCH: 'The Robinhood registry and the chain disagree on the shares per token. Nothing was prepared.',
    CATALOG_ASSET_IDENTITY_CHANGED: 'The official asset registry no longer matches this workflow\'s asset. Build it again.',
    STOCK_TOKEN_NOT_ACQUIRABLE: 'This Stock Token is not tradable now.', INSUFFICIENT_GAS_FUNDS: 'Insufficient ETH for network fees on this network.',
    QUOTE_CHANGED_REVIEW_REQUIRED: 'The quote changed. Review the updated amounts before executing.',
    QUOTE_EXPIRED_REVIEW_REQUIRED: 'Quote expired. Review a fresh quote.',
    REVIEW_EXPIRED: 'Quote expired. Simulate again.', REVIEW_REQUIRED: 'Review the current swap first.',
    INSUFFICIENT_INPUT: 'Insufficient test token balance.', INSUFFICIENT_TEST_ETH: 'Insufficient test ETH for network fees on this network.',
    POOL_UNUSABLE: 'The selected pool is unavailable. Try again later.', POOL_FACTORY_MISMATCH: 'The selected pool could not be verified.',
    WRONG_PROVIDER_CHAIN: 'The provider is not on the reviewed network.', PUBLIC_NETWORK_UNAVAILABLE: 'This network is not enabled on this app instance.',
    ATTEMPT_ALREADY_ACTIVE: 'A transaction is already in progress. Check its result before trying again.',
    SWAP_ALREADY_ATTEMPTED: 'This swap was already submitted. Check its result before trying again.',
    // BUILD-FIX-UX-001: owner-bound mainnet swaps keep the reviewed wallet nonce reserved for the earlier request (a deliberate safety rule).
    SWAP_NONCE_ALREADY_RESERVED: 'This wallet\'s next transaction on this network is still reserved for an earlier request, so a different one cannot be prepared yet. Nothing was sent.',
    RECONCILIATION_MISMATCH: 'The transaction needs manual review. The observed balances did not match the swap bounds.',
  };
  return messages[code] ?? (code.startsWith('PUBLIC_') ? 'The public testnet request could not be completed. Try again.' : code || 'Could not continue. Try again.');
}
/** FloFi Wallet's own code when it refused before any signing activity existed (EIP-1193 4100 with a proven pre-signature code). */
export function floFiRefusal(error: unknown): string | null {
  const data = error && typeof error === 'object' && 'code' in error && error.code === 4100 && 'data' in error ? (error as { data?: unknown }).data : null;
  const code = data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : null;
  return code && PRE_SIGNATURE_CODES.has(code) ? code : null;
}
export function rejected(error: unknown): boolean {
  // BUILD-FLOFI-AUTH-WALLETS-001: a FloFi Wallet refusal proven to come before any signature is a rejection too (nothing exists to observe);
  // any other 4100, and every unclear outcome, stays UNKNOWN as before.
  return !!error && typeof error === 'object' && 'code' in error && (error.code === 4001 || error.code === 'ACTION_REJECTED' || floFiRefusal(error) !== null);
}
async function calldataDigest(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return '0x' + Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function PublicTestnetProvider({ children }: { children: ReactNode }) {
  const { state, runtimeWorkflow, restoreWorkflow } = useWorkflow();
  const wallet = useBuild009Wallet();
  const [availability, setAvailability] = useState<{ testnet: boolean; catalogs: Readonly<Record<string, boolean>>; known: boolean }>({ testnet: false, catalogs: {}, known: false });
  const [run, setRun] = useState<PublicRun | null>(null);
  const [source, setSource] = useState<SemanticWorkflow | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [signingAttempt, setSigningAttempt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // BUILD-FIX-UX-001: an earlier attempt's message (e.g. a declined wallet request) belongs to that workflow; a new one starts without it.
  const workflowId = state.workflow.workflowId;
  useEffect(() => { setError(null); }, [workflowId]);
  const busyRef = useRef(false), operationEpoch = useRef(0);
  // BUILD-FLOFI-CHAT-E2E-FIX-002: the swap this runtime serves is the runtime workflow (the canonical workflow, or the sequence's current step).
  const workflowRef = useRef(runtimeWorkflow);
  workflowRef.current = runtimeWorkflow;
  const initialWorkflow = useRef(runtimeWorkflow);
  const restoreRef = useRef(restoreWorkflow); restoreRef.current = restoreWorkflow;
  const retired = Boolean(run && (recoveryOnly || source !== runtimeWorkflow));
  // BUILD-RH-002: the authored (else quoted) swap's network decides which deployment gate applies (BUILD-BASE-001: each catalog network its own).
  const authoredChain = runtimeWorkflow.nodes.find(node => node.actionType === 'asset.swap.exact-input')?.chainId ?? null;
  const authoredProfile = swapProfile(authoredChain ?? run?.quote.chainId);
  const catalogAvailable = useCallback((chain: string) => availability.catalogs[chain] === true, [availability]);
  const available = authoredProfile?.kind === 'CATALOG' ? catalogAvailable(authoredProfile.chainRef) : availability.testnet;
  const chainAvailable = useCallback((chain: string) => { const profile = swapProfile(chain); return profile ? profile.kind === 'CATALOG' ? catalogAvailable(profile.chainRef) : availability.testnet : false; },
    [availability, catalogAvailable]);
  const guarded = useCallback((label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    const epoch = ++operationEpoch.current; busyRef.current = true; setBusy(label); setError(null);
    action().catch(cause => setError(message(cause))).finally(() => { if (operationEpoch.current === epoch) { busyRef.current = false; setBusy(null); } });
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([publicAvailability(), ...CATALOG_NETWORK_IDENTITIES.map(network => catalogSwapAvailability(network.chain))]).then(([testnet, ...catalogs]) => {
      if (!cancelled) setAvailability({ testnet, catalogs: Object.fromEntries(CATALOG_NETWORK_IDENTITIES.map((network, index) => [network.chain, catalogs[index] === true])), known: true });
    }).catch(() => { if (!cancelled) setAvailability(value => ({ ...value, known: true })); });
    const id = localStorage.getItem(KEY);
    if (id) publicStatus(id).then(async result => {
      if (cancelled || !result.ok) return;
      let recovered = result.value;
      const last = recovered.attempts.at(-1);
      if (last && ['PREPARED', 'UNKNOWN'].includes(last.state)) {
        const hash = localStorage.getItem(KEY + ':' + last.attemptId);
        if (hash && /^0x[0-9a-f]{64}$/.test(hash)) {
          const reported = await publicReport(id, last.attemptId, { kind: 'HASH', txHash: hash });
          if (reported.ok) recovered = reported.value;
        }
      }
      if (!cancelled) {
        // A finished or never-executed run stays in the Dashboard; a new visit does not put it back on the Canvas.
        if (!publicRunInProgress(recovered) && tabRun() !== id) return;
        // Recover the canonical workflow only over the untouched initial template.
        // Recovery remains observation-only until fresh simulation and owner Review.
        if (workflowRef.current === initialWorkflow.current && initialWorkflow.current.revision === 0 &&
            initialWorkflow.current.nodes.every(node => node.actionType.startsWith('mock-'))) restoreRef.current(recovered.workflow);
        setRun(recovered); setRecoveryOnly(true);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const simulate = useCallback(() => guarded(`Reading ${swapProfile(authoredChain)?.network ?? 'Base Sepolia'}`, async () => {
    const profile = swapProfile(authoredChain);
    if (!available) throw new Error(profile?.kind === 'CATALOG' ? 'PUBLIC_NETWORK_UNAVAILABLE' : 'PUBLIC_RECORDING_OFF');
    if (run?.attempts.some(a => ['PREPARED', 'HASH', 'PENDING', 'UNKNOWN'].includes(a.state))) throw new Error('ATTEMPT_ALREADY_ACTIVE');
    const workflow = workflowRef.current;
    const approval = run?.attempts.at(-1);
    const resumeApproval = Boolean(run && !run.outcome && approval?.step === 'approval' &&
      approval.state === 'CONFIRMED' && (recoveryOnly || source === workflow));
    const owner = profile && ownerBoundSwapReview(profile) ? await wallet.session() : null;
    if (profile && ownerBoundSwapReview(profile) && !owner) throw new Error('WALLET_NOT_CONNECTED');
    if (owner && owner.chainId !== profile?.chainHex) throw new Error('WRONG_WALLET_CHAIN');
    if (resumeApproval && run?.quote.ownerReview && owner?.account !== run.quote.ownerReview.account) throw new Error('OWNER_REVIEW_MISMATCH');
    const prepared = unwrap(resumeApproval ? await publicRefresh(run!.quote.executionId) :
      await publicPrepare(workflow as unknown as SemanticWorkflow, owner?.account));
    localStorage.setItem(KEY, prepared.quote.executionId); markTab(prepared.quote.executionId);
    setSource(workflow as unknown as SemanticWorkflow); setRecoveryOnly(false); setRun(prepared);
  }), [guarded, available, run, recoveryOnly, source, authoredChain, wallet]);
  const review = useCallback(() => guarded('Reviewing swap', async () => {
    if (!run || retired) throw new Error('REVIEW_REQUIRED');
    setRun(unwrap(await publicReview(run.quote.executionId, run.quote.manifestHash)));
  }), [guarded, run, retired]);
  const observe = useCallback(() => guarded('Checking transaction', async () => {
    if (!run) throw new Error('EXECUTION_NOT_FOUND');
    setRun(unwrap(await publicObserve(run.quote.executionId)));
  }), [guarded, run]);
  // Switching only asks the wallet to move to the quoted (else the authored) swap's chain; it never signs or sends.
  const switchNetwork = useCallback(() => guarded('Switching wallet network', async () => {
    const profile = swapProfile(run?.quote.chainId ?? workflowRef.current.nodes.find(n => n.actionType === 'asset.swap.exact-input')?.chainId);
    if (!profile) throw new Error('REVIEW_REQUIRED');
    await wallet.switchTo(profile.chainHex);
  }), [guarded, wallet, run]);
  const execute = useCallback(() => guarded('Preparing transaction', async () => {
    if (!run || retired) throw new Error('REVIEW_REQUIRED');
    if (run.reviewedManifestHash !== run.quote.manifestHash) throw new Error('REVIEW_REQUIRED');
    const provider = injected();
    if (!provider) throw new Error('WALLET_NOT_FOUND');
    // The quoted chain fixes the only chain the wallet may be on; it is read again just before the single send.
    const profile = swapProfile(run.quote.chainId);
    if (!profile) throw new Error('WRONG_WALLET_CHAIN');
    let session = await wallet.session();
    if (!session) session = await wallet.connect();
    if (!session) throw new Error('WALLET_CONNECTION_REJECTED');
    if (session.chainId !== profile.chainHex) throw new Error('WRONG_WALLET_CHAIN');
    const begun = await publicBegin(run.quote.executionId, session.account);
    if (!begun.ok) {
      const current = await publicStatus(run.quote.executionId);
      if (current.ok) setRun(current.value);
      throw new Error(begun.code);
    }
    const { attempt, tx } = begun.value;
    const acceptCurrent = (value: PublicRun) => setRun(current => current?.quote.executionId === run.quote.executionId ? value : current);
    const clearSigning = () => setSigningAttempt(current => current === attempt.attemptId ? null : current);
    setRun(unwrap(await publicStatus(run.quote.executionId)));
    // BUILD-FLOFI-BRIDGE-LIVE-FIX-003: the wallet request carries exactly the reviewed native value to the reviewed target (see swapWalletRequestMatches).
    if (!swapWalletRequestMatches(run.quote, attempt.step, tx, profile, session.account) || await calldataDigest(tx.data) !== attempt.calldataDigest) {
      unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' }));
      throw new Error('TRANSACTION_ARTIFACT_CHANGED');
    }
    const actualChain = await provider.request({ method: 'eth_chainId' });
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (typeof actualChain !== 'string' || actualChain.toLowerCase() !== profile.chainHex ||
        !Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== session.account) {
      unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' }));
      throw new Error('WRONG_WALLET_CHAIN');
    }
    let hash: unknown;
    busyRef.current = false; setBusy(null);
    setSigningAttempt(attempt.attemptId);
    // BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs only for the reviewed run it is told about (no effect on any other wallet).
    bindFloFiSigning(provider, signingContextOf(run.quote.executionId, 'base-sepolia-swap'));
    try { hash = await watchWalletResponse(provider, () => provider.request({ method: 'eth_sendTransaction', params: [tx] }), () => {
      clearSigning();
      void publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' }).then(result => { if (result.ok) acceptCurrent(result.value); }).catch(() => undefined);
    }); }
    catch (cause) {
      acceptCurrent(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: rejected(cause) ? 'REJECTED' : 'UNKNOWN' })));
      const refusal = floFiRefusal(cause);
      if (refusal) throw new Error(refusal, { cause });
      if (rejected(cause)) throw new Error('WALLET_AUTHORIZATION_REJECTED', { cause });
      throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause });
    }
    finally { clearSigning(); }
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      acceptCurrent(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' })));
      throw new Error('SUBMISSION_RESULT_UNKNOWN');
    }
    const txHash = hash.toLowerCase();
    localStorage.setItem(KEY + ':' + attempt.attemptId, txHash);
    acceptCurrent(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'HASH', txHash })));
    for (let i = 0; i < 30; i++) {
      const observed = unwrap(await publicObserve(run.quote.executionId));
      acceptCurrent(observed);
      const state = observed.attempts.at(-1)?.state;
      if (state !== 'PENDING') break;
      await new Promise<void>(resolve => setTimeout(resolve, 2_000));
    }
  }), [guarded, run, retired, wallet]);
  const signing = Boolean(signingAttempt && run?.attempts.some(attempt => attempt.attemptId === signingAttempt));
  return <Context.Provider value={{ available, catalogAvailable, chainAvailable, availabilityKnown: availability.known, run, recoveryOnly, retired, busy, signing, error,
    simulate, review, execute, observe, switchNetwork }}>{children}</Context.Provider>;
}
export function usePublicTestnet(): Store { const value = useContext(Context); if (!value) throw new Error('PUBLIC_TESTNET_PROVIDER_MISSING'); return value; }
