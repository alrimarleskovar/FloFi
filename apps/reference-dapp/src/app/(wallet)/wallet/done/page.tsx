// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: `/wallet/done`, where a Google/Apple unlock window lands (`/wallet/callback/<provider>` redirects here).
 * It carries only `unlocked` or a closed error code, tells the waiting FloFi Wallet window to re-check its session, and closes itself.
 */
import type { Metadata } from 'next';
import { WalletDone } from '../../../../wallet-app/wallet-done';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi Wallet', robots: { index: false, follow: false }, referrer: 'no-referrer' };
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function WalletDonePage({ searchParams }: { searchParams: Search }) {
  const raw = (await searchParams).result;
  const result = raw === 'unlocked' ? 'unlocked' : typeof raw === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(raw) ? raw : 'OIDC_SIGN_IN_FAILED';
  return <WalletDone result={result}/>;
}
