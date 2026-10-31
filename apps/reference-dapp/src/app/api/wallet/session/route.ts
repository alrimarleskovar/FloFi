// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet session (wallet origin only).
 * GET: the account this wallet session serves and its managed wallets (public data). POST `{handoff}`: redeems a single-use handoff from
 * a product page with a verified account session (src/accounts/wallet-session.ts). DELETE: locks FloFi Wallet in this browser.
 */
import { currentWalletSession, clearWalletSession, sameWalletOrigin, setWalletSession, walletError, walletHost, walletJson } from '../../../../accounts/wallet-host';
import { readWalletHandoff, redeemedWalletSession } from '../../../../accounts/wallet-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(404, { code: 'NOT_FOUND' });
  const session = await currentWalletSession(host);
  if (!session) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' });
  try { return walletJson(200, { context: await host.service.context(session), appOrigin: host.origin.appOrigin }); }
  catch (cause) { return walletError(cause, 'WALLET_SESSION_REQUIRED', 401); }
}

export async function POST(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  try {
    const body = await request.json().catch(() => null) as { handoff?: unknown } | null;
    const now = new Date(), handoff = readWalletHandoff(process.env, body?.handoff, now, host.origin.host);
    if (!handoff) return walletJson(401, { code: 'WALLET_HANDOFF_INVALID' });
    // Single use, and only while the account session it names is still valid (not signed out, not revoked, not expired).
    if (!await host.account.store.consumeProof(handoff.digest, new Date(handoff.expiresAt * 1000), now)) return walletJson(401, { code: 'WALLET_HANDOFF_INVALID' });
    if (!await host.account.store.verifySession(handoff.account, now)) return walletJson(401, { code: 'ACCOUNT_SESSION_REQUIRED' });
    // Reopening FloFi Wallet from the same account session keeps a live unlock; anything else starts locked.
    const session = redeemedWalletSession(handoff.account, await currentWalletSession(host).catch(() => null), now);
    await setWalletSession(host, session);
    return walletJson(200, { context: await host.service.context(session), appOrigin: host.origin.appOrigin });
  } catch (cause) { return walletError(cause); }
}

export async function DELETE(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  await clearWalletSession(host);
  return walletJson(200, { ok: true });
}
