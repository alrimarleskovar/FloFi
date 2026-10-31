// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's pages (wallet origin only; the proxy serves them nowhere else). No product shell, no
 * workflow engine, no Copilot: only the language provider and the theme bootstrap. Every page renders per request so the proxy's nonce
 * policy (`walletPagePolicy`: no `'unsafe-eval'`, no inline script but this nonce'd one) applies to it and to Next.js's own scripts.
 */
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { connection } from 'next/server';
import { LocaleProvider } from '../../i18n/locale';
import { LANGUAGE_COOKIE, parseLanguage } from '../../i18n/language';
import { THEME_BOOTSTRAP } from '../../accounts/account-theme';
import '../globals.css';

export default async function WalletLayout({ children }: { children: ReactNode }) {
  await connection();
  const jar = await cookies();
  // The proxy's per-request nonce: the only inline script these pages run besides Next.js's own.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <LocaleProvider initialLanguage={parseLanguage(jar.get(LANGUAGE_COOKIE)?.value) ?? 'EN'}>
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}/>
    {children}
  </LocaleProvider>;
}
