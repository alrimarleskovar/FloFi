// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: server-only glue between FloFi Wallet's signing binding (`server/managed-signing.ts`) and the flows' own
 * services. Not a server action module: nothing here is callable from a browser.
 *
 * - Runs are read through each flow's existing `status` action, i.e. the same cloud flow (hosted) or local service (development) the
 *   product uses, so FloFi Wallet sees exactly the durable attempt the owner's store prepared, never a copy.
 * - EVM reads and broadcasts go through the `managed-wallet-evm` cloud flow on hosted deployments and the in-process module locally.
 * - `signingGate` is what FloFi Wallet's relay and sign-context route use: it resolves the binding for the managed wallets saved to the
 *   account and, for the relay, claims the attempt so FloFi Wallet signs each reviewed attempt at most once.
 */
import { createHash } from 'node:crypto';
import { canonicalAddress, MANAGED_PROVIDER, type AccountWallet } from '../accounts/account-model';
import type { AccountStore } from '../accounts/account-store';
import { cloudFlow } from '../server/flow-runtime';
import { localCatalogNetworkMode } from '../server/catalog-networks';
import { createManagedWalletEvm, type ManagedEvmBroadcast, type ManagedEvmExpected, type ManagedEvmFees, type ManagedWalletEvm } from '../server/managed-wallet-evm';
import { resolveManagedSigning, type ManagedSigningDeps, type ManagedSigningRequest, type ManagedSigningResult } from '../server/managed-signing';
import type { SigningContext, SigningFlow } from '../wallet/flofi-signing';
import { jupiterStatus } from './jupiter-action';
import { solanaTransferStatus } from './solana-transfer-action';
import { transferStatus } from './robinhood-transfer-action';
import { publicStatus } from './public-testnet-action';

const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const unwrap = <T,>(result: Result<T>): T => { if (!result.ok) throw new Error(result.code); return result.value; };

/** One run of a supported flow, as that flow's own `status` returns it. Throws the flow's code when it cannot be read. */
export async function loadSigningRun(flow: SigningFlow, runId: string): Promise<unknown> {
  switch (flow) {
    case 'jupiter-swap': return unwrap(await jupiterStatus(runId));
    case 'solana-transfer': return unwrap(await solanaTransferStatus('mainnet', runId));
    case 'robinhood-mainnet-transfer': case 'base-mainnet-transfer': case 'arbitrum-mainnet-transfer': case 'ethereum-mainnet-transfer':
      return unwrap(await transferStatus(runId));
    case 'robinhood-swap': case 'base-swap': case 'arbitrum-swap': case 'ethereum-swap': return unwrap(await publicStatus(runId));
  }
}

let local: ManagedWalletEvm | null = null;
/** Local development and the MOCKED harness only (`localCatalogNetworkMode` never allows live reads on a deployed server). */
const localEvm = () => local ??= createManagedWalletEvm({ env: process.env, mode: network => localCatalogNetworkMode(network, process.env) });
async function evm<T>(method: 'pendingNonce' | 'fees' | 'broadcast', args: readonly unknown[], run: (s: ManagedWalletEvm) => Promise<T>): Promise<T> {
  const cloud = await cloudFlow<T>('managed-wallet-evm', method, args);
  if (cloud) return unwrap(cloud);
  return run(localEvm());
}
const chainHex = (chainId: number) => `0x${chainId.toString(16)}`;
export const managedEvmPendingNonce = (chainId: number, address: string) =>
  evm<string>('pendingNonce', [chainHex(chainId), address.toLowerCase()], s => s.pendingNonce(chainHex(chainId), address));
export const managedEvmFees = (chainId: number) => evm<ManagedEvmFees>('fees', [chainHex(chainId)], s => s.fees(chainHex(chainId)));
export const managedEvmBroadcast = (chainId: number, raw: string, expected: ManagedEvmExpected) =>
  evm<ManagedEvmBroadcast>('broadcast', [chainHex(chainId), raw, expected], s => s.broadcast(chainHex(chainId), raw, expected));

/** The managed wallets (generated or imported in FloFi Wallet) among an account's saved wallets. */
export const managedWallets = (wallets: readonly AccountWallet[]) => wallets.filter(wallet => wallet.provider === MANAGED_PROVIDER && wallet.origin !== 'external');
/** The resolver's dependencies for one account's managed wallets. */
export function signingDeps(wallets: readonly AccountWallet[]): ManagedSigningDeps {
  const managed = managedWallets(wallets);
  return {
    load: loadSigningRun,
    managed: (ecosystem, address) => managed.some(wallet => wallet.ecosystem === ecosystem && wallet.address === canonicalAddress(ecosystem, address)),
    pendingNonce: async (chainId, address) => BigInt(await managedEvmPendingNonce(chainId, address)),
    fees: async chainId => { const fees = await managedEvmFees(chainId); return { maxFeePerGas: BigInt(fees.maxFeePerGas), maxPriorityFeePerGas: BigInt(fees.maxPriorityFeePerGas) }; },
  };
}
export const claimDigest = (purpose: 'signature' | 'broadcast', attempt: string) => createHash('sha256').update(`flofi-wallet-${purpose}:${attempt}`).digest('hex');
/** Claims `purpose` for a resolved attempt once (the account store's single-use proof table). */
export async function claimAttempt(store: Pick<AccountStore, 'consumeProof'>, purpose: 'signature' | 'broadcast', attempt: string, expiresAtMs: number, now = new Date()): Promise<boolean> {
  return store.consumeProof(claimDigest(purpose, attempt), new Date(Math.max(expiresAtMs, now.getTime()) + CLAIM_TTL_MS), now);
}

/**
 * Gives an attempt's signature claim back, only when the provider refused the signing request without creating any activity (it
 * answered 400, 401 or 403 to the submit): nothing was signed, so the person may sign that reviewed attempt again. An unclear outcome
 * (no answer, 5xx, success) never releases it.
 */
export const RELEASABLE_PROVIDER_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);
export async function releaseAttempt(store: Pick<AccountStore, 'releaseProof'>, attempt: string): Promise<void> {
  await store.releaseProof(claimDigest('signature', attempt));
}

/**
 * FloFi Wallet's gate for one wallet session (wallet origin only). `claim: false` (sign-context) only resolves and summarizes; `claim: true`
 * (the relay, right before forwarding a signing activity) also consumes the attempt's single signature, so a second signature for the same
 * reviewed attempt is refused (`FLOFI_WALLET_ALREADY_SIGNED`) whoever asks for it.
 */
export function signingGate(store: Pick<AccountStore, 'consumeProof'>, wallets: readonly AccountWallet[], options: { readonly claim: boolean },
  deps: ManagedSigningDeps = signingDeps(wallets)) {
  return async (context: SigningContext, request: ManagedSigningRequest): Promise<ManagedSigningResult> => {
    const resolved = await resolveManagedSigning(context, request, deps);
    if (!resolved.ok || !options.claim) return resolved;
    let claimed: boolean;
    try { claimed = await claimAttempt(store, 'signature', resolved.value.attempt, resolved.value.expiresAtMs); }
    catch { return { ok: false, code: 'FLOFI_WALLET_REVIEW_UNAVAILABLE' }; }
    return claimed ? resolved : { ok: false, code: 'FLOFI_WALLET_ALREADY_SIGNED' };
  };
}
