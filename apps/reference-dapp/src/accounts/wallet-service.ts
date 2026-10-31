// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's server side (wallet origin only).
 *
 * Unlocking opens a provider session for a key that only the wallet origin holds (its IndexedDB stamper). It always needs the person:
 * - email: the provider sends a code to the account's own verified address (never one the browser names); the wallet page encrypts the
 *   code with its key to the provider's enclave; the verification token is checked for this address and this key; the wallet page signs
 *   the provider's login (and, the first time, sign-up) message with that key. FloFi's server never holds a usable credential.
 * - Google / Apple: a fresh OpenID Connect sign-in on the wallet origin whose nonce commits to the wallet key, for the same Google/Apple
 *   account already linked to this FloFi account.
 * The person's provider organization has that identity as its only root user; FloFi's parent key is not a member.
 */
import { createHash, createPublicKey, ECDH, verify } from 'node:crypto';
import { canonicalAddress, exportActions, isManagedLogin, MANAGED_PROVIDER, normalizeEmail, parseAccountWalletId, type AccountWallet, type ManagedLogin } from './account-model.ts';
import { SESSION_PUBLIC_KEY, type OidcFlow } from './account-session.ts';
import type { AccountStore } from './account-store.ts';
import { exchangeGoogleCode, verifyIdToken, type OidcConfig } from './oidc.ts';
import { clientSignature, emailSignupSignatureMessage, loginSignatureMessage, type TurnkeyServer } from './turnkey-server.ts';
import { unlockedFor, WALLET_EXPORT_UNLOCK_SECONDS, type WalletSession } from './wallet-session.ts';

export type UnlockMethod = ManagedLogin;
export type WalletContext = { readonly accountId: string; readonly label: string; readonly methods: readonly UnlockMethod[];
  readonly organization: { readonly organizationId: string; readonly userId: string; readonly login: ManagedLogin } | null;
  readonly wallets: readonly AccountWallet[]; readonly unlocked: boolean;
  /** The unlocked wallet-origin public key and its unlock window (seconds), so FloFi Wallet can show the time left and tell whether this
   * window's own key is the unlocked one. Public values only; null while locked. */
  readonly unlockedKey: string | null; readonly unlockedAt: number | null; readonly unlockedUntil: number | null };
/** Whether `session` holds a live unlock at `nowSeconds`, and which (public) key and window. */
function unlockState(session: WalletSession, nowSeconds: number) {
  const live = session.unlockedKey !== null && session.unlockedUntil !== null && session.unlockedUntil > nowSeconds;
  return { unlocked: live, unlockedKey: live ? session.unlockedKey : null, unlockedAt: live ? session.unlockedAt : null, unlockedUntil: live ? session.unlockedUntil : null };
}
/** An email unlock waiting for the wallet page's signatures. Sealed in a short-lived HttpOnly cookie on the wallet origin, never shown. */
export type PendingEmailUnlock = { readonly email: string; readonly key: string; readonly verificationToken: string; readonly tokenId: string;
  readonly expiresAtMs: number; readonly signup: boolean };
export type ExportGrant = { readonly organizationId: string; readonly kind: 'private-key' | 'recovery-phrase'; readonly resource: string;
  readonly address: string; readonly keyFormat: 'HEXADECIMAL' | 'SOLANA'; readonly source: 'wallet' | 'wallet-account' | 'private-key' };

const fail = (code: string): never => { throw new Error(code); };
/**
 * Wallet-unlock email challenges are recorded under their own key (`wallet-unlock:<address>`): they have their own per-address budget
 * (5 per hour, apart from sign-in codes), and a sign-in challenge can never complete an unlock, nor an unlock challenge a sign-in.
 */
export const unlockChallengeKey = (email: string) => `wallet-unlock:${email}`;
const PROVIDER_LABEL: Readonly<Record<'google' | 'apple', 'Google' | 'Apple'>> = Object.freeze({ google: 'Google', apple: 'Apple' });
const seconds = (now: Date) => Math.floor(now.getTime() / 1000);
/** Whether `signature` (raw r‖s hex) is the P-256 signature of `message` (SHA-256) by the compressed `publicKey`. Checked before any submit. */
function rawP256Valid(publicKey: string, message: string, signature: string): boolean {
  try {
    const point = Buffer.from(ECDH.convertKey(publicKey, 'prime256v1', 'hex', 'hex', 'uncompressed') as string, 'hex');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
    return verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

/** Display-only expiry of a provider session JWT, capped at 15 minutes. Never used as an authorization input. */
function sessionUntil(jwt: string, now: Date): number {
  try {
    const exp = (JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    if (Number.isSafeInteger(exp) && (exp as number) > seconds(now)) return Math.min(exp as number, seconds(now) + 900);
  } catch { /* fall through */ }
  return seconds(now) + 900;
}

export function createWalletService(input: { readonly store: AccountStore; readonly turnkey: TurnkeyServer | null; readonly now?: () => Date;
  readonly transport?: typeof fetch }) {
  const { store } = input, now = input.now ?? (() => new Date()), transport = input.transport ?? fetch;
  const provider = () => input.turnkey ?? fail('MANAGED_WALLETS_NOT_CONFIGURED');

  async function record(session: WalletSession) {
    if (!await store.verifySession(session.account, now())) fail('ACCOUNT_SESSION_REQUIRED');
    return await store.account(session.account.accountId) ?? fail('ACCOUNT_NOT_FOUND');
  }
  /**
   * The unlock method of this account: the one its provider organization was created with or, before it has one, the identity the account
   * was created with, when that is Google, Apple or email. An identity linked later can never create the organization (security review
   * finding 11), including on an account created with a Web3 wallet: linking happens on the product origin, so a later link must not
   * decide who controls the wallets FloFi Wallet creates.
   */
  async function methodsOf(accountId: string, organization: { login: ManagedLogin } | null): Promise<UnlockMethod[]> {
    if (organization) return [organization.login];
    const created = (await store.account(accountId))?.identities[0];
    return created && isManagedLogin(created.kind) ? [created.kind as ManagedLogin] : [];
  }
  async function bind(accountId: string, login: ManagedLogin, locate: () => Promise<{ organization: string; user: string } | null>,
    create: () => Promise<{ organization: string; user: string }>) {
    const current = (await store.account(accountId))?.organization ?? null;
    if (current) return current.login === login ? current : fail(`MANAGED_WALLETS_NEED_${current.login.toUpperCase()}_SIGN_IN`);
    const located = await locate() ?? await create();
    return store.setWalletOrganization(accountId, { provider: 'turnkey', organization: located.organization, user: located.user, login }, now());
  }

  const service = {
    async context(session: WalletSession): Promise<WalletContext> {
      const account = await record(session);
      const organization = account.organization;
      const label = account.identities.find(identity => isManagedLogin(identity.kind))?.label ?? account.identities[0]?.label ?? 'FloFi account';
      return { accountId: account.accountId, label, methods: await methodsOf(account.accountId, organization),
        organization: organization ? { organizationId: organization.organization, userId: organization.user, login: organization.login } : null,
        wallets: account.wallets.filter(wallet => wallet.provider === MANAGED_PROVIDER && wallet.origin !== 'external'),
        ...unlockState(session, seconds(now())) };
    },
    /** Sends a code to the account's own verified email address (the browser cannot name another one), bound to the wallet key. */
    async startEmailUnlock(session: WalletSession, walletKey: unknown): Promise<{ challengeId: string; email: string; targetBundle: string }> {
      const account = await record(session);
      if (typeof walletKey !== 'string' || !SESSION_PUBLIC_KEY.test(walletKey)) fail('ACCOUNT_SESSION_KEY_INVALID');
      if (!(await methodsOf(account.accountId, account.organization)).includes('email')) fail('WALLET_UNLOCK_METHOD_UNAVAILABLE');
      const email = normalizeEmail(await store.identitySubject(account.accountId, 'email')) ?? fail('WALLET_UNLOCK_METHOD_UNAVAILABLE');
      if (!await store.emailChallengeAllowed(unlockChallengeKey(email!), now())) fail('EMAIL_RATE_LIMITED');
      const otp = await provider().initEmailOtp(email!, 'wallet-unlock');
      return { challengeId: await store.startEmailChallenge({ email: unlockChallengeKey(email!), providerChallenge: otp.otpId, browserBinding: walletKey as string }, now()),
        email: email!, targetBundle: otp.targetBundle };
    },
    /**
     * Verifies the encrypted code (5 tries per challenge) and the provider-signed token for this address and this wallet key. Returns the
     * token id and whether this is a sign-up: the wallet page builds the provider's login (and sign-up) messages itself from them and its
     * own key, so it never signs a message the server chose.
     */
    async verifyEmailUnlock(session: WalletSession, challengeId: string, encryptedOtpBundle: unknown):
      Promise<{ pending: PendingEmailUnlock; tokenId: string; email: string; signup: boolean }> {
      const account = await record(session);
      if (typeof encryptedOtpBundle !== 'string' || encryptedOtpBundle.length < 64 || encryptedOtpBundle.length > 4_096) fail('EMAIL_CODE_INVALID');
      const challenge = await store.attemptEmailChallenge(challengeId, now()) ?? fail('EMAIL_CHALLENGE_EXPIRED');
      // An unlock challenge for this account's own address only: another account's challenge, or a sign-in challenge, is useless here.
      const email = normalizeEmail(await store.identitySubject(account.accountId, 'email')) ?? fail('WALLET_UNLOCK_METHOD_UNAVAILABLE');
      if (challenge!.email !== unlockChallengeKey(email!)) fail('EMAIL_CHALLENGE_EXPIRED');
      let token: string;
      try { token = await provider().verifyEmailOtp(challenge!.providerChallenge, encryptedOtpBundle as string); }
      catch (error) {
        const code = error instanceof Error ? error.message : '';
        throw new Error(code === 'TURNKEY_ACTIVITY_NOT_COMPLETED' || code === 'TURNKEY_REQUEST_FAILED' || !code ? 'EMAIL_CODE_REJECTED' : code, { cause: error });
      }
      const claims = await provider().verificationClaims(token, { contact: email!, publicKey: challenge!.browserBinding }, now().getTime());
      if (!await store.consumeProof(createHash('sha256').update(`otp:${claims.id}`).digest('hex'), new Date(claims.expiresAtMs), now())) fail('EMAIL_VERIFICATION_REPLAYED');
      await store.consumeEmailChallenge(challengeId, now());
      const located = account.organization ? null : await provider().findOrganization({ email: email! });
      if (account.organization && account.organization.login !== 'email') fail(`MANAGED_WALLETS_NEED_${account.organization.login.toUpperCase()}_SIGN_IN`);
      const signup = !account.organization && !located;
      return { pending: { email: email!, key: challenge!.browserBinding, verificationToken: token, tokenId: claims.id, expiresAtMs: claims.expiresAtMs, signup },
        tokenId: claims.id, email: email!, signup };
    },
    /** Creates the organization if needed (V8, sign-up signature) and opens the provider session for the wallet key (OTP_LOGIN_V2). */
    async finishEmailUnlock(session: WalletSession, pending: PendingEmailUnlock, loginSignature: unknown, signupSignature: unknown): Promise<{ key: string; until: number }> {
      const account = await record(session);
      if (pending.expiresAtMs <= now().getTime()) fail('EMAIL_CHALLENGE_EXPIRED');
      const login = clientSignature(pending.key, loginSignatureMessage(pending.tokenId, pending.key), loginSignature);
      // Fail closed before any provider call: each signature must be the wallet key's over exactly the message FloFi expects.
      if (!rawP256Valid(pending.key, login.message, login.signature)) fail('TURNKEY_CLIENT_SIGNATURE_INVALID');
      if (pending.signup) {
        const signup = clientSignature(pending.key, emailSignupSignatureMessage(pending.tokenId, pending.email), signupSignature);
        if (!rawP256Valid(pending.key, signup.message, signup.signature)) fail('TURNKEY_CLIENT_SIGNATURE_INVALID');
      }
      const organization = await bind(account.accountId, 'email', () => provider().findOrganization({ email: pending.email }), async () => {
        if (!pending.signup) fail('MANAGED_ORGANIZATION_CHANGED');
        return provider().createOrganization(`flofi-${account.accountId}`, { email: pending.email, verificationToken: pending.verificationToken,
          clientSignature: clientSignature(pending.key, emailSignupSignatureMessage(pending.tokenId, pending.email), signupSignature) });
      });
      const jwt = await provider().emailLogin(organization.organization, pending.verificationToken, pending.key, login);
      return { key: pending.key, until: sessionUntil(jwt, now()) };
    },
    /**
     * Google / Apple: the verified ID token must be for the same provider account already linked to this FloFi account, and its nonce
     * must commit to the wallet key (the flow seals both). Each token is used once.
     */
    async completeOidcUnlock(session: WalletSession, config: OidcConfig, flow: OidcFlow, response: { readonly code?: unknown; readonly idToken?: unknown }):
      Promise<{ key: string; until: number }> {
      const account = await record(session);
      const key = flow.sessionKey ?? fail('ACCOUNT_SESSION_KEY_INVALID');
      if (flow.nonce !== createHash('sha256').update(key!).digest('hex')) fail('OIDC_STATE_INVALID');
      const idToken = config.provider === 'google' ? await exchangeGoogleCode(config, response.code, flow.verifier, transport) : response.idToken;
      const identity = await verifyIdToken(config, idToken, flow, { now: now(), transport });
      if (identity.subject !== await store.identitySubject(account.accountId, config.provider)) fail('WALLET_UNLOCK_IDENTITY_MISMATCH');
      if (!await store.consumeProof(createHash('sha256').update(idToken as string).digest('hex'), identity.expiresAt, now())) fail('OIDC_TOKEN_REPLAYED');
      const token = idToken as string, email = identity.emailVerified ? identity.email : null;
      const organization = await bind(account.accountId, config.provider, () => provider().findOrganization({ oidcToken: token }),
        () => provider().createOrganization(`flofi-${account.accountId}`, { provider: PROVIDER_LABEL[config.provider], oidcToken: token, email }));
      const jwt = await provider().oidcLogin(organization.organization, token, key!);
      return { key: key!, until: sessionUntil(jwt, now()) };
    },
    /** Saves wallets created or imported in FloFi Wallet after the provider confirms they are in this person's organization. */
    async saveWallets(session: WalletSession, ids: unknown, save: (ids: unknown) => Promise<AccountWallet[]>): Promise<AccountWallet[]> {
      await record(session);
      if (!session.unlockedKey) fail('MANAGED_SESSION_REQUIRED');
      return save(ids);
    },
    /** One export of a managed wallet of this account, after an unlock in the last 5 minutes. External wallets are never exportable. */
    async exportGrant(session: WalletSession, id: unknown, kind: unknown): Promise<ExportGrant> {
      const account = await record(session);
      if (!session.unlockedKey || !unlockedFor(session, session.unlockedKey, now(), WALLET_EXPORT_UNLOCK_SECONDS)) fail('WALLET_UNLOCK_REQUIRED');
      const organization = account.organization ?? fail('MANAGED_ORGANIZATION_MISSING');
      const parsed = parseAccountWalletId(id) ?? fail('ACCOUNT_WALLET_INVALID');
      const wallet = account.wallets.find(candidate => candidate.ecosystem === parsed!.ecosystem && candidate.address === parsed!.address) ?? fail('ACCOUNT_WALLET_NOT_FOUND');
      if (kind !== 'private-key' && kind !== 'recovery-phrase') fail('EXPORT_KIND_INVALID');
      if (!exportActions(wallet!).includes(kind as 'private-key')) fail('EXPORT_NOT_SUPPORTED');
      const resource = await store.managedResource(account.accountId, wallet!.ecosystem, wallet!.address) ?? fail('EXPORT_NOT_SUPPORTED');
      const source = kind === 'recovery-phrase' ? 'wallet' : resource!.origin === 'imported' ? 'private-key' : 'wallet-account';
      return { organizationId: organization!.organization, kind: kind as ExportGrant['kind'], resource: source === 'wallet-account' ? wallet!.address : resource!.resource,
        address: wallet!.address, keyFormat: wallet!.ecosystem === 'evm' ? 'HEXADECIMAL' : 'SOLANA', source };
    },
    /** Whether `address` is a managed wallet saved to this account (canonical form), for signing requests. */
    async ownsManagedAddress(session: WalletSession, address: unknown): Promise<AccountWallet | null> {
      const account = await record(session);
      if (typeof address !== 'string') return null;
      return account.wallets.find(wallet => wallet.provider === MANAGED_PROVIDER && wallet.origin !== 'external'
        && canonicalAddress(wallet.ecosystem, address) === wallet.address) ?? null;
    },
  };
  return service;
}
export type WalletService = ReturnType<typeof createWalletService>;
