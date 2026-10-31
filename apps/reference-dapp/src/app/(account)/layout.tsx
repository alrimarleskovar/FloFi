// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: sign-in and wallet onboarding, between the public landing page and `/app`. Outside the product
 * workspace: no workflow, wallet-execution or Copilot state is mounted here.
 */
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { connection } from 'next/server';
import { LocaleProvider } from '../../i18n/locale';
import { LANGUAGE_COOKIE, parseLanguage } from '../../i18n/language';
import { THEME_BOOTSTRAP } from '../../accounts/account-theme';
import '../globals.css';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await connection();
  const jar = await cookies();
  // The proxy's per-request nonce (src/accounts/account-csp.ts): the only inline script these pages run besides Next.js's own.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <LocaleProvider initialLanguage={parseLanguage(jar.get(LANGUAGE_COOKIE)?.value) ?? 'EN'}>
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}/>
    {children}
  </LocaleProvider>;
}
