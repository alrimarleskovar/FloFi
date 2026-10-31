// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: account server actions. Each one derives the account from the verified HttpOnly session
 * (sealed cookie + server-side record), never from an argument. Arguments are wallet ids, labels and choices only: no key,
 * phrase, token or code leaves the browser except the six-digit email code, which is forwarded to the provider once.
 * None of these actions signs, submits or authorizes a transaction.
 */
import { cookies } from 'next/headers';
import { accountAvailability, accountCookieOptions, accountHost, clearAccountCookie, currentAccountSession, flowCookieOptions, nextPath, setAccountCookie,
  supersede, type AccountAvailability, type AccountHost } from '../accounts/account-host';
import { ACCOUNT_EMAIL_COOKIE, ACCOUNT_FLOW_TTL_SECONDS, ACCOUNT_OIDC_COOKIE, newOidcFlow, readEmailFlow, safeReturnPath, sealEmailFlow, sealOidcFlow,
  type AccountIntent, type AccountSessionToken } from '../accounts/account-session';
import { parseAccountWalletId, type AccountView, type AccountWallet } from '../accounts/account-model';
import { authorizationUrl, oidcConfig } from '../accounts/oidc';
import type { TurnkeyBrowserConfig } from '../accounts/turnkey-server';
import { currentSolanaSession, currentWalletSession, requestOrigin } from '../server/session-principal';
import { WALLET_SESSION_TTL_SECONDS } from '../server/wallet-session';
import { ACCOUNT_REAUTH_SECONDS } from '../accounts/account-session';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown, fallback = 'ACCOUNT_REQUEST_FAILED'): { ok: false; code: string } =>
  ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback });
const fail = (code: string): never => { throw new Error(code); };
async function host(): Promise<AccountHost> {
  try { return await accountHost() ?? fail('ACCOUNTS_NOT_CONFIGURED'); } catch (error) { throw new Error(failure(error, 'ACCOUNTS_UNAVAILABLE').code, { cause: error }); }
}
/** The wallet proven in this browser within the last few minutes (a new EIP-4361 / SIWS signature), or null. */
async function freshWalletProof(namespace: 'eip155' | 'solana'): Promise<{ namespace: 'eip155' | 'solana'; address: string } | null> {
  const proof = namespace === 'eip155' ? await currentWalletSession() : namespace === 'solana' ? await currentSolanaSession() : fail('WALLET_NAMESPACE_INVALID');
  if (!proof) return null;
  const issued = Date.parse(proof.expiresAt) / 1000 - WALLET_SESSION_TTL_SECONDS;
  return Date.now() / 1000 - issued <= ACCOUNT_REAUTH_SECONDS ? { namespace, address: proof.account } : fail('WALLET_PROOF_STALE');
}
async function signedIn(): Promise<{ host: AccountHost; session: AccountSessionToken }> {
  const h = await host(), session = await currentAccountSession(h);
  return session ? { host: h, session } : fail('ACCOUNT_SESSION_REQUIRED');
}
/**
 * What the product pages may know: availability, the signed-in account (public data), and the provider's non-secret settings the sign-in
 * page needs to encrypt an email code. No provider session ever exists for this origin; managed wallets live in FloFi Wallet.
 */
export type AccountState = { readonly availability: AccountAvailability; readonly account: AccountView | null; readonly provider: TurnkeyBrowserConfig | null };
export async function accountState(): Promise<AccountState> {
  let h: AccountHost | null;
  try { h = await accountHost(); } catch { h = null; }
  const availability = accountAvailability(process.env, h), session = await currentAccountSession(h);
  if (!h || !session) return { availability, account: null, provider: h?.turnkey ?? null };
  return { availability, account: await h.service.view(session).catch(() => null), provider: h.turnkey };
}

/** Starts Google or Apple sign-in: returns the provider URL and seals state, nonce and PKCE verifier in an HttpOnly flow cookie. */
export async function startSocialSignIn(provider: 'google' | 'apple', sessionKey: string | null, intent: AccountIntent = 'sign-in', returnTo = '/app'): Promise<Result<{ url: string }>> {
  try {
    const h = await host();
    if (provider !== 'google' && provider !== 'apple') fail('OIDC_PROVIDER_INVALID');
    if (intent !== 'sign-in' && intent !== 'link') fail('ACCOUNT_INTENT_INVALID');
    const current = intent === 'link' ? await currentAccountSession(h) ?? fail('ACCOUNT_SESSION_REQUIRED') : null;
    const config = oidcConfig(provider, process.env) ?? fail('OIDC_PROVIDER_NOT_CONFIGURED');
    const origin = await requestOrigin();
    // The provider returns to FLOFI_PUBLIC_ORIGIN; a flow started on any other host would lose its cookie, so it is refused up front.
    if (!config.redirectUri.startsWith(`${origin.uri}/`)) fail('OIDC_ORIGIN_MISMATCH');
    const flow = newOidcFlow(provider, sessionKey, intent, returnTo, current);
    (await cookies()).set(ACCOUNT_OIDC_COOKIE, sealOidcFlow(process.env, flow, origin.domain, new Date()), flowCookieOptions(origin.secure, ACCOUNT_FLOW_TTL_SECONDS));
    return { ok: true, value: { url: authorizationUrl(config, flow) } };
  } catch (cause) { return failure(cause); }
}

/**
 * Sends a one-time code (the wallet provider delivers it) and seals the challenge for this attempt's browser key. Returns the
 * provider's enclave-signed encryption target: the browser encrypts the code to it, so FloFi's server never receives the code.
 */
export async function startEmailSignIn(email: string, browserKey: string, intent: AccountIntent = 'sign-in', returnTo = '/app'): Promise<Result<{ email: string; targetBundle: string }>> {
  try {
    const h = await host();
    if (!h.service.validSessionKey(browserKey)) fail('ACCOUNT_SESSION_KEY_INVALID');
    if (intent !== 'sign-in' && intent !== 'link') fail('ACCOUNT_INTENT_INVALID');
    if (intent === 'link' && !await currentAccountSession(h)) fail('ACCOUNT_SESSION_REQUIRED');
    const started = await h.service.startEmail(email, browserKey), origin = await requestOrigin();
    // Same-site only (the code is typed on this page), so the challenge cookie stays Lax.
    (await cookies()).set(ACCOUNT_EMAIL_COOKIE, sealEmailFlow(process.env, { challengeId: started.challengeId, intent, returnTo: safeReturnPath(returnTo) },
      origin.domain, new Date()), accountCookieOptions(origin.secure, ACCOUNT_FLOW_TTL_SECONDS));
    return { ok: true, value: { email: started.email, targetBundle: started.targetBundle } };
  } catch (cause) { return failure(cause, 'EMAIL_SIGN_IN_FAILED'); }
}
/** Completes email sign-in with the code encrypted in the browser (`@turnkey/crypto` `encryptOtpCodeToBundle`). */
export async function completeEmailSignIn(encryptedOtpBundle: string): Promise<Result<{ next: string }>> {
  try {
    const h = await host(), origin = await requestOrigin(), jar = await cookies();
    const flow = readEmailFlow(process.env, jar.get(ACCOUNT_EMAIL_COOKIE)?.value, new Date(), origin.domain) ?? fail('EMAIL_CHALLENGE_EXPIRED');
    const previous = await currentAccountSession(h);
    let outcome;
    try { outcome = await h.service.completeEmail(flow, encryptedOtpBundle, previous); }
    catch (error) {
      // An expired or exhausted challenge cannot be retried: the person requests a new code.
      if (error instanceof Error && error.message === 'EMAIL_CHALLENGE_EXPIRED') jar.set(ACCOUNT_EMAIL_COOKIE, '', accountCookieOptions(origin.secure, 0));
      throw error;
    }
    // The challenge is single-use once the provider accepted the code.
    jar.set(ACCOUNT_EMAIL_COOKIE, '', accountCookieOptions(origin.secure, 0));
    await supersede(h, previous, outcome.session);
    await setAccountCookie(outcome.session);
    return { ok: true, value: { next: nextPath(outcome, flow.intent, flow.returnTo) } };
  } catch (cause) { return failure(cause, 'EMAIL_SIGN_IN_FAILED'); }
}

/**
 * Web3 Wallet sign-in after the existing wallet proof (EIP-4361 or Sign-In With Solana) sealed a wallet session in this browser.
 * `provider` is display metadata only; the address comes from the verified wallet session.
 */
export async function walletAccountSignIn(namespace: 'eip155' | 'solana', providerKey: string, providerName: string, returnTo = '/app'): Promise<Result<{ next: string }>> {
  try {
    const h = await host(), proof = await freshWalletProof(namespace) ?? fail('WALLET_SESSION_REQUIRED');
    const outcome = await h.service.completeWallet(proof, { key: providerKey, name: providerName }, 'sign-in', null);
    await supersede(h, await currentAccountSession(h), outcome.session);
    await setAccountCookie(outcome.session);
    return { ok: true, value: { next: nextPath(outcome, 'sign-in', returnTo) } };
  } catch (cause) { return failure(cause, 'WALLET_SIGN_IN_FAILED'); }
}

/** Signs this browser out (server-side revocation), or every browser of the account. Wallet sessions are separate and unchanged. */
export async function accountSignOut(everywhere = false): Promise<void> {
  try {
    const h = await accountHost(), session = await currentAccountSession(h);
    if (h && session) await (everywhere ? h.store.revokeAllSessions(session.accountId) : h.store.revokeSession(session));
  } catch { /* the cookie is cleared regardless */ }
  await clearAccountCookie();
}
export async function setAccountOnboarding(value: 'completed' | 'dismissed'): Promise<Result<null>> {
  try {
    const { host: h, session } = await signedIn();
    if (value !== 'completed' && value !== 'dismissed') fail('ONBOARDING_INVALID');
    await h.store.setOnboarding(session.accountId, value);
    return { ok: true, value: null };
  } catch (cause) { return failure(cause); }
}
/** Links the external wallet proven in this browser (fresh EIP-4361 / SIWS session) to the signed-in account. */
export async function linkAccountWallet(namespace: 'eip155' | 'solana', providerKey: string, providerName: string): Promise<Result<AccountWallet>> {
  try {
    const { host: h, session } = await signedIn();
    return { ok: true, value: await h.service.linkExternalWallet(session, await freshWalletProof(namespace), { key: providerKey, name: providerName }) };
  } catch (cause) { return failure(cause, 'ACCOUNT_WALLET_LINK_FAILED'); }
}
export async function renameAccountWallet(id: string, label: string): Promise<Result<null>> {
  try {
    const { host: h, session } = await signedIn(), wallet = parseAccountWalletId(id) ?? fail('ACCOUNT_WALLET_INVALID');
    await h.store.renameWallet(session.accountId, wallet!.ecosystem, wallet!.address, label);
    return { ok: true, value: null };
  } catch (cause) { return failure(cause); }
}
/** Removes FloFi's association only. The wallet, its keys at the provider and its assets are unchanged. */
export async function removeAccountWallet(id: string): Promise<Result<null>> {
  try {
    const { host: h, session } = await signedIn(), wallet = parseAccountWalletId(id) ?? fail('ACCOUNT_WALLET_INVALID');
    await h.store.removeWallet(session.accountId, wallet!.ecosystem, wallet!.address);
    return { ok: true, value: null };
  } catch (cause) { return failure(cause); }
}
/**
 * Deletes the signed-in FloFi account (recent sign-in required): identities, sessions and saved wallet metadata. Wallets kept by the
 * provider and on-chain assets are not deleted or moved; export a managed wallet first to keep using it elsewhere.
 */
export async function deleteFloFiAccount(): Promise<Result<null>> {
  try {
    const { host: h, session } = await signedIn();
    await h.service.deleteAccount(session);
    await clearAccountCookie();
    return { ok: true, value: null };
  } catch (cause) { return failure(cause); }
}
