// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { WalletPendingNotice } from '../components/wallet-pending-notice';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import { useWorkflow } from './workflow-store';
import { connectSolanaWallet, disconnectSolanaWallet, signWithSolanaWallet, subscribeSolanaDiscovery, subscribeSolanaSession, subscribeSolanaWalletAccounts, type SolanaSession,
  type SolanaWalletChain } from '../wallet/solana-wallet';
import { activeNetworkScope } from '../domain/network-scope';
import { updateWalletPreference, walletPreference } from '../wallet/wallet-registry';
import { useWalletSelector } from '../components/wallet-selector';
import { jupiterBegin, jupiterInfo, jupiterInvalidate, jupiterObserve, jupiterReview, jupiterSimulate, jupiterStatus, jupiterSubmit, jupiterWalletFailure } from '../app/jupiter-action';
import { solanaDevnetBegin, solanaDevnetInfo, solanaDevnetInvalidate, solanaDevnetObserve, solanaDevnetReview, solanaDevnetSimulate, solanaDevnetStatus,
  solanaDevnetSubmit, solanaDevnetWalletFailure } from '../app/solana-devnet-action';
import { solanaSwapDetails, type SolanaNetwork } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { solanaTransferDetails } from '../domain/solana-transfer-authoring';
import type { JupiterRecord } from '../server/jupiter-service';
import { isPristineDraft } from '../domain/initial-workflow';
import { useProductBootstrap } from './product-bootstrap';
import { rememberWalletHint } from '../wallet/wallet-hint';
import { WALLET_RESTORE_TIMEOUT_MS } from './wallet-restore';
import { bindFloFiSigning } from '../wallet/flofi-wallet-channel';
import { signingContextOf } from '../wallet/flofi-signing';

/**
 * One Solana swap store for both runtimes of the canonical swap. The workflow's cluster selects the runtime:
 * Solana (mainnet-beta, Jupiter) or Solana Devnet (Orca Whirlpools). Journal, recovery and wallet handoff are shared.
 */
const key = 'gryloo:build014:jupiter';
const runtimes = {
  Solana: { prefix: 'JUPITER', idPrefix: 'jupiter', walletChain: 'solana:mainnet' as SolanaWalletChain, info: jupiterInfo, simulate: jupiterSimulate, review: jupiterReview,
    invalidate: jupiterInvalidate, begin: jupiterBegin, walletFailure: jupiterWalletFailure, submit: jupiterSubmit, observe: jupiterObserve, status: jupiterStatus },
  'Solana Devnet': { prefix: 'DEVNET_SWAP', idPrefix: 'orca', walletChain: 'solana:devnet' as SolanaWalletChain, info: solanaDevnetInfo, simulate: solanaDevnetSimulate,
    review: solanaDevnetReview, invalidate: solanaDevnetInvalidate, begin: solanaDevnetBegin, walletFailure: solanaDevnetWalletFailure, submit: solanaDevnetSubmit,
    observe: solanaDevnetObserve, status: solanaDevnetStatus },
} as const;
const networkOfRecord = (record: JupiterRecord): SolanaNetwork => record.review.chain === ORCA_WHIRLPOOLS_DEVNET.chain ? 'Solana Devnet' : 'Solana';
const networkOfId = (id: string): SolanaNetwork | null => /^jupiter-[a-f0-9]{32}$/.test(id) ? 'Solana' : /^orca-[a-f0-9]{32}$/.test(id) ? 'Solana Devnet' : null;
type Store = { record: JupiterRecord | null; owner: string | null; network: SolanaNetwork;
  /** The owner-chosen Wallet Standard session; shared with the Solana liquidity flow (one wallet experience). */
  session: SolanaSession | null; codePrefix: string; busy: boolean; error: string | null; retired: boolean; recovered: boolean;
  executionEnabled: boolean;
  /** Authority changes, including account round trips batched into one React render. */
  revision: number;
  /**
   * BUILD-FLOFI-PRODUCT-UX-001: a remembered Solana session (this browser had one, and the owner did not disconnect it in FloFi) is still being
   * restored silently. The header shows a neutral slot meanwhile — never a false "not connected". Bounded: it settles on the wallet's answer, or
   * after `WALLET_RESTORE_TIMEOUT_MS` when the wallet never registers.
   */
  restoring: boolean;
  /** The cluster the current Solana workflow signs on; a session on another cluster is not this flow's owner. */
  walletChain: SolanaWalletChain;
  /** Opens the canonical wallet selector (Solana wallets) for `chain` and connects only the wallet the owner picks. */
  connect(chain?: SolanaWalletChain): Promise<void>;
  /** Connects one Wallet Standard wallet by its selector key. Returns the session, or null when the wallet refused. */
  connectWith(name: string, chain: SolanaWalletChain): Promise<SolanaSession | null>;
  /** The same connection with the failure's closed code (for an actionable message). */
  connectWithResult(name: string, chain: SolanaWalletChain): Promise<{ readonly ok: true; readonly session: SolanaSession } | { readonly ok: false; readonly code: string }>;
  /** Ends FloFi's use of the Solana session (and asks the wallet to forget it when supported). */
  disconnect(): Promise<void>;
  /**
   * BUILD-SOLANA-MAINNET-001: the owner's Mainnet/Testnet choice asks the same chosen wallet for a session on `chain` (Wallet Standard connect only;
   * nothing is signed). Returns null on success, else the failure code; the current session is kept when the wallet cannot connect there.
   */
  switchCluster(chain: SolanaWalletChain): Promise<string | null>;
  /** The same switch, returning the moved session (same wallet, same account) or the failure code. */
  switchClusterTo(chain: SolanaWalletChain): Promise<{ readonly ok: true; readonly session: SolanaSession } | { readonly ok: false; readonly code: string }>;
  simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void> };
const Context = createContext<Store | null>(null);
const unresolved = (record: JupiterRecord | null) => Boolean(record?.attempt && record.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(record.attempt.state));
function walletCode(cause: unknown, prefix: string): string {
  const value = cause as { code?: unknown; name?: unknown; message?: unknown } | null;
  return value && (value.code === 4001 || /reject|declin|denied|cancel/i.test(String(value.name ?? '') + String(value.message ?? ''))) ? `${prefix}_WALLET_REJECTED` : `${prefix}_WALLET_SIGN_FAILED`;
}
const bounded = (cause: unknown) => { try { const v = cause as Record<string, unknown>; return { name: String(v?.name ?? ''), code: typeof v?.code === 'number' ? v.code : null, message: String(v?.message ?? cause).slice(0, 500) }; } catch { return { message: 'unreadable' }; } };

export function JupiterProvider({ children }: { children: ReactNode }) {
  const { runtimeWorkflow } = useWorkflow();
  const selector = useWalletSelector();
  const [record, setRecord] = useState<JupiterRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false), [signing, setSigning] = useState(false), [session, setSession] = useState<SolanaSession | null>(null);
  const [enabled, setEnabled] = useState<Record<SolanaNetwork, boolean>>({ Solana: false, 'Solana Devnet': false });
  const [revision, setRevision] = useState(0);
  const { walletHint } = useProductBootstrap();
  const [restoring, setRestoring] = useState(() => walletHint.includes('solana'));
  useEffect(() => { if (!restoring) return; const timer = window.setTimeout(() => setRestoring(false), WALLET_RESTORE_TIMEOUT_MS); return () => window.clearTimeout(timer); }, [restoring]);
  // A session (restored or connected) is remembered as a hint for the next visit's first frame; only an explicit Disconnect forgets it.
  useEffect(() => { if (session) { rememberWalletHint('solana', true); setRestoring(false); } }, [session]);
  const workflow = runtimeWorkflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const latestSession = useRef(session); latestSession.current = session;
  const busyRef = useRef(false), operationEpoch = useRef(0);
  const authored = workflow.nodes.map(node => solanaSwapDetails(node)).find(Boolean) ?? null;
  // A Solana liquidity position uses the same wallet session as the swap on its own cluster (Devnet or, BUILD-SOLANA-MAINNET-001, mainnet-beta).
  // BUILD-SOLANA-TRANSFER-UX-001: a Solana transfer signs with the same session, on its own cluster.
  const network: SolanaNetwork = authored?.network ?? workflow.nodes.map(node => solanaLiquidityDetails(node)?.network ?? solanaTransferDetails(node)?.network).find(Boolean)
    ?? (record ? networkOfRecord(record) : 'Solana');
  const runtime = runtimes[network];
  const pristineRecovery = recovered && isPristineDraft(workflow);
  const retired = Boolean(record && JSON.stringify(record.review.workflow) !== JSON.stringify(workflow) && !pristineRecovery);
  function accept(value: JupiterRecord) { setRecord(value); try { window.localStorage.setItem(key, JSON.stringify({ id: value.id })); } catch { /* server journal remains authoritative */ } }
  useEffect(() => {
    let mounted = true;
    for (const name of ['Solana', 'Solana Devnet'] as const)
      runtimes[name].info().then(result => { if (mounted && result.ok) setEnabled(current => ({ ...current, [name]: result.value.executionEnabled })); }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: unknown } | null;
      const recoveredNetwork = pointer && typeof pointer.id === 'string' ? networkOfId(pointer.id) : null;
      if (recoveredNetwork && typeof pointer?.id === 'string')
        runtimes[recoveredNetwork].status(pointer.id).then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
    } catch { setError('JUPITER_RECOVERY_POINTER_INVALID'); }
    return () => { mounted = false; };
  }, []);
  // BUILD-SOLANA-TRANSFER-UX-001: with no Solana session (a reload, a new visit), restore the owner's previously chosen Solana wallet on the
  // cluster this workflow signs on, without a prompt (Wallet Standard `connect({ silent: true })`). Only that remembered wallet, never after
  // an explicit disconnect in FloFi, never during a request; a wallet that would need to ask simply stays disconnected until the owner
  // connects it in the current flow. Only a session FloFi restored this way follows the workflow's cluster afterwards (same sender); a
  // session the owner connected or switched explicitly ("Switch to …") is never moved silently.
  // BUILD-FLOFI-MAINNET-PRODUCT-001 (wallet C): the public product restores Solana on mainnet-beta only, and never moves a wallet to Devnet, whatever
  // workflow is open (a Devnet workflow from before FloFi became Mainnet-only stays blocked). Engineering certification keeps the workflow's cluster.
  const neededChain: SolanaWalletChain = activeNetworkScope() === 'ENGINEERING' ? runtime.walletChain : 'solana:mainnet';
  const restored = useRef<SolanaSession | null>(null);
  useEffect(() => {
    if (!session) return;
    // BUILD-FLOFI-MAINNET-PRODUCT-001 (wallet B): the wallet dropping the account (locked, switched to an account not connected to FloFi, disconnected
    // in the wallet, extension restarted) ends this session and its Review, but it is not the owner's Disconnect in FloFi: silent reconnection
    // stays possible, and the wallet itself decides whether it still authorizes FloFi.
    return subscribeSolanaSession(session, next => {
      latestSession.current = next;
      setRevision(value => value + 1); setSession(next);
    });
  }, [session]);
  useEffect(() => {
    if (session && (session !== restored.current || session.chain === neededChain)) return;
    const preference = walletPreference(), name = session?.wallet.name ?? preference.solana;
    if (!name || preference.solanaDisconnected) { setRestoring(false); return; }
    let live = true, inFlight = false, again = false;
    const attempt = () => {
      // A wallet report that arrives during an attempt is not lost: the attempt runs once more when this one settles.
      if (inFlight) { again = true; return; }
      if (busyRef.current || walletPreference().solanaDisconnected) return;
      inFlight = true; again = false;
      connectSolanaWallet(name, neededChain, runtime.prefix, { silent: true, account: session?.account.address })
        .then(next => {
          if (!live || busyRef.current || walletPreference().solanaDisconnected) return;
          // The owner connected or switched in the meantime: that session stays.
          if (latestSession.current && latestSession.current !== restored.current) return;
          restored.current = next; latestSession.current = next; setSession(next);
        })
        // The remembered wallet answered without a session (not authorized silently, another account): nothing to restore. A wallet that has not
        // registered yet (`…_SOLANA_WALLET_REQUIRED`) may still do so; the bounded timeout covers one that never does.
        .catch((cause: unknown) => { if (live && !(cause instanceof Error && cause.message.endsWith('_SOLANA_WALLET_REQUIRED'))) setRestoring(false); }).finally(() => { inFlight = false; if (again && live && !latestSession.current) attempt(); });
    };
    attempt();
    // Wallet Standard wallets register asynchronously after load; without a session, the remembered wallet reporting its accounts again (unlocked,
    // switched back) is retried silently too (wallet B). An explicit Disconnect in FloFi is never undone: `attempt` checks it every time.
    const unsubscribe = subscribeSolanaDiscovery(attempt);
    const unsubscribeAccounts = session ? () => undefined : subscribeSolanaWalletAccounts(name, attempt);
    return () => { live = false; unsubscribe(); unsubscribeAccounts(); };
  }, [neededChain, session, runtime.prefix]);
  // A semantic edit after Review invalidates the authorization; any existing transaction stays observable.
  useEffect(() => { if (record && retired && record.authorization) runtimes[networkOfRecord(record)].invalidate(record.id).then(result => { if (result.ok) setRecord(current => current?.id === record.id ? result.value : current); })
    .catch(() => setError(`${runtimes[networkOfRecord(record)].prefix}_AUTHORIZATION_INVALIDATION_FAILED`)); }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; const epoch = ++operationEpoch.current; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : `${runtime.prefix}_OPERATION_FAILED`); } finally { if (operationEpoch.current === epoch) { busyRef.current = false; setBusy(false); } }
  }
  // Only an owner-chosen wallet session on the current cluster is used; nothing connects implicitly.
  async function ensureSession(): Promise<SolanaSession> {
    if (session && session.chain === runtime.walletChain) return session;
    throw new Error(`${runtime.prefix}_SOLANA_WALLET_SELECTION_REQUIRED`);
  }
  /**
   * The owner picks a wallet in the canonical selector, even if it is the only one; nothing connects implicitly.
   * `chain` lets another Solana flow on the same session (BUILD-015 Devnet liquidity) ask for its own cluster explicitly.
   */
  async function connect(chain: SolanaWalletChain = neededChain) {
    if (busyRef.current) return;
    setError(null);
    // A chosen wallet that cannot sign on `chain` fails closed with ${prefix}_SOLANA_WALLET_REQUIRED.
    const choice = await selector.choose({ ecosystems: ['solana'], solanaChain: chain });
    if (choice) await connectWith(choice.key, chain);
  }
  async function connectWithResult(name: string, chain: SolanaWalletChain): Promise<{ readonly ok: true; readonly session: SolanaSession } | { readonly ok: false; readonly code: string }> {
    if (busyRef.current) return { ok: false, code: `${runtime.prefix}_BUSY` };
    let result: { ok: true; session: SolanaSession } | { ok: false; code: string } = { ok: false, code: `${runtime.prefix}_SOLANA_WALLET_REQUIRED` };
    await operation(async () => {
      try {
        const next = await connectSolanaWallet(name, chain, runtime.prefix);
        updateWalletPreference({ solana: name, solanaDisconnected: false });
        latestSession.current = next; setSession(next); result = { ok: true, session: next };
      } catch (cause) {
        result = { ok: false, code: cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message
          : cause instanceof Error && /reject|declin|denied|cancel/i.test(cause.message + cause.name) || (cause as { code?: unknown } | null)?.code === 4001 ? `${runtime.prefix}_WALLET_REJECTED`
          : `${runtime.prefix}_SOLANA_WALLET_REQUIRED` };
        throw cause;
      }
    });
    return result;
  }
  async function connectWith(name: string, chain: SolanaWalletChain): Promise<SolanaSession | null> {
    const result = await connectWithResult(name, chain);
    return result.ok ? result.session : null;
  }
  async function switchClusterTo(chain: SolanaWalletChain): Promise<{ readonly ok: true; readonly session: SolanaSession } | { readonly ok: false; readonly code: string }> {
    const current = latestSession.current;
    if (!current) return { ok: false, code: `${runtime.prefix}_SOLANA_WALLET_SELECTION_REQUIRED` };
    if (current.chain === chain) return { ok: true, session: current };
    if (busyRef.current) return { ok: false, code: `${runtime.prefix}_BUSY` };
    const epoch = ++operationEpoch.current; busyRef.current = true; setBusy(true);
    try {
      const next = await connectSolanaWallet(current.wallet.name, chain, runtime.prefix, { account: current.account.address });
      if (latestSession.current !== current || next.wallet !== current.wallet || walletPreference().solanaDisconnected) throw new Error(`${runtime.prefix}_WALLET_CHANGED`);
      latestSession.current = next; setRevision(value => value + 1); setSession(next); return { ok: true, session: next };
    }
    catch (cause) { return { ok: false, code: cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : `${runtime.prefix}_SOLANA_WALLET_REQUIRED` }; }
    finally { if (operationEpoch.current === epoch) { busyRef.current = false; setBusy(false); } }
  }
  async function switchCluster(chain: SolanaWalletChain): Promise<string | null> {
    const result = await switchClusterTo(chain);
    return result.ok ? null : result.code;
  }
  async function disconnect() {
    const current = session;
    latestSession.current = null;
    setSession(null); setError(null);
    // No silent reconnect until the owner picks a Solana wallet again (the EVM store's rule).
    updateWalletPreference({ solanaDisconnected: true }); rememberWalletHint('solana', false); setRestoring(false);
    if (current) await disconnectSolanaWallet(current);
  }
  async function poll(id: string) {
    const api = runtimes[networkOfId(id) ?? network];
    for (let i = 0; i < 30; i++) {
      const observed = await api.observe(id); if (!observed.ok) throw new Error(observed.code);
      accept(observed.value);
      if (!unresolved(observed.value)) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  async function simulate() { await operation(async () => {
    // HOTFIX-WORKFLOW-CONCURRENCY-001: a pending transaction never blocks a new, separate simulation; the earlier run keeps being observed
    // server-side and stays listed in Dashboard.
    const owner = (await ensureSession()).account.address, snapshot = latest.current;
    const result = await runtime.simulate(snapshot, owner); if (!result.ok) throw new Error(result.code);
    if (latest.current !== snapshot) throw new Error(`${runtime.prefix}_SEMANTIC_REVISION_CHANGED`);
    accept(result.value); setRecovered(false);
  }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error(`${runtime.prefix}_SIMULATION_REQUIRED`);
    const result = await runtimes[networkOfRecord(record)].review(record.id, record.review.commitment, latest.current); if (!result.ok) throw new Error(result.code);
    accept(result.value);
  }); }
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error(`${runtime.prefix}_REVIEW_REQUIRED`);
    const api = runtimes[networkOfRecord(record)];
    const current = await ensureSession();
    if (current.account.address !== record.review.owner) throw new Error(`${api.prefix}_WRONG_OWNER`);
    // The wallet session must be on the reviewed cluster before any durable attempt exists.
    if (current.chain !== api.walletChain) throw new Error(`${api.prefix}_WRONG_CLUSTER`);
    const snapshot = latest.current;
    const begin = await api.begin(record.id, current.account.address, snapshot); if (!begin.ok) throw new Error(begin.code);
    accept(begin.value.record);
    let signed: string;
    setSigning(true); busyRef.current = false; setBusy(false);
    try {
      if (begin.value.walletChain !== current.chain) throw new Error(`${api.prefix}_WRONG_CLUSTER`);
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error(`${api.prefix}_SEMANTIC_REVISION_CHANGED`);
      // The sole owner-signature request, reachable only from the owner's Execute click.
      // BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs only for the reviewed run it is told about (no effect on any other wallet).
      bindFloFiSigning(current.wallet, signingContextOf(record.id, 'jupiter-swap'));
      signed = await signWithSolanaWallet(current, begin.value.unsignedTransaction, api.prefix, () => {
        if (latestSession.current !== current) throw new Error(`${api.prefix}_WALLET_CHANGED`);
        if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error(`${api.prefix}_SEMANTIC_REVISION_CHANGED`);
      });
    } catch (cause) {
      const failure = cause instanceof Error && new RegExp(`^${api.prefix}_[A-Z_]+$`).test(cause.message) ? cause.message : walletCode(cause, api.prefix);
      const recorded = await api.walletFailure(record.id, { stage: 'SIGN', code: failure, error: bounded(cause) });
      if (recorded.ok) accept(recorded.value);
      throw new Error(failure, { cause });
    } finally { setSigning(false); }
    const submitted = await api.submit(record.id, signed); if (!submitted.ok) throw new Error(submitted.code);
    accept(submitted.value);
    if (submitted.value.attempt?.signature) await poll(record.id);
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error(`${runtime.prefix}_RUN_MISSING`); await poll(record.id); }); }
  return <Context.Provider value={{ record, owner: session && session.chain === runtime.walletChain ? session.account.address : null, network, session, codePrefix: runtime.prefix,
    busy, error, retired, recovered, revision, restoring, executionEnabled: enabled[network], walletChain: runtime.walletChain, connect, connectWith, connectWithResult, disconnect, switchCluster, switchClusterTo,
    simulate, review, execute, observe }}>
    {signing && <WalletPendingNotice/>}
    <div data-jupiter-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useJupiter() { const value = useContext(Context); if (!value) throw new Error('JUPITER_PROVIDER_MISSING'); return value; }
/** The shared Solana session where the product shell provides one; null elsewhere (e.g. `/connections`, outside the shell). */
export function useOptionalJupiter() { return useContext(Context); }
export const useSolanaSwap = useJupiter;
