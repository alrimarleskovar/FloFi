// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: the wallet page builds the provider's login and sign-up messages itself, identical to what FloFi's server
// verifies (and to Turnkey's SDK), from validated inputs only; unlock codes are 8 letters and digits.
import { describe, expect, it } from 'vitest';
import { emailSignupSignatureMessage, loginSignatureMessage as serverLogin } from '../accounts/turnkey-server';
import { EMAIL_CODE } from '../accounts/otp-browser';
import { loginSignatureMessage, normalizeUnlockCode, signupSignatureMessage, validUnlockCode } from './email-unlock';

const KEY = '02' + 'ab'.repeat(32), TOKEN = '0b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

describe('email unlock', () => {
  it('builds exactly the messages the server checks, in the SDK’s key order', () => {
    expect(loginSignatureMessage(TOKEN, KEY)).toBe(serverLogin(TOKEN, KEY));
    expect(loginSignatureMessage(TOKEN, KEY)).toBe(`{"login":{"publicKey":"${KEY}"},"tokenId":"${TOKEN}","type":"USAGE_TYPE_LOGIN"}`);
    expect(signupSignatureMessage(TOKEN, 'ana@example.com')).toBe(emailSignupSignatureMessage(TOKEN, 'ana@example.com'));
    expect(signupSignatureMessage(TOKEN, 'ana@example.com'))
      .toBe(`{"signupV2":{"apiKeys":[],"authenticators":[],"oauthProviders":[],"email":"ana@example.com"},"tokenId":"${TOKEN}","type":"USAGE_TYPE_SIGNUP"}`);
  });
  it('refuses a token id or key that is not of the expected shape (no server-chosen text is ever signed)', () => {
    for (const tokenId of ['', 'short', `${TOKEN}","type":"x`, 'a'.repeat(65), 'with space id'])
      expect(() => loginSignatureMessage(tokenId, KEY)).toThrow('FLOFI_WALLET_UNLOCK_INVALID');
    expect(() => loginSignatureMessage(TOKEN, '04' + 'ab'.repeat(64))).toThrow('FLOFI_WALLET_UNLOCK_INVALID');
    expect(() => signupSignatureMessage(TOKEN, 'not an email')).toThrow('FLOFI_WALLET_UNLOCK_INVALID');
  });
  it('normalizes and checks 8-character codes; the browser encryptor accepts them and the 6-digit sign-in codes only', () => {
    expect(normalizeUnlockCode(' ab3d-9kq2 ')).toBe('AB3D9KQ2');
    expect(validUnlockCode('AB3D9KQ2')).toBe(true);
    for (const code of ['AB3D9KQ', 'AB3D9KQ22', 'AB3D9KQ!', '']) expect(validUnlockCode(code)).toBe(false);
    for (const code of ['AB3D9KQ2', 'ab3d9kq2', '123456']) expect(EMAIL_CODE.test(code)).toBe(true);
    for (const code of ['12345', '1234567', 'AB3D9KQ', 'AB3D9KQ2X', 'ABCDEF', '12345a']) expect(EMAIL_CODE.test(code)).toBe(false);
  });
});
