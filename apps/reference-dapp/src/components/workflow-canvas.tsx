// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import Image from 'next/image';
import type { WalletEnvironment } from '../wallet/environment';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import {lendingDetails,lendingCanvasEdges} from '../domain/lending-authoring';
import {useBuild009Wallet} from '../state/build009-wallet-store';
import { transferCardLabel, transferDetails } from '../domain/robinhood-transfer-authoring';
import { checkRecipient, recipientPolicy } from '../domain/recipient-address';
import { lendingAmountLabel } from '../domain/supply-authoring';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, getNodesBounds, Background, Handle, Position, useNodesInitialized, useNodesState, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals, type Node, type NodeChange, type NodeProps, type ReactFlowState, type FinalConnectionState, MarkerType } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import { bridgeDetails } from '../domain/bridge-authoring';
import { directions, inputSymbol, outputSymbol, formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { solanaSwapDetails, solanaSwapLabels } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { uniswapLiquidityDetails } from '../domain/uniswap-liquidity-authoring';
import { routerChainChoices, routerDetails, routerNetworkOfInput, routerTokensOf, ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL } from '../domain/router-authoring';
import { useWorkflow } from '../state/workflow-store';
import { editorReducer, resolveCanvasRemoval } from '../domain/editor';
import { checkConnection, connectionEnd, handleHitScale } from '../domain/canvas-connect';
import { CANVAS_ACTIONS, canvasAddCommand, type CanvasAction } from '../domain/canvas-authoring';
import { activeNetworkScope, isTestNetwork, mainnetCounterpart, testNetworkTemplate, workflowTestNetworks } from '../domain/network-scope';
import { walletChainRef } from '../wallet/evm-networks';
import { shellChainLabel } from '../domain/product-shell';
import { WorkflowName } from './workflow-name';
import { DarkSpotlight } from './dark-spotlight';
import { CANVAS_GESTURES, CanvasNavigator } from './canvas-navigator';
import { PanelRevealer, PanelRevealProvider } from './canvas-panel-reveal';
import { WorkflowEditReview, workflowEditProposalVisible } from './workflow-edit-review';
import { ComposerCard, supplyReviewFormId, poolReviewFormId, poolProposalTarget, type CardRecipient, type ComposerCardData } from './composer-card';
import { canEditCanvasAmount, canvasAmountCommand, setupSummary, bridgePairLabel, bridgeSetupNetworks, invertCanvasBridgeNetworks, type CanvasBridgeNetworks, universalCanvasNetworks } from '../domain/canvas-action-setup';
import { universalCanvasPair, universalKeyOfCanvasLabel, universalFeaturedAssets, universalBridgeDetails, resolveUniversalAsset, defaultUniversalInputAsset, UNIVERSAL_CANVAS_LABEL } from '../domain/universal-bridge-authoring';
import { ActionIcon } from './action-icon';
import { ensureNetworkCatalog, useNetworkCatalog } from '../state/asset-catalog-store';
import { CATALOG_NETWORK_IDENTITIES } from '../domain/network-registry';
import { counterpartSelection, invertCryptoSelection, cryptoNetworks, cryptoSelectionOf, cryptoProfile, cryptoTokenOptions, selectCryptoNetwork, selectCryptoToken, canSelectCryptoAssets, type CryptoSelection, type CryptoAction } from '../domain/crypto-action-picker';
import { actionReviewValue } from '../domain/canvas-action-setup';
import { SimulateWorkflowCanvas } from './simulate-workflow-canvas';
import { composerActions, composerSummary, composerNodeState, composerConnections, singleAmountProposalTarget } from '../domain/composer-presentation';
import { canDeleteCanvasEdge, canDeleteCanvasNode, isTextEntry } from '../domain/canvas-keyboard';
import { canvasPosition, defaultCanvasPosition, readToolboxMode, saveToolboxMode, type ToolboxMode } from '../domain/canvas-layout';
import { canvasMarquee, marqueeIntersects } from '../domain/canvas-marquee';
import { planCanvasDuplicate } from '../domain/editor-history';
import type { Workflow } from '../domain/initial-workflow';
import { canvasViewportFor, canvasViewportSignature, SIMULATION_VIEWPORT, type CanvasViewportInputs } from '../domain/mode-a';

export type CrossChainRuntimeStatus = 'Completed' | 'Failed' | 'Recovery required' | 'Pending';
const crossChainRuntime = new Map<string, Readonly<Record<string, CrossChainRuntimeStatus>>>();
export function setCrossChainCanvasRuntime(workflowId: string, revision: number, statuses: Readonly<Record<string, CrossChainRuntimeStatus>>) {
  const key = `${workflowId}:${revision}`;
  crossChainRuntime.set(key, statuses);
  window.dispatchEvent(new CustomEvent('gryloo:cross-chain-runtime', { detail: key }));
}
export type SimulationOverlay = { readonly symbol: Symbol; readonly expected: string; readonly minimum: string };
/** `solana`/`solanaKind`/`solanaProvider` mark a live-provider runtime card (Solana runtimes and the Base Sepolia Uniswap position). */
type CardData = { overview?: boolean; lending?: boolean; title: string; amount: string; runtime?: CrossChainRuntimeStatus; locked: boolean; selected: boolean; supply: boolean; chain?: string; risk?: string; swap: boolean; solana?: boolean; solanaKind?: string; solanaProvider?: string; bridge: boolean; liquidity: boolean; composition: boolean; bridgeSwap: boolean; across: boolean; crossChain: boolean; preparation: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const { t: tr } = useLocale();
  if (data.composer) return <ComposerCard data={data as ComposerCardData}/>;
  const card = data as CardData;
  if (card.overview) return <div className="flow-card">
    <Handle type="target" position={card.lending ? Position.Top : Position.Left} isConnectable={false}/>
    <span className="flow-card-kind">{tr(card.chain)}{tr(card.supply ? ' · AAVE V3' : card.solanaProvider ? ` · ${card.solanaProvider}` : '')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    {card.risk && <span className="flow-card-risk">{tr(card.risk)}</span>}
    <Handle type="source" position={card.lending ? Position.Bottom : Position.Right} isConnectable={false}/>
  </div>;
  if(card.lending)return <div className={`flow-card ${card.selected?'active':''}`}>
    <Handle type="target" position={Position.Top} isConnectable={false}/>
    <span className="flow-card-kind">{tr("BASE SEPOLIA · ")}{tr(card.swap?'UNISWAP V3':'AAVE V3')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    <small>{tr(card.swap?'Borrowed USDC flows into Swap':'Select to edit · simulate before review')}</small>
    <Handle type="source" position={Position.Bottom} isConnectable={false}/>
  </div>;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {((card.bridgeSwap && card.swap) || (!card.swap && !card.bridge && (!card.liquidity || card.composition))) && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : 'ARBITRUM · COMPOSED STEP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE ROUTE' : 'ARBITRUM · DESTINATION SWAP') : card.bridge ? 'BASE → OPTIMISM · BRIDGE ROUTE' : card.liquidity ? 'BASE · LIQUIDITY UNOBSERVED' : card.solana ? card.solanaKind ?? 'SOLANA' : card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION')}</span>
      <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>{tr("Expected ")}{tr(card.simulate.expected)}</span><span className="mocked-tag">{tr("MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>{tr("Minimum ")}{tr(card.simulate.minimum)}</span><span className="mocked-tag">{tr("MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></span>
      </> : <small>{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? 'MOCKED composed simulation · actual outputs require reconciliation' : card.across ? 'Direct Across quote in bridge review' : card.bridge ? 'Live LI.FI route in bridge review' : card.liquidity ? 'Use the isolated fork liquidity simulation' : card.solana ? `Live ${card.solanaProvider ?? ''} quote in Simulate` : card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)')}</small>}
      {((card.bridgeSwap && card.bridge) || (!card.liquidity && !card.bridge && (!card.swap || card.composition))) && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={!card.composition && !card.supply} />
    <span className="flow-card-kind">{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : card.preparation ? 'ARBITRUM · CALCULATED SPLIT' : card.liquidity ? 'ARBITRUM · UNISWAP V3' : 'ARBITRUM · DESTINATION SWAP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · UNQUOTED BRIDGE' : 'ARBITRUM · UNQUOTED SWAP') : card.bridge ? 'BASE → OPTIMISM · UNQUOTED BRIDGE' : card.composition && card.liquidity ? 'BASE · POSITION' : card.liquidity ? 'BASE · UNQUOTED POSITION' : card.solana ? card.solanaKind ?? 'SOLANA' : card.swap ? `${card.chain ?? 'Base'} · SWAP` : 'WORKFLOW ACTION')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    <small>{tr(card.supply ? 'Select to edit · simulate before review' : card.crossChain && card.runtime ? `Runtime: ${card.runtime}` : card.crossChain ? 'Select to review · non-atomic boundaries' : card.across ? 'Review route availability in Simulate' : card.bridge ? 'Review the route in Simulate' : card.composition && card.liquidity ? 'Receives the linked WETH output' : card.liquidity ? 'Select to configure the position' : card.solana ? 'Select to edit · simulate for a live quote' : card.swap ? 'Select to edit · simulate before review' : card.locked ? 'Amount locked' : 'Select to configure')}</small>
    {card.risk && <span className="flow-card-risk">{tr(card.risk)}</span>}
    <Handle type="source" position={Position.Right} isConnectable={!card.composition && !card.supply} />
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };
const COMPOSER_FIT_PADDING = { top: '32px', bottom: '90px', left: '32px', right: '32px' } as const;
/** One fit per canonical insertion, after React Flow has measured the committed nodes.
 * Draft proposals, parameter edits, connections and layout changes cannot arm it.
 */
function InsertionViewport({ workflowId, ids }: { workflowId: string; ids: readonly string[] }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const store = useStoreApi();
  const measured = useStore((state: ReactFlowState) => ids.every(id => {
    const node = state.nodeLookup.get(id);
    return Boolean(node?.measured.width && node.measured.height);
  }));
  const previous = useRef<{ workflowId: string; ids: readonly string[] }>({ workflowId, ids: [] });
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (previous.current.workflowId !== workflowId || ids.some(id => !previous.current.ids.includes(id))) pending.current = true;
    previous.current = { workflowId, ids };
    // Controlled projections may be one render behind their canonical draft.
    if (!pending.current || !ids.length || !initialized || !measured || !ids.every(id => store.getState().nodeLookup.has(id))) return;
    pending.current = false;
    const state = store.getState();
    const bounds = getNodesBounds(ids.map(id => state.nodeLookup.get(id)!));
    const [x, y, zoom] = state.transform;
    // Keep a comfortable manual viewport when every current card already fits.
    if (x + bounds.x * zoom >= 32 && y + bounds.y * zoom >= 32 &&
        x + (bounds.x + bounds.width) * zoom <= state.width - 32 &&
        y + (bounds.y + bounds.height) * zoom <= state.height - 90) return;
    void fitView({ nodes: ids.map(id => ({ id })), padding: COMPOSER_FIT_PADDING, minZoom: 0.35, maxZoom: 1.1, duration: 180 });
  }, [workflowId, ids, initialized, measured, fitView, store]);
  return null;
}
/** BUILD-FLOFI-MAINNET-PRODUCT-001: `lending` (Supply → Borrow → Swap) exists only on Base Sepolia, so the Mainnet-only product does not offer it. */
const actions = [...CANVAS_ACTIONS, 'stocks'] as const;
/** BUILD-SOLANA-MAINNET-001: the owner is told about every linked step a deletion also removed; undo restores them. */
const removalFeedback = (count: number) => count === 1 ? 'Also removed 1 linked step that cannot run without the deleted one. Undo restores it.'
  : 'Also removed the linked steps that cannot run without the deleted one. Undo restores them.';
// UX-005: the canonical transfer action is presented as Send; its action id and IR stay `transfer` / `asset.transfer`.
function actionLabel(action: typeof actions[number]) { return action === 'lending' ? 'Lending' : action === 'pool' ? 'Pool / Liquidity' : action === 'transfer' ? 'Send' : action[0]!.toUpperCase() + action.slice(1); }
function HistoryIcon({ direction }: { direction: 'undo' | 'redo' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === 'undo' ? <><path d="m10 8-4 4 4 4"/><path d="M6 12h9a5 5 0 0 1 0 10"/></>
      : <><path d="m14 8 4 4-4 4"/><path d="M18 12H9a5 5 0 0 0 0 10"/></>}
  </svg>;
}
function DuplicateIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
  </svg>;
}
function DockIcon({ floating }: { floating: boolean }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
    {floating ? <path d="M10 14h4v-4m0 4-4-4"/> : <path d="M14 10h-4v4m0-4 4 4"/>}
  </svg>;
}

/** BUILD-FIX-UX-001: keeps the connection handles' hit area usable when zoomed out (see `handleHitScale`); presentation only. */
function HandleHitArea() {
  const zoom = useStore((state: ReactFlowState) => state.transform[2]), dom = useStore((state: ReactFlowState) => state.domNode);
  useEffect(() => { dom?.style.setProperty('--canvas-handle-scale', String(handleHitScale(zoom))); }, [dom, zoom]);
  return null;
}
type ViewportState = 'pending' | 'fitted';
function viewportInputs(state: ReactFlowState): CanvasViewportInputs {
  const nodes = [...state.nodeLookup.values()].filter(node => !node.hidden && !node.parentId).map(node => ({
    id: node.id, x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y,
    width: node.measured.width, height: node.measured.height,
  }));
  return { paneWidth: state.width, paneHeight: state.height, nodes };
}

/**
 * Applies the fitted viewport whenever the pane size, node set or any measured
 * node size changes, so the final viewport depends only on the final layout
 * (BUILD-003D §3.16). React Flow is asked to remeasure a node if its
 * first ResizeObserver notification is missed.
 */
function SimulationViewport({ onState }: { onState: (state: ViewportState) => void }) {
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const ready = useStore((state: ReactFlowState) => state.panZoom !== null);
  const signature = useStore((state: ReactFlowState) => canvasViewportSignature(viewportInputs(state)));
  const applied = useRef<string | null>(null);
  const requestedMeasurement = useRef<string | null>(null);
  useLayoutEffect(() => {
    const inputs = viewportInputs(store.getState());
    const viewport = ready ? canvasViewportFor(inputs) : null;
    if (!viewport) {
      applied.current = null;
      onState('pending');
      if (ready && inputs.paneWidth > 0 && inputs.paneHeight > 0 && requestedMeasurement.current !== signature) {
        requestedMeasurement.current = signature;
        updateNodeInternals(inputs.nodes.filter(node => !node.width || !node.height).map(node => node.id));
      }
      return;
    }
    requestedMeasurement.current = null;
    if (applied.current !== signature) {
      void setViewport(viewport, { duration: 0 });
      applied.current = signature;
    }
    onState('fitted');
  }, [ready, signature, store, setViewport, updateNodeInternals, onState]);
  return null;
}

/** Read-only IR projection. Execute overview supplies no outputs or execution state. */
function ReadonlyWorkflowCanvas({ mode, workflowName, overlay, primaryAction }: { mode: 'simulate' | 'execute'; workflowName: string; overlay: ReadonlyMap<string, SimulationOverlay>; primaryAction?: ReactNode }) {
  const { t: tr } = useLocale();
  const { state, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => composerActions(workflow).map((node, index) => {
    const lending=isLendingComposition(workflow)?lendingDetails(workflow):null;
    const swap = lending?null:swapDetails(node, context);
    const solana = solanaSwapDetails(node);
    const orcaPosition = solanaLiquidityDetails(node);
    const uniPosition = uniswapLiquidityDetails(node);
    const routed = routerDetails(node);
    const bridge = bridgeDetails(node);
    const bridgeSwap = workflow.nodes[0]?.nodeId === 'build009-bridge';
    const crossChain = workflow.nodes.some(item => item.actionType === 'asset.liquidity.prepare');
    const preparation = node.actionType === 'asset.liquidity.prepare';
    const crossBridge = crossChain && node.actionType === 'asset.bridge';
    const crossSwap = crossChain && node.actionType === 'asset.swap.exact-input';
    const across = node.adapterConstraints.adapters[0]?.id === 'across.direct';
    const composition = workflow.resourceEdges.length === 1 && (node.requiredAuthorizationClass === 'MODE_B' || bridgeSwap);
    const isLiquidity = node.actionType === 'asset.liquidity.uniswap-v3';
    const lower = node.inputs.find(i => i.name === 'tick-lower');
    const upper = node.inputs.find(i => i.name === 'tick-upper');
    const range = lower?.kind === 'IDENTIFIER' && upper?.kind === 'IDENTIFIER' ? `${lower.value.slice(5)}–${upper.value.slice(5)}` : 'unreviewed';
    const current = overlay.get(node.nodeId);
    const simulate = current ? {
      expected: `${formatHumanAmount(current.expected, current.symbol, context)} ${current.symbol}`,
      minimum: `${formatHumanAmount(current.minimum, current.symbol, context)} ${current.symbol}`,
    } : null;
    return { id: node.nodeId, type: 'workflow', position: lending?{x:180,y:35+index*230}:{ x: 60 + index * 280, y: 70 + (index % 2) * 40 },
      data: { chain: shellChainLabel(node.chainId), risk: node.actionType === 'borrow' ? 'Variable debt' : node.actionType === 'withdraw' ? 'Collateral change' : undefined, lending:Boolean(lending), title: lending?(node.nodeId==='lending-supply'?'Aave Supply':node.nodeId==='lending-borrow'?'Aave Borrow':'Uniswap Swap'):node.actionType==='asset.transfer'?'Self-transfer test ETH':lending&&node.actionType==='asset.swap.exact-input'?'Borrowed Aave USDC → WETH':node.actionType==='withdraw'?'Withdraw from Aave V3':node.actionType==='repay'?'Repay to Aave V3':node.actionType==='borrow'?'Borrow from Aave V3':node.actionType === 'supply' ? 'Supply to Aave V3' : crossChain ? (crossBridge ? 'Bridge USDC' : preparation ? 'Calculate destination split' : crossSwap ? 'Swap selected USDC for WETH' : 'Mint Uniswap v3 position') : routed ? (routed.network === 'testnet' ? 'Base Sepolia → Arbitrum Sepolia USDC' : 'Base → Arbitrum USDC') : across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : orcaPosition ? `SOL/${orcaPosition.tokenB} position` : uniPosition ? 'USDC/WETH v3 position' : solana ? `${solana.from} → ${solana.to}` : swap ? `${swap.from} → ${swap.to}` : node.actionType.startsWith('mock-') ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : node.actionType, amount: node.actionType==='asset.transfer'?transferCardLabel(node as Parameters<typeof transferCardLabel>[0]):lending?(node.actionType==='supply'?`${lending.supply} USDC collateral`:node.actionType==='borrow'?`${lending.borrow} USDC · HF checkpoint ≥ 2.0`:`Exactly ${lending.borrow} borrowed USDC`):['withdraw','repay','borrow','supply'].includes(node.actionType)?lendingAmountLabel(node as Parameters<typeof lendingAmountLabel>[0])??'' : crossChain ? (crossBridge ? 'Base USDC → Arbitrum USDC' : preparation ? 'Reconciled amount → range ratio' : crossSwap ? 'Calculated partial USDC input' : `Ticks ${range} · fee 500`) : routed ? `${routed.amount} USDC → ${routed.recipient ? routed.recipient.slice(0, 8) + '…' : 'your wallet'} · ${routed.slippage} bps` : bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : orcaPosition ? `${orcaPosition.lowerPrice}–${orcaPosition.upperPrice} ${orcaPosition.tokenB}/SOL · ${orcaPosition.network}` : uniPosition ? `${uniPosition.lowerPrice}–${uniPosition.upperPrice} USDC/WETH · ${uniPosition.network}` : solana ? `${solana.amount} ${solana.from} · ${solana.network} · ${solana.slippage} bps` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, supply: ['supply','borrow','repay','withdraw'].includes(node.actionType), swap: node.actionType === SWAP_ACTION, solana: Boolean(solana || orcaPosition || uniPosition || routed), solanaKind: solana ? solanaSwapLabels(solana.network).kind : orcaPosition ? `${orcaPosition.network.toUpperCase()} · ORCA` : uniPosition ? `${uniPosition.network.toUpperCase()} · UNISWAP V3` : routed ? (routed.network === 'testnet' ? 'TESTNET · BASE SEPOLIA → ARBITRUM SEPOLIA · CROSS-CHAIN ROUTER' : 'BASE → ARBITRUM · CROSS-CHAIN ROUTER') : undefined, solanaProvider: solana ? solanaSwapLabels(solana.network).provider : orcaPosition ? orcaPosition.provider : uniPosition ? uniPosition.provider : routed ? ROUTER_ROUTING_LABEL[routed.routing] : undefined, bridge: Boolean(bridge) || crossBridge, liquidity: isLiquidity, composition, bridgeSwap, across, crossChain, preparation, simulate },
    };
  }).map(node => mode === 'execute' ? { ...node, data: { ...node.data, overview: true } } : node), [workflow, overlay, context, mode]);
  const edges = useMemo(() => (lendingCanvasEdges(workflow)??workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: edge.outputId === 'swap-input' ? 'Calculated swap USDC' : edge.outputId === 'liquidity-usdc' ? 'Reserved liquidity USDC' : edge.outputId === 'liquidity-weth' ? 'Existing WETH' : edge.outputId === 'amount-out' && edge.inputName === 'amount0-max' ? 'Reconciled WETH output' : edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false,
  }))), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const bridges = workflow.nodes.filter(n => n.actionType === 'asset.bridge').length;
  const [viewportState, setViewportState] = useState<ViewportState>('pending');
  return <section className="canvas simulate-canvas panel" aria-label={tr(mode === 'execute' ? 'Workflow overview' : 'Mocked outputs graph')}>
    <div className="canvas-head"><div><h2>{workflowName}</h2></div><span className="revision">{tr(nodes.length)}{tr(" actions")}</span></div>
    <div className="flow-surface" role="region" aria-label={tr(mode === 'execute' ? 'Workflow overview graph' : 'Mocked outputs on the workflow graph')} data-viewport={viewportState}>
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={SIMULATION_VIEWPORT.minZoom} maxZoom={SIMULATION_VIEWPORT.maxZoom}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} {...CANVAS_GESTURES}>
        <SimulationViewport onState={setViewportState} />
        <Background gap={18} size={1} color="var(--grid)" /><CanvasNavigator/>
      </ReactFlow>
      {primaryAction && <div className="canvas-primary-action simulation-canvas-actions">{primaryAction}</div>}
    </div>
    <div className="canvas-foot">{mode === 'execute' ? <span>{tr("Workflow overview")}</span> : <><span>{tr(workflow.nodes.length - swaps - bridges)}{tr(" mock · ")}{tr(bridges ? `${bridges} bridge · ` : '')}{tr(swaps)} {tr(workflow.nodes[0]?.nodeId === 'build009-bridge' ? 'Arbitrum' : 'Base')}{tr(" swap ")}{tr(swaps === 1 ? 'node' : 'nodes')}</span><span>{tr("Read-only · MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></>}</div>
  </section>;
}

type BuildCanvasProps = { environment?: WalletEnvironment; selectedId: string | null; select: (id: string | null) => void; openSettings?: (id: string) => void;
  /** BUILD-FLOFI-CONVERSATIONAL-001: the card whose settings popover is open (its settings control reports it as expanded). */ settingsId?: string | null; workflowName?: string; renameWorkflow?: (name: string) => void; onSave?: () => void; estimateOwner?: string | undefined; onToolboxModeChange?: (mode: ToolboxMode) => void; primaryAction?: ReactNode;
  /** BUILD-AUTOMATION-002: present only where automations are enabled; opens Automations on this exact Canvas workflow. */
  onAutomate?: (() => void) | undefined };
const EMPTY_OVERLAY: ReadonlyMap<string, SimulationOverlay> = new Map();
export function WorkflowCanvas(props: BuildCanvasProps | { mode: 'simulate'; workflowName: string; overlay?: ReadonlyMap<string, SimulationOverlay>; primaryAction?: ReactNode } | { mode: 'execute'; workflowName: string }) {
  if ('mode' in props && props.mode === 'simulate') return <SimulateWorkflowCanvas workflowName={props.workflowName} primaryAction={props.primaryAction}/>;
  if ('mode' in props) return <ReadonlyWorkflowCanvas mode={props.mode} workflowName={props.workflowName} overlay={EMPTY_OVERLAY}/>;
  return <BuildCanvas {...props}/>;
}

function BuildCanvas({ environment, selectedId, select, openSettings, settingsId = null, workflowName = 'Your Workflow', renameWorkflow = () => {}, onSave, estimateOwner, onToolboxModeChange, primaryAction, onAutomate }: BuildCanvasProps) {
  const { t: tr } = useLocale();
  const { state, dispatch, context, canvasLayout, canUndo, canRedo, undo, redo, moveCanvasNodes, addCanvasCommand, duplicateCanvasNodes, propose, review,
    actionSetup = null, amountInputs = {}, bridgeNetworkInputs = {}, cryptoSelections = {}, recipientInputs = {}, editCanvasRecipient, editCryptoSelection, startActionSetup, startStocksSetup, editCanvasAmount, editSwapSetupDirection, editBridgeNetworks, cancelCanvasAmount, reviewCanvasAmount, commitCanvasAmount, removeActionSetup, pending, applyProposal, dismissProposal } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const wallet=useBuild009Wallet();
  // BUILD-RH-002: catalog-network assets resolve from the official catalog; load it whenever the Canvas shows an action on that network
  // (BUILD-BASE-001: Robinhood Chain and Base). The hook re-renders the Canvas when any catalog registers.
  const catalog = useNetworkCatalog();
  // UX-007: a network chosen in a card's picker loads its token metadata before any amount is typed (stable, reused across keystrokes).
  const shownCatalogs = CATALOG_NETWORK_IDENTITIES.filter(network => actionSetup?.cryptoSelection?.network === network.name ||
    Object.values(cryptoSelections).some(selection => selection.network === network.name) ||
    workflow.nodes.some(node => node.chainId === network.chain)).map(network => network.chain).join();
  useEffect(() => { for (const chain of shownCatalogs ? shownCatalogs.split(',') : []) void ensureNetworkCatalog(false, chain); }, [shownCatalogs]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() => selectedId ? [selectedId] : []);
  const selectedIdsRef = useRef<readonly string[]>(selectedId ? [selectedId] : []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const ignorePaneClick = useRef(false);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [toolboxMode, setToolboxMode] = useState<ToolboxMode>('top');
  useEffect(() => { setToolboxMode(readToolboxMode()); }, []);
  useEffect(() => { onToolboxModeChange?.(toolboxMode); }, [toolboxMode, onToolboxModeChange]);
  function changeToolboxMode(mode: ToolboxMode) {
    setToolboxMode(mode);
    saveToolboxMode(mode);
  }
  useEffect(() => () => marqueeCleanup.current?.(), []);
  function selectNodes(ids: readonly string[], inspector: string | null) {
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
    select(inspector);
    setSelectedEdge(null);
    setFeedback('');
  }
  useEffect(() => {
    if (selectedId && !selectedIdsRef.current.includes(selectedId)) {
      selectedIdsRef.current = [selectedId]; setSelectedIds([selectedId]); setSelectedEdge(null);
    } else if (!selectedId && selectedIdsRef.current.length === 1) {
      selectedIdsRef.current = []; setSelectedIds([]);
    }
  }, [selectedId]);
  // Proposal-based compositions become selectable only after the canonical edit is applied.
  const previousNodeIds = useRef(new Set(workflow.nodes.map(node => node.nodeId)));
  useEffect(() => {
    if (selectedEdge && !composerConnections(workflow).some(edge => edge.source === selectedEdge.from && edge.target === selectedEdge.to)) setSelectedEdge(null);
  }, [workflow, selectedEdge]);
  useEffect(() => {
    const remaining = selectedIdsRef.current.filter(id => actionSetup?.id === id || workflow.nodes.some(node => node.nodeId === id));
    if (remaining.length !== selectedIdsRef.current.length) { selectedIdsRef.current = remaining; setSelectedIds(remaining); }
    // A newly accepted node replaces its setup card's ID; let the addition effect transfer selection without closing explicitly opened settings.
    if (selectedId && selectedId !== actionSetup?.id && !workflow.nodes.some(node => node.nodeId === selectedId) &&
      !composerActions(workflow).some(node => !previousNodeIds.current.has(node.nodeId))) select(null);
  }, [workflow, actionSetup, selectedId, select]);
  const previousSetupId = useRef(actionSetup?.id);
  useEffect(() => {
    if (actionSetup && previousSetupId.current !== actionSetup.id) selectNodes([actionSetup.id], actionSetup.id);
    previousSetupId.current = actionSetup?.id;
  }, [actionSetup]);
  useEffect(() => {
    const added = composerActions(workflow).filter(node => !previousNodeIds.current.has(node.nodeId));
    previousNodeIds.current = new Set(workflow.nodes.map(node => node.nodeId));
    // Duplicate already selects every copy as one group. Preserve that explicit
    // selection while transferring a newly configured setup to its canonical ID.
    if (added.length && !added.every(node => selectedIdsRef.current.includes(node.nodeId)))
      selectNodes([added[0]!.nodeId], added[0]!.nodeId);
  }, [workflow]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Dialogs own their keyboard interaction while the persistent canvas stays mounted.
      if (event.defaultPrevented || event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"], [role="menu"]')) return;
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.altKey || event.metaKey) return;
      const textEntry = isTextEntry(event.target);
      if (event.key === 'Escape' && (selectedIdsRef.current.length || selectedEdge)) { event.preventDefault(); selectNodes([], null); return; }
      if (textEntry) return;
      if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && !event.target.closest('button')) {
        const id = event.target.closest('.react-flow__node')?.getAttribute('data-id');
        if (id) { event.preventDefault(); selectNodes([id], id); return; }
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' || (key === 'y' && !event.shiftKey)) {
          event.preventDefault();
          if (key === 'z' && !event.shiftKey) undo(); else redo();
          return;
        }
        return;
      }
      if (event.shiftKey) return;
      if (textEntry || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (selectedEdge) {
        event.preventDefault();
        if (!canDeleteCanvasEdge(workflow, selectedEdge.from, selectedEdge.to)) { setFeedback('This connection is required by the workflow.'); return; }
        dispatch({ type: 'DISCONNECT', from: selectedEdge.from, to: selectedEdge.to, source: 'CANVAS', baseRevision: workflow.revision });
        setSelectedEdge(null); setFeedback(''); return;
      }
      const selected = selectedIdsRef.current;
      if (!selected.length) return;
      event.preventDefault();
      // BUILD-SOLANA-MAINNET-001 (requirement D): every selected card is deleted; linked steps that cannot run without it go too, and are named.
      const removingSetup = Boolean(actionSetup && selected.includes(actionSetup.id));
      const canonicalSelection = selected.filter(id => id !== actionSetup?.id && workflow.nodes.some(node => node.nodeId === id));
      const plan = canonicalSelection.length ? resolveCanvasRemoval(workflow, canonicalSelection, context) : null;
      if (removingSetup) removeActionSetup();
      if (plan) dispatch({ type: 'REMOVE_MANY', nodeIds: canonicalSelection, source: 'CANVAS', baseRevision: workflow.revision });
      selectNodes([], null);
      if (plan?.cascaded.length) setFeedback(removalFeedback(plan.cascaded.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, workflow, context, actionSetup, removeActionSetup, selectedEdge, select, undo, redo]);
  const previousEnvironment = useRef(environment);
  useEffect(() => {
    if (previousEnvironment.current === environment) return;
    previousEnvironment.current = environment;
    if (pending?.command.type === 'ADD_ROUTER_BRIDGE' || pending?.command.type === 'SET_ROUTER_BRIDGE') dismissProposal();
    else if (pending && ['ADD_CRYPTO_ACTION', 'SET_CRYPTO_ACTION', 'ADD_UNISWAP_LIQUIDITY', 'SET_UNISWAP_LIQUIDITY', 'ADD_SOLANA_LIQUIDITY', 'SET_SOLANA_LIQUIDITY', 'ADD_SUPPLY', 'SET_SUPPLY', 'ADD_BORROW', 'SET_BORROW', 'ADD_REPAY', 'SET_REPAY', 'ADD_WITHDRAW', 'SET_WITHDRAW'].includes(pending.command.type)) dismissProposal();
  }, [environment, pending, dismissProposal]);
  // BUILD-SOLANA-MAINNET-001: a step changes network only when the wallet's environment changes between Mainnet and Testnet, and then only to
  // its own network family's counterpart (Solana Devnet → Solana, never to another chain); a step without one stays as it is, blocked. Opening a
  // saved or handed-off workflow never re-networks it. A new draft that has no network yet starts on the environment's first network.
  const settledEnvironment = useRef<WalletEnvironment | null>(null);
  const environmentTransitions = useRef(0), assetTransitions = useRef(0), routeTransitions = useRef(0);
  useEffect(() => {
    if (!environment || environment === 'unknown') return;
    const previous = settledEnvironment.current;
    settledEnvironment.current = environment;
    if (previous && previous !== environment) environmentTransitions.current += 1;
  }, [environment]);
  useEffect(() => {
    if (!environment || environment === 'unknown') return;
    const transition = assetTransitions.current !== environmentTransitions.current;
    assetTransitions.current = environmentTransitions.current;
    // The Stocks card is Robinhood Chain only: it never moves to another network with the wallet environment.
    if (actionSetup && actionSetup.action !== 'bridge' && !(actionSetup.action === 'swap' && actionSetup.stocks)) {
      const available = cryptoNetworks(actionSetup.action, environment);
      const selection = actionSetup.cryptoSelection;
      // A new card starts on the network the connected EVM wallet is already on when it serves the action (FloFi never moves the wallet).
      const walletChain = walletChainRef(wallet.chainId), preferred = available.find(profile => profile.chain === walletChain) ?? available[0];
      const next = !available.length || available.some(profile => profile.network === selection?.network) ? null
        : selection ? counterpartSelection(selection, environment) : selectCryptoNetwork(actionSetup.action, preferred!.network);
      if (next) editCryptoSelection(actionSetup.id, next, wallet.account ?? undefined);
    }
    if (!transition) return;
    for (const node of workflow.nodes) {
      const selection = cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node);
      if (!selection || !canSelectCryptoAssets(node, workflow) || composerSummary(workflow, node, context).action === 'Stocks') continue;
      const next = counterpartSelection(selection, environment);
      if (next && next !== selection) editCryptoSelection(node.nodeId, next, wallet.account ?? undefined);
    }
  }, [environment, actionSetup, workflow, cryptoSelections, editCryptoSelection, wallet.account, wallet.chainId, context]);
  useEffect(() => {
    if (environment !== 'mainnet' && environment !== 'testnet') return;
    const transition = routeTransitions.current !== environmentTransitions.current;
    routeTransitions.current = environmentTransitions.current;
    const option = ROUTER_NETWORK_OPTIONS[environment];
    const alignNetworks = (id: string, current: CanvasBridgeNetworks) => {
      // BUILD-RH-002: any route of the wallet's environment stays (mainnet: Base → Arbitrum One and the Robinhood Chain routes).
      const network = routerNetworkOfInput(current);
      if (network && ROUTER_NETWORK_OPTIONS[network].environment === environment) return;
      const patch: Partial<CanvasBridgeNetworks> = {
        ...(current.source !== option.source ? { source: option.source } : {}),
        ...(current.destination !== option.destination ? { destination: option.destination } : {}),
      };
      // Change only editable drafts; the canonical route still requires Review / Apply.
      if (Object.keys(patch).length) editBridgeNetworks(id, patch);
    };
    // A new card's universal pair (Solana in or out) is a mainnet route of its own: kept as chosen.
    if (actionSetup?.action === 'bridge' && !(environment === 'mainnet' && universalCanvasPair(bridgeSetupNetworks(actionSetup)))) alignNetworks(actionSetup.id, bridgeSetupNetworks(actionSetup));
    if (transition) for (const node of workflow.nodes) {
      const details = routerDetails(node);
      if (details && canEditCanvasAmount(node, context, workflow)) alignNetworks(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? details);
    }
  }, [environment, actionSetup, workflow, context, bridgeNetworkInputs, editBridgeNetworks]);
  // BUILD-FLOFI-MAINNET-PRODUCT-001: a workflow saved or handed off on a test network before FloFi became Mainnet-only opens as it was (never
  // re-networked silently) and cannot be simulated. "Rebuild on <mainnet>" is the owner's explicit re-authoring: each step becomes a draft on its
  // network family's mainnet with its own amount, which the owner checks and applies before a fresh simulation and Review on real funds.
  const legacyNetworks = activeNetworkScope() === 'ENGINEERING' ? [] : workflowTestNetworks(workflow);
  const legacyMainnets = [...new Set(legacyNetworks.map(network => mainnetCounterpart(network.key)?.name).filter((name): name is string => Boolean(name)))];
  function rebuildOnMainnet() {
    for (const node of workflow.nodes) {
      const router = routerDetails(node);
      if (router && canEditCanvasAmount(node, context, workflow)) {
        const option = ROUTER_NETWORK_OPTIONS.mainnet, current = bridgeNetworkInputs[node.nodeId] ?? router;
        if (current.source !== option.source || current.destination !== option.destination) editBridgeNetworks(node.nodeId, { source: option.source, destination: option.destination });
        continue;
      }
      const selection = cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node);
      if (!selection || !isTestNetwork(node.chainId) || !canSelectCryptoAssets(node, workflow)) continue;
      const next = counterpartSelection(selection, 'mainnet');
      if (next && next !== selection) editCryptoSelection(node.nodeId, next, wallet.account ?? undefined);
    }
  }
  const projectedNodes = useMemo<Node[]>(() => {
    const actionSelection = (id: string, selection: CryptoSelection, editable = true) => {
      const profiles = cryptoNetworks(selection.action, environment ?? 'unknown');
      const valid = profiles.some(profile => profile.network === selection.network);
      return { selection, networks: profiles.filter(profile => editable || profile.network === selection.network).map(profile => profile.network), valid,
        tokens: { source: valid ? editable ? cryptoTokenOptions(selection, 'source') : [selection.from] : [], destination: valid ? editable ? cryptoTokenOptions(selection, 'destination') : selection.to ? [selection.to] : [] : [] },
        onNetwork: (network: string) => { if (editable && profiles.some(profile => profile.network === network)) editCryptoSelection(id, selectCryptoNetwork(selection.action, network, selection), wallet.account ?? undefined); },
        onToken: (side: 'source' | 'destination', token: string) => { if (editable) editCryptoSelection(id, selectCryptoToken(selection, side, token)); },
        // BUILD-SOLANA-MAINNET-001 (requirement C): the arrow exchanges From and To as a draft (the old estimate is dropped and the draft re-quoted).
        ...(editable && invertCryptoSelection(selection) ? { onInvert: () => { const inverted = invertCryptoSelection(selection); if (inverted) editCryptoSelection(id, inverted); } } : {}),
      };
    };
    // BUILD-RH-002: the Stocks card edits the destination Stock Token of its Robinhood Chain swap (featured shortcut or search result).
    const stocksData = (id: string, selection: CryptoSelection, editable = true) => ({ equity: selection.to ?? '',
      onEquityChange: (symbol: string) => { if (editable && symbol !== selection.to) { try { editCryptoSelection(id, selectCryptoToken(selection, 'destination', symbol)); } catch { /* not in the current catalog */ } } } });
    const selectedSummary = (summary: ReturnType<typeof composerSummary>, selection?: CryptoSelection | null) => !selection ? summary : {
      ...summary, chain: selection.network, provider: cryptoProfile(selection)!.provider,
      amount: `${summary.amount.split(' ')[0]} ${selection.from}`, detail: selection.action === 'swap' ? `${selection.from} → ${selection.to}` : summary.detail,
      ...(summary.liquidityValues ? { liquidityValues: summary.liquidityValues.map((value, index) => ({ ...value, token: index ? selection.to! : selection.from })) } : {}),
    };
    // BUILD-RH-002: an environment may offer several routes (mainnet: Base → Arbitrum One, Base/Arbitrum ⇄ Robinhood Chain); the destination
    // list follows the chosen source, and choosing a source keeps the destination only when it still forms a supported pair.
    // All five mainnets can be authored independently. A canonical legacy adapter changes only through an explicit Review/Apply.
    const bridgeSelection = (id: string, networks: CanvasBridgeNetworks, universalAllowed = false) => {
      const network = environment === 'mainnet' || environment === 'testnet' ? environment : null;
      const universal = universalAllowed && network === 'mainnet';
      // Keep the established EVM fallback (Base first) when a source change invalidates its destination. Solana remains independently selectable.
      const mainnets = [...Object.values(UNIVERSAL_CANVAS_LABEL).filter(label => label !== 'Solana'), 'Solana'];
      const choices = network ? routerChainChoices(network, networks.source) : null;
      const sources = universal ? mainnets : choices?.sources ?? [];
      const destinations = (universal ? mainnets.filter(label => label !== networks.source) : choices?.destinations ?? []) as CanvasBridgeNetworks['destination'][];
      const routed = routerNetworkOfInput(networks);
      return {
        source: sources, destination: destinations,
        valid: network !== null && (routed !== null && ROUTER_NETWORK_OPTIONS[routed].environment === network || universal && universalCanvasPair(networks) !== null),
        unavailable: universal ? [] : [network === 'testnet' ? ORCA_WHIRLPOOLS_DEVNET.network : JUPITER_SOLANA_MAINNET.network],
        onSelect: (side: 'source' | 'destination', selected: string) => {
          if (!network) return;
          if (side === 'source') {
            const source = sources.find(candidate => candidate === selected);
            if (!source) return;
            const next = universal ? mainnets.filter(label => label !== source) as CanvasBridgeNetworks['destination'][]
              : routerChainChoices(network, source).destinations;
            editBridgeNetworks(id, { source: source as CanvasBridgeNetworks['source'], ...next.includes(networks.destination) && networks.destination !== (source as string) ? {} : { destination: next[0]! } });
          } else {
            const destination = destinations.find(candidate => candidate === selected);
            if (destination) editBridgeNetworks(id, { destination });
          }
        },
      };
    };
    const bridgeTokens = (id: string, networks: CanvasBridgeNetworks) => ({
      references: { source: networks.inputAsset, destination: networks.outputAsset },
      source: universalKeyOfCanvasLabel(networks.source) ? universalFeaturedAssets(universalKeyOfCanvasLabel(networks.source)!) : [routerTokensOf(networks)?.token ?? 'USDC'],
      destination: universalKeyOfCanvasLabel(networks.destination) ? universalFeaturedAssets(universalKeyOfCanvasLabel(networks.destination)!) : [routerTokensOf(networks)?.destinationToken ?? 'USDC'],
      onSelect: (side: 'source' | 'destination', reference: string) => {
        const key = universalKeyOfCanvasLabel(side === 'source' ? networks.source : networks.destination);
        if (!key) return;
        try { resolveUniversalAsset(key, reference); } catch { return; }
        // Retain the other side independently, including a different output asset on the same network pair.
        editBridgeNetworks(id, { inputAsset: networks.inputAsset ?? routerTokensOf(networks)?.token ?? defaultUniversalInputAsset(universalKeyOfCanvasLabel(networks.source)!),
          outputAsset: networks.outputAsset ?? routerTokensOf(networks)?.destinationToken ?? defaultUniversalInputAsset(universalKeyOfCanvasLabel(networks.destination)!),
          [side === 'source' ? 'inputAsset' : 'outputAsset']: reference });
      },
    });
    const bridgeInvert = (id: string, networks: CanvasBridgeNetworks): Pick<ComposerCardData, 'onInvertBridge'> => invertCanvasBridgeNetworks(networks) ? {
      onInvertBridge: () => { const reversed = invertCanvasBridgeNetworks(networks); if (reversed) editBridgeNetworks(id, reversed); },
    } : {};
    // UX-001: a Send card's "To" field drafts the transfer's one canonical recipient; the network's transfer profile decides validity.
    const recipientField = (id: string, network: string | undefined, canonical: string | null): CardRecipient | undefined => {
      const policy = network ? recipientPolicy(network) : null;
      if (!network || !policy || policy.kind === 'UNSUPPORTED') return undefined;
      if (policy.kind === 'OWNER_ONLY') return { value: '', placeholder: 'Your connected wallet', ownerOnly: true, status: 'valid', onChange: () => undefined };
      const typed = id === actionSetup?.id ? actionSetup.cryptoRecipient : recipientInputs[id];
      const value = typed ?? (canonical && canonical !== 'CONNECTED_OWNER' ? canonical : '');
      return { value, ownerOnly: false, placeholder: typed === undefined && canonical === 'CONNECTED_OWNER' ? 'Your connected wallet' : policy.format.placeholder,
        status: typed === undefined && canonical ? 'valid' : checkRecipient(network, value).ok ? 'valid' : value.trim() ? 'invalid' : 'required',
        onChange: (next: string) => editCanvasRecipient?.(id, next) };
    };
    const nodeRecipient = (node: Workflow['nodes'][number]) => {
      const transfer = transferDetails(node as Parameters<typeof transferDetails>[0]);
      return transfer ? recipientField(node.nodeId, cryptoSelections[node.nodeId]?.network ?? transfer.network, transfer.recipient) : undefined;
    };
    const setupRecipient = actionSetup?.cryptoSelection?.action === 'transfer' ? recipientField(actionSetup.id, actionSetup.cryptoSelection.network, null) : undefined;
    // UX-007: a swap card quotes what it shows — the committed action, or its unapplied draft as a preview snapshot that is never applied,
    // reviewed or simulated. An incomplete or invalid draft has nothing to quote.
    const liveQuoteTarget = (id: string): { estimateWorkflow?: Workflow; estimateNodeId: string } => {
      if (id !== actionSetup?.id && amountInputs[id] === undefined && !cryptoSelections[id] && !bridgeNetworkInputs[id] && recipientInputs[id] === undefined) return { estimateWorkflow: workflow, estimateNodeId: id };
      try {
        const preview = editorReducer(state, canvasAmountCommand(state, id === actionSetup?.id ? actionSetup : null, amountInputs, id, context, bridgeNetworkInputs, cryptoSelections, recipientInputs), context);
        const nodeId = id === actionSetup?.id ? preview.workflow.nodes.find(node => !workflow.nodes.some(previous => previous.nodeId === node.nodeId))?.nodeId : id;
        return !preview.error && nodeId ? { estimateWorkflow: preview.workflow, estimateNodeId: nodeId } : { estimateNodeId: id };
      } catch { return { estimateNodeId: id }; }
    };
    const proposalTarget = pending?.authoringId ?? (pending ? singleAmountProposalTarget(workflow, pending.command) : null);
    const contextualTarget = pending?.command.source === 'CHAT' ? proposalTarget ?? poolProposalTarget(pending.command) : null;
    const projected: Node[] = composerActions(workflow).map((node, index) => ({
    id: node.nodeId, type: 'workflow',
    ariaLabel: `Step ${index + 1}: ${composerSummary(workflow, node, context).action}`,
    position: canvasLayout[node.nodeId] ? canvasPosition(canvasLayout, node, index) :
      isLendingComposition(workflow) ? { x: 180, y: 35 + index * 230 } : canvasPosition(canvasLayout, node, index),
    selected: selectedIds.includes(node.nodeId) || selectedId === node.nodeId,
    data: { composer: true, connectable: true, ...(['asset.swap.exact-input', 'asset.bridge'].includes(node.actionType) ? liveQuoteTarget(node.nodeId) : { estimateNodeId: node.nodeId }), estimateOwner: node.chainId.startsWith('solana:') ? estimateOwner : wallet.account,
      estimateEvmOwner: wallet.account, estimateSolanaOwner: estimateOwner,
      contextualProposal: contextualTarget === node.nodeId, onOpenSettings: () => { selectNodes([node.nodeId], node.nodeId); openSettings?.(node.nodeId); }, settingsOpen: settingsId === node.nodeId, step: index + 1, selected: selectedId === node.nodeId,
      vertical: isLendingComposition(workflow), summary: selectedSummary(composerSummary(workflow, node, context), cryptoSelections[node.nodeId]),
      ...(cryptoSelectionOf(node) ? { actionSelection: actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!, canSelectCryptoAssets(node, workflow)) } : {}),
      ...(composerSummary(workflow, node, context).action === 'Stocks' && (cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)) ? { stocks: stocksData(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!, canSelectCryptoAssets(node, workflow)) } : {}),
      ...(routerDetails(node) ? {
        summary: { ...composerSummary(workflow, node, context), chain: `${(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).source} → ${(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).destination}`,
          bridgePair: bridgePairLabel(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!),
          amount: `${composerSummary(workflow, node, context).amount.split(' ')[0]} ${bridgePairLabel(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).split(' → ')[0]}` },
        ...(canEditCanvasAmount(node, context, workflow) ? { networkSelection: bridgeSelection(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!, true), tokenSelection: bridgeTokens(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!), ...bridgeInvert(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!) } : {}),
      } : {}),
      ...(universalBridgeDetails(node) ? (() => {
        const networks = bridgeNetworkInputs[node.nodeId] ?? universalCanvasNetworks(universalBridgeDetails(node)!);
        return { summary: { ...composerSummary(workflow, node, context), chain: `${networks.source} → ${networks.destination}`, bridgePair: bridgePairLabel(networks), amount: `${amountInputs[node.nodeId] ?? universalBridgeDetails(node)!.amount} ${bridgePairLabel(networks).split(' → ')[0]}` },
          networkSelection: bridgeSelection(node.nodeId, networks, true), tokenSelection: bridgeTokens(node.nodeId, networks), ...bridgeInvert(node.nodeId, networks) };
      })() : {}),
      ...(composerSummary(workflow, node, context).action === 'Pool / Liquidity' ? { poolProposal: {
        nodeId: node.nodeId, formId: poolReviewFormId(node.nodeId), canReview: selectedId === node.nodeId,
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && pending?.valid && poolProposalTarget(pending.command) === node.nodeId && pending.command.baseRevision === workflow.revision),
        onApply: applyProposal,
      } } : {}),
      ...(node.actionType === 'asset.transfer' && nodeRecipient(node) ? { recipient: nodeRecipient(node)! } : {}),
      ...(['supply', 'borrow', 'repay', 'withdraw', 'asset.transfer'].includes(node.actionType) ? { supplyProposal: {
        formId: supplyReviewFormId(node.nodeId), reviewLabel: `Review ${composerSummary(workflow, node, context).action} change`, canReview: selectedId === node.nodeId,
        hasProposal: Boolean(pending && proposalTarget === node.nodeId),
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && pending?.valid && proposalTarget === node.nodeId && pending.command.baseRevision === workflow.revision),
        onApply: applyProposal,
      } } : {}),
      validation: node.actionType !== 'supply' && amountInputs[node.nodeId] !== undefined
        ? { ...composerNodeState(review, node.nodeId), status: 'Check amount', tone: 'warning' }
        : composerNodeState(review, node.nodeId),
      ...(canEditCanvasAmount(node, context, workflow) ? { amountEditor: {
        ...(['supply', 'borrow', 'repay', 'withdraw', 'asset.transfer'].includes(node.actionType) ? { formId: supplyReviewFormId(node.nodeId) } : {}),
        value: amountInputs[node.nodeId] ?? composerSummary(workflow, node, context).amount.split(' ')[0]!,
        changed: amountInputs[node.nodeId] !== undefined,
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && (!routerDetails(node) || bridgeSelection(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).valid) && pending?.valid && pending.authoringId === node.nodeId && pending.authoringAmount === actionReviewValue(null, node.nodeId, amountInputs[node.nodeId], bridgeNetworkInputs[node.nodeId], cryptoSelections[node.nodeId], recipientInputs[node.nodeId]) && pending.command.baseRevision === workflow.revision),
        onChange: (value: string) => editCanvasAmount(node.nodeId, value),
        onReview: () => reviewCanvasAmount(node.nodeId), onCancel: () => cancelCanvasAmount(node.nodeId),
        onApply: applyProposal, onCommit: () => commitCanvasAmount(node.nodeId),
        blocked: cryptoSelectionOf(node) && !actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid ? 'Choose a network available for the connected wallet.'
          : routerDetails(node) && !bridgeSelection(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).valid ? 'Choose matching networks.' : null,
      } } : {}) },
    }));
    if (actionSetup) projected.push({ id: actionSetup.id, type: 'workflow', ariaLabel: `Step ${projected.length + 1}: ${setupSummary(actionSetup, context).action}`,
      position: canvasLayout[actionSetup.id] ?? defaultCanvasPosition(projected.length), selected: selectedId === actionSetup.id,
      data: { composer: true, connectable: false, ...(['swap', 'bridge'].includes(actionSetup.action) ? { ...liveQuoteTarget(actionSetup.id), estimateOwner: estimateOwner ?? wallet.account,
        estimateEvmOwner: wallet.account, estimateSolanaOwner: estimateOwner } : {}),
        onOpenSettings: () => { selectNodes([actionSetup.id], actionSetup.id); openSettings?.(actionSetup.id); }, settingsOpen: settingsId === actionSetup.id, step: projected.length + 1, selected: selectedId === actionSetup.id, vertical: false,
        summary: setupSummary(actionSetup, context),
        ...(actionSetup.action === 'swap' && actionSetup.stocks && actionSetup.cryptoSelection ? { stocks: stocksData(actionSetup.id, actionSetup.cryptoSelection) } : {}),
        ...(actionSetup.action !== 'bridge' ? { actionSelection: actionSelection(actionSetup.id, actionSetup.cryptoSelection ?? selectCryptoNetwork(actionSetup.action as CryptoAction, actionSetup.action === 'swap' ? context.assets.USDC.asset.chainId === 'eip155:84532' ? 'Base Sepolia' : 'Base' : 'Base Sepolia')) } : {}),
        ...(actionSetup.action === 'bridge' ? { networkSelection: bridgeSelection(actionSetup.id, bridgeSetupNetworks(actionSetup), true), tokenSelection: bridgeTokens(actionSetup.id, bridgeSetupNetworks(actionSetup)), ...bridgeInvert(actionSetup.id, bridgeSetupNetworks(actionSetup)) } : {}),
        ...(actionSetup.action === 'swap' ? { tokenSelection: {
          source: directions.map(direction => inputSymbol(direction)), destination: directions.map(direction => outputSymbol(direction)),
          onSelect: (side: 'source' | 'destination', symbol: string) => {
            const direction = directions.find(direction => (side === 'source' ? inputSymbol(direction) : outputSymbol(direction)) === symbol);
            if (direction) editSwapSetupDirection(actionSetup.id, direction);
          },
        } } : {}),
        validation: { findings: [], status: 'Draft', tone: 'neutral', message: undefined, next: undefined },
        ...(actionSetup.action === 'pool' ? { poolProposal: { nodeId: actionSetup.id, formId: poolReviewFormId(actionSetup.id),
          canReview: selectedId === actionSetup.id,
          canApply: Boolean(Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision), onApply: applyProposal } } : {}),
        ...(setupRecipient ? { recipient: setupRecipient } : {}),
        ...(actionSetup.action !== 'pool' && actionSetup.action !== 'swap' && actionSetup.action !== 'bridge' ? { supplyProposal: {
          formId: supplyReviewFormId(actionSetup.id), reviewLabel: `Review ${setupSummary(actionSetup, context).action} change`, canReview: selectedId === actionSetup.id,
          hasProposal: pending?.authoringId === actionSetup.id,
          canApply: Boolean(Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision),
          onApply: applyProposal,
        } } : {}),
        ...(actionSetup.action !== 'pool' ? { amountEditor: { ...(actionSetup.action !== 'swap' && actionSetup.action !== 'bridge' ? { formId: supplyReviewFormId(actionSetup.id) } : {}), value: actionSetup.amount, changed: true, onChange: (value: string) => editCanvasAmount(actionSetup.id, value),
          canApply: Boolean((actionSetup.action === 'bridge' || Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid)) && (actionSetup.action !== 'bridge' || bridgeSelection(actionSetup.id, bridgeSetupNetworks(actionSetup), true).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision),
          onReview: () => reviewCanvasAmount(actionSetup.id), onApply: applyProposal, onCommit: () => commitCanvasAmount(actionSetup.id),
          blocked: actionSetup.action === 'bridge' ? bridgeSelection(actionSetup.id, bridgeSetupNetworks(actionSetup), true).valid ? null : 'Choose matching networks.'
            : actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid ? null : 'Choose a network available for the connected wallet.' } } : {}),
      } });
    return projected;
  }, [environment, state, workflow, actionSetup, amountInputs, bridgeNetworkInputs, cryptoSelections, recipientInputs, editCanvasRecipient, editCryptoSelection, wallet.account, estimateOwner, selectedId, selectedIds, context, canvasLayout, review, editCanvasAmount, editSwapSetupDirection, editBridgeNetworks, reviewCanvasAmount, commitCanvasAmount, cancelCanvasAmount, openSettings, settingsId, pending, applyProposal, catalog.version]);
  // Live pointer positions stay in React Flow state; layout is committed on release.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(projectedNodes);
  useLayoutEffect(() => {
    setNodes(current => projectedNodes.map(node => {
      const previous = current.find(item => item.id === node.id);
      return previous?.measured ? { ...node, measured: previous.measured } : node;
    }));
  }, [projectedNodes, setNodes]);
  const edges = useMemo(() => composerConnections(workflow).map(edge => ({ ...edge,
    sourceHandle: 'output', targetHandle: 'input', type: 'smoothstep', animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 'var(--edge-active)' : 'var(--edge-line)' },
    selected: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target,
    style: { stroke: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 'var(--edge-active)' : 'var(--edge-line)', strokeWidth: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 2.5 : 1.5 },
    labelStyle: { fontSize: 10, fill: 'var(--edge-label)' }, labelBgStyle: { fill: 'var(--page)' },
  })), [workflow, selectedEdge]);
  function addAction(action: CanvasAction | 'stocks') {
    if (actionSetup) { selectNodes([actionSetup.id], actionSetup.id); setFeedback('Configure this action before adding another.'); return; }
    if (action === 'stocks') {
      let slot = projectedNodes.length, position = defaultCanvasPosition(slot);
      while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) position = defaultCanvasPosition(++slot);
      const id = startStocksSetup(position);
      selectNodes([id], id); setFeedback('');
      return;
    }
    if (action === 'pool' || action === 'swap' || action === 'bridge' || action === 'supply' || action === 'borrow' || action === 'repay' || action === 'withdraw' || action === 'transfer') {
      if (['supply', 'borrow', 'repay'].includes(action) && !wallet.account) { setFeedback('Connect your wallet to set the beneficiary before adding this action.'); return; }
      let slot = composerActions(workflow).length;
      let position = defaultCanvasPosition(slot);
      while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) position = defaultCanvasPosition(++slot);
      const id = startActionSetup(action, position, wallet.account ?? undefined);
      selectNodes([id], id); setFeedback(''); return;
    }
    let command;
    try { command = canvasAddCommand(action, workflow.revision, wallet.account); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : 'Connect your wallet to add this action.'); return; }
    const preview = editorReducer(state, command, context);
    if (preview.error) {
      setFeedback(/ISOLATED|WORKFLOW_MUST_BE_EMPTY/.test(preview.error)
        ? 'This action requires a separate workflow. Use Supply → Borrow → Swap for the supported connected lending flow.'
        : 'This action could not be added. Check the workflow and try again.');
      return;
    }
    if (action === 'lending') { propose(command); return; }
    const added = preview.workflow.nodes.find(node => !workflow.nodes.some(existing => existing.nodeId === node.nodeId));
    if (!added) return;
    const nodeId = added.nodeId;
    let slot = projectedNodes.length;
    let position = defaultCanvasPosition(slot);
    while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) {
      slot += 1;
      position = defaultCanvasPosition(slot);
    }
    addCanvasCommand(command, position);
    selectNodes([nodeId], nodeId);
  }
  function commitDrag(dragged: Node, draggedNodes: Node[]) {
    const moved = draggedNodes.length ? draggedNodes : [dragged];
    moveCanvasNodes(Object.fromEntries(moved.map(node => [node.id, node.position])));
  }
  const duplicatePlan = actionSetup || Object.keys(amountInputs).length ? null : planCanvasDuplicate(workflow, canvasLayout, selectedIds, context);
  function duplicateSelection() {
    if (!duplicatePlan) return;
    duplicateCanvasNodes(selectedIdsRef.current);
    selectNodes(duplicatePlan.ids, duplicatePlan.ids.length === 1 ? duplicatePlan.ids[0]! : null);
  }
  function startMarquee(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const origin = { x: event.clientX, y: event.clientY };
    let current = origin;
    const onMove = (move: MouseEvent) => {
      current = { x: move.clientX, y: move.clientY };
      setMarquee(canvasMarquee(surface.getBoundingClientRect(), origin, current));
    };
    const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); marqueeCleanup.current = null; setMarquee(null); };
    const onUp = (up: MouseEvent) => {
      current = { x: up.clientX, y: up.clientY };
      cleanup();
      if (Math.abs(current.x - origin.x) < 4 && Math.abs(current.y - origin.y) < 4) return;
      ignorePaneClick.current = true;
      setTimeout(() => { ignorePaneClick.current = false; }, 0);
      const bounds = surface.getBoundingClientRect();
      const rectangle = canvasMarquee(bounds, origin, current);
      const box = { left: bounds.left + rectangle.left, right: bounds.left + rectangle.left + rectangle.width,
        top: bounds.top + rectangle.top, bottom: bounds.top + rectangle.top + rectangle.height };
      const ids = [...surface.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')]
        .filter(element => marqueeIntersects(box, element.getBoundingClientRect()))
        .map(element => element.dataset.id!).filter(Boolean);
      selectNodes(ids, ids.length === 1 ? ids[0]! : null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    marqueeCleanup.current = cleanup;
  }
  function connect(source: string | null, target: string | null, sourceHandle: string | null | undefined, targetHandle: string | null | undefined) {
    if (!source || !target || sourceHandle !== 'output' || targetHandle !== 'input') { setFeedback('Connect an output handle to an input handle.'); return; }
    const checked = checkConnection(state, context, source, target);
    if (!checked.ok) { setFeedback(checked.message); return; }
    dispatch(checked.command); setFeedback('');
  }
  /**
   * BUILD-FIX-UX-001: a drag released on a step's card (not exactly on its small input) still names that step. React Flow already handled
   * a drop on a valid input (onConnect); anything else is checked by the same CONNECT rules and explained, never forced.
   */
  function finishConnection(event: MouseEvent | TouchEvent, connection: FinalConnectionState) {
    if (connection.isValid || !connection.fromNode || !connection.fromHandle) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const card = point ? document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('.build-flow-surface .react-flow__node[data-id]') : null;
    const ends = connectionEnd({ nodeId: connection.fromNode.id, type: connection.fromHandle.type }, connection.toNode?.id ?? card?.dataset.id ?? null);
    if (ends) connect(ends.from, ends.to, 'output', 'input');
  }
  const deleteAllowed = Boolean(selectedId && selectedId === actionSetup?.id) || canDeleteCanvasNode(workflow, selectedId);
  const emptyProposal = projectedNodes.length === 0 && workflowEditProposalVisible(pending, workflow);
  function deleteSelectedCard() {
    if (!selectedId || !deleteAllowed) return;
    if (selectedId === actionSetup?.id) { removeActionSetup(); selectNodes([], null); return; }
    const plan = resolveCanvasRemoval(workflow, [selectedId], context);
    dispatch({ type: 'REMOVE', nodeId: selectedId, source: 'CANVAS', baseRevision: workflow.revision });
    selectNodes([], null);
    if (plan?.cascaded.length) setFeedback(removalFeedback(plan.cascaded.length));
  }
  const dockButton = <button type="button" className="toolbox-mode-toggle" title={tr(toolboxMode === 'top' ? 'Undock toolbar' : 'Dock toolbar')} aria-label={tr(toolboxMode === 'top' ? 'Undock toolbar' : 'Dock toolbar')} aria-pressed={toolboxMode === 'floating'} onClick={() => changeToolboxMode(toolboxMode === 'top' ? 'floating' : 'top')}><DockIcon floating={toolboxMode === 'floating'}/></button>;
  const toolbox = <div className="canvas-toolbox" role="toolbar" aria-label={tr("Canvas tools")}>
    <div className="canvas-primary-tools" role="group" aria-label={tr("Workflow actions")}>
    {actions.filter(action => action !== 'lending' || activeNetworkScope() === 'ENGINEERING').map(action => <button key={action} type="button"
      title={tr(action === 'stocks' ? 'Stocks' : action === 'lending' ? 'Add Aave Supply → Aave Borrow → Uniswap Swap' : action === 'swap' || action === 'supply' || action==='borrow' || action==='repay' || action==='withdraw' ? 'Add ' + action : 'Add ' + actionLabel(action))}
      aria-label={tr(action === 'stocks' ? 'Stocks' : action==='lending'?'Add Supply → Borrow → Swap':'Add ' + (action === 'transfer' ? 'send' : action))} disabled={action==='lending'&&isLendingComposition(workflow)} onClick={() => addAction(action)}><ActionIcon action={action}/><span>{tr(actionLabel(action))}</span></button>)}
    <button type="button" disabled aria-label={tr("Privacy")} title={tr("Privacy · not available yet")}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/></svg><span>{tr("Privacy")}</span>
    </button>
    </div>
    <div className="canvas-utility-tools" role="group" aria-label={tr("Workflow utilities")}>
    <span className="toolbox-divider" aria-hidden="true"/>
    <button type="button" title={tr("Duplicate selection")} aria-label={tr("Duplicate selection")} disabled={!duplicatePlan} onClick={duplicateSelection}><DuplicateIcon/><span>{tr("Duplicate")}</span></button>
    <button type="button" title={tr("Undo (Ctrl+Z)")} aria-label={tr("Undo")} disabled={!canUndo} onClick={undo}><HistoryIcon direction="undo"/><span>{tr("Undo")}</span></button>
    <button type="button" title={tr("Redo (Ctrl+Shift+Z or Ctrl+Y)")} aria-label={tr("Redo")} disabled={!canRedo} onClick={redo}><HistoryIcon direction="redo"/><span>{tr("Redo")}</span></button>
    <button type="button" aria-label={tr("Delete")} title={tr(deleteAllowed ? 'Delete' : 'Select a card to delete')} disabled={!deleteAllowed} onClick={deleteSelectedCard}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>{tr("Delete")}</span>
    </button>
    {tr(toolboxMode === 'top' && dockButton)}
    </div>
  </div>;
  return <section className={`canvas panel ${isLendingComposition(workflow)?'lending-canvas':''}`} tabIndex={-1} aria-label={tr("Workflow canvas")}>
    <div className="canvas-head build-canvas-head"><WorkflowName name={workflowName} rename={renameWorkflow}
      onSave={onSave} onAutomate={onAutomate && workflow.nodes.some(node => !node.actionType.startsWith('mock-')) ? onAutomate : undefined}/><div className={toolboxMode === 'top' ? 'canvas-toolbar-row' : 'canvas-toolbar-utilities'}>{tr(toolboxMode === 'top' && toolbox)}{tr(toolboxMode === 'floating' && dockButton)}<span className="revision">{tr(projectedNodes.length)} {tr(projectedNodes.length === 1 ? 'action' : 'actions')}</span></div></div>
    {feedback && <p className="canvas-feedback" role="status">{tr(feedback)}</p>}
    {legacyNetworks.length > 0 && <div className="canvas-legacy-network" role="status" data-legacy-network={legacyNetworks.map(network => network.key).join(' ')}>
      <p><strong>{tr(...testNetworkTemplate(legacyNetworks))}</strong></p>
      <p>{tr('Nothing on this workflow runs on a test network. Rebuilding turns each step into a draft on its mainnet with the same amount: check every value and apply it. Mainnet uses real funds, and nothing runs before a fresh simulation, your Review and your wallet signature.')}</p>
      {legacyMainnets.length > 0 && <button type="button" onClick={rebuildOnMainnet}>{tr('Rebuild on {0}', legacyMainnets.join(' / '))}</button>}
    </div>}
    <div ref={surfaceRef} className="flow-surface build-flow-surface" role="region" aria-label={tr("Workflow graph")} onMouseDown={startMarquee}>
      <PanelRevealProvider><ReactFlow key={isLendingComposition(workflow)?'lending':'general'} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={(changes: NodeChange<Node>[]) => onNodesChange(changes.filter(change => change.type !== 'select'))} fitViewOptions={{ padding: COMPOSER_FIT_PADDING }} minZoom={0.35} maxZoom={1.4}
        nodesDraggable nodesConnectable deleteKeyCode={null} selectNodesOnDrag={false} panOnDrag={[1, 2]} {...CANVAS_GESTURES}
        // BUILD-FIX-UX-001: an ordinary click never connects; a drag snaps to a nearby input; only a connection the workflow accepts is shown as valid.
        connectOnClick={false} connectionDragThreshold={4} connectionRadius={48}
        isValidConnection={connection => connection.sourceHandle === 'output' && connection.targetHandle === 'input' && checkConnection(state, context, connection.source, connection.target).ok}
        onConnectEnd={finishConnection}
        onNodeClick={(event, node) => {
          if (ignorePaneClick.current) return;
          if (event.shiftKey) {
            const current = selectedIdsRef.current;
            const ids = current.includes(node.id) ? current.filter(id => id !== node.id) : [...current, node.id];
            selectNodes(ids, ids.includes(node.id) ? node.id : ids.length === 1 ? ids[0]! : null);
          } else selectNodes([node.id], node.id);
        }}
        onNodeDragStart={(_event, node) => { if (!selectedIdsRef.current.includes(node.id)) selectNodes([node.id], node.id); }}
        onNodeDragStop={(_event, node, draggedNodes) => commitDrag(node, draggedNodes)}
        onEdgeClick={(_event, edge) => { selectNodes([], null); setSelectedEdge({ from: edge.source, to: edge.target }); }}
        onPaneClick={() => { if (ignorePaneClick.current) return; selectNodes([], null); }} onConnect={({ source, target, sourceHandle, targetHandle }) => connect(source, target, sourceHandle, targetHandle)}>
        <InsertionViewport workflowId={workflow.workflowId} ids={composerActions(workflow).map(node => node.nodeId)}/><HandleHitArea/>
        <Background gap={18} size={1} color="var(--grid)" /><DarkSpotlight/><CanvasNavigator fitViewOptions={{ padding: COMPOSER_FIT_PADDING }}/><PanelRevealer/>
      </ReactFlow></PanelRevealProvider>
      {/* UX-006: an empty Canvas shows the uncommitted proposal confirmation in the empty state's place; Apply/Dismiss are unchanged. */}
      <WorkflowEditReview centered={emptyProposal}/>
      {projectedNodes.length === 0 && !emptyProposal && <div className="canvas-empty">
        <span className="canvas-empty-mascot" aria-hidden="true">
          <Image className="flofi-droplet-wave-light" src="/brand/flofi-droplet-wave.svg" alt={tr("")} width={400} height={400} draggable={false} unoptimized/>
          <Image className="flofi-droplet-wave-dark" src="/brand/flofi-droplet-wave-dark.svg" alt={tr("")} width={400} height={400} draggable={false} unoptimized/>
        </span>
        <strong>{tr("Start your workflow")}</strong><p>{tr("Add an action from the toolbar, then select its card to configure it.")}</p>
      </div>}
      {marquee && marquee.width >= 4 && marquee.height >= 4 && <div className="canvas-marquee" aria-hidden="true" style={marquee}/>}
      {toolboxMode === 'floating' && <div className="floating-toolbox">{tr(toolbox)}</div>}
      {primaryAction && <div className="canvas-primary-action">{primaryAction}</div>}
    </div>
    <div className="canvas-foot"><span>{tr(isLendingComposition(workflow)?'Supply → Borrow → Swap · HF ≥ 2 policy checkpoint':'Step numbers show workflow order. Dragging changes layout only.')}</span><span>{tr(isLendingComposition(workflow)?'Select each step to edit. Approvals appear only in the execution plan.':'Arrows show linked steps. Select a step to edit below.')}</span></div>
  </section>;
}
