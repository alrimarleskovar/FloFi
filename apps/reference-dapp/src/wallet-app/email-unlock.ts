// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the messages FloFi Wallet signs to unlock with an email code (security review finding 5).
 *
 * The provider's client signature is ECDSA P-256 over a message, and with the same key a signature over any string is also a valid
 * request stamp for that string. So the wallet page never signs text the server chose: it builds the two messages itself, byte for byte
 * as Turnkey's own SDK does (`@turnkey/core` `getClientSignatureMessageForLogin` / `ForSignup`, key order included), from inputs it
 * validates: the verification token id (a UUID-like resource id), its own public key for login, and the email address it showed the
 * person for sign-up. The sign-up usage always carries empty `apiKeys`/`authenticators`/`oauthProviders`, so a signature can never
 * authorize an extra root credential. FloFi's server checks both signatures against the same construction before calling the provider.
 */

const fail = (code: string): never => { throw new Error(code); };
/** FloFi Wallet unlock codes: 8 letters and digits (Turnkey's Crockford alphabet), entered only on the wallet origin. */
export const UNLOCK_CODE_LENGTH = 8;
const TOKEN_ID = /^[A-Za-z0-9-]{8,64}$/, PUBLIC_KEY = /^0[23][0-9a-f]{64}$/, EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** What the person typed, as the provider compares it: letters upper-cased, spaces and dashes dropped. */
export const normalizeUnlockCode = (typed: string): string => typed.toUpperCase().replace(/[\s-]/g, '');
export const validUnlockCode = (code: string): boolean => code.length === UNLOCK_CODE_LENGTH && /^[A-Z0-9]+$/.test(code);

/** `{"login":{"publicKey":K},"tokenId":id,"type":"USAGE_TYPE_LOGIN"}` for this page's own key. */
export function loginSignatureMessage(tokenId: string, publicKey: string): string {
  if (!TOKEN_ID.test(tokenId) || !PUBLIC_KEY.test(publicKey)) fail('FLOFI_WALLET_UNLOCK_INVALID');
  return JSON.stringify({ login: { publicKey }, tokenId, type: 'USAGE_TYPE_LOGIN' });
}
/** `{"signupV2":{"apiKeys":[],"authenticators":[],"oauthProviders":[],"email":E},"tokenId":id,"type":"USAGE_TYPE_SIGNUP"}` for the shown email. */
export function signupSignatureMessage(tokenId: string, email: string): string {
  if (!TOKEN_ID.test(tokenId) || !EMAIL.test(email)) fail('FLOFI_WALLET_UNLOCK_INVALID');
  return JSON.stringify({ signupV2: { apiKeys: [], authenticators: [], oauthProviders: [], email }, tokenId, type: 'USAGE_TYPE_SIGNUP' });
}
