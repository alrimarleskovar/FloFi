// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: what FloFi Wallet may show before it offers Sign (wallet origin only; spec §2).
 *
 * POST `{flow, runId, op, address, tx | chain + transaction}` (or the operation with its own `signing` binding) → `{summary}` built from the
 * server's Review of that run, or a refusal code. The request must be a same-origin request of a valid wallet session; the run is loaded
 * through its own flow; its PREPARED/SUBMITTING attempt must belong to a managed wallet saved to this account and carry exactly these
 * bytes (`server/managed-signing.ts`). Read-only: nothing is claimed, signed or sent here; the relay re-checks and claims at signing time.
 */
import { currentWalletSession, sameWalletOrigin, walletHost, walletJson } from '../../../../accounts/wallet-host';
import { parseSigningRequest } from '../../../../server/managed-signing';
import { signingGate } from '../../../flofi-wallet-signing';

export const dynamic = 'force-dynamic';
const NOSNIFF = { 'x-content-type-options': 'nosniff' };
const MAX_BODY = 300_000;
/** Refusals are the person's to read (403); a run or network that cannot be read right now is a temporary failure (503). */
const TEMPORARY = new Set(['FLOFI_WALLET_REVIEW_UNAVAILABLE', 'FLOFI_WALLET_NETWORK_READ_FAILED']);

export async function POST(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' }, NOSNIFF);
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' }, NOSNIFF);
  const session = await currentWalletSession(host);
  if (!session) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' }, NOSNIFF);
  const text = await request.text().catch(() => '');
  let body: unknown;
  try { body = text.length <= MAX_BODY ? JSON.parse(text) : null; } catch { body = null; }
  const parsed = parseSigningRequest(body);
  if (!parsed) return walletJson(400, { code: 'FLOFI_WALLET_REQUEST_INVALID' }, NOSNIFF);
  const context = await host.service.context(session).catch(() => null);
  if (!context) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' }, NOSNIFF);
  const result = await signingGate(host.account.store, context.wallets, { claim: false })(parsed.context, parsed.request)
    .catch(() => ({ ok: false as const, code: 'FLOFI_WALLET_REVIEW_UNAVAILABLE' }));
  if (!result.ok) return walletJson(TEMPORARY.has(result.code) ? 503 : 403, { code: result.code }, NOSNIFF);
  return walletJson(200, { summary: result.value.summary }, NOSNIFF);
}
