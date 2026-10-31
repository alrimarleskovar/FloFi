// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { WalletPendingNotice } from '../components/wallet-pending-notice';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet } from './build009-wallet-store';
import { TRANSFER_NETWORKS } from '../domain/robinhood-transfer-authoring';
import { transferBegin, transferHandoff, transferInvalidate, transferObserve, transferRecoverReview, transferReport, transferReview,
  transferSimulate, transferStatus, transferWalletFailure } from '../app/robinhood-transfer-action';
import type { TransferRecord, TransferWalletDiagnostic } from '../server/robinhood-transfer-service';
import { bindFloFiSigning } from '../wallet/flofi-wallet-channel';
import { signingContextOf } from '../wallet/flofi-signing';

const key = 'gryloo:rh-demo-001:transfer';
const REFUSALS = [4001, 4100, 4200];
type Store = { record: TransferRecord | null; busy: boolean; error: string | null; retired: boolean; signing: boolean;
  simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void>; recoverReview(): Promise<void>; switchNetwork(): Promise<void> };
const Context = createContext<Store | null>(null);
function quantity(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return BigInt(value);
  throw new Error('TRANSFER_WALLET_NONCE_RESPONSE_INVALID');
}
function errorValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 512) : value ?? null;
  const v = value as { code?: unknown; message?: unknown };
  return { code: typeof v.code === 'number' || typeof v.code === 'string' ? v.code : null, message: typeof v.message === 'string' ? v.message.slice(0, 512) : null };
}
export function RobinhoodTransferProvider({ children }: { children: ReactNode }) {
  const { runtimeWorkflow } = useWorkflow(), wallet = useBuild009Wallet();
  const [record, setRecord] = useState<TransferRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const workflow = runtimeWorkflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const latestWallet = useRef(wallet); latestWallet.current = wallet;
  const busyRef = useRef(false), operationEpoch = useRef(0);
  const retired = Boolean(record && JSON.stringify(record.review.workflow) !== JSON.stringify(workflow) &&
    !(workflow.revision === 0 && workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  function accept(value: TransferRecord) {
    setRecord(value);
    const hash = value.attempt?.transactionHash;
    try { window.localStorage.setItem(key, JSON.stringify({ id: value.id, ...hash ? { hash } : {} })); } catch { /* The server journal remains authoritative. */ }
  }
  useEffect(() => {
    let mounted = true;
    try {
      const pointer = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: unknown; hash?: unknown } | null;
      if (pointer && typeof pointer.id === 'string' && /^(rhx|rht|bat|art|ett)-[a-f0-9]{32}$/.test(pointer.id)) (async () => {
        if (typeof pointer.hash === 'string' && /^0x[0-9a-f]{64}$/.test(pointer.hash)) await transferReport(pointer.id as string, { kind: 'HASH', hash: pointer.hash }).catch(() => undefined);
        return transferStatus(pointer.id as string);
      })().then(result => { if (mounted && result.ok) setRecord(result.value); }).catch(() => undefined);
    } catch { setError('TRANSFER_RECOVERY_POINTER_INVALID'); }
    return () => { mounted = false; };
  }, []);
  useEffect(() => { if (record && retired && record.authorization) transferInvalidate(record.id).then(r => { if (r.ok) setRecord(r.value); }).catch(() => setError('TRANSFER_AUTHORIZATION_INVALIDATION_FAILED')); }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; const epoch = ++operationEpoch.current; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'TRANSFER_OPERATION_FAILED'); } finally { if (operationEpoch.current === epoch) { busyRef.current = false; setBusy(false); } }
  }
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; code: string }): T => { if (!result.ok) throw new Error(result.code); return result.value; };
  async function simulate() { await operation(async () => {
    // HOTFIX-WORKFLOW-CONCURRENCY-001: a pending transaction never blocks a new, separate simulation; the earlier run keeps being observed
    // server-side and stays listed in Dashboard.
    let session = await wallet.session(); if (!session) session = await wallet.connect();
    if (!session) throw new Error('TRANSFER_WALLET_REQUIRED');
    const snapshot = latest.current, value = unwrap(await transferSimulate(snapshot, session.account));
    if (latest.current !== snapshot) throw new Error('TRANSFER_SEMANTIC_REVISION_CHANGED');
    accept(value);
  }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error('TRANSFER_SIMULATION_REQUIRED');
    accept(unwrap(await transferReview(record.id, record.review.commitment, latest.current)));
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error('TRANSFER_RUN_MISSING'); accept(unwrap(await transferObserve(record.id))); }); }
  async function recoverReview() { await operation(async () => { if (!record) throw new Error('TRANSFER_RUN_MISSING'); accept(unwrap(await transferRecoverReview(record.id))); }); }
  /** The reviewed transaction's chain (else the authored node's) is the only network the wallet is asked to switch to. */
  const chainHexOf = (chain: string | undefined) => Object.values(TRANSFER_NETWORKS).find(profile => profile.chain === chain)?.chainHex as '0xb626' | '0xaa36a7' | '0x1237' | '0x2105' | undefined;
  async function switchNetwork() { await operation(async () => {
    const target = chainHexOf(record?.review.chain ?? latest.current.nodes.find(n => n.actionType === 'asset.transfer')?.chainId);
    if (!target) throw new Error('TRANSFER_REVIEW_REQUIRED');
    await wallet.switchTo(target);
  }); }
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error('TRANSFER_REVIEW_REQUIRED');
    let session = await wallet.session(); if (!session) session = await wallet.connect();
    if (!session) throw new Error('TRANSFER_WALLET_REQUIRED');
    const reviewedChain = record.review.transaction.chainId.toLowerCase();
    if (chainHexOf(record.review.chain) !== reviewedChain || session.chainId !== reviewedChain) throw new Error('TRANSFER_WRONG_CHAIN');
    if (session.account !== record.review.account) throw new Error('TRANSFER_WRONG_ACCOUNT');
    const provider = injected(); if (!provider) throw new Error('TRANSFER_WALLET_REQUIRED');
    const snapshot = latest.current;
    if (JSON.stringify(snapshot) !== JSON.stringify(record.review.workflow)) throw new Error('TRANSFER_SEMANTIC_REVISION_CHANGED');
    const diagnostic: TransferWalletDiagnostic = { invoked: false, calls: [], code: 'TRANSFER_WALLET_PREFLIGHT' };
    const request = async (method: string, params: unknown[] = []) => {
      const call: TransferWalletDiagnostic['calls'][number] = { method, ...method === 'eth_sendTransaction' ? { submission: true } : {} }; diagnostic.calls.push(call);
      try { const result = await provider.request({ method, ...params.length ? { params } : {} }); call.result = typeof result === 'string' ? result.slice(0, 200) : null; return result; }
      catch (cause) { call.error = errorValue(cause); throw cause; }
    };
    // Read-only session checks before and after the durable preparation; any change fails closed.
    const validateSession = async () => {
      const accounts = await request('eth_accounts'), chain = await request('eth_chainId'), pending = await request('eth_getTransactionCount', [session.account, 'pending']);
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error('TRANSFER_SEMANTIC_REVISION_CHANGED');
      if (injected() !== provider) throw new Error('TRANSFER_WALLET_PROVIDER_CHANGED');
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== session.account) throw new Error('TRANSFER_WRONG_ACCOUNT');
      if (typeof chain !== 'string' || chain.toLowerCase() !== reviewedChain) throw new Error('TRANSFER_WRONG_CHAIN');
      if (quantity(pending) !== BigInt(record.review.nonce)) throw new Error('TRANSFER_WALLET_NONCE_MISMATCH');
    };
    let prepared = false;
    try {
      await validateSession();
      const begin = unwrap(await transferBegin(record.id, session.account, snapshot)); accept(begin.record); prepared = true;
      await validateSession();
      accept(unwrap(await transferHandoff(record.id)));
      if (latestWallet.current.account !== session.account || latestWallet.current.chainId !== session.chainId) throw new Error('TRANSFER_WRONG_ACCOUNT');
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot) || injected() !== provider) throw new Error('TRANSFER_SEMANTIC_REVISION_CHANGED');
      // The sole submission point, reachable only from the owner's Execute click. The wallet assigns the reviewed nonce.
      setSigning(true); diagnostic.invoked = true; busyRef.current = false; setBusy(false);
      const { from, to, value, data, chainId, gas, maxFeePerGas, maxPriorityFeePerGas } = begin.transaction;
      let hash: unknown;
      // BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet signs only for the reviewed run it is told about (no effect on any other wallet).
      bindFloFiSigning(provider, signingContextOf(record.id, 'robinhood-transfer'));
      try { hash = await request('eth_sendTransaction', [{ from, to, value, data, chainId, gas, maxFeePerGas, maxPriorityFeePerGas }]); } finally { setSigning(false); }
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('TRANSFER_SUBMISSION_UNKNOWN');
      try { window.localStorage.setItem(key, JSON.stringify({ id: record.id, hash: hash.toLowerCase() })); } catch { /* Reported to the server next. */ }
      accept(unwrap(await transferReport(record.id, { kind: 'HASH', hash: hash.toLowerCase() })));
    } catch (cause) {
      const send = diagnostic.calls.find(c => c.submission), sendError = send?.error as { code?: unknown } | undefined;
      const refused = Boolean(send) && send!.result === undefined && typeof sendError?.code === 'number' && REFUSALS.includes(sendError.code);
      if (refused) diagnostic.rejectionCode = sendError!.code as number;
      diagnostic.code = refused ? 'TRANSFER_REJECTED' : !diagnostic.invoked ? (cause instanceof Error && /^TRANSFER_[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'TRANSFER_RPC_ERROR_BEFORE_WALLET_SUBMISSION') : 'TRANSFER_SUBMISSION_UNKNOWN';
      if (prepared && (!diagnostic.invoked || refused)) {
        const failure = await transferWalletFailure(record.id, diagnostic); if (failure.ok) accept(failure.value);
        throw new Error(diagnostic.code, { cause });
      }
      if (diagnostic.invoked) {
        // The request may have reached the network: never resend, only observe.
        const report = await transferReport(record.id, { kind: 'UNKNOWN', code: diagnostic.code }); if (report.ok) accept(report.value);
        throw new Error('TRANSFER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', { cause });
      }
      throw cause;
    }
    const observed = await transferObserve(record.id); if (observed.ok) accept(observed.value);
  }); }
  return <Context.Provider value={{ record, busy, error, retired, signing, simulate, review, execute, observe, recoverReview, switchNetwork }}>
    {signing && <WalletPendingNotice/>}
    <div data-transfer-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useRobinhoodTransfer() { const value = useContext(Context); if (!value) throw new Error('TRANSFER_PROVIDER_MISSING'); return value; }
