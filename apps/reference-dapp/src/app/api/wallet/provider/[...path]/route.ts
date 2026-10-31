// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's relay for its stamped provider requests (see `accounts/wallet-relay.ts`). Wallet origin only. */
import { currentWalletSession, sameWalletOrigin, walletHost, walletJson } from '../../../../../accounts/wallet-host';
import { walletRelayDecision } from '../../../../../accounts/wallet-relay';
import { RELEASABLE_PROVIDER_STATUSES, releaseAttempt, signingGate } from '../../../../flofi-wallet-signing';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  const session = await currentWalletSession(host);
  const body = await request.text().catch(() => ''), stamp = request.headers.get('x-stamp');
  // A sign-in message to sign (raw payload only) travels base64url-encoded in its own header so the relay can recompute the payload.
  const encoded = request.headers.get('x-flofi-message');
  let message: string | null;
  try { message = encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : null; } catch { message = null; }
  const context_ = session ? await host.service.context(session).catch(() => null) : null;
  // The attempt whose single signature the gate claims for this request (released below only if the provider provably created nothing).
  let claimed: string | null = null;
  const gate = context_ ? signingGate(host.account.store, context_.wallets, { claim: true }) : null;
  const organization = context_?.organization ? { organizationId: context_.organization.organizationId, userId: context_.organization.userId } : null;
  const decision = await walletRelayDecision({ path: (await context.params).path.join('/'), body, stamp, message, session, organization,
    app: { host: host.origin.appHost, origin: host.origin.appOrigin },
    // The reviewed attempt a signing activity belongs to (`x-flofi-signing`), resolved for this account's managed wallets; the gate claims
    // the attempt's single signature. Without a wallet context there is no gate, so every signing activity is refused (fail closed).
    signing: request.headers.get('x-flofi-signing'),
    ...(gate ? { attempt: async (binding, request) => { const result = await gate(binding, request); if (result.ok) claimed = result.value.attempt; return result; } } : {}),
    apiBaseUrl: host.account.turnkey?.apiBaseUrl ?? null, wallets: async () => context_?.wallets ?? [],
    managedResource: wallet => host.account.store.managedResource(session!.account.accountId, wallet.ecosystem, wallet.address), now: new Date() })
    .catch(() => ({ ok: false as const, status: 503, code: 'ACCOUNTS_UNAVAILABLE' }));
  if (!decision.ok) return walletJson(decision.status, { code: decision.code });
  // Byte-for-byte: the provider verifies the wallet page's stamp over exactly this body. Nothing here is logged or kept.
  const upstream = await fetch(decision.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Stamp': stamp! }, body }).catch(() => null);
  if (!upstream) return walletJson(502, { code: 'MANAGED_PROVIDER_UNAVAILABLE' });
  if (claimed && RELEASABLE_PROVIDER_STATUSES.has(upstream.status)) await releaseAttempt(host.account.store, claimed).catch(() => undefined);
  return new Response(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
