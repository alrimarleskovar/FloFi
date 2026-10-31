// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: every sentence FloFi Wallet shows has a Portuguese translation in `src/i18n/pt-wallet.ts` with the same
// placeholders, including the code messages and the texts passed to shared controls.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { portugueseWallet } from '../i18n/pt-wallet';
import { WALLET_MESSAGES, walletMessage } from './wallet-messages';

const here = fileURLToPath(new URL('.', import.meta.url));
function translationCalls(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(here).filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))) {
    const src = ts.createSourceFile(file, readFileSync(join(here, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const argument = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keys.add(node.text.trim());
      else if (ts.isConditionalExpression(node)) { argument(node.whenTrue); argument(node.whenFalse); }
    };
    const scan = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(src) === 't' && node.arguments[0]) argument(node.arguments[0]); ts.forEachChild(node, scan); };
    scan(src);
  }
  return [...keys].filter(Boolean);
}
/** Texts handed to shared controls as props and translated there (SignControls, UnlockPanel, unlock method labels). */
const PASSED = ['Sign', 'Signing…', 'Show recovery phrase', 'Show private key', 'Opening…', 'Unlock FloFi Wallet', 'Unlock again to export', 'Unlock now',
  'Unlocking proves it’s you to the wallet provider. Your keys stay with Turnkey; FloFi never holds them.',
  'Export needs an unlock in the last 5 minutes. Unlock again with your email code, Google or Apple.',
  'Unlock now so FloFi Wallet is ready when FloFi asks for a signature. Unlocking never signs anything by itself.',
  'Email me a code', 'Continue with Google', 'Continue with Apple'];

describe('FloFi Wallet Portuguese catalog', () => {
  it('translates every literal the wallet pages pass to t()', () => {
    const calls = translationCalls();
    expect(calls.length).toBeGreaterThan(120);
    expect(calls.filter(key => !Object.hasOwn(portugueseWallet, key))).toEqual([]);
  });
  it('translates the texts passed to shared controls and every code message, including the fallbacks', () => {
    const fallbacks = ['MANAGED_WALLETS_NEED_EMAIL_SIGN_IN', 'OIDC_UNKNOWN', 'MANAGED_UNKNOWN', 'TOTALLY_UNKNOWN'].map(walletMessage);
    expect([...PASSED, ...Object.values(WALLET_MESSAGES), ...fallbacks].filter(key => !Object.hasOwn(portugueseWallet, key))).toEqual([]);
  });
  it('keeps placeholders and never leaves a translation empty', () => {
    for (const [key, value] of Object.entries(portugueseWallet)) {
      expect(value.trim(), key).not.toBe('');
      expect([...new Set(value.match(/\{\d+\}/g) ?? [])].sort(), key).toEqual([...new Set(key.match(/\{\d+\}/g) ?? [])].sort());
    }
  });
});
