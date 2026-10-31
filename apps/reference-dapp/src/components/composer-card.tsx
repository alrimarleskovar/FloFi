// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { buildEstimateFailureMessage } from '../domain/build-estimate';
import { useLiveQuote } from '../state/build-estimate';
import { Handle, Position } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';
import type { Command } from '../domain/commands';
import type { CanvasAction } from '../domain/canvas-authoring';
import { ActionIcon } from './action-icon';
import { TokenBrandIcon, NetworkBrandIcon } from './brand-icon';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PoolPriceRange, usePoolPriceRange, type PoolPricePreset } from './pool-price-range';
import { TokenAmountInput } from './token-amount-input';
import { usePoolContributionInputs } from './canvas-card-inputs';
import type { CanonicalAsset } from '@defi-workflow-engine/action-registry';
import { featuredStockSymbols, ROBINHOOD_CHAIN } from '../domain/asset-catalogs';
import { networkIdentity } from '../domain/network-registry';
import type { CryptoSelection } from '../domain/crypto-action-picker';
import { SolanaVerifiedAssetSearch } from './solana-verified-asset-search';
import { universalKeyOfCanvasLabel } from '../domain/universal-bridge-authoring';
import { UNIVERSAL_NETWORKS } from '@defi-workflow-engine/workflow-contracts';
import { AssetSearch } from './asset-search';
import { useRevealPanel } from './canvas-panel-reveal';
import { ProposalReviewArtifact } from './proposal-review';
import { usdLine, type UsdLine } from '../domain/usd-estimate';

export type CanvasAmountEditor = { value: string; changed: boolean; canApply: boolean; formId?: string; onChange(value: string): void; onReview(): string | null; onApply(): void; onCancel?: () => void;
  /**
   * BUILD-FIX-UX-001: Enter (or leaving the card) applies a valid draft to the editable workflow — no Review/Apply step for an ordinary
   * amount. Returns the validation message; an invalid draft never changes the workflow. Not authorization (see `commitCanvasAmount`).
   */
  onCommit?: () => string | null;
  /** Why the draft cannot apply yet (an unavailable network or bridge pair), or null. */
  blocked?: string | null };
export function supplyReviewFormId(nodeId: string) { return `composer-supply-review-${nodeId}`; }

export function poolReviewFormId(nodeId: string) { return `composer-pool-review-${nodeId}`; }
/** Route existing liquidity edit proposals to their card; no new authoring commands. */
export function poolProposalTarget(command: Command): string | null {
  if (command.type === 'SET_CRYPTO_ACTION' && command.input.selection.action === 'pool') return command.nodeId;
  return ['SET_LIQUIDITY', 'SET_UNISWAP_LIQUIDITY', 'SET_SOLANA_LIQUIDITY'].includes(command.type) && 'nodeId' in command ? command.nodeId : null;
}

const actionIcons: Record<string, CanvasAction | 'stocks' | 'transfer'> = {
  Swap: 'swap', Bridge: 'bridge', 'Pool / Liquidity': 'pool', 'Prepare liquidity': 'pool',
  Supply: 'supply', Lending: 'lending', Borrow: 'borrow', Repay: 'repay', Withdraw: 'withdraw', Send: 'transfer', Stocks: 'stocks',
};

/**
 * Contributions supply both assets together; only conversions show direction. BUILD-SOLANA-MAINNET-001 (requirement C): on a Swap card the same
 * arrow, unchanged in place and look, is the control that exchanges From and To (`onInvert`); elsewhere it stays decorative.
 */
function ValuePair({ relationship, className = '', onInvert, children }: { relationship: 'directional' | 'contribution'; className?: string; onInvert?: (() => void) | undefined; children: ReactNode }) {
  const { t: tr } = useLocale();
  const arrow = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-5-5 5 5 5-5"/></svg>;
  return <div className={`composer-value-pair${className ? ` ${className}` : ''}`} data-relationship={relationship}>
    {children}
    {relationship === 'directional' && (onInvert
      ? <button type="button" className="composer-value-arrow composer-value-invert nodrag nopan" aria-label={tr('Switch From and To tokens')} title={tr('Switch From and To tokens')}
        onClick={onInvert}>{arrow}</button>
      : <span className="composer-value-arrow" aria-hidden="true">{arrow}</span>)}
  </div>;
}

/** `network` adds the network badge; `markNetwork` only binds the token's identity to its network (picker options carry no badge). */
function TokenChip({ symbol, network, markNetwork }: { symbol: string; network?: string; markNetwork?: string }) {
  const { t: tr } = useLocale();
  return <span className="composer-token-chip">
    <span className="composer-token-avatar" data-token={symbol}>
      <TokenBrandIcon symbol={symbol} network={network ?? markNetwork}/>
      {network !== undefined && <span className="composer-network-badge" role="img" aria-label={tr(`${network} network`)} title={network}><NetworkBrandIcon network={network}/></span>}
    </span>
    <span className="composer-amount-token">{symbol}</span>
  </span>;
}

type TokenPickerControl = { label: string; expanded: boolean; controls: string; title?: string; onToggle(trigger: HTMLButtonElement): void };
function TokenPill({ symbol, network, picker }: { symbol: string; network: string; picker: TokenPickerControl }) {
  const { t: tr } = useLocale();
  return <button type="button" className="composer-token-chip composer-equity-pill composer-token-pill nodrag nopan" aria-label={tr(picker.label)} aria-expanded={picker.expanded} aria-controls={picker.controls} title={tr(picker.title)}
    onClick={event => { event.stopPropagation(); picker.onToggle(event.currentTarget); }} onKeyDown={event => event.stopPropagation()}>
    <TokenChip symbol={symbol} network={network}/>
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4 3 3 3-3"/></svg>
  </button>;
}

function TokenPicker({ symbol, network, options, onChange }: { symbol: string; network: string; options: readonly string[]; onChange(symbol: string): void }) {
  const { t: tr } = useLocale();
  const name = useId();
  const listRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, []);
  return <fieldset ref={listRef} className="composer-stock-options composer-token-options">
    <legend className="sr-only">{tr("Choose token on ")}{network}</legend>
    {options.map(option => <label key={option} className="composer-stock-option" data-selected={option === symbol || undefined}>
      <input className="sr-only" type="radio" name={name} value={option} aria-label={option} checked={option === symbol} onChange={() => onChange(option)}/>
      <TokenChip symbol={option} markNetwork={network}/>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </label>)}
  </fieldset>;
}

/** UX-001: the Send card's destination, on the card itself. It edits only the draft of the transfer's one canonical `recipient`. */
export type CardRecipient = { value: string; placeholder: string; ownerOnly: boolean; status: 'valid' | 'required' | 'invalid'; onChange(value: string): void };
function RecipientField({ recipient, formId }: { recipient: CardRecipient; formId?: string | undefined }) {
  const { t: tr } = useLocale();
  const id = useId();
  return <div className="composer-recipient nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <label htmlFor={id}>{tr('To')}</label>
    <input id={id} className="composer-recipient-input numeric" type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={128}
      value={recipient.value} placeholder={tr(recipient.placeholder)} readOnly={recipient.ownerOnly} form={formId}
      title={tr(recipient.ownerOnly ? 'This network sends only to your connected wallet.' : 'Paste or type the destination wallet address')}
      aria-invalid={recipient.status === 'invalid' || undefined} aria-describedby={recipient.status === 'invalid' ? `${id}-error` : undefined}
      onChange={event => recipient.onChange(event.target.value)}/>
    {recipient.status === 'invalid' && <span id={`${id}-error`} className="composer-recipient-error">{tr('Enter a valid recipient address for this network.')}</span>}
  </div>;
}

function NetworkBadge({ network }: { network: string }) {
  return <span className="composer-bridge-network-icon" aria-hidden="true"><NetworkBrandIcon network={network}/></span>;
}
function NetworkPicker({ network, options, unavailable = [], onSelect }: { network: string; options: readonly string[]; unavailable?: readonly string[] | undefined; onSelect(network: string): void }) {
  const { t: tr } = useLocale();
  return <fieldset className="composer-stock-options composer-network-options">
    <legend className="sr-only">{tr("Choose network")}</legend>
    {[...options, ...unavailable].map(option => <button key={option} type="button" className="composer-stock-option" disabled={unavailable.includes(option)} aria-label={option} aria-pressed={option === network} data-selected={option === network || undefined} onClick={() => onSelect(option)}>
      <NetworkBadge network={option}/><span>{option}</span>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </button>)}
  </fieldset>;
}

function AssetNetworkPicker({ id, side, symbol, network, tokens, networks, unavailable, onTokenChange, onNetworkChange, onCollapse, bridge = false, search, selectedReference }: {
  id: string; side: 'source' | 'destination'; symbol: string; network: string; tokens: readonly string[]; networks: readonly string[]; unavailable?: readonly string[] | undefined;
  onTokenChange(symbol: string): void; onNetworkChange(network: string): void; onCollapse(): void;
  bridge?: boolean; selectedReference?: string | undefined;
  /** BUILD-BASE-001: an official-catalog network's search (the whole validated catalog behind the shortcuts). */
  search?: { readonly chain: string; readonly accept: (asset: CanonicalAsset) => boolean; readonly identity?: boolean; onSelect(symbol: string): void } | undefined;
}) {
  const { t: tr } = useLocale();
  const sideLabel = side === 'source' ? 'Source' : 'Destination';
  const shortcuts = <TokenPicker symbol={symbol} network={network} options={tokens} onChange={token => { if (tokens.includes(token)) onTokenChange(token); }}/>;
  const panel = useRef<HTMLElement>(null);
  useRevealPanel(panel);
  return <section ref={panel} id={id} className="composer-stocks-panel composer-bridge-picker nodrag nopan" aria-label={tr(`${sideLabel} ${bridge ? 'bridge' : 'asset'} picker`)}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyDownCapture={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCollapse(); }
    }}>
    <button type="button" className="composer-pool-collapse" aria-label={tr(bridge ? 'Hide bridge picker' : 'Hide token picker')} title={tr(bridge ? 'Hide bridge picker' : 'Hide token picker')} onClick={onCollapse}>
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
    </button>
    <div className="composer-bridge-picker-columns">
      <div className="composer-bridge-picker-column" role="region" aria-label={tr(`${sideLabel} token picker`)}>
        <span className="composer-bridge-picker-heading" aria-hidden="true">{tr("Tokens")}</span>
        {!bridge && shortcuts}
        {search && network !== 'Solana' && <AssetSearch chain={search.chain} selected={selectedReference ?? symbol} accept={search.accept} onSelect={search.onSelect} onSelectAsset={search.identity ? asset => search.onSelect(asset.address ? `${asset.address}@${asset.decimals}` : asset.symbol) : undefined} copy={{
          heading: tr("Search assets"), searchLabel: tr("Search {0} tokens", network), placeholder: tr("Search by symbol or name…"),
          loading: tr("Loading {0} tokens…", network), unavailable: tr("{0} tokens are unavailable right now.", network), retry: tr("Try again"),
          empty: tr("No token matches this search."), results: tr("{0} token results", network), total: count => tr("{0} tokens · type to search", count) }}/>}
        {search && network === 'Solana' && <SolanaVerifiedAssetSearch selected={selectedReference ?? symbol} onSelect={search.onSelect} copy={{
          heading: tr('Search assets'), searchLabel: tr('Search Solana tokens'), placeholder: tr('Search by symbol or mint…'),
          loading: tr('Loading {0} tokens…', network), unavailable: tr('{0} tokens are unavailable right now.', network), retry: tr('Try again'),
          empty: tr('No token matches this search.'), results: tr('{0} token results', network), excluded: count => tr('{0} entries excluded because display metadata is incomplete.', count), total: count => tr('{0} tokens · type to search', count) }}/>}
        {bridge && shortcuts}
      </div>
      <div className="composer-bridge-picker-column" role="region" aria-label={tr(bridge ? `${sideLabel} network picker` : 'Action network picker')}>
        <span className="composer-bridge-picker-heading" title={tr(bridge ? undefined : 'One network for all assets in this action')} aria-hidden="true">{tr("Networks")}</span>
        {!networks.length && !bridge && <p className="muted">{tr("No supported networks in the connected wallet environment.")}</p>}
        <NetworkPicker network={network} options={networks} unavailable={unavailable} onSelect={choice => { if (networks.includes(choice) && choice !== network) onNetworkChange(choice); }}/>
      </div>
    </div>
  </section>;
}

function EquityPill({ equity, onToggle, expanded, controls }: { equity: string; onToggle(): void; expanded: boolean; controls: string }) {
  const { t: tr } = useLocale();
  return <button type="button" className="composer-token-chip composer-equity-pill nodrag nopan" aria-label={tr("Select stock")} aria-expanded={expanded} aria-controls={controls}
    onClick={event => { event.stopPropagation(); onToggle(); }} onKeyDown={event => event.stopPropagation()}>
    <span className="composer-token-avatar composer-robinhood-avatar">
      <img src="/brand/robinhood-avatar.jpg" width="22" height="22" alt={tr("Robinhood")}/>
      <span className="composer-network-badge" data-network="robinhood" role="img" aria-label={tr("Robinhood Chain network")} title={tr("Robinhood Chain")}><NetworkBrandIcon network="Robinhood Chain"/></span>
    </span>
    <span className="composer-amount-token">{tr(equity)}</span>
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4 3 3 3-3"/></svg>
  </button>;
}

/** Featured Stock Tokens: shortcuts only, never the limit of the catalog. */
function StockPicker({ equity, options, onChange }: { equity: string; options: readonly string[]; onChange(equity: string): void }) {
  const { t: tr } = useLocale();
  const name = useId();
  return <fieldset className="composer-stock-options">
    <legend className="sr-only">{tr("Choose stock")}</legend>
    {options.map(symbol => <label key={symbol} className="composer-stock-option" data-selected={symbol === equity || undefined}>
      <input className="sr-only" type="radio" name={name} value={symbol} checked={symbol === equity} onChange={() => onChange(symbol)}/>
      <span>{symbol}</span>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </label>)}
  </fieldset>;
}
/**
 * BUILD-RH-002: featured shortcuts plus search over every validated active official Robinhood Stock Token. Loading, empty and
 * unavailable states are explicit; a result configures the same Stocks card. No registry data beyond symbol and name is shown.
 * BUILD-BASE-001: the search is the shared catalog asset search.
 */
function StocksPanel({ id, equity, onChange, onCollapse }: { id: string; equity: string; onChange(equity: string): void; onCollapse(): void }) {
  const { t: tr } = useLocale();
  const panel = useRef<HTMLElement>(null);
  useRevealPanel(panel);
  return <section ref={panel} id={id} className="composer-stocks-panel composer-stocks-catalog nodrag nopan" aria-label={tr("Stocks configuration")} onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCollapse(); } }}>
    <button type="button" className="composer-pool-collapse" aria-label={tr("Hide Stocks configuration")} title={tr("Hide Stocks configuration")} onClick={onCollapse}>
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
    </button>
    <span className="composer-bridge-picker-heading">{tr("Featured")}</span>
    <StockPicker equity={equity} options={featuredStockSymbols()} onChange={onChange}/>
    <AssetSearch chain={ROBINHOOD_CHAIN} selected={equity} assetClass="STOCK_TOKEN" onSelect={onChange} copy={{ heading: tr("Search assets"),
      searchLabel: tr("Search Stock Tokens"), placeholder: tr("Search by symbol or company name…"), loading: tr("Loading Robinhood Stock Tokens…"),
      unavailable: tr("Robinhood Stock Tokens are unavailable right now."), retry: tr("Try again"), empty: tr("No Stock Token matches this search."),
      results: tr("Stock Token results"), total: count => tr("{0} Stock Tokens · type to search", count) }}/>
  </section>;
}

const priceStrategies = [
  { title: 'Estável', label: 'Stable', range: '± 0.03%', description: 'Good for stablecoins or pairs with low volatility' },
  { title: 'Amplo', label: 'Wide', range: '–50% — +100%', description: 'Good for volatile pairs' },
  { title: 'Unilateral inferior', label: 'Lower single-sided', range: '–50%', description: 'Provide liquidity if the price falls' },
  { title: 'Unilateral superior', label: 'Upper single-sided', range: '+100%', description: 'Provide liquidity if the price rises' },
] as const;

/** Selection previews only; the authored protocol stays in the position editor. */
function PoolProviderSelector({ provider, chain }: { provider: string; chain: string }) {
  const { t: tr } = useLocale();
  const active = /solana|orca/i.test(`${provider} ${chain}`) ? 'Solana' : /uniswap/i.test(provider) ? 'Uniswap' : provider || 'Uniswap';
  const [choice, setChoice] = useState(active);
  useEffect(() => { setChoice(active); }, [active]);
  const options = ['Uniswap', 'Solana'].includes(active) ? ['Uniswap', 'Solana'] : [active, 'Uniswap', 'Solana'];
  return <div className="composer-pool-mode composer-pool-provider nodrag nopan" role="group" aria-label={tr("Liquidity provider")}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {options.map(option => <button key={option} type="button" aria-pressed={choice === option} onClick={() => setChoice(option)}>{option}</button>)}
  </div>;
}

/** Shared editable percentage; acceptance still belongs to the position form. */
function PoolCustomRange({ value, onChange }: { value: number; onChange(value: number): void }) {
  const { t: tr } = useLocale();
  return <div className="composer-pool-custom nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <label className="composer-pool-custom-box"><span>{tr("Custom")}</span>
      <span className="composer-pool-custom-value"><span>±</span><input type="number" aria-label={tr("Custom range percentage")} inputMode="decimal" min="0.01" max="90" step="0.01" value={value} style={{ width: `${String(value).length}ch` }} onChange={event => { if (event.target.value !== '') onChange(Number(event.target.value)); }}/><span>%</span></span>
    </label>
  </div>;
}

/** Product presentation only; authored ranges still use the existing position editor. */
function PoolRangeSelector({ mode, onChange }: { mode: 'Tick' | 'Price'; onChange(mode: 'Tick' | 'Price'): void }) {
  const { t: tr } = useLocale();
  return <div className="composer-pool-range nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="composer-pool-mode" role="group" aria-label={tr("Liquidity range view")}>
        {(['Tick', 'Price'] as const).map(option => <button key={option} type="button" aria-pressed={mode === option} onClick={() => {
          onChange(option);
        }}>{tr(option)}</button>)}
      </div>
  </div>;
}

function PoolPricePanel({ strategy, onSelect, onCollapse }: { strategy: PoolPricePreset | null; onSelect(strategy: PoolPricePreset): void; onCollapse(): void }) {
  const { t: tr } = useLocale();
  const id = useId();
  const panel = useRef<HTMLFieldSetElement>(null);
  useRevealPanel(panel);
  return <fieldset ref={panel} className="composer-pool-presets nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <legend className="sr-only">{tr("Price strategies")}</legend>
      <button type="button" className="composer-pool-collapse" aria-label={tr("Hide price strategies")} title={tr("Hide price strategies")} onClick={onCollapse}>
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
      </button>
      {priceStrategies.map(preset => <label key={preset.title} className="composer-pool-preset" data-selected={strategy === preset.title || undefined}>
        <input className="sr-only" type="radio" name={`${id}-strategy`} value={preset.title} checked={strategy === preset.title} onChange={() => onSelect(preset.title)}/>
        <span className="composer-pool-preset-heading">
          <span className="composer-pool-preset-title">{tr(preset.label)}</span>
          <span className="composer-pool-preset-check" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7"/></svg></span>
        </span>
        <span className="composer-pool-preset-range">{tr(preset.range)}</span>
        <span className="composer-pool-preset-description">{tr(preset.description)}</span>
      </label>)}
    </fieldset>;
}

/** Display priority is shared by all value boxes in the card; token inputs keep their denomination. */
function ValueBox({ amount, token, network, source, label, hint, editor, inputLabel, equity, picker, fiatFirst, onFiatFirstChange, readOnly = false, invalid = false, usd }: { usd?: UsdLine; invalid?: boolean; readOnly?: boolean; amount?: string | undefined; token: string; network: string; source?: boolean; label?: string; hint: string; editor?: (Pick<CanvasAmountEditor, 'value' | 'formId' | 'onChange'> & { onEscape?: () => void }) | undefined; inputLabel?: string; equity?: { symbol: string; onToggle(): void; expanded: boolean; controls: string }; picker?: TokenPickerControl; fiatFirst: boolean; onFiatFirstChange: (fiatFirst: boolean) => void }) {
  const { t: tr } = useLocale();
  if (readOnly) return <span className={`numeric composer-amount-box ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={tr(label ?? (source ? 'Source amount' : 'Destination amount'))} data-symbolic={!amount || undefined} title={tr(hint)}>
    <span className="composer-value-column"><span className="composer-amount-value">{tr(amount ?? '—')}</span></span>{tr(' ')}
    <TokenChip symbol={token} network={network.replace(/ \(\d+\)$/, '').replace('Robinhood Chain Testnet', 'Robinhood Chain')}/>
  </span>;
  // BUILD-FIX-UX-001: USD first is offered only when a verified USD estimate exists; otherwise the line says why there is none.
  const usdFirst = fiatFirst && usd?.kind === 'value';
  const tokenValue = editor ? <TokenAmountInput className={`composer-token-value ${usdFirst ? 'composer-fiat-value' : 'composer-amount-value'}`}
    aria-label={tr(inputLabel ?? `Source amount (${token})`)} inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80}
    form={editor.formId} value={editor.value} style={usdFirst ? { width: `${Math.max(editor.value.length, 1)}ch` } : undefined}
    aria-invalid={invalid || undefined} onValueChange={editor.onChange}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && editor.onEscape) { event.preventDefault(); editor.onEscape(); } }}/>
    : <span className={usdFirst ? 'composer-fiat-value' : 'composer-amount-value'}>{tr(amount ?? '0')}</span>;
  return <span className={`numeric composer-amount-box nodrag nopan ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={tr(label ?? (source ? 'Source amount' : 'Destination amount (unquoted placeholder)'))}
    data-symbolic={!amount || undefined} title={tr(hint)}>
    <span className="composer-value-column">
      <span className="composer-value-line">
        {usdFirst ? <button type="button" className="composer-primary-fiat" aria-label={tr("Show token amount first")} title={tr(usd.title)} onClick={() => onFiatFirstChange(false)}>{tr(usd.text)}</button> : tokenValue}
      </span>
      {usdFirst ? <span className="composer-token-subline">{editor ? <>{tr(tokenValue)}<span>{tr(token)}</span></>
        : <span>{tr(amount ?? '0')} {tr(token)}</span>}</span>
        : usd?.kind === 'value' ? <button type="button" className="composer-fiat-value" data-usd="value" aria-label={tr("Show USD value first")} title={tr(usd.title)} onClick={() => onFiatFirstChange(true)}>{tr(usd.text)}</button>
        : <span className="composer-fiat-value" data-usd={usd?.kind ?? 'unavailable'} title={tr(usd?.title ?? 'No verified USD price is available for this asset right now.')}>{tr(usd?.text ?? 'USD price unavailable')}</span>}
    </span>
    {equity ? <EquityPill equity={equity.symbol} onToggle={equity.onToggle} expanded={equity.expanded} controls={equity.controls}/> : picker ? <TokenPill symbol={token} network={network} picker={picker}/> : <TokenChip symbol={token} network={network}/>}
  </span>;
}

export type ComposerCardData = {
  onInvertBridge?: () => void;
  connectable?: boolean;
  actionSelection?: { selection: CryptoSelection; networks: readonly string[]; valid: boolean; tokens: { source: readonly string[]; destination: readonly string[] }; onNetwork(network: string): void; onToken(side: 'source' | 'destination', token: string): void;
    /** BUILD-SOLANA-MAINNET-001: exchanges From and To (Swap cards only; absent where the reversed pair is unavailable or the step is not editable). */
    onInvert?: () => void };
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
  estimateWorkflow?: SemanticWorkflow; estimateNodeId?: string; estimateOwner?: string | null;
  estimateEvmOwner?: string | null; estimateSolanaOwner?: string | null;
  amountEditor?: CanvasAmountEditor;
  contextualProposal?: boolean;
  tokenSelection?: { references?: { source: string | undefined; destination: string | undefined }; source: readonly string[]; destination: readonly string[]; onSelect(side: 'source' | 'destination', symbol: string): void };
  networkSelection?: { source: readonly string[]; destination: readonly string[]; valid: boolean; unavailable?: readonly string[]; onSelect(side: 'source' | 'destination', network: string): void };
  /** BUILD-RH-002: the Stocks card, a Robinhood Chain swap that pays USDG for the selected Stock Token. */
  stocks?: { equity: string; onEquityChange(equity: string): void };
  supplyProposal?: { formId: string; reviewLabel?: string; canReview: boolean; hasProposal: boolean; canApply: boolean; onApply(): void };
  recipient?: CardRecipient;
  poolProposal?: { nodeId: string; formId: string; canReview: boolean; canApply: boolean; onApply(): void };
  onOpenSettings?: () => void;
  /** BUILD-FLOFI-CONVERSATIONAL-001: this card's settings popover is open. */
  settingsOpen?: boolean;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  const { t: tr } = useLocale();
  // UX-007: the shared live quote for swap cards (Swap and the Stocks swap): calculating at once, then this exact amount's estimate or none.
  const quoteNode = card.estimateWorkflow?.nodes.find(n => n.nodeId === card.estimateNodeId);
  const quoteOwner = quoteNode?.chainId.startsWith('solana:') ? card.estimateSolanaOwner ?? card.estimateOwner : card.estimateEvmOwner ?? card.estimateOwner;
  const quoteDestination = quoteNode?.chainId.startsWith('solana:') ? card.estimateEvmOwner : card.estimateSolanaOwner;
  const quote = useLiveQuote(['Swap', 'Stocks', 'Bridge'].includes(card.summary.action) ? card.estimateWorkflow : undefined,
    card.estimateNodeId ?? '', quoteOwner, card.summary.action === 'Bridge' ? quoteDestination : undefined);
  const estimate = quote.status === 'ready' ? quote.estimate : null;
  const discovery = estimate?.bridge?.discovery ?? (quote.status === 'unavailable' ? quote.discovery : undefined);
  const usdState = { status: quote.status === 'calculating' ? 'pending' as const : estimate ? 'ready' as const : 'none' as const,
    mocked: estimate?.usd?.evidence === 'MOCKED', ...(estimate?.usd ? { observedAt: estimate.usd.observedAt } : {}) };
  const [amountError, setAmountError] = useState<string | null>(null);
  const [fiatFirst, setFiatFirst] = useState(false);
  const stocksCard = Boolean(card.stocks);
  const amountBox = !card.inspection && (card.summary.action === 'Swap' || card.summary.action === 'Bridge' || stocksCard);
  const bridgeCard = !card.inspection && card.summary.action === 'Bridge';
  const poolCard = !card.inspection && card.summary.action === 'Pool / Liquidity';
  const [poolMode, setPoolMode] = useState<'Tick' | 'Price'>('Tick');
  const [poolPanelOpen, setPoolPanelOpen] = useState(false);
  const [stocksPanelOpen, setStocksPanelOpen] = useState(false);
  const stocksPanelId = useId();
  const [tokenPanel, setTokenPanel] = useState<'source' | 'destination' | null>(null);
  const tokenPanelId = useId();
  const tokenTrigger = useRef<HTMLButtonElement | null>(null);
  const [bridgePanel, setBridgePanel] = useState<'source' | 'destination' | null>(null);
  const bridgePanelId = useId();
  const bridgeTrigger = useRef<HTMLButtonElement | null>(null);
  const poolRange = usePoolPriceRange(card.poolProposal?.nodeId);
  const poolContributions = usePoolContributionInputs(card.poolProposal?.nodeId);
  function changePoolMode(mode: 'Tick' | 'Price') {
    setTokenPanel(null);
    setPoolMode(mode); setPoolPanelOpen(mode === 'Price');
    if (mode === 'Price') {
      // Review validates the same visible Custom or preset range.
      if (poolMode !== 'Price') {
        if (poolRange.preset) poolRange.selectPreset(poolRange.preset);
        else poolRange.edit(poolRange.percent);
      }
      void poolRange.refresh();
    }
    else if (poolRange.edited) poolRange.reset();
  }
  const poolNodeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tokenPanel && !bridgePanel) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !poolNodeRef.current?.contains(event.target)) { setTokenPanel(null); setBridgePanel(null); } };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [tokenPanel, bridgePanel]);
  const poolValues = poolCard ? poolContributions.values ?? card.summary.liquidityValues : undefined;
  const quietAmount = amountBox || (!card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw', 'Send'].includes(card.summary.action) && (Boolean(card.amountEditor?.changed) || card.validation.status === 'Draft'));
  const amountParts = card.summary.amount.match(/^(\d+(?:\.\d+)?) (\S+)$/);
  const pair = card.summary.detail ?? card.summary.bridgePair;
  const [pairSource, pairDestination] = pair?.split(' → ') ?? [];
  const [sourceNetwork = 'Network not specified', destinationNetwork = sourceNetwork] = card.summary.chain.split(' → ');
  const editor = card.amountEditor ? { ...card.amountEditor, onChange: (value: string) => { setAmountError(null); card.amountEditor!.onChange(value); } } : undefined;
  // BUILD-FIX-UX-001: an ordinary amount edit applies directly to the editable workflow. A chat (Copilot) proposal keeps its own review.
  const directCommit = Boolean(editor?.onCommit && !card.contextualProposal);
  function commitAmount() {
    if (!editor?.changed) return;
    if (!directCommit) { setAmountError(editor.onReview()); return; }
    setAmountError(editor.blocked ?? editor.onCommit!());
  }
  function picker(side: 'source' | 'destination'): TokenPickerControl {
    if (bridgeCard) return { label: `Configure ${side} asset`, title: `${side === 'source' ? amountParts?.[2] ?? pairSource : pairDestination} on ${side === 'source' ? sourceNetwork : destinationNetwork}`, expanded: bridgePanel === side, controls: bridgePanelId, onToggle: trigger => {
      bridgeTrigger.current = trigger; setBridgePanel(current => current === side ? null : side); setTokenPanel(null);
    } };
    return { label: `Select ${side} token`, title: `${side === 'source' ? poolValues?.[0]?.token ?? amountParts?.[2] ?? pairSource : poolValues?.[1]?.token ?? pairDestination} on ${sourceNetwork}`, expanded: tokenPanel === side, controls: tokenPanelId, onToggle: trigger => {
      tokenTrigger.current = trigger; setTokenPanel(current => current === side ? null : side); setPoolPanelOpen(false);
      setBridgePanel(null);
    } };
  }
  function collapseTokens() { setTokenPanel(null); tokenTrigger.current?.focus(); }
  function collapseBridge() { setBridgePanel(null); bridgeTrigger.current?.focus(); }
  const bridgeSymbol = bridgePanel === 'destination' ? pairDestination : amountParts?.[2] ?? pairSource;
  const bridgeNetwork = bridgePanel === 'destination' ? destinationNetwork : sourceNetwork;
  const tokenSymbol = tokenPanel === 'destination' ? poolValues?.[1]?.token ?? pairDestination : poolValues?.[0]?.token ?? amountParts?.[2] ?? pairSource;
  const tokenNetwork = poolCard || tokenPanel === 'source' ? sourceNetwork : destinationNetwork;
  // Authored actions keep their configured assets; draft Swap exposes its existing supported directions.
  const tokenOptions = tokenPanel && tokenSymbol ? card.actionSelection?.tokens[tokenPanel] ?? card.tokenSelection?.[tokenPanel] ?? [tokenSymbol] : [];
  const AmountContainer = editor ? 'form' : 'div';
  const content = <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection || quietAmount ? undefined : card.validation.tone}>
      <Handle id="input" type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={!card.inspection && Boolean(card.connectable)}/>
      <strong className="composer-action-title"><span>{tr(card.step)}. {tr(card.summary.action)}</span><ActionIcon action={actionIcons[card.summary.action] ?? 'action'}/></strong>
      {!card.inspection && !quietAmount && card.validation.status !== 'Configured' && <span className="composer-card-state" title={tr(card.validation.message)}>{tr(card.validation.tone !== 'neutral' && '⚠ ')}{tr(card.validation.status === 'Draft' ? 'Check settings' : card.validation.status)}</span>}
      {poolCard ? <PoolProviderSelector provider={card.summary.provider} chain={card.summary.chain}/> : <span className="composer-metadata">
        <span className="composer-provider">{tr(card.summary.provider.replace(/Cross-chain Router/g, 'Router') || 'Provider not specified')}</span>
        {!bridgeCard && <>{tr(' · ')}<span className="composer-chain">{tr(card.summary.chain)}</span></>}
      </span>}
      {card.inspection ? <>
        {card.summary.liquidityValues ? <ValuePair relationship="contribution">
          {card.summary.liquidityValues.map((value, index) => <ValueBox key={value.token} readOnly source={index === 0} amount={value.amount} token={value.token} network={sourceNetwork}
            label={`${index === 0 ? 'First' : 'Second'} liquidity asset amount`} hint="Configured liquidity contribution" fiatFirst={false} onFiatFirstChange={setFiatFirst}/>)}
        </ValuePair> : <div className={pairDestination ? 'composer-value-pair' : undefined}>
          {amountParts ? <ValueBox readOnly source amount={amountParts[1]} token={amountParts[2]!} network={sourceNetwork} hint={card.summary.amount} fiatFirst={false} onFiatFirstChange={setFiatFirst}/>
            : <span className="numeric composer-amount">{tr(card.summary.amount)}</span>}
          {pairDestination && <><span className="composer-value-arrow" aria-hidden="true">↓</span><ValueBox readOnly token={pairDestination} network={destinationNetwork} hint="Output estimate unavailable" fiatFirst={false} onFiatFirstChange={setFiatFirst}/></>}
        </div>}
        {pairDestination && <span className="composer-quote-note" title={quote.status === 'unavailable' && quote.code ? [quote.code, quote.correlationId].filter(Boolean).join(' · ') : undefined}>{tr("Estimate unavailable")}</span>}
      </>        : amountBox ? <AmountContainer className="composer-amount-form nodrag nopan"
        onKeyDown={event => event.stopPropagation()}
        onSubmit={event => { event.preventDefault(); commitAmount(); }}
        // Leaving this step (pointer or touch: a decimal keypad may have no Enter key) applies a valid draft too; focus within the step,
        // its pickers or its Canvas node (selecting the card) does not.
        onBlur={event => {
          const next = event.relatedTarget, node = event.currentTarget.closest('.react-flow__node');
          if (directCommit && editor?.changed && !(next instanceof Node && (poolNodeRef.current?.contains(next) || node?.contains(next)))) commitAmount();
        }}>
        <ValuePair relationship="directional" onInvert={bridgeCard ? card.onInvertBridge : card.summary.action === 'Swap' && !stocksCard ? card.actionSelection?.onInvert : undefined}>
        <ValueBox source amount={amountParts?.[1]} token={amountParts?.[2] ?? pairSource ?? '—'} {...stocksCard ? { label: 'Stocks amount', inputLabel: `Stocks amount (${amountParts?.[2] ?? pairSource ?? 'USDG'})` } : {}}
          network={sourceNetwork} editor={editor && directCommit && editor.changed && editor.onCancel ? { ...editor, onEscape: () => { setAmountError(null); editor.onCancel!(); } } : editor} invalid={Boolean(amountError)} {...stocksCard ? {} : { picker: picker('source') }} hint={editor ? 'Enter the source amount' : card.summary.amount} fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}
          usd={usdLine(sourceNetwork, estimate?.usd?.input, usdState)}/>
        <ValueBox amount={estimate?.expected ?? (quote.status === 'calculating' ? 'Calculating…' : '—')} token={pairDestination ?? '—'} network={destinationNetwork}
          {...card.stocks ? { equity: { symbol: card.stocks.equity, onToggle: () => { setStocksPanelOpen(open => !open); setTokenPanel(null); }, expanded: stocksPanelOpen, controls: stocksPanelId } } : { picker: picker('destination') }}
          hint="Approximate read-only output; simulate before review" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}
          usd={usdLine(destinationNetwork, estimate?.usd?.output, usdState)}/>
        </ValuePair>
        <span className="composer-quote-note" title={quote.status === 'unavailable' && quote.code ? [quote.code, quote.correlationId].filter(Boolean).join(' · ') : undefined}>{card.networkSelection?.valid === false ? tr('Choose matching networks') : <>{!amountParts && <>{tr(card.summary.amount)} · </>}{tr(estimate ? `Approximate · ${estimate.provider} · Simulate before review` : quote.status === 'calculating' ? 'Calculating estimate…' : quote.status === 'unavailable' ? buildEstimateFailureMessage(quote.code ?? 'ESTIMATE_UNAVAILABLE') : 'Estimate unavailable')}</>}</span>
        {estimate?.bridge && <span className="composer-quote-note">{tr(estimate.bridge.execution === 'QUOTE_ONLY'
          ? 'Live quote only · execution is not validated' : 'Builder verified · simulation and Review still required')}</span>}
        {discovery && <details className="nodrag nopan"><summary>{tr('Provider estimates')}</summary><ul aria-label={tr('Provider estimates')}>
          {discovery.candidates.map((candidate, index) => <li key={`${candidate.provider}-${index}`} title={candidate.reason ?? undefined}>
            {candidate.provider} · {tr(({ EXECUTABLE: 'Builder verified · simulation and Review still required', LIVE_QUOTE: 'Live quote only', BELOW_MINIMUM: 'Below provider minimum',
              ABOVE_MAXIMUM: 'Above provider maximum', INSUFFICIENT_LIQUIDITY: 'Insufficient liquidity', TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable',
              NO_ROUTE: 'No route', SUPPORTED_BY_PROVIDER: 'Supported, no quote', INTERNAL_ERROR: 'Internal quote error' } as const)[candidate.status])}
          </li>)}
        </ul></details>}
        {editor?.changed && (directCommit ? <div className="composer-amount-actions composer-amount-direct">
          <span className="composer-amount-hint">{tr("Press Enter to apply")}</span>
          {editor.onCancel && <button type="button" className="composer-amount-cancel" onClick={() => { setAmountError(null); editor.onCancel!(); }}>{tr("Cancel")}</button>}
        </div> : <div className="composer-amount-actions">
          <button type="submit" className="composer-amount-review" disabled={card.networkSelection?.valid === false || card.actionSelection?.valid === false}>{tr("Review amount")}</button>
          {card.contextualProposal ? <ProposalReviewArtifact portalFromCard canApply={editor.canApply} onApply={editor.onApply}/>
            : <button type="button" className="composer-amount-apply" disabled={!editor.canApply} onClick={editor.onApply}>{tr("Apply amount")}</button>}
          {editor.onCancel && <button type="button" className="composer-amount-cancel" onClick={editor.onCancel}>{tr("Cancel")}</button>}
        </div>)}
        {amountError && <span className="composer-amount-error" role="alert">{tr(amountError)}</span>}
      </AmountContainer> : poolValues?.length === 2 ? <ValuePair relationship="contribution" className="nodrag nopan">
        <ValueBox source label="First liquidity asset amount" inputLabel={`First liquidity amount (${poolValues[0]!.token})`} amount={poolValues[0]!.amount} token={poolValues[0]!.token} network={sourceNetwork} hint="First liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst} usd={usdLine(sourceNetwork, null, { status: 'none' })}
          picker={picker('source')} editor={card.poolProposal ? { value: poolValues[0]!.amount, formId: card.poolProposal.formId, onChange: amount => poolContributions.edit(0, amount) } : undefined}/>
        <ValueBox label="Second liquidity asset amount" inputLabel={`Second liquidity amount (${poolValues[1]!.token})`} amount={poolValues[1]!.amount} token={poolValues[1]!.token} network={sourceNetwork} hint="Second liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst} usd={usdLine(sourceNetwork, null, { status: 'none' })}
          picker={picker('destination')} editor={card.poolProposal ? { value: poolValues[1]!.amount, formId: card.poolProposal.formId, onChange: amount => poolContributions.edit(1, amount) } : undefined}/>
      </ValuePair> : !card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw', 'Send'].includes(card.summary.action) && (amountParts || editor)
        ? <ValueBox source fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst} usd={usdLine(sourceNetwork, null, { status: 'none' })} amount={amountParts?.[1]} token={amountParts?.[2] ?? 'USDC'} network={sourceNetwork} picker={picker('source')} editor={editor} hint={editor ? 'Enter the source amount' : card.summary.amount}/>
        : <span className="numeric composer-amount">{tr(card.summary.amount)}</span>}
      {!card.inspection && card.recipient && <RecipientField recipient={card.recipient} formId={card.supplyProposal?.formId}/>}
      {!card.inspection && card.supplyProposal && <div className="composer-amount-actions composer-supply-actions nodrag nopan" onClick={event => event.stopPropagation()}>
        <button type="submit" form={card.supplyProposal.formId} className="composer-amount-review" title={card.recipient && card.recipient.status !== 'valid' ? tr('Enter the recipient address.') : undefined}
          disabled={!card.supplyProposal.canReview || card.actionSelection?.valid === false || Boolean(card.recipient && card.recipient.status !== 'valid')}>{tr(card.supplyProposal.reviewLabel ?? 'Review Supply change')}</button>
        {card.supplyProposal.hasProposal && (card.contextualProposal ? <ProposalReviewArtifact portalFromCard canApply={card.supplyProposal.canApply} onApply={card.supplyProposal.onApply}/>
          : <button type="button" className="composer-amount-apply" disabled={!card.supplyProposal.canApply} onClick={card.supplyProposal.onApply}>{tr("Apply proposal")}</button>)}
      </div>}
      {!amountBox && !poolCard && (!card.inspection || !pairDestination) && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{tr(pair)}</span>}
      {poolCard && <div className="composer-pool-controls">
        {poolMode === 'Price' && <PoolPriceRange percent={poolRange.percent} preset={poolRange.preset} extent={poolRange.extent} reference={poolRange.reference} onChange={poolRange.edit}/>}
        <div className="composer-pool-control-row">{poolMode === 'Price' && (poolRange.preset && poolRange.preset !== 'Estável'
          ? <button type="button" className="composer-pool-custom-box composer-pool-preset-summary nodrag nopan" aria-label={tr("Edit custom range")} onClick={event => { event.stopPropagation(); poolRange.edit(poolRange.percent); }}><span>{tr("Custom")}</span><span>{tr(priceStrategies.find(preset => preset.title === poolRange.preset)!.range)}</span></button>
          : <PoolCustomRange value={poolRange.percent} onChange={poolRange.edit}/>)}<PoolRangeSelector mode={poolMode} onChange={changePoolMode}/></div>
        {card.poolProposal && <div className="composer-amount-actions nodrag nopan" onClick={event => event.stopPropagation()}>
          <button type="submit" form={card.poolProposal.formId} className="composer-amount-review" disabled={!card.poolProposal.canReview || card.actionSelection?.valid === false || (poolRange.edited && !poolRange.reference)}>{tr("Review")}</button>
          {card.contextualProposal ? <ProposalReviewArtifact portalFromCard canApply={card.poolProposal.canApply && (!poolRange.edited || poolRange.reviewCurrent)} onApply={() => { card.poolProposal!.onApply(); poolRange.reset(); }}/>
            : <button type="button" className="composer-amount-apply" disabled={!card.poolProposal.canApply || (poolRange.edited && !poolRange.reviewCurrent)} onClick={() => { card.poolProposal!.onApply(); poolRange.reset(); }}>{tr("Apply")}</button>}
        </div>}
      </div>}
      {!card.inspection && !quietAmount && card.validation.message && <span className="composer-warning" title={tr(card.validation.message)}>{tr("Check settings")}</span>}
      {card.summary.risk && <span className="flow-card-risk">{tr(card.summary.risk)}</span>}
      {!card.inspection && <button type="button" className="composer-selected nodrag nopan" aria-haspopup="dialog" aria-expanded={Boolean(card.settingsOpen)} aria-label={tr("Action settings")}
        onClick={event => { event.stopPropagation(); card.onOpenSettings?.(); }} title={tr("Open this action's settings")}>{tr("Settings ")}<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>}
      <Handle id="output" type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={!card.inspection && Boolean(card.connectable)}/>
    </div>;
  // BUILD-BASE-001: on an official-catalog network the editable picker also searches the whole validated catalog (swaps and pools: ERC-20s).
  const catalogNetwork = card.actionSelection && card.actionSelection.tokens[tokenPanel || 'source'].length > 1 ? networkIdentity(tokenNetwork) : null;
  const searchAction = card.actionSelection?.selection.action;
  const tokenSearch = tokenPanel && catalogNetwork?.catalog && (searchAction === 'swap' || searchAction === 'pool' || (searchAction === 'transfer' && tokenPanel === 'source'))
    ? { chain: catalogNetwork.chain, accept: (asset: CanonicalAsset) => searchAction === 'transfer' || asset.kind === 'ERC20',
      onSelect: (symbol: string) => card.actionSelection!.onToken(tokenPanel, symbol) } : undefined;
  const tokens = tokenPanel && tokenSymbol && <AssetNetworkPicker key={tokenPanel + tokenNetwork} id={tokenPanelId} side={tokenPanel} symbol={tokenSymbol} network={tokenNetwork}
    tokens={tokenOptions} networks={card.actionSelection?.networks ?? []} onCollapse={collapseTokens} search={tokenSearch}
    onTokenChange={symbol => { if (card.actionSelection) card.actionSelection.onToken(tokenPanel, symbol); else card.tokenSelection?.onSelect(tokenPanel, symbol); }}
    onNetworkChange={network => { card.actionSelection?.onNetwork(network); setAmountError(null); if (poolCard) poolRange.reset(); }}/>;
  const bridgeKey = universalKeyOfCanvasLabel(bridgeNetwork);
  // A network change can clear an incompatible asset; keep the picker available for the required new selection.
  const bridge = bridgePanel && <AssetNetworkPicker bridge key={bridgePanel + bridgeNetwork} id={bridgePanelId} side={bridgePanel} symbol={bridgeSymbol ?? ''} network={bridgeNetwork}
    tokens={card.tokenSelection?.[bridgePanel] ?? (bridgeSymbol ? [bridgeSymbol] : [])} networks={card.networkSelection?.[bridgePanel] ?? [bridgeNetwork]} unavailable={card.networkSelection?.unavailable}
    selectedReference={card.tokenSelection?.references?.[bridgePanel]}
    search={bridgeKey && card.tokenSelection ? { chain: UNIVERSAL_NETWORKS[bridgeKey].chain, accept: () => true, identity: true, onSelect: reference => card.tokenSelection!.onSelect(bridgePanel, reference) } : undefined}
    onTokenChange={symbol => card.tokenSelection?.onSelect(bridgePanel, symbol)}
    onNetworkChange={network => { card.networkSelection?.onSelect(bridgePanel, network); setAmountError(null); }} onCollapse={collapseBridge}/>;
  return poolCard ? <div ref={poolNodeRef} className="composer-pool-node">{tr(content)}{tr(tokens)}{poolPanelOpen && <PoolPricePanel strategy={poolRange.preset} onSelect={poolRange.selectPreset} onCollapse={() => setPoolPanelOpen(false)}/>}</div> : card.stocks ? <div ref={poolNodeRef} className="composer-stocks-node">{tr(content)}
    {stocksPanelOpen && <StocksPanel id={stocksPanelId} equity={card.stocks.equity} onChange={card.stocks.onEquityChange} onCollapse={() => setStocksPanelOpen(false)}/>}
  </div> : !card.inspection && (amountBox || ['Supply', 'Borrow', 'Repay', 'Withdraw', 'Send'].includes(card.summary.action)) ? <div ref={poolNodeRef} className="composer-token-node">{tr(content)}{tr(tokens)}{tr(bridge)}</div> : content;
}
