// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: authorizes one export of a managed wallet (wallet origin only): an unlock in the last 5 minutes and a
 * managed wallet saved to this account. The secret is decrypted only inside the provider's export iframe on the wallet page.
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
    const body = await request.json().catch(() => null) as { id?: unknown; kind?: unknown } | null;
    return walletJson(200, { grant: await host.service.exportGrant(session, body?.id, body?.kind) });
  } catch (cause) { return walletError(cause, 'EXPORT_NOT_AUTHORIZED', 403); }
}
