// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's calls to its own server (`/api/wallet/*`, same origin, wallet host only).
 *
 * Every answer is read strictly and only for the fields the page uses; anything malformed fails closed with a code instead of being
 * repaired. The server is still not trusted with what the person signs: the page builds its own unlock messages (email-unlock.ts), and a
 * signing summary is shown only when it names the exact run, flow and wallet the request named. No response here ever carries a key,
 * phrase, provider session or token; the wallet session lives in an HttpOnly cookie the page cannot read.
 */
import { readAccountWallet, type AccountWallet } from '../accounts/account-model';
import { parseSigningSummary, type SigningSummary } from '../wallet/flofi-signing';
import { withoutControlCharacters } from '../wallet/wallet-registry';
import type { ExportGrant } from './provider-client';
import type { SigningBinding } from './protocol';

export type UnlockMethod = 'email' | 'google' | 'apple';
export type WalletContext = { readonly accountId: string; readonly label: string; readonly methods: readonly UnlockMethod[];
  readonly organization: { readonly organizationId: string; readonly userId: string; readonly login: UnlockMethod } | null;
  readonly wallets: readonly AccountWallet[]; readonly unlocked: boolean;
  /** Optional server fields (epoch seconds; the unlocked public key). Absent: the page knows only `unlocked`. */
  readonly unlockedAt: number | null; readonly unlockedUntil: number | null; readonly unlockedKey: string | null };

export class WalletApiError extends Error {
  constructor(code: string, readonly status: number) { super(code); this.name = 'WalletApiError'; }
}
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/, ACCOUNT = /^acct_[0-9a-f]{32}$/, RESOURCE = /^[A-Za-z0-9-]{8,64}$/, KEY = /^0[23][0-9a-f]{64}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/, CHALLENGE = /^[0-9a-f]{32}$/, TOKEN_ID = /^[A-Za-z0-9-]{8,64}$/;
const METHODS: readonly UnlockMethod[] = ['email', 'google', 'apple'];
type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
const invalid = (): never => { throw new WalletApiError('WALLET_REQUEST_FAILED', 200); };
const seconds = (value: unknown): number | null => value === undefined || value === null ? null : Number.isSafeInteger(value) && (value as number) > 0 ? value as number : invalid();

/** The wallet context the server returned, or null when any field the page relies on is missing or malformed. */
export function parseWalletContext(value: unknown): WalletContext | null {
  const r = record(value);
  if (!r || typeof r.accountId !== 'string' || !ACCOUNT.test(r.accountId) || typeof r.label !== 'string' || typeof r.unlocked !== 'boolean') return null;
  const label = withoutControlCharacters(r.label).replace(/\s+/g, ' ').trim();
  if (!label || label.length > 200 || !Array.isArray(r.methods) || !Array.isArray(r.wallets)) return null;
  const methods = r.methods.filter((method): method is UnlockMethod => METHODS.includes(method as UnlockMethod));
  if (methods.length !== r.methods.length) return null;
  let organization: WalletContext['organization'] = null;
  if (r.organization !== null) {
    const o = record(r.organization);
    if (!o || typeof o.organizationId !== 'string' || !RESOURCE.test(o.organizationId) || typeof o.userId !== 'string' || !RESOURCE.test(o.userId)
      || !METHODS.includes(o.login as UnlockMethod)) return null;
    organization = { organizationId: o.organizationId, userId: o.userId, login: o.login as UnlockMethod };
  }
  const wallets = r.wallets.map(readAccountWallet);
  // Only managed wallets belong here; an external wallet in this list would be a server error, never something to sign with.
  if (wallets.some(wallet => !wallet || wallet.provider !== 'turnkey' || wallet.origin === 'external')) return null;
  try {
    const unlockedKey = r.unlockedKey === undefined || r.unlockedKey === null ? null : typeof r.unlockedKey === 'string' && KEY.test(r.unlockedKey) ? r.unlockedKey : invalid();
    return { accountId: r.accountId, label, methods: [...new Set(methods)], organization, wallets: wallets as AccountWallet[], unlocked: r.unlocked,
      unlockedAt: seconds(r.unlockedAt), unlockedUntil: seconds(r.unlockedUntil), unlockedKey };
  } catch { return null; }
}

async function call(path: string, method: 'GET' | 'POST' | 'DELETE', body: unknown, fallback: string): Promise<Json> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
    ...body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } };
  const response = await fetch(path, init).catch(() => { throw new WalletApiError(fallback, 0); });
  const value = record(await response.json().catch(() => null));
  if (!response.ok) throw new WalletApiError(value && typeof value.code === 'string' && CODE.test(value.code) ? value.code : fallback, response.status);
  return value ?? invalid();
}
const contextOf = (value: Json, appOrigin: string | null): WalletContext => {
  if (appOrigin !== null && value.appOrigin !== appOrigin) throw new WalletApiError('MANAGED_WALLETS_NOT_CONFIGURED', 200);
  return parseWalletContext(value.context) ?? invalid();
};

export const walletApi = {
  /** The account this browser's wallet session serves (401 `WALLET_SESSION_REQUIRED` when there is none). */
  async session(appOrigin: string): Promise<WalletContext> { return contextOf(await call('/api/wallet/session', 'GET', undefined, 'WALLET_SESSION_REQUIRED'), appOrigin); },
  /** Redeems the product page's single-use handoff (received by postMessage from the opener only). */
  async redeem(token: string, appOrigin: string): Promise<WalletContext> {
    return contextOf(await call('/api/wallet/session', 'POST', { handoff: token }, 'WALLET_HANDOFF_INVALID'), appOrigin);
  },
  async lock(): Promise<void> { await call('/api/wallet/session', 'DELETE', undefined, 'WALLET_REQUEST_FAILED'); },
  async emailStart(key: string): Promise<{ challengeId: string; email: string; targetBundle: string }> {
    const v = await call('/api/wallet/unlock/email', 'POST', { step: 'start', key }, 'EMAIL_SIGN_IN_FAILED');
    if (typeof v.challengeId !== 'string' || !CHALLENGE.test(v.challengeId) || typeof v.email !== 'string' || !EMAIL.test(v.email)
      || typeof v.targetBundle !== 'string' || v.targetBundle.length < 16 || v.targetBundle.length > 16_384) invalid();
    return { challengeId: v.challengeId as string, email: v.email as string, targetBundle: v.targetBundle as string };
  },
  async emailVerify(challengeId: string, encryptedOtpBundle: string): Promise<{ tokenId: string; email: string; signup: boolean }> {
    const v = await call('/api/wallet/unlock/email', 'POST', { step: 'verify', challengeId, encryptedOtpBundle }, 'EMAIL_SIGN_IN_FAILED');
    if (typeof v.tokenId !== 'string' || !TOKEN_ID.test(v.tokenId) || typeof v.email !== 'string' || !EMAIL.test(v.email) || typeof v.signup !== 'boolean') invalid();
    return { tokenId: v.tokenId as string, email: v.email as string, signup: v.signup as boolean };
  },
  async emailFinish(loginSignature: string, signupSignature: string | null): Promise<{ context: WalletContext; unlockedUntil: number | null }> {
    const v = await call('/api/wallet/unlock/email', 'POST', { step: 'finish', loginSignature, ...signupSignature ? { signupSignature } : {} }, 'EMAIL_SIGN_IN_FAILED');
    return { context: contextOf(v, null), unlockedUntil: seconds(v.unlockedUntil) };
  },
  /** The provider's authorization URL for a Google/Apple unlock, opened in a child window. Only https (or the loopback test harness). */
  async oidcStart(provider: 'google' | 'apple', key: string): Promise<string> {
    const v = await call('/api/wallet/unlock/oidc', 'POST', { provider, key }, 'OIDC_SIGN_IN_FAILED');
    let url: URL;
    try { url = new URL(typeof v.url === 'string' ? v.url : ''); } catch { return invalid(); }
    const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if ((url.protocol !== 'https:' && !loopback) || url.username || url.password) invalid();
    return url.href;
  },
  async saveWallets(ids: readonly string[]): Promise<{ saved: readonly AccountWallet[]; context: WalletContext }> {
    const v = await call('/api/wallet/wallets', 'POST', { ids }, 'ACCOUNT_WALLET_SAVE_FAILED');
    const saved = Array.isArray(v.saved) ? v.saved.map(readAccountWallet) : null;
    if (!saved || saved.some(wallet => !wallet)) invalid();
    return { saved: saved as AccountWallet[], context: contextOf(v, null) };
  },
  /** One export of `wallet`, authorized by the server (unlock in the last 5 minutes); checked to be for exactly that wallet and kind. */
  async exportGrant(wallet: AccountWallet, kind: 'recovery-phrase' | 'private-key'): Promise<ExportGrant> {
    const v = record((await call('/api/wallet/export', 'POST', { id: wallet.id, kind }, 'EXPORT_NOT_AUTHORIZED')).grant) ?? invalid();
    const source = v.source === 'wallet' || v.source === 'wallet-account' || v.source === 'private-key' ? v.source : invalid();
    const keyFormat = wallet.ecosystem === 'evm' ? 'HEXADECIMAL' : 'SOLANA';
    if (typeof v.organizationId !== 'string' || !RESOURCE.test(v.organizationId) || v.address !== wallet.address || v.keyFormat !== keyFormat || v.kind !== kind
      || (kind === 'recovery-phrase') !== (source === 'wallet') || typeof v.resource !== 'string'
      || (source === 'wallet-account' ? v.resource !== wallet.address : !RESOURCE.test(v.resource))) invalid();
    return { organizationId: v.organizationId as string, source, resource: v.resource as string, address: wallet.address, keyFormat };
  },
  /**
   * The server's Review summary for the FloFi attempt `binding` names, if the request's bytes match it exactly (spec decision 2). The
   * summary must name the same flow, run and owner as the request; otherwise, or when the server cannot answer, nothing is signable.
   */
  async signingContext(binding: SigningBinding, address: string, request: Json): Promise<SigningSummary> {
    let v: Json;
    try { v = await call('/api/wallet/sign-context', 'POST', { flow: binding.flow, runId: binding.runId, address, ...request }, 'FLOFI_WALLET_REVIEW_UNAVAILABLE'); }
    catch (error) {
      // The server's refusal code when it gave one (no match, flow not supported, expired…); otherwise the review could not be loaded.
      throw error instanceof WalletApiError && error.message !== 'WALLET_REQUEST_FAILED' ? error : new WalletApiError('FLOFI_WALLET_REVIEW_UNAVAILABLE', 0);
    }
    const summary = parseSigningSummary(v.summary);
    if (!summary) throw new WalletApiError('FLOFI_WALLET_REVIEW_UNAVAILABLE', 200);
    const owner = summary.owner.startsWith('0x') ? summary.owner.toLowerCase() : summary.owner;
    if (summary.flow !== binding.flow || summary.runId !== binding.runId || owner !== address) throw new WalletApiError('FLOFI_WALLET_NO_MATCHING_REVIEW', 200);
    return summary;
  },
};
