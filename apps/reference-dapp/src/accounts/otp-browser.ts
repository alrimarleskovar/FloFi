// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the browser half of the provider's encrypted email code (Turnkey `INIT_OTP_V3` / `VERIFY_OTP_V2`).
 *
 * The code the person types never goes to FloFi's server. `@turnkey/crypto` first verifies the enclave signature on the encryption
 * target (Turnkey's key pinned in the package), then HPKE-encrypts `{otp_code, public_key}` to that target. The provider's
 * verification token is bound to `public_key`: only the holder of the matching private key can use it to open a wallet session.
 */

const fail = (code: string): never => { throw new Error(code); };

/** Compressed SEC1 form (hex) of an uncompressed P-256 public key. */
export function compressP256(raw: Uint8Array): string {
  if (raw.length !== 65 || raw[0] !== 4) return fail('OTP_KEY_INVALID');
  const prefix = (raw[64]! & 1) === 1 ? '03' : '02';
  return prefix + Array.from(raw.subarray(1, 33), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The public key of a P-256 key pair created for one sign-in attempt. Its private half is non-extractable and is dropped with this
 * page; no provider session is ever opened for it (sign-in proves the email address, nothing more).
 */
export async function attemptPublicKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']).catch(() => fail('OTP_KEY_UNAVAILABLE'));
  return compressP256(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
}

/**
 * The two code shapes FloFi asks the provider for: a 6-digit sign-in code (product origin) or an 8-character FloFi Wallet unlock code
 * (letters and digits, wallet origin only; see `turnkey-server.ts` `initEmailOtp`). Nothing else is ever encrypted to the enclave.
 */
export const EMAIL_CODE = /^[0-9]{6}$|^[A-Za-z0-9]{8}$/;

/**
 * Encrypts the typed code and `publicKey` to the provider's signed target. `signerPublicKey` is null in production (the package's
 * pinned Turnkey key); only the MOCKED loopback browser suite names its own harness key.
 */
export async function encryptEmailCode(code: string, targetBundle: string, publicKey: string, signerPublicKey: string | null): Promise<string> {
  if (!EMAIL_CODE.test(code)) fail('EMAIL_CODE_INVALID');
  const { encryptOtpCodeToBundle } = await import('@turnkey/crypto');
  try { return await encryptOtpCodeToBundle(code, targetBundle, publicKey, signerPublicKey ?? undefined); }
  catch { return fail('EMAIL_TARGET_UNVERIFIED'); }
}
