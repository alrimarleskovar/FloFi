// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: account orchestration (server only).
 *
 * Every entry point receives identity that the server itself verified — an OIDC ID token checked against the provider's keys, a
 * one-time code verified by the provider (encrypted in the browser; FloFi checks the provider-signed verification token), or a wallet
 * session sealed after FloFi verified the wallet's signature — never a claim from the browser. Signing in creates no wallet, opens no
 * wallet-provider session, grants no permission, starts no transaction and delegates no signer. Managed wallets are unlocked, created,
 * imported, signed with and exported only in FloFi Wallet on its own origin (wallet-service.ts). Saving a managed wallet requires the
 * provider to confirm that the address belongs to this person's own organization; linking an external wallet requires a fresh wallet
 * proof in this browser.
 */
import { accountWalletId, canonicalAddress, MANAGED_PROVIDER, MANAGED_PROVIDER_NAME, normalizeEmail, parseAccountWalletId, validProvider,
  walletLabel, type AccountView, type AccountWallet, type IdentityKind } from './account-model.ts';
import { freshlyAuthenticated, SESSION_PUBLIC_KEY, type AccountSessionToken, type EmailFlow, type OidcFlow } from './account-session.ts';
import type { AccountStore, IdentityClaim } from './account-store.ts';
import { createHash } from 'node:crypto';
import { exchangeGoogleCode, verifyIdToken, type OidcConfig } from './oidc.ts';
import type { TurnkeyServer } from './turnkey-server.ts';
import type { WalletEcosystem } from '../wallet/wallet-registry';

/** The outcome of a verified sign-in. Signing in never opens a wallet-provider session (`managed` is always null; kept for callers). */
export type SignInOutcome = { readonly session: AccountSessionToken; readonly created: boolean; readonly onboarding: AccountView['onboarding'];
  readonly managed: null; readonly managedError: string | null };

const fail = (code: string): never => { throw new Error(code); };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const classified = (error: unknown, fallback: string) => error instanceof Error && CODE.test(error.message) ? error.message : fallback;
export function createAccountService(input: { readonly store: AccountStore; readonly turnkey: TurnkeyServer | null; readonly now?: () => Date;
  readonly transport?: typeof fetch }) {
  const { store, turnkey } = input, now = input.now ?? (() => new Date()), transport = input.transport ?? fetch;

  async function establish(claim: IdentityClaim, intent: 'sign-in' | 'link', current: AccountSessionToken | null): Promise<{ session: AccountSessionToken; created: boolean }> {
    if (intent === 'link') {
      // Linking adds a verified identity to the signed-in account; it never moves one from another account.
      if (!current || !freshlyAuthenticated(current, now())) fail('ACCOUNT_REAUTHENTICATION_REQUIRED');
      await store.linkIdentity(current!.accountId, claim, now());
      return { session: current!, created: false };
    }
    const signed = await store.signIn(claim, now());
    return { session: signed, created: signed.created };
  }
  async function onboardingOf(accountId: string) { return (await store.account(accountId))?.onboarding ?? 'pending'; }

  const service = {
    /**
     * Google (code + PKCE) or Apple (form_post ID token): verify, then sign in or link. Signing in to FloFi opens no wallet-provider
     * session; managed wallets are unlocked separately in FloFi Wallet, on its own origin.
     */
    async completeOidc(config: OidcConfig, flow: OidcFlow, response: { readonly code?: unknown; readonly idToken?: unknown }, current: AccountSessionToken | null): Promise<SignInOutcome> {
      const idToken = config.provider === 'google' ? await exchangeGoogleCode(config, response.code, flow.verifier, transport) : response.idToken;
      const identity = await verifyIdToken(config, idToken, flow, { now: now(), transport });
      // Each ID token signs in once: a replayed token is refused.
      if (!await store.consumeProof(createHash('sha256').update(idToken as string).digest('hex'), identity.expiresAt, now())) fail('OIDC_TOKEN_REPLAYED');
      const email = identity.emailVerified ? identity.email : null;
      const { session, created } = await establish({ kind: config.provider, subject: identity.subject, label: email }, flow.intent, current);
      return { session, created, onboarding: await onboardingOf(session.accountId), managed: null, managedError: null };
    },
    /**
     * Sends an email one-time code through the provider (encrypted-OTP activity), at most 5 per address per hour (and a
     * deployment-wide ceiling). `browserKey` is the public half of a key the sign-in page created for this attempt only: the code
     * the person types is encrypted with it to the provider's enclave, so FloFi's server never sees the code.
     */
    async startEmail(email: unknown, browserKey: string): Promise<{ challengeId: string; email: string; targetBundle: string }> {
      if (!turnkey) fail('EMAIL_SIGN_IN_NOT_CONFIGURED');
      const address = normalizeEmail(email) ?? fail('EMAIL_INVALID');
      if (!SESSION_PUBLIC_KEY.test(browserKey)) fail('ACCOUNT_SESSION_KEY_INVALID');
      if (!await store.emailChallengeAllowed(address, now())) fail('EMAIL_RATE_LIMITED');
      const otp = await turnkey!.initEmailOtp(address);
      return { challengeId: await store.startEmailChallenge({ email: address, providerChallenge: otp.otpId, browserBinding: browserKey }, now()), email: address,
        targetBundle: otp.targetBundle };
    },
    /**
     * Verifies the encrypted code with the provider, then checks the provider-signed verification token is for exactly this address
     * and this browser's key, and has not been used before. Only then signs in or links the verified email.
     */
    async completeEmail(flow: EmailFlow, encryptedOtpBundle: unknown, current: AccountSessionToken | null): Promise<SignInOutcome> {
      if (!turnkey) fail('EMAIL_SIGN_IN_NOT_CONFIGURED');
      if (typeof encryptedOtpBundle !== 'string' || encryptedOtpBundle.length < 64 || encryptedOtpBundle.length > 4_096) fail('EMAIL_CODE_INVALID');
      // Server-side attempt budget: at most 5 tries per challenge, whatever the provider allows; then a new code is required.
      const challenge = await store.attemptEmailChallenge(flow.challengeId, now()) ?? fail('EMAIL_CHALLENGE_EXPIRED');
      const { email, providerChallenge, browserBinding } = challenge!;
      // A FloFi Wallet unlock challenge never signs anyone in (wallet-service.ts `unlockChallengeKey`).
      if (email.startsWith('wallet-unlock:')) fail('EMAIL_CHALLENGE_EXPIRED');
      let verificationToken: string;
      try { verificationToken = await turnkey!.verifyEmailOtp(providerChallenge, encryptedOtpBundle as string); }
      catch (error) {
        // A wrong or expired code is a completed-but-failed provider activity; transport and configuration failures keep their own code.
        const code = classified(error, 'EMAIL_CODE_REJECTED');
        throw new Error(code === 'TURNKEY_ACTIVITY_NOT_COMPLETED' || code === 'TURNKEY_REQUEST_FAILED' ? 'EMAIL_CODE_REJECTED' : code, { cause: error });
      }
      const claims = await turnkey!.verificationClaims(verificationToken, { contact: email, publicKey: browserBinding }, now().getTime());
      // A verification token signs in once, even within its lifetime.
      if (!await store.consumeProof(createHash('sha256').update(`otp:${claims.id}`).digest('hex'), new Date(claims.expiresAtMs), now())) fail('EMAIL_VERIFICATION_REPLAYED');
      await store.consumeEmailChallenge(flow.challengeId, now());
      const { session, created } = await establish({ kind: 'email', subject: email, label: email }, flow.intent, current);
      return { session, created, onboarding: await onboardingOf(session.accountId), managed: null, managedError: null };
    },
    /**
     * Web3 Wallet sign-in: the wallet session FloFi sealed after verifying the wallet's EIP-4361 / Sign-In With Solana signature.
     * The wallet is recorded as an external wallet of the account (public metadata; never exportable).
     */
    async completeWallet(proof: { readonly namespace: 'eip155' | 'solana'; readonly address: string }, provider: { readonly key: unknown; readonly name: unknown },
      intent: 'sign-in' | 'link', current: AccountSessionToken | null): Promise<SignInOutcome> {
      const ecosystem: WalletEcosystem = proof.namespace === 'eip155' ? 'evm' : 'solana', address = canonicalAddress(ecosystem, proof.address) ?? fail('WALLET_ADDRESS_INVALID');
      // Linking checks the wallet record first, so a wallet held by another account never leaves a half-linked identity behind.
      const holder = await store.walletHolder(ecosystem, address);
      if (intent === 'link' && holder && holder !== current?.accountId) fail('ACCOUNT_WALLET_LINKED_ELSEWHERE');
      const { session, created } = await establish({ kind: proof.namespace, subject: address, label: null }, intent, current);
      const key = validProvider(provider.key) ? provider.key : 'injected', name = walletLabel(provider.name) ?? (ecosystem === 'evm' ? 'EVM wallet' : 'Solana wallet');
      // A wallet whose record belongs to another account (for example an exported managed wallet) still signs in to its own identity's
      // account; its record is never moved.
      if (!holder) await store.saveWallet(session.accountId, { ecosystem, address, origin: 'external', provider: key, providerName: name, providerResource: null, label: name }, now());
      return { session, created, onboarding: await onboardingOf(session.accountId), managed: null, managedError: 'MANAGED_WALLETS_NEED_SOCIAL_SIGN_IN' };
    },
    async view(session: AccountSessionToken): Promise<AccountView | null> {
      const account = await store.account(session.accountId);
      if (!account) return null;
      return { accountId: account.accountId, method: session.method, identities: account.identities, onboarding: account.onboarding, wallets: account.wallets,
        managedLogin: account.organization?.login ?? null, authenticatedAt: new Date(session.authenticatedAt * 1000).toISOString(),
        expiresAt: new Date(session.expiresAt * 1000).toISOString() };
    },
    /** Saves managed wallets after the provider confirms each address belongs to this person's organization. */
    async saveManagedWallets(session: AccountSessionToken, ids: unknown): Promise<AccountWallet[]> {
      if (!turnkey) fail('MANAGED_WALLETS_NOT_CONFIGURED');
      const requested = (Array.isArray(ids) ? ids : []).slice(0, 8).map(parseAccountWalletId);
      if (!requested.length || requested.some(entry => entry === null)) fail('ACCOUNT_WALLET_INVALID');
      const organization = (await store.account(session.accountId))?.organization ?? fail('MANAGED_ORGANIZATION_MISSING');
      const [accounts, wallets, keys] = await Promise.all([turnkey!.walletAccounts(organization!.organization), turnkey!.wallets(organization!.organization),
        turnkey!.privateKeys(organization!.organization)]);
      const saved: AccountWallet[] = [];
      for (const entry of requested as { ecosystem: WalletEcosystem; address: string }[]) {
        const format = entry.ecosystem === 'evm' ? 'ADDRESS_FORMAT_ETHEREUM' : 'ADDRESS_FORMAT_SOLANA';
        const same = (candidate: string) => canonicalAddress(entry.ecosystem, candidate) === entry.address;
        const account = accounts.find(candidate => candidate.format === format && same(candidate.address));
        const generated = account && wallets.find(wallet => wallet.walletId === account.walletId && !wallet.imported);
        const imported = !generated ? keys.find(key => key.imported && key.addresses.some(address => address.format === format && same(address.address))) : undefined;
        if (!generated && !imported) fail('ACCOUNT_WALLET_NOT_OWNED');
        const label = entry.ecosystem === 'evm' ? 'EVM wallet' : 'Solana wallet';
        saved.push(await store.saveWallet(session.accountId, { ecosystem: entry.ecosystem, address: entry.address, origin: generated ? 'generated' : 'imported',
          provider: MANAGED_PROVIDER, providerName: MANAGED_PROVIDER_NAME, providerResource: generated ? generated.walletId : imported!.privateKeyId,
          label: generated ? label : `Imported ${label}` }, now()));
      }
      return saved;
    },
    /** Links an external wallet proven in this browser (fresh wallet session) to the signed-in account. */
    async linkExternalWallet(session: AccountSessionToken, proof: { readonly namespace: 'eip155' | 'solana'; readonly address: string } | null,
      provider: { readonly key: unknown; readonly name: unknown }): Promise<AccountWallet> {
      if (!proof) fail('WALLET_SESSION_REQUIRED');
      await service.completeWallet(proof!, provider, 'link', session);
      const ecosystem: WalletEcosystem = proof!.namespace === 'eip155' ? 'evm' : 'solana';
      return (await store.wallets(session.accountId)).find(wallet => wallet.id === accountWalletId(ecosystem, canonicalAddress(ecosystem, proof!.address)!))
        ?? fail('ACCOUNT_WALLET_NOT_FOUND');
    },
    /** Deletes the signed-in account (recent sign-in required). Provider wallets and on-chain assets are untouched. */
    async deleteAccount(session: AccountSessionToken): Promise<void> {
      if (!freshlyAuthenticated(session, now())) fail('ACCOUNT_REAUTHENTICATION_REQUIRED');
      await store.deleteAccount(session.accountId);
    },
    validSessionKey: (value: unknown): value is string => typeof value === 'string' && SESSION_PUBLIC_KEY.test(value),
    identityKinds: (account: AccountView): readonly IdentityKind[] => account.identities.map(identity => identity.kind),
  };
  return service;
}
export type AccountService = ReturnType<typeof createAccountService>;
