// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: saves wallets created or imported in FloFi Wallet to the FloFi account (wallet origin only). The server
 * asks the provider, with FloFi's parent key (read-only queries), whether each address belongs to this person's own organization.
 */
import { currentWalletSession, sameWalletOrigin, walletError, walletHost, walletJson } from '../../../../accounts/wallet-host';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  const session = await currentWalletSession(host);
  if (!session) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' });
  try {
    const body = await request.json().catch(() => null) as { ids?: unknown } | null;
    const saved = await host.service.saveWallets(session, body?.ids, ids => host.account.service.saveManagedWallets(session.account, ids));
    return walletJson(200, { saved, context: await host.service.context(session) });
  } catch (cause) { return walletError(cause, 'ACCOUNT_WALLET_SAVE_FAILED'); }
}
