// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: `/onboarding`, the wallet introduction for a signed-in account. */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { accountState } from '../../account-action';
import { WalletIntro } from '../../../components/account/wallet-intro';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi · Your wallets', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function OnboardingPage() {
  const state = await accountState();
  if (!state.account) redirect('/login?returnTo=%2Fonboarding');
  return <WalletIntro state={state}/>;
}
