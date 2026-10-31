// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-FLOFI-AUTH-WALLETS-001: `/login`. A verified session is restored server-side and continues to the app (or onboarding). */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { accountState } from '../../account-action';
import { safeReturnPath } from '../../../accounts/account-session';
import { SignInScreen } from '../../../components/account/sign-in';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi · Sign in', robots: { index: false, follow: false }, referrer: 'no-referrer' };
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams, state = await accountState();
  const intent = one(params.intent) === 'link' ? 'link' : 'sign-in', returnTo = safeReturnPath(one(params.returnTo) ?? '/app');
  const method = one(params.method) === 'email' ? 'email' : one(params.method) === 'wallet' ? 'wallet' : null;
  const error = one(params.error), code = error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error) ? error : null;
  // A returning, still-valid session goes straight on, unless the person explicitly asked to sign in again or to add a sign-in.
  if (state.account && intent === 'sign-in' && !method && !code) {
    const social = state.account.method === 'google' || state.account.method === 'apple' || state.account.method === 'email';
    redirect(social && state.account.onboarding === 'pending' ? '/onboarding' : returnTo);
  }
  if (intent === 'link' && !state.account) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return <SignInScreen state={state} initialError={code} returnTo={returnTo} intent={intent} initialMethod={method}/>;
}
