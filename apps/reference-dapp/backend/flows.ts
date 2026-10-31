// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 flow registry for the cloud backend. Each cloud-enabled flow binds the UNCHANGED service
 * (the same code the in-process server actions run) to shared durable storage, and declares:
 *  - the exact server-action methods exposed over HTTP, with strict argument validation (the browser is never
 *    trusted: only IDs, the authoring workflow and wallet results are accepted, and the service re-validates
 *    every transition against durable state);
 *  - a projector deriving run/attempt/journal rows and required durable work from each snapshot;
 *  - when a run needs background observation. Observation is read-only discovery and reconciliation; no
 *    backend path can sign or submit. PREPARED attempts are never observed by workers, because observing a
 *    PREPARED attempt cancels it and the owner's browser may be between `begin` and `handoff`.
 */
import { financialRunStatus } from '../src/domain/financial-run-status.ts';
import { hashJournalBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { EthereumRouterNetwork } from '@defi-workflow-engine/action-registry';
import { boundCompositionNeedsObservation, boundCompositionPhase, type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { Projection, Projector, WorkRequest } from '@defi-workflow-engine/cloud-runtime';
import { createRobinhoodTransferService, type TransferRecord, type TransferWalletDiagnostic } from '../src/server/robinhood-transfer-service.ts';
import { createSupplyService, type SupplyRecord, type SupplyWalletDiagnostic } from '../src/server/supply-service.ts';
import { createDurablePublicTestnetService, type PublicRun } from '../src/server/public-testnet-service.ts';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY, ORCA_WHIRLPOOLS_MAINNET_LIQUIDITY, SOLANA_DEVNET_TRANSFER, SOLANA_MAINNET_TRANSFER,
  type AssetCatalog, type OrcaLiquidityProfile, type SolanaTransferProfile } from '@defi-workflow-engine/action-registry';
import { CATALOG_NETWORKS, type CatalogNetworkRuntime } from '../src/server/catalog-networks.ts';
import type { JupiterHttp } from '@defi-workflow-engine/reference-compiler';
import { nativeTransferEnabledNetworks, nativeTransferReadRpcs } from '../src/server/robinhood-rpc.ts';
import { createCatalogLendingReadRpc, createLendingReadRpcs } from '../src/server/supply-rpc.ts';
import { baseSepoliaSwapRpc, ethereumSepoliaSwapRpc } from '../src/server/public-testnet-rpc.ts';
import { createSolanaRpc, solanaRpcOverride } from '../src/server/solana-rpc.ts';
import { createJupiterHttp } from '../src/server/jupiter-http.ts';
import { createJupiterService, createSolanaDevnetService, type JupiterRecord, type JupiterWalletDiagnostic } from '../src/server/jupiter-service.ts';
import { createSolanaTransferService, type SolanaTransferRecord, type SolanaTransferWalletDiagnostic } from '../src/server/solana-transfer-service.ts';
import { createOrcaLiquidityService, type OrcaLiquidityRecord, type OrcaLiquidityWalletDiagnostic } from '../src/server/orca-liquidity-service.ts';
import { createSolanaCompositionService, type SolanaCompositionDiagnostic, type SolanaCompositionRecord } from '../src/server/solana-composition-service.ts';
import { createUniswapLiquidityService, uniswapNeedsObservation, type UniswapLiquidityRecord,
  type UniswapWalletDiagnostic } from '../src/server/uniswap-liquidity-service.ts';
import { baseSepoliaLiquidityRpc, createBaseSepoliaReadRpc, UNISWAP_LIQUIDITY_RPC_METHODS } from '../src/server/public-testnet-rpc.ts';
import { UNI_MOCK_CODE_PINS, UNI_MOCK_RPC_URL } from '../src/server/uniswap-liquidity-mock.ts';
import { createRouterService, ROUTER_RUN_ID, routerNeedsObservation, type RouterRecord, type RouterWalletDiagnostic } from '../src/server/router-service.ts';
import { routerNetworkMode, routerNetworkRuntime, type RouterNetwork } from '../src/server/router-runtime.ts';
import { PAYMENT_OWNERSHIP, ROUTER_OWNERSHIP, UNIVERSAL_OWNERSHIP, type OwnershipPolicy } from '../src/server/run-ownership.ts';
import { createUniversalRouterService, universalNeedsObservation, UNIVERSAL_RUN_ID, type UniversalRecord, type UniversalWalletDiagnostic } from '../src/server/universal-router/service.ts';
import { createUniversalDiscovery } from '../src/server/universal-router/discovery.ts';
import { createRelayProvider } from '../src/server/universal-router/relay-provider.ts';
import { universalRouterMode, universalRouterRuntime, universalRouterTransport, type UniversalRouterTransport } from '../src/server/universal-router/runtime.ts';
import { parseDiscoveryRequest } from '../src/server/universal-router/requests.ts';
import type { RouteProvider } from '../src/server/router-providers.ts';
import type { RoutingProvider } from '@defi-workflow-engine/workflow-contracts';
import { isHostedDeployment } from '../src/server/deployment.ts';
import { createLendingCompositionService, type LendingRecord } from '../src/server/lending-composition-service.ts';
import { createLendingRpc } from '../src/server/lending-rpc.ts';
import { createPaymentFlowService, PAYMENT_RUN_ID, paymentNeedsObservation, type PaymentRecord, type PaymentWalletResult } from '../src/server/payment-flow-service.ts';
import { paymentMode, paymentRuntime } from '../src/server/payment-runtime.ts';
import { MAX_LOG_BYTES } from '@defi-workflow-engine/cloud-runtime';
import { createManagedWalletEvm, type ManagedEvmExpected } from '../src/server/managed-wallet-evm.ts';

export type FlowName = `crosschain-router-${EthereumRouterNetwork}` | 'robinhood-transfer' | 'aave-supply' | 'base-sepolia-swap' | 'solana-devnet-swap' | 'orca-liquidity' | 'jupiter-swap' | 'uniswap-liquidity' | 'crosschain-router'
  /** BUILD-SOLANA-MAINNET-001: Orca Whirlpools liquidity on Solana mainnet-beta (real funds), the same service as `orca-liquidity` on its own storage. */
  | 'orca-liquidity-mainnet'
  | 'crosschain-router-testnet' | 'lending-composition' | 'pix-payment' | 'robinhood-swap' | 'robinhood-mainnet-transfer' | 'robinhood-liquidity'
  | 'crosschain-router-base-to-robinhood' | 'crosschain-router-robinhood-to-base' | 'crosschain-router-arbitrum-to-robinhood' | 'crosschain-router-robinhood-to-arbitrum'
  /** BUILD-BASE-001: Base mainnet (real funds) as a catalog network, and the Router's Arbitrum One → Base route. */
  | 'ethereum-swap' | 'ethereum-mainnet-transfer' | 'ethereum-liquidity' | 'ethereum-aave' | 'arbitrum-swap' | 'arbitrum-mainnet-transfer' | 'arbitrum-liquidity' | 'base-swap' | 'base-mainnet-transfer' | 'base-liquidity' | 'base-aave' | 'arbitrum-aave' | 'crosschain-router-arbitrum-to-base'
  /** Solana Devnet Swap → Orca liquidity, composed from the two Solana Devnet flows above. */
  | 'solana-devnet-composition'
  /** BUILD-SOLANA-TRANSFER-UX-001: direct SOL / SPL transfers to another wallet on mainnet-beta (real funds) and Devnet. */
  | 'solana-transfer' | 'solana-devnet-transfer'
  /** BUILD-CROSSCHAIN-UNIVERSAL-001: the universal Cross-chain Router across the five mainnets (Relay Depository, verified). */
  | 'crosschain-universal'
  /** BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's EVM reads and attempt-bound broadcast on the four catalog mainnets (no runs of its own). */
  | 'managed-wallet-evm';
export type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
/** Network transport for one flow. Built from configuration in production; replaced by MOCKED chains in tests. */
export type FlowDeps = { readonly rpc: Rpc; readonly mode: 'live' | 'harness'; readonly env: Readonly<Record<string, string | undefined>>; readonly http?: JupiterHttp;
  /** BUILD-ROUTER-001: the destination chain and the routing providers (the source chain is `rpc`). */
  readonly router?: { readonly destinationRpc: Rpc; readonly providers: Readonly<Record<RoutingProvider, RouteProvider>> };
  /** BUILD-ETHEREUM-001: further chain-bound read clients of a multi-network flow, keyed by CAIP-2 chain (`rpc` is its original network). */
  readonly chains?: { readonly rpcs: Readonly<Record<string, Rpc>> };
  /** BUILD-RH-002: the official asset catalog of a catalog network (fails closed when the registry is unavailable or malformed). */
  readonly catalog?: (chain: string) => Promise<AssetCatalog>;
  /** BUILD-CROSSCHAIN-UNIVERSAL-001: the universal router's chains (EVM read clients and Solana) and its provider transport. */
  readonly universal?: UniversalRouterTransport };
export type FlowMode = 'live' | 'harness' | 'off';
type Args = readonly unknown[];
export type FlowService = { readonly call: (method: string, args: Args) => Promise<unknown>; readonly load: (runId: string) => Promise<unknown>;
  readonly observe: (runId: string) => Promise<unknown> };
export type FlowDefinition = {
  readonly name: FlowName; readonly busyCode: string; readonly runId: RegExp; readonly unavailableCode: string;
  readonly methods: Readonly<Record<string, { readonly mutates: boolean; readonly validate: (args: Args) => boolean }>>;
  readonly create: (storage: ExecutionStorage, deps: FlowDeps, related?: Readonly<Partial<Record<FlowName, ExecutionStorage>>>) => FlowService;
  readonly transport: (mode: 'live' | 'harness', env: Readonly<Record<string, string | undefined>>) => Omit<FlowDeps, 'mode' | 'env'>;
  readonly needsObservation: (record: unknown) => boolean;
  readonly projector: Projector;
  readonly evidence: (record: unknown) => { bundleHash: string; environment: string; outcome: string; bytes: Uint8Array } | null;
  /**
   * BUILD-JOURNEY-001: permissionless flows bind every run to the wallet that created it. With a policy, the API refuses any call
   * whose wallet session principal is not the run's owner (`run-ownership.ts`); `ownerOf` reads the owner from the durable record.
   */
  readonly ownership?: { readonly policy: OwnershipPolicy; readonly ownerOf: (record: unknown) => string };
  /**
   * BUILD-CLOUD-PARITY-001: the durable namespace (logs and leases) when it is shared with another flow. The lending composition
   * shares the Aave Supply family's, so owner-nonce and economic-intent reservations are common to both, as in the shared local
   * journal directory. Each flow still writes and projects only its own run logs.
   */
  readonly namespace?: FlowName;
  /**
   * A composed flow runs its steps on other flows' UNCHANGED services. `uses` names exactly those flows: the backend hands
   * `create` their storage (same tenant, their own namespaces, so owner leases and registries stay shared with their
   * isolated runs) and nothing else. Their runs are still projected and observed by their own flows.
   */
  readonly uses?: readonly FlowName[];
};

/** The read client of a network this deployment has not enabled: every call fails closed with the flow's disabled code. */
const networkNotEnabled = (code: string): Rpc => async () => { throw new Error(code); };
const ACCOUNT = /^0x[0-9a-fA-F]{40}$/, COMMITMENT = /^0x[0-9a-f]{64}$/, HASH = /^0x[0-9a-fA-F]{64}$/, CODE = /^[A-Z][A-Z0-9_]{1,80}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const workflow = (value: unknown) => isObject(value) && Array.isArray(value.nodes) && typeof value.workflowId === 'string';
const diagnostic = (value: unknown) => isObject(value) && typeof value.invoked === 'boolean' && Array.isArray(value.calls) && typeof value.code === 'string';
const result = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.hash === 'string' && HASH.test(value.hash) && Object.keys(value).length === 2
  : (value.kind === 'UNKNOWN' || value.kind === 'REJECTED') && (value.code === undefined || typeof value.code === 'string' && CODE.test(value.code)) &&
    Object.keys(value).every(k => k === 'kind' || k === 'code'));
const shape = (...checks: ((value: unknown) => boolean)[]) => (args: Args) => args.length === checks.length && checks.every((check, i) => check(args[i]));
const optionalShape = (required: number, ...checks: ((value: unknown) => boolean)[]) => (args: Args) =>
  args.length >= required && args.length <= checks.length && args.every((value, i) => checks[i]!(value));
const id = (pattern: RegExp) => (value: unknown) => typeof value === 'string' && pattern.test(value);
const account = (value: unknown) => typeof value === 'string' && ACCOUNT.test(value);
const commitment = (value: unknown) => typeof value === 'string' && COMMITMENT.test(value);
const STEPS = ['APPROVAL', 'SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW'];
const step = (value: unknown) => typeof value === 'string' && STEPS.includes(value);
const OBSERVABLE = ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];

function lastRecord<T>(bytes: Uint8Array): T {
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd().split('\n');
  return JSON.parse(lines.at(-1)!) as T;
}
function journalRows(journal: TransferRecord['journal']) {
  const hashes = hashJournalBytes(new TextEncoder().encode(JSON.stringify(journal)));
  return journal.entries.map((entry, index) => ({ sequence: entry.sequence, entryHash: hashes[index]!, level: entry.level, entityId: entry.entityId,
    attemptId: entry.executionAttemptId, fromState: entry.fromState, toState: entry.toState, recordedAt: entry.recordedAt }));
}
const errorCode = (value: string | null | undefined) => value && CODE.test(value) ? value : value ? 'UNCLASSIFIED_ERROR' : null;
function work(flow: FlowName, runId: string, observe: boolean, firstDelayMs: number, hasEvidence: boolean): WorkRequest[] {
  const payload = { namespace: flow, runId }, dedupeKey = `${flow}:${runId}`;
  return [...observe ? [{ kind: 'reconcile', dedupeKey, runId, payload, delayMs: firstDelayMs }] : [],
    ...hasEvidence ? [{ kind: 'evidence.archive', dedupeKey, runId, payload }] : []];
}
function evidenceOf(record: { evidence: unknown; verdict: string }) {
  const evidence = record.evidence as { bundle?: { environment?: unknown; outcome?: unknown }; bundleHash?: unknown } | null;
  if (!evidence || record.verdict !== 'RECONCILED' || typeof evidence.bundleHash !== 'string' || !evidence.bundle) return null;
  return { bundleHash: evidence.bundleHash, environment: String(evidence.bundle.environment), outcome: String(evidence.bundle.outcome),
    bytes: new TextEncoder().encode(JSON.stringify(evidence)) };
}

const transferNeedsObservation = (value: unknown) => {
  const record = value as TransferRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && !!record.attempt && OBSERVABLE.includes(record.attempt.state);
};
/**
 * The transfer coordinator as a cloud flow. `robinhood-transfer`: the public-testnet native self-transfers (`rhx-` runs).
 * BUILD-RH-002 `robinhood-mainnet-transfer`: Robinhood Chain mainnet (real funds) native ETH and catalog ERC-20 transfers (`rht-`
 * runs), with the official catalog and the deployment's explicit owner-execution opt-in. BUILD-BASE-001 `base-mainnet-transfer`: the
 * same on Base mainnet (`bat-` runs, the Base catalog and gates; the OP Stack L1 fee is bounded and reconciled by the engine).
 */
function transferFlow(name: 'robinhood-transfer' | CatalogNetworkRuntime['flows']['transfer'], network: CatalogNetworkRuntime | null = null): FlowDefinition {
  const RUN = network ? new RegExp(`^${network.prefixes.transfer}-[a-f0-9]{32}$`) : /^rhx-[a-f0-9]{32}$/;
  return {
    name, busyCode: 'TRANSFER_BUSY', runId: RUN, unavailableCode: 'TRANSFER_SERVICE_UNAVAILABLE',
    methods: {
      ...(!network ? { info: { mutates: false, validate: shape() } } : {}),
      simulate: { mutates: true, validate: shape(workflow, account) },
      review: { mutates: true, validate: shape(id(RUN), commitment, workflow) },
      invalidate: { mutates: true, validate: shape(id(RUN)) },
      begin: { mutates: true, validate: shape(id(RUN), account, workflow) },
      handoff: { mutates: true, validate: shape(id(RUN)) },
      report: { mutates: true, validate: shape(id(RUN), result) },
      walletFailure: { mutates: true, validate: shape(id(RUN), diagnostic) },
      observe: { mutates: true, validate: shape(id(RUN)) },
      status: { mutates: false, validate: shape(id(RUN)) },
      recoverReview: { mutates: true, validate: shape(id(RUN)) },
    },
    // Each transfer network has its own read client and its own enablement; a disabled network's client always fails closed.
    transport: network ? (mode, env) => ({ rpc: network.rpc(mode, env), catalog: network.catalogFor(mode) })
      : (mode, env) => { const { rpc, rpcs } = nativeTransferReadRpcs(mode, env); return { rpc: rpc ?? networkNotEnabled('TRANSFER_PUBLIC_TESTNET_NOT_ENABLED'), chains: { rpcs } }; },
    create(storage, { rpc, mode, env, chains, catalog }) {
      const s = network ? createRobinhoodTransferService({ storage, rpcs: { [network.chain]: rpc }, idPrefix: network.prefixes.transfer,
        provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_MAINNET', ...catalog ? { catalogFor: catalog } : {}, executionEnabled: network.ownerExecutionEnabled(mode, env) })
        : createRobinhoodTransferService({ storage, rpc, ...chains ? { rpcs: chains.rpcs } : {}, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET' });
      const table: Record<string, (args: Args) => Promise<unknown>> = {
        ...(!network ? { info: async () => ({ executionEnabled: true, networks: nativeTransferEnabledNetworks(mode, env) }) } : {}),
        simulate: ([w, a]) => s.simulate(w, a as string),
        review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
        invalidate: ([i]) => s.invalidate(i as string),
        begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
        handoff: ([i]) => s.handoff(i as string),
        report: ([i, r]) => s.report(i as string, r as Parameters<typeof s.report>[1]),
        walletFailure: ([i, d]) => s.walletFailure(i as string, d as TransferWalletDiagnostic),
        observe: ([i]) => s.observe(i as string),
        status: ([i]) => s.load(i as string),
        recoverReview: ([i]) => s.recoverReview(i as string),
      };
      return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
    },
    needsObservation: transferNeedsObservation,
    projector(file, bytes): Projection | null {
      if (!file.endsWith('.jsonl')) return null;
      const record = lastRecord<TransferRecord>(bytes), attempt = record.attempt, observe = transferNeedsObservation(record);
      const evidence = evidenceOf(record);
      return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow: name,
        status: record.verdict !== 'PENDING' ? record.verdict : attempt ? attempt.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
        provenance: record.provenance, ownerAccount: record.review.account.toLowerCase(), recoveryOf: record.recoveryOf ?? null, errorCode: errorCode(record.error),
        needsObservation: observe, hasEvidence: evidence !== null,
        attempts: attempt ? [{ attemptId: `${record.id}.TRANSFER`, step: 'TRANSFER', state: attempt.state, nonce: attempt.nonce,
          transactionHash: attempt.transactionHash, preparedAtBlock: attempt.preparedAtBlock, reconciled: attempt.reconciled }] : [],
        journal: journalRows(record.journal) },
      // SUBMITTING usually means the owner's wallet prompt is open: give the browser time to report first.
      work: work(name, record.id, observe, attempt?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
    },
    evidence: record => evidenceOf(record as TransferRecord),
  };
}
const robinhood = transferFlow('robinhood-transfer');
const robinhoodMainnetTransfer = transferFlow('robinhood-mainnet-transfer', CATALOG_NETWORKS.robinhood);
const baseMainnetTransfer = transferFlow('base-mainnet-transfer', CATALOG_NETWORKS.base);
const ethereumMainnetTransfer = transferFlow('ethereum-mainnet-transfer', CATALOG_NETWORKS.ethereum);
const arbitrumMainnetTransfer = transferFlow('arbitrum-mainnet-transfer', CATALOG_NETWORKS['arbitrum-one']);

const supplyNeedsObservation = (value: unknown) => {
  const record = value as SupplyRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && record.attempts.some(a => !a.reconciled && OBSERVABLE.includes(a.state));
};
/**
 * The shared Aave lending service: testnets use `aave-supply`; catalog mainnets bind the network's registered
 * flow, namespace, owner gate and read client. Durable reservations and observation-only workers are shared.
 */
function supplyFlow(name: 'aave-supply' | 'base-aave' | 'arbitrum-aave' | 'ethereum-aave'): FlowDefinition {
  const network = Object.values(CATALOG_NETWORKS).find(n => n.flows.lending === name);
  const SUPPLY_ID = new RegExp(`^${network?.prefixes.lending ?? 'supply'}-[a-f0-9]{32}$`);
  return {
  name, busyCode: 'SUPPLY_BUSY', runId: SUPPLY_ID, unavailableCode: 'SUPPLY_SERVICE_UNAVAILABLE',
  methods: {
    simulate: { mutates: true, validate: shape(workflow, account) },
    review: { mutates: true, validate: shape(id(SUPPLY_ID), commitment, workflow) },
    begin: { mutates: true, validate: shape(id(SUPPLY_ID), account, workflow) },
    report: { mutates: true, validate: shape(id(SUPPLY_ID), step, result) },
    observe: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    status: { mutates: false, validate: shape(id(SUPPLY_ID)) },
    invalidate: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    recoverReview: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    walletFailure: { mutates: true, validate: shape(id(SUPPLY_ID), diagnostic) },
    walletTrace: { mutates: true, validate: shape(id(SUPPLY_ID), diagnostic) },
    handoff: { mutates: true, validate: optionalShape(2, id(SUPPLY_ID), step, v => typeof v === 'boolean') },
  },
  transport: network ? (mode, env) => ({ rpc: createCatalogLendingReadRpc(network, mode === 'harness', env) })
    : (mode, env) => { const rpcs = createLendingReadRpcs(mode === 'harness', env); return { rpc: rpcs['eip155:84532'], chains: { rpcs } }; },
  create(storage, { rpc, mode, env, chains }) {
    const s = network ? createSupplyService({ storage, rpc: networkNotEnabled('SUPPLY_NETWORK_UNAVAILABLE'), rpcs: { [network.chain]: rpc }, idPrefix: network.prefixes.lending!,
      provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_MAINNET', executionEnabled: network.ownerExecutionEnabled(mode, env) })
      : createSupplyService({ storage, rpc, ...chains ? { rpcs: chains.rpcs } : {}, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET' });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      simulate: ([w, a]) => s.simulate(w, a as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      report: ([i, st, r]) => s.report(i as string, st as Parameters<typeof s.report>[1], r as Parameters<typeof s.report>[2]),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
      invalidate: ([i]) => s.invalidate(i as string),
      recoverReview: ([i]) => s.recoverReview(i as string),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as SupplyWalletDiagnostic),
      walletTrace: ([i, d]) => s.walletTrace(i as string, d as SupplyWalletDiagnostic),
      handoff: ([i, st, managed]) => s.handoff(i as string, st as Parameters<typeof s.handoff>[1], managed === true),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: supplyNeedsObservation,
  projector(logName, bytes): Projection | null {
    if (!logName.endsWith('.jsonl')) return null;
    const record = lastRecord<SupplyRecord>(bytes), observe = supplyNeedsObservation(record), evidence = evidenceOf(record);
    const open = record.attempts.find(a => !a.reconciled);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow: name,
      status: record.verdict !== 'PENDING' ? record.verdict : open ? open.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.review.account.toLowerCase(), recoveryOf: record.recoveryOf ?? null, errorCode: errorCode(record.error),
      needsObservation: observe, hasEvidence: evidence !== null,
      attempts: record.attempts.map(a => ({ attemptId: `${record.id}.${a.step}`, step: a.step, state: a.state, nonce: a.nonce,
        transactionHash: a.transactionHash, preparedAtBlock: a.preparedAtBlock, reconciled: a.reconciled })),
      journal: journalRows(record.journal) },
    work: work(name, record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
  },
  evidence: record => evidenceOf(record as SupplyRecord),
  };
}
const ethereumAave = supplyFlow('ethereum-aave');
const supply = supplyFlow('aave-supply'), baseAave = supplyFlow('base-aave'), arbitrumAave = supplyFlow('arbitrum-aave');

/**
 * The existing exact-profile Base Sepolia Uniswap v3 swap (USDC <-> WETH). Read-only public preflight (pinned
 * contracts, pool, quote, freshness, gas), explicit Review, then the owner's wallet sends the exact approval or
 * swap. Workers only read receipts for attempts that already carry the owner's transaction hash.
 */
const SWAP_ID = /^pub-[0-9a-f]{24}$/;
const swapNeedsObservation = (value: unknown) => {
  const run = value as PublicRun, last = run.attempts.at(-1);
  return !run.divergence && !run.outcome && !!last && ((!!last.txHash && (last.state === 'HASH' || last.state === 'PENDING' ||
    !!run.quote.ownerReview && last.state === 'CONFIRMED' && (last.step === 'swap' || last.nativeAfter === null))) ||
    !!run.quote.ownerReview && ['PREPARED', 'UNKNOWN'].includes(last.state));
};
const swapEvidence = (value: unknown) => {
  const outcome = (value as PublicRun).outcome;
  if (!outcome) return null;
  return { bundleHash: outcome.evidenceBundleHash, environment: outcome.evidence.environment, outcome: outcome.evidence.outcome,
    bytes: new TextEncoder().encode(JSON.stringify(outcome)) };
};
const swapResult = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.txHash === 'string' && HASH.test(value.txHash) &&
  Object.keys(value).length === 2 : (value.kind === 'REJECTED' || value.kind === 'UNKNOWN') && Object.keys(value).length === 1);
const swap: FlowDefinition = {
  name: 'base-sepolia-swap', busyCode: 'EXECUTION_BUSY', runId: SWAP_ID, unavailableCode: 'PUBLIC_INTERNAL_ERROR',
  methods: {
    prepare: { mutates: true, validate: shape(workflow) },
    refresh: { mutates: true, validate: shape(id(SWAP_ID)) },
    review: { mutates: true, validate: shape(id(SWAP_ID), commitment) },
    begin: { mutates: true, validate: shape(id(SWAP_ID), account) },
    report: { mutates: true, validate: shape(id(SWAP_ID), v => typeof v === 'string' && /^pub-[0-9a-f]{24}\.(approval|swap)\.[1-8]$/.test(v), swapResult) },
    observe: { mutates: true, validate: shape(id(SWAP_ID)) },
    status: { mutates: false, validate: shape(id(SWAP_ID)) },
  },
  transport: (_mode, env) => ({ rpc: baseSepoliaSwapRpc(env.GRYLOO_BASE_SEPOLIA_RPC_URL), chains: { rpcs: { 'eip155:11155111': ethereumSepoliaSwapRpc(env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL) } } }),
  create(storage, { rpc, chains }) {
    const s = createDurablePublicTestnetService({ storage, rpc, ...chains ? { rpcs: chains.rpcs } : {} });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      prepare: ([w]) => s.prepare(w as SemanticWorkflow),
      refresh: ([i]) => s.refresh(i as string),
      review: ([i, h]) => s.review(i as string, h as string),
      begin: ([i, a]) => s.begin(i as string, a as string),
      report: ([i, attempt, r]) => s.report(i as string, attempt as string, r as Parameters<typeof s.report>[2]),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: swapNeedsObservation,
  projector(name, bytes): Projection | null {
    if (!name.endsWith('.jsonl')) return null;
    const run = lastRecord<PublicRun>(bytes), observe = swapNeedsObservation(run), evidence = swapEvidence(run), last = run.attempts.at(-1);
    return { run: { runId: run.quote.executionId, workflowId: run.workflow.workflowId, flow: 'base-sepolia-swap',
      status: run.outcome ? 'RECONCILED' : last ? last.state : run.reviewedManifestHash ? 'AUTHORIZED' : 'SIMULATED',
      provenance: 'PUBLIC_TESTNET', ownerAccount: last?.account ?? null, recoveryOf: null, errorCode: null, needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: run.attempts.map(a => ({ attemptId: a.attemptId, step: a.step.toUpperCase(), state: a.state, nonce: null, transactionHash: a.txHash,
        preparedAtBlock: a.preBlock, reconciled: a.state === 'CONFIRMED' && (a.step === 'approval' || run.outcome !== null) })),
      journal: [] },
    work: work('base-sepolia-swap', run.quote.executionId, observe, 5_000, evidence !== null) };
  },
  evidence: run => swapEvidence(run),
};

/**
 * BUILD-RH-002: Robinhood Chain mainnet (real funds) catalog swaps on the same durable swap service, in their own `rhs-`
 * namespace. `begin` additionally needs the deployment's real-funds owner-execution opt-in; the owner's wallet still signs
 * and sends. Workers only read receipts of attempts that already carry the owner's transaction hash. BUILD-BASE-001 `base-swap`:
 * the same on Base mainnet (`bas-` runs, the Base catalog and gates; Base's USDC ⇄ WETH reference swap included).
 */
function catalogSwapFlow(network: CatalogNetworkRuntime): FlowDefinition {
  const name = network.flows.swap, prefix = network.prefixes.swap;
  const RUN = new RegExp(`^${prefix}-[0-9a-f]{24}$`), ATTEMPT = new RegExp(`^${prefix}-[0-9a-f]{24}\\.(approval|swap)\\.[1-8]$`);
  return {
  name, busyCode: 'EXECUTION_BUSY', runId: RUN, unavailableCode: 'PUBLIC_INTERNAL_ERROR',
  methods: {
    prepare: { mutates: true, validate: optionalShape(1, workflow, account) },
    refresh: { mutates: true, validate: shape(id(RUN)) },
    review: { mutates: true, validate: shape(id(RUN), commitment) },
    begin: { mutates: true, validate: shape(id(RUN), account) },
    report: { mutates: true, validate: shape(id(RUN), v => typeof v === 'string' && ATTEMPT.test(v), swapResult) },
    observe: { mutates: true, validate: shape(id(RUN)) },
    status: { mutates: false, validate: shape(id(RUN)) },
  },
  transport: (mode, env) => ({ rpc: network.rpc(mode, env), catalog: network.catalogFor(mode) }),
  create(storage, { rpc, mode, env, catalog }) {
    const unavailable = async (): Promise<AssetCatalog> => { throw new Error(network.catalogUnavailableCode); };
    const s = createDurablePublicTestnetService({ storage, rpc: networkNotEnabled('PUBLIC_NETWORK_UNAVAILABLE'), rpcs: { [network.chain]: rpc }, idPrefix: prefix,
      catalog: network.swapRuntime(mode, env, catalog ?? unavailable) });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      prepare: ([w, a]) => s.prepare(w as SemanticWorkflow, a as string | undefined), refresh: ([i]) => s.refresh(i as string), review: ([i, h]) => s.review(i as string, h as string),
      begin: ([i, a]) => s.begin(i as string, a as string),
      report: ([i, attempt, r]) => s.report(i as string, attempt as string, r as Parameters<typeof s.report>[2]),
      observe: ([i]) => s.observe(i as string), status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: swapNeedsObservation,
  projector(logName, bytes): Projection | null {
    if (!logName.endsWith('.jsonl')) return null;
    const run = lastRecord<PublicRun>(bytes), observe = swapNeedsObservation(run), evidence = swapEvidence(run), last = run.attempts.at(-1);
    return { run: { runId: run.quote.executionId, workflowId: run.workflow.workflowId, flow: name,
      status: run.divergence ? 'DIVERGENT' : run.outcome ? 'RECONCILED' : last ? last.state : run.reviewedManifestHash ? 'AUTHORIZED' : 'SIMULATED',
      provenance: run.quote.provenance === 'MOCKED' ? 'MOCKED' : 'PUBLIC_MAINNET', ownerAccount: last?.account ?? run.quote.ownerReview?.account ?? null, recoveryOf: null, errorCode: run.divergence ?? null,
      needsObservation: observe, hasEvidence: evidence !== null,
      attempts: run.attempts.map(a => ({ attemptId: a.attemptId, step: a.step.toUpperCase(), state: a.state, nonce: a.tx.nonce ? BigInt(a.tx.nonce).toString() : null, transactionHash: a.txHash,
        preparedAtBlock: a.preBlock, reconciled: !run.divergence && a.state === 'CONFIRMED' &&
          (a.step === 'approval' ? !run.quote.ownerReview || a.nativeAfter !== null : run.outcome !== null) })),
      journal: [] },
    work: work(name, run.quote.executionId, observe, 5_000, evidence !== null) };
  },
  evidence: run => swapEvidence(run),
  };
}
const ethereumSwap = catalogSwapFlow(CATALOG_NETWORKS.ethereum);
const robinhoodSwap = catalogSwapFlow(CATALOG_NETWORKS.robinhood), baseSwap = catalogSwapFlow(CATALOG_NETWORKS.base), arbitrumSwap = catalogSwapFlow(CATALOG_NETWORKS['arbitrum-one']);

/**
 * Solana flows (BUILD-014 Jupiter mainnet-beta swap, BUILD-DEMO-001 Orca Devnet swap, BUILD-015 Orca Devnet liquidity).
 * The owner's wallet signs in the browser; the API verifies the exact reviewed bytes and owner signature, persists the
 * signature and relays the owner-signed bytes once — only on the browser's explicit `submit`. Workers only observe by
 * signature (their transport cannot send at all) and never touch PREPARED attempts.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const solanaOwner = (value: unknown) => typeof value === 'string' && SOLANA_ADDRESS.test(value);
const signedTransaction = (value: unknown) => typeof value === 'string' && value.length <= 8_192 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const solanaDiagnostic = (value: unknown) => isObject(value) && ['CONNECT', 'SIGN', 'PREFLIGHT'].includes(String(value.stage)) && typeof value.code === 'string' &&
  JSON.stringify(value).length <= 16_384;
const liquidityRequest = (value: unknown) => isObject(value) && ['OPEN', 'DECREASE_PARTIAL', 'EXIT'].includes(String(value.operation)) &&
  solanaOwner(value.positionMint) && (value.partBps === undefined || Number.isSafeInteger(value.partBps)) &&
  Object.keys(value).every(k => ['operation', 'positionMint', 'partBps'].includes(k));
type SolanaRecord = { id: string; review: { owner: string; workflow: SemanticWorkflow }; provenance: 'PUBLIC_MAINNET' | 'PUBLIC_DEVNET' | 'MOCKED';
  authorization: string | null; verdict: string; notSubmitted?: boolean; error: string | null; journal: TransferRecord['journal']; evidence: unknown;
  attempt: { state: string; signature: string | null; preparedAtBlockHeight: number; reconciled: boolean } | null };
const solanaNeedsObservation = (value: unknown) => {
  const record = value as SolanaRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && !!record.attempt && OBSERVABLE.includes(record.attempt.state);
};
function solanaProjector(flow: FlowName, step: (record: SolanaRecord) => string) {
  return (name: string, bytes: Uint8Array): Projection | null => {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<SolanaRecord>(bytes), attempt = record.attempt, observe = solanaNeedsObservation(record), evidence = evidenceOf(record);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow,
      status: record.verdict !== 'PENDING' ? record.verdict : attempt ? attempt.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.review.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: attempt ? [{ attemptId: `${record.id}.${step(record).toLowerCase()}`, step: step(record), state: attempt.state, nonce: null,
        transactionHash: attempt.signature, preparedAtBlock: attempt.preparedAtBlockHeight, reconciled: attempt.reconciled }] : [],
      journal: journalRows(record.journal) },
    work: work(flow, record.id, observe, 5_000, evidence !== null) };
  };
}
const solanaSwapMethods = (idPattern: RegExp) => ({
  info: { mutates: false, validate: shape() },
  simulate: { mutates: true, validate: shape(workflow, solanaOwner) },
  review: { mutates: true, validate: shape(id(idPattern), commitment, workflow) },
  invalidate: { mutates: true, validate: shape(id(idPattern)) },
  begin: { mutates: true, validate: shape(id(idPattern), solanaOwner, workflow) },
  walletFailure: { mutates: true, validate: shape(id(idPattern), solanaDiagnostic) },
  submit: { mutates: true, validate: shape(id(idPattern), signedTransaction) },
  observe: { mutates: true, validate: shape(id(idPattern)) },
  status: { mutates: false, validate: shape(id(idPattern)) },
});
function solanaSwapTable(s: ReturnType<typeof createSolanaDevnetService>): Record<string, (args: Args) => Promise<unknown>> {
  return {
    info: async () => ({ executionEnabled: s.executionEnabled }),
    simulate: ([w, o]) => s.simulate(w, o as string),
    review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
    invalidate: ([i]) => s.invalidate(i as string),
    begin: ([i, o, w]) => s.begin(i as string, o as string, w as SemanticWorkflow),
    walletFailure: ([i, d]) => s.walletFailure(i as string, d as JupiterWalletDiagnostic),
    submit: ([i, t]) => s.submit(i as string, t as string),
    observe: ([i]) => s.observe(i as string),
    status: ([i]) => s.load(i as string),
  };
}
const DEVNET_SWAP_ID = /^orca-[a-f0-9]{32}$/;
const solanaDevnetSwap: FlowDefinition = {
  name: 'solana-devnet-swap', busyCode: 'DEVNET_SWAP_BUSY', runId: DEVNET_SWAP_ID, unavailableCode: 'DEVNET_SWAP_SERVICE_UNAVAILABLE',
  methods: solanaSwapMethods(DEVNET_SWAP_ID),
  transport: (mode, env) => ({ rpc: createSolanaRpc(mode === 'harness' ? 'http://127.0.0.1:8552/rpc'
    : solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'DEVNET_SWAP_RPC_CONFIGURATION_INVALID') ?? ORCA_WHIRLPOOLS_DEVNET.rpc, mode === 'harness') }),
  create(storage, { rpc, mode, env }) {
    const s = createSolanaDevnetService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_DEVNET',
      executionEnabled: env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED' });
    const table = solanaSwapTable(s);
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation, projector: solanaProjector('solana-devnet-swap', () => 'SWAP'), evidence: record => evidenceOf(record as JupiterRecord),
};
const JUPITER_ID = /^jupiter-[a-f0-9]{32}$/;
const jupiterSwap: FlowDefinition = {
  name: 'jupiter-swap', busyCode: 'JUPITER_BUSY', runId: JUPITER_ID, unavailableCode: 'JUPITER_SERVICE_UNAVAILABLE',
  methods: solanaSwapMethods(JUPITER_ID),
  transport: (mode, env) => ({
    rpc: createSolanaRpc(mode === 'harness' ? 'http://127.0.0.1:8551/rpc'
      : solanaRpcOverride(env.GRYLOO_SOLANA_RPC_URL, 'JUPITER_RPC_CONFIGURATION_INVALID') ?? JUPITER_SOLANA_MAINNET.rpc, mode === 'harness'),
    http: createJupiterHttp(mode === 'harness' ? 'http://127.0.0.1:8551/swap/v2/build' : JUPITER_SOLANA_MAINNET.api + JUPITER_SOLANA_MAINNET.endpoint,
      mode === 'harness' ? undefined : env.JUPITER_API_KEY) }),
  create(storage, { rpc, http, mode, env }) {
    if (!http) throw new Error('JUPITER_CONFIGURATION_INVALID');
    // Real-funds execution stays a separate explicit owner opt-in; Simulate and Review remain read-only without it.
    const s = createJupiterService({ storage, rpc, http, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_MAINNET',
      executionEnabled: mode === 'harness' || env.GRYLOO_JUPITER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED' });
    const table = solanaSwapTable(s);
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation, projector: solanaProjector('jupiter-swap', () => 'SWAP'), evidence: record => evidenceOf(record as JupiterRecord),
};
/**
 * BUILD-SOLANA-TRANSFER-UX-001: one Solana transfer flow per cluster, on the same strict method surface as the Solana swaps. Mainnet-beta real-funds
 * execution is a separate explicit owner opt-in (GRYLOO_SOLANA_TRANSFER_OWNER_EXECUTION); Devnet follows the existing Devnet execution switch.
 */
const solanaTransferFlow = (name: 'solana-transfer' | 'solana-devnet-transfer', profile: SolanaTransferProfile): FlowDefinition => {
  const idPattern = new RegExp(`^${profile.idPrefix}-[a-f0-9]{32}$`);
  return {
    name, busyCode: 'SOLANA_TRANSFER_BUSY', runId: idPattern, unavailableCode: 'SOLANA_TRANSFER_SERVICE_UNAVAILABLE',
    methods: solanaSwapMethods(idPattern),
    transport: (mode, env) => ({ rpc: createSolanaRpc(mode === 'harness' ? `http://127.0.0.1:8552/${profile.realFunds ? 'transfer-rpc' : 'transfer-devnet-rpc'}`
      : (profile.realFunds ? solanaRpcOverride(env.GRYLOO_SOLANA_RPC_URL, 'SOLANA_TRANSFER_RPC_CONFIGURATION_INVALID')
        : solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'SOLANA_TRANSFER_RPC_CONFIGURATION_INVALID')) ?? profile.rpc, mode === 'harness') }),
    create(storage, { rpc, mode, env }) {
      const s = createSolanaTransferService({ storage, rpc, profile, provenance: mode === 'harness' ? 'MOCKED' : profile.provenance,
        executionEnabled: profile.realFunds ? mode === 'harness' || env.GRYLOO_SOLANA_TRANSFER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED'
          : env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED' });
      const table: Record<string, (args: Args) => Promise<unknown>> = {
        info: async () => ({ executionEnabled: s.executionEnabled }),
        simulate: ([w, o]) => s.simulate(w, o as string),
        review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
        invalidate: ([i]) => s.invalidate(i as string),
        begin: ([i, o, w]) => s.begin(i as string, o as string, w as SemanticWorkflow),
        walletFailure: ([i, d]) => s.walletFailure(i as string, d as SolanaTransferWalletDiagnostic),
        submit: ([i, t]) => s.submit(i as string, t as string),
        observe: ([i]) => s.observe(i as string),
        status: ([i]) => s.load(i as string),
      };
      return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
    },
    needsObservation: solanaNeedsObservation, projector: solanaProjector(name, () => 'TRANSFER'), evidence: record => evidenceOf(record as SolanaTransferRecord),
  };
};
const ORCA_LP_ID = /^orcalp-[a-f0-9]{32}$/;
/** Orca Whirlpools liquidity on one Solana cluster: Devnet (`orca-liquidity`) or mainnet-beta (`orca-liquidity-mainnet`, BUILD-SOLANA-MAINNET-001). */
const orcaLiquidityFlow = (name: 'orca-liquidity' | 'orca-liquidity-mainnet', profile: OrcaLiquidityProfile): FlowDefinition => ({
  name, busyCode: 'ORCA_LIQUIDITY_BUSY', runId: ORCA_LP_ID, unavailableCode: 'ORCA_LIQUIDITY_SERVICE_UNAVAILABLE',
  methods: { ...solanaSwapMethods(ORCA_LP_ID),
    simulate: { mutates: true, validate: shape(workflow, solanaOwner, liquidityRequest) },
    price: { mutates: false, validate: shape() },
    positions: { mutates: false, validate: shape(solanaOwner) },
    inspect: { mutates: false, validate: shape(solanaOwner, solanaOwner) } },
  transport: (mode, env) => ({ rpc: createSolanaRpc(mode === 'harness' ? `http://127.0.0.1:8552/${profile.realFunds ? 'mainnet-rpc' : 'rpc'}`
    : (profile.realFunds ? solanaRpcOverride(env.GRYLOO_SOLANA_RPC_URL, 'ORCA_LIQUIDITY_RPC_CONFIGURATION_INVALID')
      : solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'ORCA_LIQUIDITY_RPC_CONFIGURATION_INVALID')) ?? profile.rpc, mode === 'harness') }),
  create(storage, { rpc, mode, env }) {
    // Devnet execution is on unless disabled; mainnet-beta owner execution (real funds) is an explicit opt-in, like Jupiter's.
    const s = createOrcaLiquidityService({ storage, rpc, profile, provenance: mode === 'harness' ? 'MOCKED' : profile.provenance,
      executionEnabled: profile.realFunds ? mode === 'harness' || env.GRYLOO_ORCA_MAINNET_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED'
        : env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED' });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      price: () => s.price(),
      positions: ([o]) => s.positions(o as string),
      inspect: ([o, m]) => s.inspect(o as string, m as string),
      simulate: ([w, o, r]) => s.simulate(w as SemanticWorkflow, o as string, r as Parameters<typeof s.simulate>[2]),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i]) => s.invalidate(i as string),
      begin: ([i, o, w]) => s.begin(i as string, o as string, w as SemanticWorkflow),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as OrcaLiquidityWalletDiagnostic),
      submit: ([i, t]) => s.submit(i as string, t as string),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation,
  projector: solanaProjector(name, record => (record as unknown as OrcaLiquidityRecord).operation),
  evidence: record => evidenceOf(record as OrcaLiquidityRecord),
});
const orcaLiquidity = orcaLiquidityFlow('orca-liquidity', ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY);

const SOLANA_COMPOSITION_ID = /^solcomp-[a-f0-9]{32}$/;
const positionMint = (value: unknown) => typeof value === 'string' && SOLANA_ADDRESS.test(value);
const compositionDiagnostic = (value: unknown) => isObject(value) && Object.keys(value).length === 2 && ['SWAP', 'LIQUIDITY'].includes(String(value.step)) &&
  solanaDiagnostic(value.diagnostic);
/**
 * Solana Devnet Swap → Orca liquidity: the composition coordinator over the `solana-devnet-swap` and `orca-liquidity` services,
 * each on its own durable namespace of the same tenant. The coordinator signs and sends nothing; its runs are projected for
 * history, and a worker observes a run only once one of its steps has a signed transaction (never a prepared, unsigned one).
 */
const solanaComposition: FlowDefinition = {
  name: 'solana-devnet-composition', busyCode: 'SOLANA_COMPOSITION_BUSY', runId: SOLANA_COMPOSITION_ID, unavailableCode: 'SOLANA_COMPOSITION_SERVICE_UNAVAILABLE',
  uses: ['solana-devnet-swap', 'orca-liquidity'],
  methods: {
    info: { mutates: false, validate: shape() },
    simulate: { mutates: true, validate: shape(workflow, solanaOwner) },
    review: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), commitment, workflow) },
    invalidate: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID)) },
    beginSwap: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), solanaOwner, workflow) },
    submitSwap: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), signedTransaction) },
    prepareLiquidity: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), solanaOwner, workflow, positionMint) },
    reviewLiquidity: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), commitment, workflow) },
    beginLiquidity: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), solanaOwner, workflow) },
    submitLiquidity: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), signedTransaction) },
    walletFailure: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID), compositionDiagnostic) },
    observe: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID)) },
    end: { mutates: true, validate: shape(id(SOLANA_COMPOSITION_ID)) },
    status: { mutates: false, validate: shape(id(SOLANA_COMPOSITION_ID)) },
  },
  transport: (mode, env) => solanaDevnetSwap.transport(mode, env),
  create(storage, { rpc, mode, env }, related) {
    const swapStorage = related?.['solana-devnet-swap'], liquidityStorage = related?.['orca-liquidity'];
    if (!swapStorage || !liquidityStorage) throw new Error('SOLANA_COMPOSITION_CONFIGURATION_INVALID');
    const provenance = mode === 'harness' ? 'MOCKED' as const : 'PUBLIC_DEVNET' as const, executionEnabled = env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED';
    const s = createSolanaCompositionService({ rpc, storage, provenance, executionEnabled,
      swap: createSolanaDevnetService({ storage: swapStorage, rpc, provenance, executionEnabled }),
      liquidity: createOrcaLiquidityService({ storage: liquidityStorage, rpc, provenance, executionEnabled }) });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      simulate: ([w, o]) => s.simulate(w, o as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i]) => s.invalidate(i as string),
      beginSwap: ([i, o, w]) => s.beginSwap(i as string, o as string, w as SemanticWorkflow),
      submitSwap: ([i, t]) => s.submitSwap(i as string, t as string),
      prepareLiquidity: ([i, o, w, m]) => s.prepareLiquidity(i as string, o as string, w as SemanticWorkflow, m as string),
      reviewLiquidity: ([i, c, w]) => s.reviewLiquidity(i as string, c as string, w as SemanticWorkflow),
      beginLiquidity: ([i, o, w]) => s.beginLiquidity(i as string, o as string, w as SemanticWorkflow),
      submitLiquidity: ([i, t]) => s.submitLiquidity(i as string, t as string),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as SolanaCompositionDiagnostic),
      observe: ([i]) => s.observe(i as string),
      end: ([i]) => s.end(i as string),
      status: ([i]) => s.status(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: record => boundCompositionNeedsObservation(record as SolanaCompositionRecord),
  projector: (name, bytes) => {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<SolanaCompositionRecord>(bytes), observe = boundCompositionNeedsObservation(record), evidence = compositionEvidence(record);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow: 'solana-devnet-composition', status: boundCompositionPhase(record),
      provenance: record.provenance, ownerAccount: record.review.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
      hasEvidence: evidence !== null, attempts: [], journal: journalRows(record.journal) },
      work: work('solana-devnet-composition', record.id, observe, 5_000, evidence !== null) };
  },
  // Like the two Solana Devnet flows it composes: tenant-scoped storage and unguessable run ids (wallet-session principals are EVM only).
  // Clients address only composition runs; the step runs are reached solely through the composition record.
  evidence: record => compositionEvidence(record as SolanaCompositionRecord),
};
function compositionEvidence(record: SolanaCompositionRecord) {
  const evidence = record.evidence;
  if (!evidence || boundCompositionPhase(record) !== 'COMPLETED') return null;
  return { bundleHash: evidence.bundleHash, environment: evidence.bundle.environment, outcome: evidence.bundle.outcome, bytes: new TextEncoder().encode(JSON.stringify(evidence)) };
}

/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC: the canonical concentrated-liquidity action on Base Sepolia through Uniswap v3. Read-only
 * public simulation and Review; the owner's browser wallet sends each exact approval and the mint. The API records the
 * reported hash; workers only observe and reconcile (their transport cannot send) and never touch PREPARED attempts.
 */
const uniswapEvmResult = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.hash === 'string' && HASH.test(value.hash) && Object.keys(value).length === 2
  : (value.kind === 'UNKNOWN' || value.kind === 'REJECTED') && (value.code === undefined || typeof value.code === 'string' && CODE.test(value.code)) &&
    Object.keys(value).every(k => k === 'kind' || k === 'code'));
/** Preserve the browser's attempt identity across the cloud boundary; services compare it with the durable attempt before accepting a report. */
const attemptBoundResult = (check: (value: unknown) => boolean, pattern: RegExp) => (value: unknown) => {
  if (!isObject(value)) return false;
  const { attemptId, ...report } = value;
  return (attemptId === undefined || typeof attemptId === 'string' && pattern.test(attemptId)) && check(report);
};
const routerWalletResult = attemptBoundResult(uniswapEvmResult, /^xroute-[a-f0-9]{32}\.(approval|deposit)\.[1-9][0-9]?$/);
const universalWalletResult = attemptBoundResult(result, /^xuni-[a-f0-9]{32}\.(approval|deposit)\.[1-9][0-9]?$/);
/**
 * BUILD-RH-002 `robinhood-liquidity`: Robinhood Chain (real funds) Uniswap v3 positions on official catalog pairs on the same liquidity
 * service, in their own `rhlp-` namespace, behind the Robinhood Chain gates (owner execution needs the real-funds opt-in).
 * BUILD-BASE-001 `base-liquidity`: the same on Base mainnet (`balp-` runs, the Base catalog and gates).
 */
const TESTNET_LIQUIDITY_ID = /^unilp-[a-f0-9]{32}$/;
const catalogPair = (v: unknown) => isObject(v) && Object.keys(v).length === 3 && typeof v.tokenA === 'string' && /^0x[0-9a-f]{40}$/.test(v.tokenA) &&
  typeof v.tokenB === 'string' && /^0x[0-9a-f]{40}$/.test(v.tokenB) && [100, 500, 3000, 10000].includes(v.fee as number);
function liquidityFlow(name: 'uniswap-liquidity' | NonNullable<CatalogNetworkRuntime['flows']['liquidity']>, network: CatalogNetworkRuntime | null = null): FlowDefinition {
  const catalogNetwork = network !== null, flowName = name;
  const RUN = network ? new RegExp(`^${network.prefixes.liquidity}-[a-f0-9]{32}$`) : TESTNET_LIQUIDITY_ID, servedChain = network?.chain;
  return {
  name, busyCode: 'UNISWAP_LIQUIDITY_BUSY', runId: RUN, unavailableCode: 'UNISWAP_LIQUIDITY_SERVICE_UNAVAILABLE',
  methods: {
    info: { mutates: false, validate: shape() },
    price: { mutates: false, validate: catalogNetwork ? shape(v => v === servedChain, catalogPair) : optionalShape(0, v => v === 'eip155:84532' || v === 'eip155:11155111') },
    simulate: { mutates: true, validate: shape(workflow, account) },
    refresh: { mutates: true, validate: shape(id(RUN)) },
    review: { mutates: true, validate: shape(id(RUN), commitment, workflow) },
    invalidate: { mutates: true, validate: shape(id(RUN)) },
    begin: { mutates: true, validate: shape(id(RUN), account, workflow) },
    handoff: { mutates: true, validate: shape(id(RUN)) },
    report: { mutates: true, validate: shape(id(RUN), uniswapEvmResult) },
    walletFailure: { mutates: true, validate: shape(id(RUN), diagnostic) },
    observe: { mutates: true, validate: shape(id(RUN)) },
    status: { mutates: false, validate: shape(id(RUN)) },
  },
  // BUILD-ETHEREUM-001: the live deployment also reads Ethereum Sepolia through its own chain-bound client; the MOCKED harness serves Base Sepolia only.
  // BUILD-RH-002: Robinhood Chain reads only chain 4663 (no Base client) and the official catalog; BUILD-BASE-001 Base only chain 8453.
  transport: network ? (mode, env) => ({ rpc: networkNotEnabled('UNISWAP_NETWORK_UNAVAILABLE'),
    chains: { rpcs: { [network.chain]: network.rpc(mode, env, network.liquidityRpcMethods) } }, catalog: network.catalogFor(mode) })
    : (mode, env) => ({ rpc: mode === 'harness' ? createBaseSepoliaReadRpc(UNI_MOCK_RPC_URL, UNISWAP_LIQUIDITY_RPC_METHODS)
    : baseSepoliaLiquidityRpc(env.GRYLOO_BASE_SEPOLIA_RPC_URL), ...mode === 'live' ? { chains: { rpcs: { 'eip155:11155111': ethereumSepoliaSwapRpc(env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL, UNISWAP_LIQUIDITY_RPC_METHODS) } } } : {} }),
  create(storage, { rpc, mode, env, chains, catalog }) {
    const s = network
      ? createUniswapLiquidityService({ storage, rpc, ...chains ? { rpcs: chains.rpcs } : {}, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_MAINNET',
        executionEnabled: network.ownerExecutionEnabled(mode, env),
        catalog: { chain: network.chain, catalogFor: catalog ?? (async () => { throw new Error(network.catalogUnavailableCode); }) } })
      : createUniswapLiquidityService({ storage, rpc, ...chains ? { rpcs: chains.rpcs } : {}, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET',
        executionEnabled: env.GRYLOO_UNISWAP_LIQUIDITY_EXECUTION !== 'DISABLED', ...mode === 'harness' ? { mockedCodePins: UNI_MOCK_CODE_PINS } : {} });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      price: ([chain, pair]) => s.price(chain as string | undefined, pair as Parameters<typeof s.price>[1]),
      simulate: ([w, a]) => s.simulate(w, a as string),
      refresh: ([i]) => s.refresh(i as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i]) => s.invalidate(i as string),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      handoff: ([i]) => s.handoff(i as string),
      report: ([i, r]) => s.report(i as string, r as Parameters<typeof s.report>[1]),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as UniswapWalletDiagnostic),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: uniswapNeedsObservation,
  projector(name, bytes): Projection | null {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<UniswapLiquidityRecord>(bytes), observe = uniswapNeedsObservation(record), evidence = evidenceOf(record);
    const open = record.attempts.find(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(a.state));
    return { run: { runId: record.id, workflowId: record.workflow.workflowId, flow: flowName,
      status: record.verdict !== 'PENDING' ? record.verdict : open ? open.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: record.attempts.map(a => ({ attemptId: a.attemptId, step: a.step, state: a.state, nonce: a.nonce, transactionHash: a.transactionHash,
        preparedAtBlock: a.preparedAtBlock, reconciled: a.reconciled })),
      journal: [] },
    // SUBMITTING usually means the owner's wallet prompt is open: give the browser time to report first.
    work: work(flowName, record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
  },
  evidence: record => evidenceOf(record as UniswapLiquidityRecord),
  };
}
const uniswapLiquidity = liquidityFlow('uniswap-liquidity'), robinhoodLiquidity = liquidityFlow('robinhood-liquidity', CATALOG_NETWORKS.robinhood),
  ethereumLiquidity = liquidityFlow('ethereum-liquidity', CATALOG_NETWORKS.ethereum),
  baseLiquidity = liquidityFlow('base-liquidity', CATALOG_NETWORKS.base), arbitrumLiquidity = liquidityFlow('arbitrum-liquidity', CATALOG_NETWORKS['arbitrum-one']);

/**
 * BUILD-ROUTER-001: the canonical Cross-chain Router, Base USDC → Arbitrum USDC (LI.FI or direct Across; underlying Across).
 * Read-only quotes, simulation and Review; the owner's browser wallet sends each exact request. The API records the
 * reported hash; workers only observe and reconcile both chains (their transports cannot send) and never touch PREPARED.
 * BUILD-JOURNEY-001: the same definition serves the testnet profile (Base Sepolia → Arbitrum Sepolia) as its own flow and
 * durable namespace, and both bind each run to its owner's wallet session.
 */
const invalidation = (value: unknown) => value === 'SEMANTIC_EDIT' || value === 'WALLET_CHANGED';
function routerFlow(name: Extract<FlowName, `crosschain-router${string}`>, network: RouterNetwork): FlowDefinition {
  return {
    name, busyCode: 'ROUTER_BUSY', runId: ROUTER_RUN_ID, unavailableCode: 'ROUTER_SERVICE_UNAVAILABLE',
    methods: {
      info: { mutates: false, validate: shape() },
      simulate: { mutates: true, validate: shape(workflow, account) },
      refresh: { mutates: true, validate: shape(id(ROUTER_RUN_ID)) },
      review: { mutates: true, validate: shape(id(ROUTER_RUN_ID), commitment, workflow) },
      invalidate: { mutates: true, validate: optionalShape(1, id(ROUTER_RUN_ID), invalidation) },
      begin: { mutates: true, validate: shape(id(ROUTER_RUN_ID), account, workflow) },
      handoff: { mutates: true, validate: shape(id(ROUTER_RUN_ID)) },
      report: { mutates: true, validate: shape(id(ROUTER_RUN_ID), routerWalletResult) },
      walletFailure: { mutates: true, validate: shape(id(ROUTER_RUN_ID), diagnostic) },
      observe: { mutates: true, validate: shape(id(ROUTER_RUN_ID)) },
      status: { mutates: false, validate: shape(id(ROUTER_RUN_ID)) },
    },
    transport: (mode, env) => { const r = routerNetworkRuntime(network, mode, env); return { rpc: r.sourceRpc, router: { destinationRpc: r.destinationRpc, providers: r.providers } }; },
    create(storage, { rpc, mode, env, router }) {
      if (!router) throw new Error('ROUTER_CONFIGURATION_INVALID');
      // The runtime's gates (provenance, owner-execution opt-in, MOCKED pins) apply; the transports may be test substitutes.
      const runtime = routerNetworkRuntime(network, mode, env);
      const s = createRouterService({ storage, sourceRpc: rpc, destinationRpc: router.destinationRpc, providers: router.providers, profile: runtime.profile,
        provenance: runtime.provenance, executionEnabled: runtime.executionEnabled, ...runtime.mockedCodePins ? { mockedCodePins: runtime.mockedCodePins } : {} });
      const table: Record<string, (args: Args) => Promise<unknown>> = {
        info: async () => ({ executionEnabled: s.executionEnabled }),
        simulate: ([w, a]) => s.simulate(w, a as string),
        refresh: ([i]) => s.refresh(i as string),
        review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
        invalidate: ([i, r]) => s.invalidate(i as string, r as 'SEMANTIC_EDIT' | 'WALLET_CHANGED' | undefined),
        begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
        handoff: ([i]) => s.handoff(i as string),
        report: ([i, r]) => s.report(i as string, r as Parameters<typeof s.report>[1]),
        walletFailure: ([i, d]) => s.walletFailure(i as string, d as RouterWalletDiagnostic),
        observe: ([i]) => s.observe(i as string),
        status: ([i]) => s.load(i as string),
      };
      return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
    },
    needsObservation: routerNeedsObservation,
    projector(logName, bytes): Projection | null {
      if (!logName.endsWith('.jsonl')) return null;
      const record = lastRecord<RouterRecord>(bytes), observe = routerNeedsObservation(record), evidence = evidenceOf(record);
      const open = record.attempts.find(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(a.state));
      return { run: { runId: record.id, workflowId: record.workflow.workflowId, flow: name,
        status: financialRunStatus(record),
        provenance: record.provenance, ownerAccount: record.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
        hasEvidence: evidence !== null,
        attempts: record.attempts.map(a => ({ attemptId: a.attemptId, step: a.step, state: a.state, nonce: a.nonce, transactionHash: a.transactionHash,
          preparedAtBlock: a.preparedAtBlock, reconciled: a.reconciled })),
        journal: [] },
      // SUBMITTING usually means the owner's wallet prompt is open; a bridge in flight is polled more gently.
      work: work(name, record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : open ? 5_000 : 15_000, evidence !== null) };
    },
    evidence: record => evidenceOf(record as RouterRecord),
    ownership: { policy: ROUTER_OWNERSHIP, ownerOf: record => (record as RouterRecord).owner },
  };
}
const crosschainRouter = routerFlow('crosschain-router', 'mainnet'), crosschainRouterTestnet = routerFlow('crosschain-router-testnet', 'testnet');

/**
 * BUILD-CROSSCHAIN-UNIVERSAL-001: the universal Cross-chain Router as one cloud flow and durable namespace for all five mainnets (any
 * source to any other destination). The UNCHANGED service: workers only observe and reconcile (EVM clients cannot send; the Solana
 * client's `sendTransaction` is reached only from `submit`, with owner-signed bytes verified against the Review). Runs belong to the
 * wallet that simulated them — an EVM or a Solana session principal. `discover` is read-only and persists nothing.
 */
const universalAccount = (value: unknown) => typeof value === 'string' && (ACCOUNT.test(value) || SOLANA_ADDRESS.test(value));
const universalDiagnostic = (value: unknown) => isObject(value) && typeof value.invoked === 'boolean' && Array.isArray(value.calls) && typeof value.code === 'string' &&
  JSON.stringify(value).length <= 65_536;
const universalRequest = (value: unknown) => isObject(value) && JSON.stringify(value).length <= 4_096;
const crosschainUniversal: FlowDefinition = {
  name: 'crosschain-universal', busyCode: 'UNIVERSAL_BUSY', runId: UNIVERSAL_RUN_ID, unavailableCode: 'UNIVERSAL_SERVICE_UNAVAILABLE',
  methods: {
    info: { mutates: false, validate: shape() },
    discover: { mutates: false, validate: shape(universalRequest) },
    simulate: { mutates: true, validate: optionalShape(2, workflow, universalAccount, universalAccount) },
    refresh: { mutates: true, validate: optionalShape(1, id(UNIVERSAL_RUN_ID), universalAccount) },
    review: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID), commitment, workflow) },
    invalidate: { mutates: true, validate: optionalShape(1, id(UNIVERSAL_RUN_ID), invalidation) },
    begin: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID), universalAccount, workflow) },
    handoff: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID)) },
    report: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID), universalWalletResult) },
    submit: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID), signedTransaction) },
    walletFailure: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID), universalDiagnostic) },
    observe: { mutates: true, validate: shape(id(UNIVERSAL_RUN_ID)) },
    status: { mutates: false, validate: shape(id(UNIVERSAL_RUN_ID)) },
  },
  transport: (mode, env) => { const t = universalRouterTransport(mode, env); return { rpc: t.evmRpcs['eip155:8453']!, universal: t }; },
  create(storage, { mode, env, universal }) {
    if (!universal) throw new Error('UNIVERSAL_CONFIGURATION_INVALID');
    // The runtime's gates (provenance, owner-execution opt-in, MOCKED pins) apply; the transports may be test substitutes.
    const runtime = universalRouterRuntime(mode, env, universal);
    const s = createUniversalRouterService({ storage, evmRpcs: runtime.evmRpcs, solanaRpc: runtime.solanaRpc,
      providers: { relay: createRelayProvider({ http: runtime.http, ...runtime.apis.relay ? { api: runtime.apis.relay } : {}, ...runtime.keys.relay ? { apiKey: runtime.keys.relay } : {} }) },
      provenance: runtime.provenance, executionEnabled: runtime.executionEnabled, ...runtime.mockedDeployment ? { mockedDeployment: runtime.mockedDeployment } : {} });
    const discovery = createUniversalDiscovery({ http: runtime.http, apis: runtime.apis, keys: runtime.keys });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      discover: async ([r]) => { const request = parseDiscoveryRequest(r); return discovery.discover(request, request.providers); },
      simulate: ([w, a, d]) => s.simulate(w, a as string, d as string | undefined),
      refresh: ([i, d]) => s.refresh(i as string, d as string | undefined),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i, r]) => s.invalidate(i as string, r as 'SEMANTIC_EDIT' | 'WALLET_CHANGED' | undefined),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      handoff: ([i]) => s.handoff(i as string),
      report: ([i, r]) => s.report(i as string, r as Parameters<typeof s.report>[1]),
      submit: ([i, t]) => s.submit(i as string, t as string),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as UniversalWalletDiagnostic),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: universalNeedsObservation,
  projector(logName, bytes): Projection | null {
    if (!logName.endsWith('.jsonl')) return null;
    const record = lastRecord<UniversalRecord>(bytes), observe = universalNeedsObservation(record), evidence = evidenceOf(record);
    const open = record.attempts.find(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(a.state));
    return { run: { runId: record.id, workflowId: record.workflow.workflowId, flow: 'crosschain-universal',
      status: financialRunStatus(record),
      provenance: record.provenance, ownerAccount: record.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: record.attempts.map(a => ({ attemptId: a.attemptId, step: a.step, state: a.state, nonce: a.ecosystem === 'EVM' ? a.nonce : null, transactionHash: a.transactionHash,
        preparedAtBlock: a.ecosystem === 'EVM' ? a.preparedAtBlock : a.preparedAtHeight, reconciled: a.reconciled })),
      journal: [] },
      // SUBMITTING usually means the owner's wallet prompt is open; a bridge in flight is polled more gently.
      work: work('crosschain-universal', record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : open ? 5_000 : 15_000, evidence !== null) };
  },
  evidence: record => evidenceOf(record as UniversalRecord),
  ownership: { policy: UNIVERSAL_OWNERSHIP, ownerOf: record => (record as UniversalRecord).owner },
};

/**
 * BUILD-013 Supply → Borrow → Swap composition on Base Sepolia (BUILD-CLOUD-PARITY-001 cloud flow). The UNCHANGED service on the Aave
 * family's shared namespace. Its run log repeats every Review in each snapshot, so the cloud store's 16 MiB bound is passed as the
 * service's run capacity: begin() refuses a step before any wallet request when its submission and reconciliation might not fit
 * (`LENDING_JOURNAL_CAPACITY_INSUFFICIENT`). Live reads need the keyed provider BUILD-013 requires (`GRYLOO_ALCHEMY_API_KEY`).
 */
const LENDING_ID = /^lending-[a-f0-9]{32}$/;
const lendingAttempt = (value: unknown) => typeof value === 'string' && /^lending-[a-f0-9]{32}\.(POOL_APPROVAL|SUPPLY|BORROW|ROUTER_APPROVAL|SWAP)\.[0-9]{1,3}$/.test(value);
const lendingResult = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.hash === 'string' && HASH.test(value.hash) && Object.keys(value).length === 2
  : value.kind === 'UNKNOWN' && Object.keys(value).length === 1);
const lendingNeedsObservation = (value: unknown) => {
  const record = value as LendingRecord;
  return !['COMPLETED', 'FAILED'].includes(record.status) && record.attempts.some(a => !a.reconciled && !a.notSubmitted && OBSERVABLE.includes(a.state));
};
const lendingEvidence = (value: unknown) => {
  const record = value as LendingRecord, evidence = record.evidence;
  if (record.status !== 'COMPLETED' || !evidence) return null;
  return { bundleHash: evidence.bundleHash, environment: String(evidence.bundle.environment), outcome: String(evidence.bundle.outcome),
    bytes: new TextEncoder().encode(JSON.stringify(evidence)) };
};
const lendingComposition: FlowDefinition = {
  name: 'lending-composition', namespace: 'aave-supply', busyCode: 'LENDING_BUSY', runId: LENDING_ID, unavailableCode: 'LENDING_SERVICE_UNAVAILABLE',
  methods: {
    simulate: { mutates: true, validate: shape(workflow, account) },
    review: { mutates: true, validate: shape(id(LENDING_ID), commitment, workflow) },
    begin: { mutates: true, validate: shape(id(LENDING_ID), account, workflow) },
    handoff: { mutates: true, validate: shape(id(LENDING_ID), lendingAttempt) },
    report: { mutates: true, validate: shape(id(LENDING_ID), lendingAttempt, lendingResult) },
    cancelPrepared: { mutates: true, validate: shape(id(LENDING_ID), lendingAttempt) },
    observe: { mutates: true, validate: shape(id(LENDING_ID)) },
    status: { mutates: false, validate: shape(id(LENDING_ID)) },
    refresh: { mutates: true, validate: shape(id(LENDING_ID)) },
    invalidate: { mutates: true, validate: shape(id(LENDING_ID)) },
  },
  transport: (mode, env) => ({ rpc: createLendingRpc(mode === 'harness', env) }),
  create(storage, { rpc, mode }) {
    const s = createLendingCompositionService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET', maxRunBytes: MAX_LOG_BYTES });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      simulate: ([w, a]) => s.simulate(w, a as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      handoff: ([i, t]) => s.handoff(i as string, t as string),
      report: ([i, t, r]) => s.report(i as string, t as string, r as Parameters<typeof s.report>[2]),
      cancelPrepared: ([i, t]) => s.cancelPrepared(i as string, t as string),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
      refresh: ([i]) => s.refreshReview(i as string),
      invalidate: ([i]) => s.invalidate(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: lendingNeedsObservation,
  projector(name, bytes): Projection | null {
    // Only this flow's run logs; the shared namespace also holds Aave Supply runs and both flows' intents.
    if (!/^lending-[a-f0-9]{32}\.jsonl$/.test(name)) return null;
    const record = lastRecord<LendingRecord>(bytes), observe = lendingNeedsObservation(record), evidence = lendingEvidence(record);
    const open = record.attempts.find(a => !a.reconciled && !a.notSubmitted && OBSERVABLE.includes(a.state));
    return { run: { runId: record.id, workflowId: record.reviews[0]!.workflow.workflowId, flow: 'lending-composition', status: record.status,
      provenance: record.provenance, ownerAccount: record.reviews.at(-1)!.fields.owner.toLowerCase(), recoveryOf: record.recoveryOf ?? null,
      errorCode: errorCode(record.error), needsObservation: observe, hasEvidence: evidence !== null,
      attempts: record.attempts.map(a => ({ attemptId: a.id, step: a.step, state: a.state, nonce: a.nonce, transactionHash: a.hash?.toLowerCase() ?? null,
        preparedAtBlock: a.preparedAtBlock, reconciled: a.reconciled })),
      journal: journalRows(record.journal) },
    // SUBMITTING usually means the owner's wallet prompt is open: give the browser time to report first.
    work: work('lending-composition', record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
  },
  evidence: lendingEvidence,
};

/**
 * Stablecoin → Pix through the configured PaymentAdapter (`payment-flow-service.ts`). Channels only draft and quote; every run is
 * owned by the wallet that simulated it, the provider pays out only after the owner's own source transfer is verified on Base, and
 * settlement is recorded only with the provider's Pix proof. Index logs (`<payout id>.payment`) map a provider webhook to its run.
 */
const paymentRequest = (value: unknown) => isObject(value) && JSON.stringify(value).length <= 8_192;
const paymentEvidence = (value: unknown) => {
  const record = value as PaymentRecord;
  return record.evidence && record.state === 'PAYMENT_SETTLED' ? { bundleHash: record.evidence.bundleHash, environment: record.provenance, outcome: record.state,
    bytes: new TextEncoder().encode(JSON.stringify(record.evidence)) } : null;
};
const pixPayment: FlowDefinition = {
  name: 'pix-payment', busyCode: 'PAYMENT_BUSY', runId: PAYMENT_RUN_ID, unavailableCode: 'PAYMENT_SERVICE_UNAVAILABLE',
  methods: {
    info: { mutates: false, validate: shape() },
    simulate: { mutates: true, validate: shape(paymentRequest, account) },
    review: { mutates: true, validate: shape(id(PAYMENT_RUN_ID), commitment) },
    invalidate: { mutates: true, validate: shape(id(PAYMENT_RUN_ID)) },
    begin: { mutates: true, validate: shape(id(PAYMENT_RUN_ID), account) },
    handoff: { mutates: true, validate: shape(id(PAYMENT_RUN_ID)) },
    report: { mutates: true, validate: shape(id(PAYMENT_RUN_ID), result) },
    observe: { mutates: true, validate: shape(id(PAYMENT_RUN_ID)) },
    status: { mutates: false, validate: shape(id(PAYMENT_RUN_ID)) },
  },
  transport: (_mode, env) => ({ rpc: paymentRuntime(env).rpc }),
  create(storage, { rpc, env }) {
    // The runtime's gates (provider configuration, provenance, owner-execution opt-in) apply; the read client may be a test substitute.
    const runtime = paymentRuntime(env);
    const s = createPaymentFlowService({ storage, rpc, adapters: runtime.adapters, provenance: runtime.provenance, executionEnabled: runtime.executionEnabled });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      simulate: ([r, a]) => s.simulate(r as Parameters<typeof s.simulate>[0], a as string),
      review: ([i, c]) => s.review(i as string, c as string),
      invalidate: ([i]) => s.invalidate(i as string),
      begin: ([i, a]) => s.begin(i as string, a as string),
      handoff: ([i]) => s.handoff(i as string),
      report: ([i, r]) => s.report(i as string, r as PaymentWalletResult),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: paymentNeedsObservation,
  projector(logName, bytes): Projection | null {
    if (!logName.endsWith('.jsonl')) return null;
    const record = lastRecord<PaymentRecord>(bytes), observe = paymentNeedsObservation(record), evidence = paymentEvidence(record);
    return { run: { runId: record.id, workflowId: record.id, flow: 'pix-payment', status: record.state,
      // The run log keeps the exact label; a provider sandbox is the valueless public-test class of the projection.
      provenance: record.provenance === 'PROVIDER_SANDBOX' ? 'PUBLIC_TESTNET' : record.provenance, ownerAccount: record.facts.owner.address, recoveryOf: null,
      errorCode: errorCode(record.error), needsObservation: observe, hasEvidence: evidence !== null,
      attempts: record.attempt ? [{ attemptId: `${record.id}.SOURCE`, step: 'SOURCE', state: record.attempt.state, nonce: null,
        transactionHash: record.attempt.transactionHash, preparedAtBlock: null, reconciled: record.state === 'PAYMENT_SETTLED' }] : [],
      journal: [] },
      // A Pix payout settles in seconds once paid out; the source transfer needs a few Base blocks first.
      work: work('pix-payment', record.id, observe, 15_000, evidence !== null) };
  },
  evidence: paymentEvidence,
  ownership: { policy: PAYMENT_OWNERSHIP, ownerOf: record => (record as PaymentRecord).facts.owner.address },
};

const QUANTITY_ARG = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/, RAW_TX = /^0x02(?:[0-9a-f]{2}){1,131072}$/, DATA_ARG = /^0x(?:[0-9a-f]{2}){0,131072}$/;
const NUMBER_ARG = /^(?:0x[0-9a-f]{1,64}|0|[1-9][0-9]{0,77})$/;
const chainIdArg = (value: unknown) => typeof value === 'string' && QUANTITY_ARG.test(value);
const expectedTx = (value: unknown) => isObject(value) && Object.keys(value).length === 9 && typeof value.hash === 'string' && HASH.test(value.hash)
  && ['from', 'to'].every(key => typeof value[key] === 'string' && ACCOUNT.test(value[key] as string)) && typeof value.data === 'string' && DATA_ARG.test(value.data)
  && ['value', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(key => typeof value[key] === 'string' && NUMBER_ARG.test(value[key] as string));
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's EVM network side on hosted deployments (spec §4). The product server action has already
 * verified the account session, re-resolved the reviewed attempt through its own flow and checked the owner is a managed wallet of that
 * account; this flow re-checks the signed bytes against those exact fields and the network's own gates (`GRYLOO_<NET>_MAINNET`, and
 * `GRYLOO_<NET>_OWNER_EXECUTION` for a broadcast) and sends at most once. It keeps no runs: nothing to project, observe or archive.
 */
const managedWalletEvm: FlowDefinition = {
  name: 'managed-wallet-evm', busyCode: 'MANAGED_WALLET_EVM_BUSY', runId: /(?!)/, unavailableCode: 'FLOFI_WALLET_NETWORK_READ_FAILED',
  methods: {
    pendingNonce: { mutates: false, validate: shape(chainIdArg, account) },
    fees: { mutates: false, validate: shape(chainIdArg) },
    broadcast: { mutates: true, validate: shape(chainIdArg, value => typeof value === 'string' && RAW_TX.test(value), expectedTx) },
  },
  transport: () => ({ rpc: networkNotEnabled('FLOFI_WALLET_NETWORK_UNSUPPORTED') }),
  create(_storage, { env }) {
    // Each catalog network keeps its own gate; a hosted deployment never talks to a loopback harness.
    const s = createManagedWalletEvm({ env, mode: network => { const mode = network.mode(env); return mode === 'harness' && isHostedDeployment(env) ? 'off' : mode; } });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      pendingNonce: ([chain, address]) => s.pendingNonce(chain, address),
      fees: ([chain]) => s.fees(chain),
      broadcast: ([chain, raw, expected]) => s.broadcast(chain, raw, expected as ManagedEvmExpected),
    };
    const none = async () => { throw new Error('MANAGED_WALLET_EVM_HAS_NO_RUNS'); };
    return { call: (method, args) => table[method]!(args), load: none, observe: none };
  },
  needsObservation: () => false,
  projector: () => null,
  evidence: () => null,
};

export const FLOWS: Readonly<Record<FlowName, FlowDefinition>> = Object.freeze({ 'robinhood-transfer': robinhood, 'aave-supply': supply, 'base-sepolia-swap': swap,
  'solana-devnet-swap': solanaDevnetSwap, 'orca-liquidity': orcaLiquidity, 'jupiter-swap': jupiterSwap, 'uniswap-liquidity': uniswapLiquidity,
  'orca-liquidity-mainnet': orcaLiquidityFlow('orca-liquidity-mainnet', ORCA_WHIRLPOOLS_MAINNET_LIQUIDITY),
  'crosschain-router': crosschainRouter, 'crosschain-router-testnet': crosschainRouterTestnet, 'lending-composition': lendingComposition,
  'pix-payment': pixPayment, 'robinhood-swap': robinhoodSwap, 'robinhood-mainnet-transfer': robinhoodMainnetTransfer, 'robinhood-liquidity': robinhoodLiquidity,
  'crosschain-router-base-to-robinhood': routerFlow('crosschain-router-base-to-robinhood', 'base-to-robinhood'),
  'crosschain-router-robinhood-to-base': routerFlow('crosschain-router-robinhood-to-base', 'robinhood-to-base'),
  'crosschain-router-arbitrum-to-robinhood': routerFlow('crosschain-router-arbitrum-to-robinhood', 'arbitrum-to-robinhood'),
  'crosschain-router-robinhood-to-arbitrum': routerFlow('crosschain-router-robinhood-to-arbitrum', 'robinhood-to-arbitrum'),
  'ethereum-swap': ethereumSwap, 'ethereum-mainnet-transfer': ethereumMainnetTransfer, 'ethereum-liquidity': ethereumLiquidity, 'ethereum-aave': ethereumAave,
  'arbitrum-swap': arbitrumSwap, 'arbitrum-mainnet-transfer': arbitrumMainnetTransfer, 'arbitrum-liquidity': arbitrumLiquidity,
  'base-swap': baseSwap, 'base-mainnet-transfer': baseMainnetTransfer, 'base-liquidity': baseLiquidity, 'base-aave': baseAave, 'arbitrum-aave': arbitrumAave,
  'crosschain-router-ethereum-to-base': routerFlow('crosschain-router-ethereum-to-base', 'ethereum-to-base'),
  'crosschain-router-base-to-ethereum': routerFlow('crosschain-router-base-to-ethereum', 'base-to-ethereum'),
  'crosschain-router-ethereum-to-arbitrum': routerFlow('crosschain-router-ethereum-to-arbitrum', 'ethereum-to-arbitrum'),
  'crosschain-router-arbitrum-to-ethereum': routerFlow('crosschain-router-arbitrum-to-ethereum', 'arbitrum-to-ethereum'),
  'crosschain-router-ethereum-to-robinhood': routerFlow('crosschain-router-ethereum-to-robinhood', 'ethereum-to-robinhood'),
  'crosschain-router-robinhood-to-ethereum': routerFlow('crosschain-router-robinhood-to-ethereum', 'robinhood-to-ethereum'),
  'crosschain-router-arbitrum-to-base': routerFlow('crosschain-router-arbitrum-to-base', 'arbitrum-to-base'), 'solana-devnet-composition': solanaComposition,
  'solana-transfer': solanaTransferFlow('solana-transfer', SOLANA_MAINNET_TRANSFER), 'solana-devnet-transfer': solanaTransferFlow('solana-devnet-transfer', SOLANA_DEVNET_TRANSFER),
  'crosschain-universal': crosschainUniversal, 'managed-wallet-evm': managedWalletEvm });
export const isFlowName = (value: string): value is FlowName => Object.hasOwn(FLOWS, value);

/**
 * Backend enablement is explicit per flow and independent of NODE_ENV (a deployed backend is never in
 * development mode). The MOCKED loopback harness takes precedence so automated tests can never reach a
 * public network. BUILD-CLOUD-PARITY-001: a hosted deployment (Vercel, Railway) never talks to a loopback harness; a harness
 * gate set there by mistake leaves the flow off instead of pointing it at 127.0.0.1.
 */
export function flowMode(flow: FlowName, env: Readonly<Record<string, string | undefined>>): FlowMode {
  const mode = configuredFlowMode(flow, env);
  return mode === 'harness' && isHostedDeployment(env) ? 'off' : mode;
}
function configuredFlowMode(flow: FlowName, env: Readonly<Record<string, string | undefined>>): FlowMode {
  // The existing public-swap gate value; in the separately deployed backend it does not also require NODE_ENV=development.
  if (flow === 'base-sepolia-swap') return env.GRYLOO_PUBLIC_TESTNET === 'record' ? 'live' : 'off';
  // Solana Devnet (valueless test tokens): explicit backend enablement; the MOCKED loopback harness wins.
  if (flow === 'solana-devnet-swap' || flow === 'orca-liquidity' || flow === 'solana-devnet-composition')
    return env.GRYLOO_SOLANA_DEVNET_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_SOLANA_DEVNET === 'live' ? 'live' : 'off';
  // BUILD-SOLANA-TRANSFER-UX-001: Solana transfers. Mainnet-beta: `GRYLOO_SOLANA_TRANSFER=live` enables read-only Simulate/Review; real-funds execution
  // additionally needs GRYLOO_SOLANA_TRANSFER_OWNER_EXECUTION. Devnet: the existing Devnet enablement. The MOCKED loopback harness wins.
  if (flow === 'solana-transfer') return env.GRYLOO_SOLANA_TRANSFER_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_SOLANA_TRANSFER === 'live' ? 'live' : 'off';
  if (flow === 'solana-devnet-transfer')
    return env.GRYLOO_SOLANA_TRANSFER_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_SOLANA_DEVNET === 'live' ? 'live' : 'off';
  // Jupiter mainnet-beta: `live` enables read-only Simulate/Review; real-funds execution additionally needs GRYLOO_JUPITER_OWNER_EXECUTION.
  if (flow === 'jupiter-swap') return env.GRYLOO_JUPITER_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_JUPITER === 'live' ? 'live' : 'off';
  // BUILD-SOLANA-MAINNET-001 Orca mainnet-beta liquidity: `live` enables read-only Simulate/Review; real-funds execution additionally needs
  // GRYLOO_ORCA_MAINNET_OWNER_EXECUTION. The MOCKED loopback harness wins.
  if (flow === 'orca-liquidity-mainnet') return env.GRYLOO_ORCA_MAINNET_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_ORCA_MAINNET === 'live' ? 'live' : 'off';
  // Base Sepolia Uniswap v3 liquidity (test tokens): explicit backend enablement; the MOCKED loopback harness wins.
  if (flow === 'uniswap-liquidity')
    return env.GRYLOO_UNISWAP_LIQUIDITY_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_UNISWAP_LIQUIDITY_TESTNET === 'live' ? 'live' : 'off';
  // Cross-chain Router on Base mainnet / Arbitrum One: `live` enables read-only quotes, simulation and Review; owner execution
  // additionally needs GRYLOO_ROUTER_OWNER_EXECUTION. The MOCKED loopback harness wins.
  if (flow === 'crosschain-router') return routerNetworkMode('mainnet', env);
  // BUILD-JOURNEY-001: the same router on Base Sepolia → Arbitrum Sepolia (test USDC); the MOCKED loopback harness wins.
  if (flow === 'crosschain-router-testnet') return routerNetworkMode('testnet', env);
  // BUILD-013 lending composition: part of the Aave family's explicit enablement; its own MOCKED loopback harness wins.
  if (flow === 'lending-composition') return env.GRYLOO_LENDING_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_SUPPLY_TESTNET === 'live' ? 'live' : 'off';
  // Stablecoin → Pix: `GRYLOO_PAYMENT=live`; begin additionally needs the provider's production environment and the owner-execution opt-in.
  if (flow === 'pix-payment') return paymentMode(env);
  // BUILD-RH-002 Robinhood Chain mainnet: `GRYLOO_ROBINHOOD_MAINNET=live` enables the catalog, quotes, simulation and Review;
  // owner execution additionally needs GRYLOO_ROBINHOOD_OWNER_EXECUTION. The MOCKED loopback harness wins.
  if (flow === 'robinhood-swap' || flow === 'robinhood-mainnet-transfer' || flow === 'robinhood-liquidity') return CATALOG_NETWORKS.robinhood.mode(env);
  // BUILD-RH-002 Robinhood Chain router routes: the Robinhood mainnet gates (real funds), the MOCKED loopback harness wins.
  if (flow.startsWith('crosschain-router-') && flow.includes('robinhood')) return routerNetworkMode(flow.slice('crosschain-router-'.length) as RouterNetwork, env);
  // BUILD-BASE-001 Base mainnet: `GRYLOO_BASE_MAINNET=live` enables the catalog, quotes, simulation and Review; owner execution additionally
  // needs GRYLOO_BASE_OWNER_EXECUTION. The MOCKED loopback harness wins. Arbitrum One → Base is the Router's own route and gates.
  if (flow === 'ethereum-swap' || flow === 'ethereum-mainnet-transfer' || flow === 'ethereum-liquidity' || flow === 'ethereum-aave') return CATALOG_NETWORKS.ethereum.mode(env);
  if (flow === 'arbitrum-swap' || flow === 'arbitrum-mainnet-transfer' || flow === 'arbitrum-liquidity' || flow === 'arbitrum-aave') return CATALOG_NETWORKS['arbitrum-one'].mode(env);
  if (flow === 'base-swap' || flow === 'base-mainnet-transfer' || flow === 'base-liquidity' || flow === 'base-aave') return CATALOG_NETWORKS.base.mode(env);
  if (flow === 'crosschain-router-ethereum-to-base') return routerNetworkMode('ethereum-to-base', env);
  if (flow === 'crosschain-router-base-to-ethereum') return routerNetworkMode('base-to-ethereum', env);
  if (flow === 'crosschain-router-ethereum-to-arbitrum') return routerNetworkMode('ethereum-to-arbitrum', env);
  if (flow === 'crosschain-router-arbitrum-to-ethereum') return routerNetworkMode('arbitrum-to-ethereum', env);
  if (flow === 'crosschain-router-ethereum-to-robinhood') return routerNetworkMode('ethereum-to-robinhood', env);
  if (flow === 'crosschain-router-robinhood-to-ethereum') return routerNetworkMode('robinhood-to-ethereum', env);
  if (flow === 'crosschain-router-arbitrum-to-base') return routerNetworkMode('arbitrum-to-base', env);
  // BUILD-CROSSCHAIN-UNIVERSAL-001: `GRYLOO_UNIVERSAL_ROUTER=live` (read-only), owner execution additionally needs its real-funds opt-in; the harness wins.
  if (flow === 'crosschain-universal') return universalRouterMode(env);
  // BUILD-FLOFI-AUTH-WALLETS-001: on wherever a catalog mainnet is (each call re-checks its own network's gates).
  if (flow === 'managed-wallet-evm') {
    const modes = Object.values(CATALOG_NETWORKS).map(network => network.mode(env));
    return modes.includes('harness') ? 'harness' : modes.includes('live') ? 'live' : 'off';
  }
  if (flow === 'robinhood-transfer') {
    if (env.GRYLOO_ROBINHOOD_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
    return env.GRYLOO_ROBINHOOD_TESTNET === 'live' || env.GRYLOO_ETHEREUM_SEPOLIA_TRANSFER === 'live' ? 'live' : 'off';
  }
  if (env.GRYLOO_SUPPLY_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_SUPPLY_TESTNET === 'live' ? 'live' : 'off';
}
const DISABLED: Readonly<Record<FlowName, string>> = { 'robinhood-transfer': 'TRANSFER_PUBLIC_TESTNET_NOT_ENABLED', 'aave-supply': 'SUPPLY_PUBLIC_TESTNET_NOT_ENABLED',
  'base-sepolia-swap': 'PUBLIC_RECORDING_OFF', 'solana-devnet-swap': 'DEVNET_SWAP_PUBLIC_DEVNET_NOT_ENABLED', 'orca-liquidity': 'ORCA_LIQUIDITY_PUBLIC_DEVNET_NOT_ENABLED',
  'jupiter-swap': 'JUPITER_PUBLIC_MAINNET_NOT_ENABLED', 'uniswap-liquidity': 'UNISWAP_LIQUIDITY_PUBLIC_TESTNET_NOT_ENABLED', 'orca-liquidity-mainnet': 'ORCA_LIQUIDITY_PUBLIC_MAINNET_NOT_ENABLED',
  'crosschain-router': 'ROUTER_NOT_ENABLED', 'crosschain-router-testnet': 'ROUTER_TESTNET_NOT_ENABLED', 'lending-composition': 'LENDING_PUBLIC_TESTNET_NOT_ENABLED',
  'pix-payment': 'PAYMENT_NOT_ENABLED', 'robinhood-swap': 'ROBINHOOD_MAINNET_NOT_ENABLED', 'robinhood-mainnet-transfer': 'ROBINHOOD_MAINNET_NOT_ENABLED',
  'robinhood-liquidity': 'ROBINHOOD_MAINNET_NOT_ENABLED',
  'crosschain-router-base-to-robinhood': 'ROBINHOOD_MAINNET_NOT_ENABLED', 'crosschain-router-robinhood-to-base': 'ROBINHOOD_MAINNET_NOT_ENABLED',
  'crosschain-router-arbitrum-to-robinhood': 'ROBINHOOD_MAINNET_NOT_ENABLED', 'crosschain-router-robinhood-to-arbitrum': 'ROBINHOOD_MAINNET_NOT_ENABLED',
  'ethereum-swap': 'ETHEREUM_MAINNET_NOT_ENABLED', 'ethereum-mainnet-transfer': 'ETHEREUM_MAINNET_NOT_ENABLED', 'ethereum-liquidity': 'ETHEREUM_MAINNET_NOT_ENABLED', 'ethereum-aave': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'arbitrum-swap': 'ARBITRUM_MAINNET_NOT_ENABLED', 'arbitrum-mainnet-transfer': 'ARBITRUM_MAINNET_NOT_ENABLED', 'arbitrum-liquidity': 'ARBITRUM_MAINNET_NOT_ENABLED',
  'base-swap': 'BASE_MAINNET_NOT_ENABLED', 'base-mainnet-transfer': 'BASE_MAINNET_NOT_ENABLED', 'base-liquidity': 'BASE_MAINNET_NOT_ENABLED',
  'crosschain-router-ethereum-to-base': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'crosschain-router-base-to-ethereum': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'crosschain-router-ethereum-to-arbitrum': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'crosschain-router-arbitrum-to-ethereum': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'crosschain-router-ethereum-to-robinhood': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'crosschain-router-robinhood-to-ethereum': 'ETHEREUM_MAINNET_NOT_ENABLED',
  'base-aave': 'BASE_MAINNET_NOT_ENABLED', 'arbitrum-aave': 'ARBITRUM_MAINNET_NOT_ENABLED', 'crosschain-router-arbitrum-to-base': 'ROUTER_NOT_ENABLED',
  'solana-devnet-composition': 'SOLANA_COMPOSITION_PUBLIC_DEVNET_NOT_ENABLED',
  'solana-transfer': 'SOLANA_TRANSFER_PUBLIC_MAINNET_NOT_ENABLED', 'solana-devnet-transfer': 'SOLANA_TRANSFER_PUBLIC_DEVNET_NOT_ENABLED',
  'crosschain-universal': 'UNIVERSAL_ROUTER_NOT_ENABLED', 'managed-wallet-evm': 'FLOFI_WALLET_NETWORK_UNSUPPORTED' };
export const disabledCode = (flow: FlowName) => DISABLED[flow];
