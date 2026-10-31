// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the contract that binds every FloFi Wallet signature to one reviewed FloFi attempt.
 *
 * Why: the product origin runs without `script-src`, so a request that reaches FloFi Wallet may have been written by injected script.
 * FloFi Wallet therefore never signs bytes on the word of the product page. Each signing request names the run it belongs to
 * (`{flow, runId}`); FloFi Wallet's own server loads that run through the run's own service, requires its PREPARED or SUBMITTING attempt
 * to belong to a managed wallet saved to the account and to carry exactly these bytes, and returns a summary built from the server's
 * Review. Requests that match nothing are refused (`FLOFI_WALLET_NO_MATCHING_REVIEW`); flows FloFi cannot bind yet are refused by name
 * (`FLOFI_WALLET_FLOW_NOT_SUPPORTED`). The relay requires the same binding (`x-flofi-signing`) before it forwards a signing activity.
 *
 * Shared by the product page, FloFi Wallet's pages and the server: no engine, Ajv or server import may ever be added here (the wallet
 * origin's bundle runs under a policy without `'unsafe-eval'`).
 */
import type { WalletEcosystem } from './wallet-registry';

/**
 * FloFi Wallet is a mainnet wallet only (owner requirement for PR #143): Ethereum, Base, Arbitrum One and Robinhood Chain mainnet, and Solana
 * mainnet. Every Devnet/testnet chain or cluster is refused at the signing boundary (product providers, FloFi Wallet's page, its relay).
 */
export const FLOFI_WALLET_EVM_CHAIN_IDS: ReadonlySet<number> = new Set([1, 8453, 42161, 4663]);
export const FLOFI_WALLET_SOLANA_CHAIN = 'solana:mainnet' as const;
/** The flows FloFi Wallet can bind a signature to (spec §3), with their run namespaces: mainnet flows only. Every other flow is refused by name. */
export const SIGNING_FLOWS = Object.freeze({
  'jupiter-swap': { ecosystem: 'solana', run: /^jupiter-[a-f0-9]{32}$/ },
  'solana-transfer': { ecosystem: 'solana', run: /^soltx-[a-f0-9]{32}$/ },
  'robinhood-mainnet-transfer': { ecosystem: 'evm', run: /^rht-[a-f0-9]{32}$/ },
  'base-mainnet-transfer': { ecosystem: 'evm', run: /^bat-[a-f0-9]{32}$/ },
  'arbitrum-mainnet-transfer': { ecosystem: 'evm', run: /^art-[a-f0-9]{32}$/ },
  'ethereum-mainnet-transfer': { ecosystem: 'evm', run: /^ett-[a-f0-9]{32}$/ },
  'robinhood-swap': { ecosystem: 'evm', run: /^rhs-[0-9a-f]{24}$/ },
  'base-swap': { ecosystem: 'evm', run: /^bas-[0-9a-f]{24}$/ },
  'arbitrum-swap': { ecosystem: 'evm', run: /^ars-[0-9a-f]{24}$/ },
  'ethereum-swap': { ecosystem: 'evm', run: /^ets-[0-9a-f]{24}$/ },
} satisfies Readonly<Record<string, { readonly ecosystem: WalletEcosystem; readonly run: RegExp }>>);
export type SigningFlow = keyof typeof SIGNING_FLOWS;
export const isSigningFlow = (flow: unknown): flow is SigningFlow => typeof flow === 'string' && Object.hasOwn(SIGNING_FLOWS, flow);

/** Which reviewed FloFi run a signing request belongs to. Carries no authority: the server resolves and checks it. */
export type SigningContext = { readonly flow: string; readonly runId: string };
const FLOW = /^[a-z][a-z0-9-]{2,63}$/, RUN = /^[a-z]{2,8}-[0-9a-f]{24,32}$/;
export function parseSigningContext(value: unknown): SigningContext | null {
  const r = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return r && Object.keys(r).length === 2 && typeof r.flow === 'string' && FLOW.test(r.flow) && typeof r.runId === 'string' && RUN.test(r.runId)
    ? { flow: r.flow, runId: r.runId } : null;
}
/**
 * The binding of a run by its id: the supported flow whose namespace it is in, else `fallback` (the store's own flow name, which FloFi
 * Wallet then refuses by name as not supported yet).
 */
export function signingContextOf(runId: string, fallback: string): SigningContext {
  const flow = (Object.keys(SIGNING_FLOWS) as SigningFlow[]).find(name => SIGNING_FLOWS[name].run.test(runId));
  return { flow: flow ?? fallback, runId };
}
/** The relay header value: `<flow>:<runId>`. */
export const SIGNING_HEADER = 'x-flofi-signing';
export const signingHeaderValue = (context: SigningContext) => `${context.flow}:${context.runId}`;
export function parseSigningHeader(value: string | null | undefined): SigningContext | null {
  if (typeof value !== 'string' || value.length > 120) return null;
  const index = value.indexOf(':');
  return index > 0 ? parseSigningContext({ flow: value.slice(0, index), runId: value.slice(index + 1) }) : null;
}

/** What FloFi Wallet shows next to "Exactly the transaction FloFi prepared for this strategy": built by the server from its Review, never by the product page. */
export type SigningSummary = { readonly flow: SigningFlow; readonly runId: string; readonly network: string; readonly chain: string; readonly realFunds: boolean;
  readonly action: string; readonly owner: string; readonly lines: readonly { readonly label: string; readonly value: string }[]; readonly expiresAt: string | null };
/** Printable, single-line text (no control characters), bounded. */
const TEXT = { test: (value: string) => value.length >= 1 && value.length <= 200 && ![...value].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) };
export function parseSigningSummary(value: unknown): SigningSummary | null {
  const r = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!r || !isSigningFlow(r.flow) || typeof r.runId !== 'string' || !SIGNING_FLOWS[r.flow].run.test(r.runId)) return null;
  for (const key of ['network', 'chain', 'action', 'owner'] as const) if (typeof r[key] !== 'string' || !TEXT.test(r[key] as string)) return null;
  if (typeof r.realFunds !== 'boolean' || !Array.isArray(r.lines) || r.lines.length > 16) return null;
  if (r.expiresAt !== null && (typeof r.expiresAt !== 'string' || !Number.isFinite(Date.parse(r.expiresAt)))) return null;
  const lines = r.lines.map(line => line && typeof line === 'object' && typeof line.label === 'string' && TEXT.test(line.label) && typeof line.value === 'string'
    && TEXT.test(line.value) && Object.keys(line).length === 2 ? { label: line.label as string, value: line.value as string } : null);
  if (lines.some(line => !line)) return null;
  return { flow: r.flow, runId: r.runId, network: r.network as string, chain: r.chain as string, realFunds: r.realFunds, action: r.action as string,
    owner: r.owner as string, lines: lines as { label: string; value: string }[], expiresAt: r.expiresAt as string | null };
}

/**
 * Owner-facing codes of FloFi Wallet's product-side integration, with their English text (the i18n layer translates these strings; the
 * Portuguese text is listed in the build report for `src/i18n/pt.ts`).
 */
export const FLOFI_WALLET_MESSAGES = Object.freeze({
  FLOFI_WALLET_NOT_OPEN: 'FloFi Wallet is not open. Choose Continue in FloFi Wallet.',
  FLOFI_WALLET_UNAVAILABLE: 'FloFi Wallet is not available here. Sign in to your FloFi account, or use MetaMask, Phantom or Solflare.',
  FLOFI_WALLET_POPUP_BLOCKED: 'Your browser blocked the FloFi Wallet window. Allow pop-ups for FloFi, then try again.',
  FLOFI_WALLET_CLOSED: 'FloFi Wallet closed before it answered. Check the recorded status before you try again.',
  FLOFI_WALLET_BUSY: 'FloFi Wallet is already handling a request. Finish or cancel it there first.',
  FLOFI_WALLET_LOCKED: 'Unlock FloFi Wallet first, then authorize again.',
  FLOFI_WALLET_REJECTED: 'You cancelled the request in FloFi Wallet. Nothing was signed.',
  FLOFI_WALLET_NO_MATCHING_REVIEW: 'FloFi Wallet found no reviewed FloFi strategy that matches this request, so it signed nothing.',
  FLOFI_WALLET_FLOW_NOT_SUPPORTED: 'FloFi Wallet can\'t sign this action yet — use MetaMask, Phantom or Solflare.',
  FLOFI_WALLET_REVIEW_EXPIRED: 'This Review has expired. Simulate again before you sign.',
  FLOFI_WALLET_REVIEW_UNAVAILABLE: 'FloFi Wallet could not load the Review right now. Nothing was signed. Try again shortly.',
  FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED: 'FloFi Wallet signs only actions you reviewed and authorized in FloFi.',
  FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED: 'FloFi Wallet signs only EIP-1559 transactions. Use another wallet for this action.',
  FLOFI_WALLET_NETWORK_UNSUPPORTED: 'FloFi Wallet works on Base, Arbitrum, Ethereum and Robinhood Chain.',
  FLOFI_WALLET_METHOD_UNSUPPORTED: 'FloFi Wallet does not support this wallet request.',
  FLOFI_WALLET_MESSAGE_UNSUPPORTED: 'FloFi Wallet signs only FloFi\'s own sign-in messages.',
  FLOFI_WALLET_NONCE_MISMATCH: 'Your FloFi Wallet has another pending transaction. Wait for it to confirm, then simulate again.',
  FLOFI_WALLET_FEE_TOO_HIGH: 'Network fees are far above the expected range right now. Try again shortly.',
  FLOFI_WALLET_NETWORK_READ_FAILED: 'FloFi could not read the network right now. Nothing was signed. Try again shortly.',
  FLOFI_WALLET_ALREADY_SIGNED: 'FloFi Wallet already signed this attempt once. FloFi is checking its status; do not sign again.',
  FLOFI_WALLET_SIGNER_MISMATCH: 'The signature does not belong to the reviewed FloFi Wallet address. FloFi did not broadcast it.',
  FLOFI_WALLET_SUBMISSION_UNKNOWN: 'FloFi Wallet signed, but FloFi cannot confirm the broadcast. FloFi keeps checking the network; do not sign again.',
  FLOFI_WALLET_SIGNATURE_UNKNOWN: 'FloFi Wallet may have signed, but FloFi did not receive the signature, so nothing was submitted. Simulate again to retry.',
  FLOFI_WALLET_OPENING: 'FloFi Wallet is opening. Unlock it if it asks, then choose Authorize again.',
  FLOFI_WALLET_REQUEST_INVALID: 'FloFi Wallet could not read this request. Nothing was signed.',
  FLOFI_WALLET_ACCOUNT_REQUIRED: 'Sign in to your FloFi account to use FloFi Wallet.',
  FLOFI_WALLET_ACCOUNT_MISMATCH: 'This address is not a FloFi Wallet of the FloFi account you are signed in to.',
} as const);
export type FloFiWalletCode = keyof typeof FLOFI_WALLET_MESSAGES;
export const floFiWalletMessage = (code: string): string | null => Object.hasOwn(FLOFI_WALLET_MESSAGES, code) ? FLOFI_WALLET_MESSAGES[code as FloFiWalletCode] : null;

/**
 * Codes that prove FloFi Wallet submitted no signing activity: the request never reached the provider (refused by FloFi Wallet, its server
 * or its relay before forwarding). Everything else that fails a signing request — a closed window, an unknown code, a provider error —
 * may follow a signature and is treated as UNKNOWN, never as a refusal (spec §5). FloFi Wallet must therefore answer any failure after its
 * signing activity reached the provider with a code outside this set (`FLOFI_WALLET_SUBMISSION_UNKNOWN`), even when the underlying error
 * was one of these (for example a session that ended while polling the activity).
 */
export const PRE_SIGNATURE_CODES: ReadonlySet<string> = new Set([
  'FLOFI_WALLET_NOT_OPEN', 'FLOFI_WALLET_UNAVAILABLE', 'FLOFI_WALLET_POPUP_BLOCKED', 'FLOFI_WALLET_BUSY', 'FLOFI_WALLET_LOCKED',
  'FLOFI_WALLET_NO_MATCHING_REVIEW', 'FLOFI_WALLET_FLOW_NOT_SUPPORTED', 'FLOFI_WALLET_REVIEW_EXPIRED', 'FLOFI_WALLET_REVIEW_UNAVAILABLE',
  'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED',
  'FLOFI_WALLET_LEGACY_GAS_UNSUPPORTED', 'FLOFI_WALLET_NETWORK_UNSUPPORTED', 'FLOFI_WALLET_METHOD_UNSUPPORTED', 'FLOFI_WALLET_MESSAGE_UNSUPPORTED',
  // Not FLOFI_WALLET_ALREADY_SIGNED: this request reached nothing, but the attempt's single signature already exists somewhere, so its
  // outcome is unknown and must be reconciled, never retried as if nothing had been signed.
  'FLOFI_WALLET_NONCE_MISMATCH', 'FLOFI_WALLET_FEE_TOO_HIGH', 'FLOFI_WALLET_NETWORK_READ_FAILED',
  'FLOFI_WALLET_ACCOUNT_REQUIRED', 'FLOFI_WALLET_REQUEST_INVALID', 'FLOFI_WALLET_ACCOUNT_MISMATCH',
  // FloFi Wallet's own session and relay refusals (src/accounts/wallet-relay.ts): nothing was forwarded to the provider.
  'WALLET_SESSION_REQUIRED', 'WALLET_UNLOCK_REQUIRED', 'WALLET_HANDOFF_INVALID', 'ACCOUNT_SESSION_REQUIRED', 'MANAGED_WALLETS_NOT_CONFIGURED',
  'SIGNER_NOT_MANAGED', 'SIGN_REQUEST_INVALID', 'MANAGED_ORGANIZATION_MISSING', 'PROVIDER_ORGANIZATION_MISMATCH', 'PROVIDER_REQUEST_NOT_CANONICAL',
  'WALLET_CROSS_ORIGIN', 'PROVIDER_ROUTE_NOT_ALLOWED', 'PROVIDER_STAMP_REQUIRED', 'PROVIDER_REQUEST_TOO_LARGE', 'PROVIDER_REQUEST_INVALID',
  'PROVIDER_ACTIVITY_MISMATCH', 'ACCOUNTS_UNAVAILABLE',
]);
/** The person declined in FloFi Wallet before pressing Sign (the only failure that maps to EIP-1193 4001). */
export const REJECTED_CODE = 'FLOFI_WALLET_REJECTED';
export type SigningFailure = 'rejected' | 'refused' | 'unknown';
export const classifySigningFailure = (code: string): SigningFailure => code === REJECTED_CODE ? 'rejected' : PRE_SIGNATURE_CODES.has(code) ? 'refused' : 'unknown';
