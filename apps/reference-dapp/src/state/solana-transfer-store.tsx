// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { WalletPendingNotice } from '../components/wallet-pending-notice';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { useJupiter } from './jupiter-store';
import { signWithSolanaWallet, type SolanaWalletChain } from '../wallet/solana-wallet';
import { solanaTransferBegin, solanaTransferInfo, solanaTransferInvalidate, solanaTransferObserve, solanaTransferReview, solanaTransferSimulate, solanaTransferStatus,
  solanaTransferSubmit, solanaTransferWalletFailure, type SolanaTransferCluster } from '../app/solana-transfer-action';
import { solanaTransferDetails } from '../domain/solana-transfer-authoring';
import type { SolanaNetwork } from '../domain/jupiter-authoring';
import type { SolanaTransferRecord } from '../server/solana-transfer-service';
import { bindFloFiSigning } from '../wallet/flofi-wallet-channel';
import { signingContextOf } from '../wallet/flofi-signing';

/**
 * BUILD-SOLANA-TRANSFER-UX-001: the Solana transfer runtime in the browser. It signs with the product's one Solana wallet session (the shared
 * session of the Solana flows; nothing connects here on its own) on the transfer's own cluster. Journal, recovery and evidence live on the
 * server; this store holds a pointer to the current run, asks the wallet for exactly one signature after the owner's Authorize, and observes.
 */
const key = 'flofi:solana-transfer';
const X = 'SOLANA_TRANSFER';
const clusterOfNetwork = (network: SolanaNetwork): SolanaTransferCluster => network === 'Solana Devnet' ? 'devnet' : 'mainnet';
const clusterOfId = (id: string): SolanaTransferCluster | null => /^soltx-[a-f0-9]{32}$/.test(id) ? 'mainnet' : /^soltd-[a-f0-9]{32}$/.test(id) ? 'devnet' : null;
const networkOfCluster = (cluster: SolanaTransferCluster): SolanaNetwork => cluster === 'devnet' ? 'Solana Devnet' : 'Solana';
const walletChainOf = (network: SolanaNetwork): SolanaWalletChain => network === 'Solana Devnet' ? 'solana:devnet' : 'solana:mainnet';
type Store = { record: SolanaTransferRecord | null; owner: string | null; network: SolanaNetwork; walletChain: SolanaWalletChain;
  busy: boolean; error: string | null; retired: boolean; recovered: boolean; executionEnabled: boolean; signing: boolean;
  connect(): Promise<void>; simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void> };
const Context = createContext<Store | null>(null);
const unresolved = (record: SolanaTransferRecord | null) => Boolean(record?.attempt && record.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(record.attempt.state));
function walletCode(cause: unknown): string {
  const value = cause as { code?: unknown; name?: unknown; message?: unknown } | null;
  return value && (value.code === 4001 || /reject|declin|denied|cancel/i.test(String(value.name ?? '') + String(value.message ?? ''))) ? `${X}_WALLET_REJECTED` : `${X}_WALLET_SIGN_FAILED`;
}
const bounded = (cause: unknown) => { try { const v = cause as Record<string, unknown>; return { name: String(v?.name ?? ''), code: typeof v?.code === 'number' ? v.code : null, message: String(v?.message ?? cause).slice(0, 500) }; } catch { return { message: 'unreadable' }; } };

export function SolanaTransferProvider({ children }: { children: ReactNode }) {
  const { runtimeWorkflow } = useWorkflow(), solana = useJupiter();
  const [record, setRecord] = useState<SolanaTransferRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false), [signing, setSigning] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [enabled, setEnabled] = useState<Record<SolanaTransferCluster, boolean>>({ mainnet: false, devnet: false });
  const workflow = runtimeWorkflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const latestSession = useRef(solana.session); latestSession.current = solana.session;
  const busyRef = useRef(false), operationEpoch = useRef(0);
  const authored = workflow.nodes.map(node => solanaTransferDetails(node)).find(Boolean) ?? null;
  const recordCluster = record ? clusterOfId(record.id) : null;
  const network: SolanaNetwork = authored?.network ?? (recordCluster ? networkOfCluster(recordCluster) : 'Solana');
  const cluster = clusterOfNetwork(network), walletChain = walletChainOf(network);
  const retired = Boolean(record && JSON.stringify(record.review.workflow) !== JSON.stringify(workflow) && !(recovered && workflow.revision === 0 && workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  function accept(value: SolanaTransferRecord) { setRecord(value); try { window.localStorage.setItem(key, JSON.stringify({ id: value.id })); } catch { /* the server journal remains authoritative */ } }
  useEffect(() => {
    let mounted = true;
    let recovery: Promise<void> = Promise.resolve();
    for (const name of ['mainnet', 'devnet'] as const)
      solanaTransferInfo(name).then(result => { if (mounted && result.ok) setEnabled(current => ({ ...current, [name]: result.value.executionEnabled })); }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: unknown } | null;
      const recoveredCluster = pointer && typeof pointer.id === 'string' ? clusterOfId(pointer.id) : null;
      if (recoveredCluster && typeof pointer?.id === 'string')
        recovery = solanaTransferStatus(recoveredCluster, pointer.id).then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
    } catch { setError(`${X}_RECOVERY_POINTER_INVALID`); }
    void recovery.finally(() => { if (mounted) setRecovering(false); });
    return () => { mounted = false; };
  }, []);
  // A semantic edit after Review invalidates the authorization; an existing transaction stays observable.
  useEffect(() => {
    if (!record || !retired || !record.authorization) return;
    const own = clusterOfId(record.id); if (!own) return;
    solanaTransferInvalidate(own, record.id).then(result => { if (result.ok) setRecord(current => current?.id === record.id ? result.value : current); }).catch(() => setError(`${X}_AUTHORIZATION_INVALIDATION_FAILED`));
  }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current || recovering) return; const epoch = ++operationEpoch.current; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : `${X}_OPERATION_FAILED`); }
    finally { if (operationEpoch.current === epoch) { busyRef.current = false; setBusy(false); } }
  }
  // Only the owner's session on this cluster is used; it is the same session every Solana flow shares.
  const session = solana.session?.chain === walletChain ? solana.session : null;
  async function poll(id: string) {
    const own = clusterOfId(id) ?? cluster;
    for (let i = 0; i < 30; i++) {
      const observed = await solanaTransferObserve(own, id); if (!observed.ok) throw new Error(observed.code);
      accept(observed.value);
      if (!unresolved(observed.value)) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  async function simulate() { await operation(async () => {
    // HOTFIX-WORKFLOW-CONCURRENCY-001: a pending transaction never blocks a new, separate simulation; the earlier run keeps being observed
    // server-side and stays listed in Dashboard.
    if (!session) throw new Error(`${X}_SOLANA_WALLET_SELECTION_REQUIRED`);
    const snapshot = latest.current;
    const result = await solanaTransferSimulate(cluster, snapshot, session.account.address); if (!result.ok) throw new Error(result.code);
    if (latest.current !== snapshot) throw new Error(`${X}_SEMANTIC_REVISION_CHANGED`);
    accept(result.value); setRecovered(false);
  }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error(`${X}_SIMULATION_REQUIRED`);
    const own = clusterOfId(record.id) ?? cluster;
    const result = await solanaTransferReview(own, record.id, record.review.commitment, latest.current); if (!result.ok) throw new Error(result.code);
    accept(result.value);
  }); }
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error(`${X}_REVIEW_REQUIRED`);
    const own = clusterOfId(record.id) ?? cluster, current = solana.session;
    if (!current || current.chain !== walletChainOf(networkOfCluster(own))) throw new Error(`${X}_WRONG_CLUSTER`);
    // A different connected account is never substituted for the reviewed owner: its own fresh simulation and Review are required.
    if (current.account.address !== record.review.owner) throw new Error(`${X}_WRONG_OWNER`);
    const snapshot = latest.current;
    const begin = await solanaTransferBegin(own, record.id, current.account.address, snapshot); if (!begin.ok) throw new Error(begin.code);
    accept(begin.value.record);
    let signed: string;
    setSigning(true); busyRef.current = false; setBusy(false);
    try {
      if (begin.value.walletChain !== current.chain) throw new Error(`${X}_WRONG_CLUSTER`);
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error(`${X}_SEMANTIC_REVISION_CHANGED`);
      // The sole owner-signature request, reachable only from the owner's Authorize action.
      // BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs only for the reviewed run it is told about (no effect on any other wallet).
      bindFloFiSigning(current.wallet, signingContextOf(record.id, 'solana-transfer'));
      signed = await signWithSolanaWallet(current, begin.value.unsignedTransaction, X, () => {
        if (latestSession.current !== current) throw new Error(`${X}_WALLET_CHANGED`);
        if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error(`${X}_SEMANTIC_REVISION_CHANGED`);
      });
    } catch (cause) {
      const failure = cause instanceof Error && new RegExp(`^${X}_[A-Z_]+$`).test(cause.message) ? cause.message : walletCode(cause);
      const recorded = await solanaTransferWalletFailure(own, record.id, { stage: 'SIGN', code: failure, error: bounded(cause) });
      if (recorded.ok) accept(recorded.value);
      throw new Error(failure, { cause });
    } finally { setSigning(false); }
    const submitted = await solanaTransferSubmit(own, record.id, signed); if (!submitted.ok) throw new Error(submitted.code);
    accept(submitted.value);
    if (submitted.value.attempt?.signature) await poll(record.id);
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error(`${X}_RUN_MISSING`); await poll(record.id); }); }
  return <Context.Provider value={{ record, owner: session?.account.address ?? null, network, walletChain, busy: busy || recovering, error, retired, recovered,
    executionEnabled: enabled[cluster], signing, connect: () => solana.connect(walletChain), simulate, review, execute, observe }}>
    {signing && <WalletPendingNotice/>}
    <div data-solana-transfer-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useSolanaTransfer() { const value = useContext(Context); if (!value) throw new Error('SOLANA_TRANSFER_PROVIDER_MISSING'); return value; }
