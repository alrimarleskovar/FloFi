// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: owner-facing text for account codes. A raw code never reaches the interface. */
import { floFiWalletMessage } from '../../wallet/flofi-signing';

const MESSAGES: Readonly<Record<string, string>> = {
  ACCOUNTS_NOT_CONFIGURED: "Accounts aren't available on this deployment yet.",
  ACCOUNTS_UNAVAILABLE: 'FloFi accounts are temporarily unavailable. Try again in a moment.',
  ACCOUNT_SESSION_REQUIRED: 'Your session ended. Sign in again to continue.',
  ACCOUNT_REAUTHENTICATION_REQUIRED: 'For your security, confirm it’s you by signing in again.',
  ACCOUNT_IDENTITY_LINKED_ELSEWHERE: 'That sign-in already belongs to another FloFi account. Nothing was merged or moved.',
  ACCOUNT_WALLET_LINKED_ELSEWHERE: 'That wallet already belongs to another FloFi account. Nothing was merged or moved.',
  ACCOUNT_WALLET_NOT_OWNED: 'The wallet provider could not confirm this wallet belongs to you. Nothing was saved.',
  ACCOUNT_WALLET_NOT_FOUND: 'That wallet is no longer in your account.',
  ACCOUNT_WALLET_LABEL_INVALID: 'Use 1–40 characters.',
  OIDC_PROVIDER_NOT_CONFIGURED: 'This sign-in method is not available on this deployment yet.',
  OIDC_ORIGIN_MISMATCH: 'Open FloFi at its main address to use this sign-in method.',
  OIDC_STATE_INVALID: 'That sign-in link expired or was opened in another browser. Start again.',
  OIDC_CANCELLED: 'Sign-in was cancelled. Nothing changed.',
  OIDC_TOKEN_EXCHANGE_FAILED: 'The provider did not complete sign-in. Try again.',
  OIDC_JWKS_UNAVAILABLE: 'FloFi could not verify the sign-in with the provider right now. Try again.',
  OIDC_SIGN_IN_FAILED: 'FloFi could not verify that sign-in. Nothing was signed in.',
  EMAIL_INVALID: 'Enter a valid email address.',
  EMAIL_SIGN_IN_NOT_CONFIGURED: 'Email sign-in is not available on this deployment yet.',
  EMAIL_CODE_INVALID: 'Enter the 6-digit code from the email.',
  EMAIL_CODE_REJECTED: 'That code is not valid or has expired. Request a new one.',
  EMAIL_CHALLENGE_EXPIRED: 'That code expired or was tried too many times. Request a new one.',
  EMAIL_RATE_LIMITED: 'Too many codes were requested for this address. Wait a while, then try again.',
  OIDC_TOKEN_REPLAYED: 'That sign-in was already used. Start again.',
  ACCOUNT_NOT_FOUND: 'This FloFi account no longer exists.',
  EMAIL_SIGN_IN_FAILED: 'Email sign-in did not complete. Try again.',
  EMAIL_TARGET_UNVERIFIED: 'FloFi could not verify the email provider’s encryption key. Your code was not sent. Request a new code.',
  EMAIL_VERIFICATION_INVALID: 'The email provider’s confirmation could not be verified. Nothing was signed in.',
  EMAIL_VERIFICATION_MISMATCH: 'That confirmation is not for this email or this browser. Nothing was signed in.',
  EMAIL_VERIFICATION_REPLAYED: 'That code was already used. Request a new one.',
  OTP_KEY_UNAVAILABLE: 'This browser could not create a secure key for the code. Update your browser and try again.',
  MANAGED_SESSION_KEY_UNAVAILABLE: 'This browser could not create a secure session key. Allow site storage and try again.',
  WALLET_SESSION_REQUIRED: 'Your wallet did not sign the sign-in message. Nothing was signed in.',
  WALLET_PROOF_STALE: 'Sign the new sign-in message in your wallet to continue.',
  WALLET_SIGN_IN_FAILED: 'Wallet sign-in did not complete. Try again.',
  MANAGED_WALLETS_NOT_CONFIGURED: "Creating and importing wallets isn't available on this deployment yet.",
  MANAGED_WALLETS_NEED_SOCIAL_SIGN_IN: 'Creating or importing wallets needs a Google, Apple or email sign-in.',
  MANAGED_SESSION_REQUIRED: 'Sign in again to unlock your FloFi wallets in this browser.',
  MANAGED_SESSION_EXPIRED: 'Your secure wallet session expired. Sign in again to continue.',
  MANAGED_PROVIDER_UNAVAILABLE: 'The wallet provider could not be reached. Nothing changed.',
  MANAGED_ACTIVITY_NOT_COMPLETED: 'The wallet provider did not complete the request. Nothing changed.',
  MANAGED_IMPORT_KEY_INVALID: 'That key could not be read. Check it in the secure field and try again.',
  MANAGED_IMPORT_UNAVAILABLE: 'Secure import could not start. Nothing was imported.',
  MANAGED_EXPORT_UNAVAILABLE: 'Secure export could not start. Nothing was revealed.',
  EXPORT_NOT_SUPPORTED: 'This wallet cannot be exported from FloFi.',
  MANAGED_ORGANIZATION_MISSING: 'Create or import a wallet first.',
  // FloFi Wallet (its own origin). Its FLOFI_WALLET_* codes have one catalogue, src/wallet/flofi-signing.ts.
  WALLET_UNLOCK_REQUIRED: 'Unlock FloFi Wallet to continue.',
  WALLET_UNLOCK_METHOD_UNAVAILABLE: 'FloFi Wallet unlocks with the email, Google or Apple sign-in you created your account with.',
  WALLET_UNLOCK_IDENTITY_MISMATCH: 'That is not the Google or Apple account linked to this FloFi account. Nothing was unlocked.',
  TURNKEY_CLIENT_SIGNATURE_INVALID: 'FloFi Wallet could not confirm this request with its key. Nothing was changed. Try again.',
  SIGNER_NOT_MANAGED: 'That wallet is not one of your FloFi Wallet wallets.',
};
export function accountMessage(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code]!;
  const wallet = code.startsWith('FLOFI_WALLET_') ? floFiWalletMessage(code) : null;
  if (wallet) return wallet;
  if (/^MANAGED_WALLETS_NEED_(GOOGLE|APPLE|EMAIL)_SIGN_IN$/.test(code)) return 'Your FloFi wallets are unlocked with the method you first used for them. Sign in with it to manage them.';
  if (code.startsWith('OIDC_')) return 'FloFi could not verify that sign-in. Nothing was signed in.';
  if (code.startsWith('MANAGED_') || code.startsWith('TURNKEY_')) return 'The wallet provider did not complete the request. Nothing changed.';
  // Only catalogued messages are shown: an unexpected browser or provider error text never reaches the interface.
  return 'Something went wrong. Nothing changed. Try again.';
}
