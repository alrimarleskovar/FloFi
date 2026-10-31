// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the product origin's server actions for FloFi Wallet (product host only; the proxy refuses server actions
 * on the wallet host). Each one derives the account from the verified HttpOnly account session, never from an argument.
 *
 * - `floFiWalletInfo`: whether FloFi Wallet is available here, its origin, and the public addresses of the account's managed wallets.
 * - `floFiWalletHandoff`: a sealed, single-use, 120-second handoff naming this account session, delivered to the FloFi Wallet window by
 *   `postMessage` (never in a URL). Holding one opens no provider session: unlocking still needs the person's email code or Google/Apple.
 * - `floFiEvmPendingNonce` / `floFiEvmFees`: the reads FloFi Wallet's EVM provider needs, for the account's own managed addresses on the
 *   four catalog mainnets only (the product page has no RPC).
 * - `floFiEvmBroadcast`: FloFi broadcasts an owner-signed transaction only after re-resolving the reviewed attempt it is bound to: the
 *   signed bytes are decoded here, their sender must be that attempt's owner and a managed wallet of this account, every field must equal
 *   the attempt's, and each attempt is broadcast at most once. An unclear outcome is UNKNOWN, never a refusal (spec §4, §5).
 * None of these actions signs anything or holds a key.
 */
import { accountHost, currentAccountSession, type AccountHost } from '../accounts/account-host';
import type { AccountSessionToken } from '../accounts/account-session';
import { sealWalletHandoff } from '../accounts/wallet-session';
import { managedWalletsAvailable, walletOrigin } from '../accounts/wallet-origin';
import { canonicalAddress } from '../accounts/account-model';
import { decodeSignedEip1559, resolveManagedSigning } from '../server/managed-signing';
import { expectedBroadcast, managedEvmNetwork, type ManagedEvmBroadcast, type ManagedEvmFees } from '../server/managed-wallet-evm';
import { parseSigningContext } from '../wallet/flofi-signing';
import { claimAttempt, managedEvmBroadcast, managedEvmFees, managedEvmPendingNonce, managedWallets, signingDeps } from './flofi-wallet-signing';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
export type FloFiManagedWallet = { readonly ecosystem: 'evm' | 'solana'; readonly address: string; readonly label: string };
/** `null` when FloFi Wallet is not available to this browser (not configured here, or no FloFi account session). */
export type FloFiWalletInfo = { readonly walletOrigin: string; readonly wallets: readonly FloFiManagedWallet[] } | null;
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown, fallback: string): { ok: false; code: string } =>
  ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback });
const fail = (code: string): never => { throw new Error(code); };
async function signedIn(): Promise<{ host: AccountHost; session: AccountSessionToken }> {
  let host: AccountHost | null;
  try { host = await accountHost(); } catch { host = null; }
  const session = await currentAccountSession(host);
  return host && session ? { host, session } : fail('FLOFI_WALLET_ACCOUNT_REQUIRED');
}
async function accountManagedWallets(host: AccountHost, session: AccountSessionToken) {
  const account = await host.store.account(session.accountId) ?? fail('FLOFI_WALLET_ACCOUNT_REQUIRED');
  return managedWallets(account!.wallets);
}

export async function floFiWalletInfo(): Promise<Result<FloFiWalletInfo>> {
  const origin = walletOrigin(process.env);
  if (!origin || !managedWalletsAvailable(process.env)) return { ok: true, value: null };
  try {
    let host: AccountHost | null;
    try { host = await accountHost(); } catch { host = null; }
    const session = await currentAccountSession(host);
    if (!host || !session) return { ok: true, value: null };
    const wallets = (await accountManagedWallets(host, session)).map(wallet => ({ ecosystem: wallet.ecosystem, address: wallet.address, label: wallet.label }));
    return { ok: true, value: { walletOrigin: origin.origin, wallets } };
  } catch (cause) { return failure(cause, 'FLOFI_WALLET_UNAVAILABLE'); }
}

export async function floFiWalletHandoff(): Promise<Result<{ readonly token: string; readonly walletOrigin: string }>> {
  try {
    const origin = walletOrigin(process.env);
    if (!origin || !managedWalletsAvailable(process.env)) fail('FLOFI_WALLET_UNAVAILABLE');
    const { session } = await signedIn();
    return { ok: true, value: { token: sealWalletHandoff(process.env, session, origin!.host, new Date()), walletOrigin: origin!.origin } };
  } catch (cause) { return failure(cause, 'FLOFI_WALLET_UNAVAILABLE'); }
}

export async function floFiEvmPendingNonce(chainId: string, address: string): Promise<Result<string>> {
  try {
    const network = managedEvmNetwork(chainId) ?? fail('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    const owner = canonicalAddress('evm', address) ?? fail('FLOFI_WALLET_REQUEST_INVALID');
    const { host, session } = await signedIn();
    if (!(await accountManagedWallets(host, session)).some(wallet => wallet.ecosystem === 'evm' && wallet.address === owner)) fail('FLOFI_WALLET_ACCOUNT_MISMATCH');
    return { ok: true, value: await managedEvmPendingNonce(network!.chainId, owner!) };
  } catch (cause) { return failure(cause, 'FLOFI_WALLET_NETWORK_READ_FAILED'); }
}

export async function floFiEvmFees(chainId: string): Promise<Result<ManagedEvmFees>> {
  try {
    const network = managedEvmNetwork(chainId) ?? fail('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    const { host, session } = await signedIn();
    if (!(await accountManagedWallets(host, session)).some(wallet => wallet.ecosystem === 'evm')) fail('FLOFI_WALLET_ACCOUNT_MISMATCH');
    return { ok: true, value: await managedEvmFees(network!.chainId) };
  } catch (cause) { return failure(cause, 'FLOFI_WALLET_NETWORK_READ_FAILED'); }
}

/**
 * Broadcasts the owner-signed transaction of one reviewed attempt. Any refusal here happens after FloFi Wallet signed, so the caller must
 * report the attempt UNKNOWN and discard the bytes; a HASH may still be pending.
 */
export async function floFiEvmBroadcast(signing: unknown, raw: unknown): Promise<Result<ManagedEvmBroadcast>> {
  try {
    const context = parseSigningContext(signing) ?? fail('FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED');
    const decoded = typeof raw === 'string' ? decodeSignedEip1559(raw) : null;
    if (!decoded) fail('FLOFI_WALLET_SIGNED_TRANSACTION_INVALID');
    const { host, session } = await signedIn(), wallets = await accountManagedWallets(host, session);
    // The same resolution FloFi Wallet's relay applied before signing, now on the signed bytes and their recovered sender.
    const resolved = await resolveManagedSigning(context!, { ecosystem: 'evm', tx: decoded!.tx }, { ...signingDeps(wallets), filledBoundedAtSigning: true });
    if (!resolved.ok) fail(resolved.code);
    const match = (resolved as Extract<typeof resolved, { ok: true }>).value;
    if (!match.evm || match.owner !== decoded!.tx.from) fail('FLOFI_WALLET_SIGNER_MISMATCH');
    if (!await claimAttempt(host.store, 'broadcast', match.attempt, match.expiresAtMs)) fail('FLOFI_WALLET_ALREADY_SIGNED');
    return { ok: true, value: await managedEvmBroadcast(match.evm!.chainId, (raw as string).toLowerCase(), expectedBroadcast(decoded!.tx, decoded!.hash)) };
  } catch (cause) { return failure(cause, 'FLOFI_WALLET_SUBMISSION_UNKNOWN'); }
}
