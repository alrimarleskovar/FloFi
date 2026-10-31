// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: `/onboarding/wallets`, create or import EVM and Solana wallets with the wallet provider. */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { accountState } from '../../../account-action';
import { AddWallets } from '../../../../components/account/add-wallets';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi · Add wallets', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function AddWalletsPage() {
  const state = await accountState();
  if (!state.account) redirect('/login?returnTo=%2Fonboarding%2Fwallets');
  return <AddWallets state={state}/>;
}
