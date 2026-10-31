// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: unlocking FloFi Wallet with an email code (wallet origin only).
 * `start`: the provider sends a code to the account's own verified address, bound to the wallet page's key.
 * `verify`: the code arrives encrypted to the provider's enclave (the page encrypts it); the verified token waits, sealed in a short-lived
 *   HttpOnly cookie, for the page's signatures; the page receives only the messages to sign.
 * `finish`: the page's client signatures (its own key) create the provider organization the first time and open the provider session.
 */
import { cookies } from 'next/headers';
import { sealWalletToken, unsealWalletToken } from '../../../../../accounts/account-session';
import { currentWalletSession, sameWalletOrigin, setWalletSession, walletCookieOptions, walletError, walletHost, walletJson } from '../../../../../accounts/wallet-host';
import type { PendingEmailUnlock } from '../../../../../accounts/wallet-service';

export const dynamic = 'force-dynamic';
const PENDING_TTL_SECONDS = 300;
const pendingCookie = (secure: boolean) => secure ? '__Host-flofi_wallet_unlock' : 'flofi_wallet_unlock';

export async function POST(request: Request) {
  const host = await walletHost().catch(() => null);
  if (!host) return walletJson(503, { code: 'MANAGED_WALLETS_NOT_CONFIGURED' });
  if (!sameWalletOrigin(request, host.origin)) return walletJson(403, { code: 'WALLET_CROSS_ORIGIN' });
  const session = await currentWalletSession(host);
  if (!session) return walletJson(401, { code: 'WALLET_SESSION_REQUIRED' });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null, jar = await cookies(), now = new Date();
  const cookie = pendingCookie(host.origin.secure);
  try {
    if (body?.step === 'start') return walletJson(200, await host.service.startEmailUnlock(session, body.key));
    if (body?.step === 'verify') {
      if (typeof body.challengeId !== 'string' || !/^[0-9a-f]{32}$/.test(body.challengeId)) return walletJson(400, { code: 'EMAIL_CHALLENGE_EXPIRED' });
      const verified = await host.service.verifyEmailUnlock(session, body.challengeId, body.encryptedOtpBundle);
      const p = verified.pending;
      jar.set(cookie, sealWalletToken(process.env, 'f1', { a: session.account.accountId, s: session.account.sessionId, m: p.email, k: p.key, t: p.verificationToken,
        i: p.tokenId, x: p.expiresAtMs, u: p.signup, e: Math.floor(now.getTime() / 1000) + PENDING_TTL_SECONDS, d: host.origin.host }),
      walletCookieOptions(host.origin.secure, PENDING_TTL_SECONDS));
      return walletJson(200, { tokenId: verified.tokenId, email: verified.email, signup: verified.signup });
    }
    if (body?.step === 'finish') {
      const v = unsealWalletToken(process.env, 'f1', jar.get(cookie)?.value, now, host.origin.host);
      jar.set(cookie, '', walletCookieOptions(host.origin.secure, 0));
      // The pending unlock belongs to this wallet session's account session only.
      if (!v || v.a !== session.account.accountId || v.s !== session.account.sessionId || typeof v.m !== 'string' || typeof v.k !== 'string'
        || typeof v.t !== 'string' || typeof v.i !== 'string' || !Number.isSafeInteger(v.x) || typeof v.u !== 'boolean') return walletJson(400, { code: 'EMAIL_CHALLENGE_EXPIRED' });
      const pending: PendingEmailUnlock = { email: v.m, key: v.k, verificationToken: v.t, tokenId: v.i, expiresAtMs: v.x as number, signup: v.u };
      const unlocked = await host.service.finishEmailUnlock(session, pending, body.loginSignature, body.signupSignature);
      const next = { ...session, unlockedKey: unlocked.key, unlockedAt: Math.floor(now.getTime() / 1000), unlockedUntil: Math.min(unlocked.until, session.expiresAt) };
      await setWalletSession(host, next);
      return walletJson(200, { context: await host.service.context(next), unlockedUntil: next.unlockedUntil });
    }
    return walletJson(400, { code: 'WALLET_REQUEST_INVALID' });
  } catch (cause) { return walletError(cause, 'EMAIL_SIGN_IN_FAILED'); }
}
