// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: what FloFi Wallet tells the person for each code it can meet, in the wallet's own words (the account
 * screens' texts assume a different page). A raw code, stack or provider message never reaches the interface: unknown codes get a
 * generic sentence that promises nothing was changed only where that is true. Portuguese lives in `src/i18n/pt-wallet.ts`.
 */
import { floFiWalletMessage } from '../wallet/flofi-signing';

export const WALLET_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  // FloFi Wallet's own codes
  FLOFI_WALLET_SIGNATURE_UNKNOWN: 'FloFi Wallet could not confirm the result of this signature. Any signature was discarded and nothing was sent. Check the status in FloFi before you try again.',
  FLOFI_WALLET_SIGNED_TRANSACTION_MISMATCH: 'The wallet provider returned a different transaction from the one you approved. FloFi Wallet discarded it and sent nothing.',
  FLOFI_WALLET_UNLOCK_TIMEOUT: 'The sign-in did not finish within 3 minutes. Nothing was unlocked. Try again.',
  FLOFI_WALLET_UNLOCK_INVALID: 'FloFi Wallet could not safely finish unlocking. Nothing was unlocked. Start again.',
  FLOFI_WALLET_OPENER_CLOSED: 'The FloFi page that asked for this was closed, so FloFi Wallet signed nothing. Start again from FloFi.',
  FLOFI_WALLET_OPENER_CLOSED_AFTER_SIGNING: 'The FloFi page that asked for this was closed before it received the signature. FloFi Wallet discarded it and nothing was sent. Check the status in FloFi before you try again.',
  FLOFI_WALLET_SIGN_IN_WINDOW_BLOCKED: 'Your browser blocked the sign-in window. Allow pop-ups for FloFi Wallet, then try again.',
  FLOFI_WALLET_ACCOUNT_MISMATCH: 'FloFi Wallet switched to another FloFi account. This request was cancelled and nothing was signed.',
  FLOFI_WALLET_REQUEST_INVALID: 'FloFi Wallet could not read this request, so it signed nothing.',
  FLOFI_WALLET_REJECTED: 'You cancelled the request. Nothing was signed.',
  FLOFI_WALLET_BUSY: 'FloFi Wallet is already handling another request. Finish or cancel it first.',
  FLOFI_WALLET_LOCKED: 'FloFi Wallet was locked. Nothing was signed.',
  FLOFI_WALLET_NO_MATCHING_REVIEW: 'FloFi found no reviewed strategy that matches this request, so FloFi Wallet signed nothing.',
  FLOFI_WALLET_FLOW_NOT_SUPPORTED: 'FloFi Wallet can’t sign this action yet — use MetaMask, Phantom or Solflare.',
  FLOFI_WALLET_REVIEW_EXPIRED: 'This Review has expired. Simulate again in FloFi before you sign.',
  FLOFI_WALLET_REVIEW_UNAVAILABLE: 'FloFi Wallet could not load your Review right now. Nothing was signed. Try again.',
  FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED: 'FloFi Wallet signs only actions you reviewed and authorized in FloFi. Nothing was signed.',
  FLOFI_WALLET_NETWORK_UNSUPPORTED: 'FloFi Wallet signs only on Ethereum, Base, Arbitrum and Robinhood Chain. Nothing was signed.',
  FLOFI_WALLET_MESSAGE_UNSUPPORTED: 'FloFi Wallet signs only FloFi’s own, unexpired sign-in message for this wallet. Nothing was signed.',
  // FloFi Wallet's server and relay
  MANAGED_WALLETS_NOT_CONFIGURED: 'FloFi Wallet isn’t available on this deployment yet.',
  WALLET_SESSION_REQUIRED: 'This window is no longer connected to your FloFi account. Open FloFi Wallet from FloFi again.',
  WALLET_HANDOFF_INVALID: 'This FloFi Wallet link expired or was already used. Open FloFi Wallet from FloFi again.',
  ACCOUNT_SESSION_REQUIRED: 'Your FloFi session ended. Sign in to FloFi again, then open FloFi Wallet from there.',
  WALLET_CROSS_ORIGIN: 'FloFi Wallet refused a request that did not come from this window.',
  WALLET_REQUEST_FAILED: 'FloFi Wallet could not complete that request. Nothing changed. Try again.',
  WALLET_UNLOCK_REQUIRED: 'Unlock FloFi Wallet to continue.',
  WALLET_UNLOCK_METHOD_UNAVAILABLE: 'This FloFi account can’t unlock FloFi Wallet with that method.',
  WALLET_UNLOCK_IDENTITY_MISMATCH: 'That Google or Apple account isn’t the one linked to this FloFi account. Nothing was unlocked.',
  SIGNER_NOT_MANAGED: 'That address isn’t a FloFi Wallet of this account. Nothing was signed.',
  SIGN_REQUEST_INVALID: 'FloFi Wallet refused this signing request. Nothing was signed.',
  MANAGED_ORGANIZATION_MISSING: 'Unlock FloFi Wallet once to set it up, then try again.',
  MANAGED_SESSION_KEY_UNAVAILABLE: 'This browser could not create a secure key for FloFi Wallet. Allow site storage for FloFi Wallet and try again.',
  MANAGED_PROVIDER_UNAVAILABLE: 'The wallet provider could not be reached. Try again.',
  MANAGED_ACTIVITY_NOT_COMPLETED: 'The wallet provider did not complete the request. Try again.',
  MANAGED_RESPONSE_INVALID: 'The wallet provider sent an answer FloFi Wallet could not verify, so it was not used.',
  MANAGED_IMPORT_KEY_INVALID: 'That key could not be read. Check it in the secure field and try again.',
  MANAGED_IMPORT_UNAVAILABLE: 'Secure import could not start. Nothing was imported.',
  MANAGED_EXPORT_UNAVAILABLE: 'Secure export could not start. Nothing was revealed.',
  EXPORT_NOT_SUPPORTED: 'This wallet can’t be exported from FloFi Wallet.',
  EXPORT_NOT_AUTHORIZED: 'FloFi Wallet could not authorize this export. Nothing was revealed.',
  EXPORT_KIND_INVALID: 'This wallet can’t be exported that way.',
  ACCOUNT_WALLET_NOT_FOUND: 'That wallet is no longer in your FloFi account.',
  ACCOUNT_WALLET_NOT_OWNED: 'The wallet provider could not confirm this wallet belongs to you. Nothing was saved.',
  ACCOUNT_WALLET_SAVE_FAILED: 'The wallet was created but could not be saved to your FloFi account yet. Try again.',
  ACCOUNT_WALLET_LINKED_ELSEWHERE: 'That wallet already belongs to another FloFi account. Nothing was saved.',
  ACCOUNTS_UNAVAILABLE: 'FloFi accounts are temporarily unavailable. Try again in a moment.',
  // Unlocking
  EMAIL_RATE_LIMITED: 'Too many codes were requested for this address. Wait a while, then try again.',
  EMAIL_CODE_INVALID: 'Enter the 8-character code from the email.',
  EMAIL_CODE_REJECTED: 'That code is not valid or has expired. Check it, or request a new one.',
  EMAIL_CHALLENGE_EXPIRED: 'That code expired or was tried too many times. Request a new one.',
  EMAIL_TARGET_UNVERIFIED: 'FloFi Wallet could not verify the email provider’s encryption key. Your code was not sent. Request a new code.',
  EMAIL_VERIFICATION_INVALID: 'The email provider’s confirmation could not be verified. Nothing was unlocked.',
  EMAIL_VERIFICATION_MISMATCH: 'That confirmation is not for this account or this window. Nothing was unlocked.',
  EMAIL_VERIFICATION_REPLAYED: 'That code was already used. Request a new one.',
  EMAIL_SIGN_IN_FAILED: 'Unlocking with email did not complete. Nothing was unlocked. Try again.',
  TURNKEY_CLIENT_SIGNATURE_INVALID: 'FloFi Wallet could not prove this window’s key to the wallet provider. Nothing was unlocked. Start again.',
  OIDC_CANCELLED: 'Sign-in was cancelled. Nothing was unlocked.',
  OIDC_STATE_INVALID: 'That sign-in expired or was finished in another browser. Start again.',
  OIDC_PROVIDER_NOT_CONFIGURED: 'This sign-in method isn’t available on this deployment yet.',
  OIDC_TOKEN_REPLAYED: 'That sign-in was already used. Start again.',
});
const GENERIC = 'Something went wrong in FloFi Wallet. Try again.';

export function walletMessage(code: string): string {
  if (Object.hasOwn(WALLET_MESSAGES, code)) return WALLET_MESSAGES[code]!;
  if (/^MANAGED_WALLETS_NEED_(GOOGLE|APPLE|EMAIL)_SIGN_IN$/.test(code)) return 'FloFi Wallet unlocks with the sign-in you first used for it. Choose that method.';
  if (code.startsWith('OIDC_')) return 'FloFi Wallet could not verify that sign-in. Nothing was unlocked.';
  if (code.startsWith('FLOFI_WALLET_')) return floFiWalletMessage(code) ?? GENERIC;
  if (code.startsWith('MANAGED_') || code.startsWith('TURNKEY_') || code.startsWith('PROVIDER_')) return 'The wallet provider did not complete the request. Try again.';
  return GENERIC;
}
/** The code carried by an error (our closed codes only), or `fallback`. */
export const codeOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : fallback;
