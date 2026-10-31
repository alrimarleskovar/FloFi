// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: `/wallet`, FloFi Wallet (wallet origin only). The server passes the client only public configuration: the
 * product and wallet origins, the provider's import/export frame URLs and OTP signer override (MOCKED loopback suite only; null in
 * production), and which unlock methods this deployment can run. No secret, no account data: the account arrives by handoff from the
 * opener. Without a wallet origin and a provider, the page says FloFi Wallet is unavailable and nothing is simulated.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { oidcConfig } from '../../../accounts/oidc';
import { createTurnkeyServer, turnkeyConfig } from '../../../accounts/turnkey-server';
import { walletOrigin } from '../../../accounts/wallet-origin';
import { WalletApp, type WalletAppConfig } from '../../../wallet-app/wallet-app';
import { WalletUnavailable } from '../../../wallet-app/wallet-shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi Wallet', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function WalletPage() {
  const origin = walletOrigin(process.env), provider = turnkeyConfig(process.env);
  if (!origin || !provider) return <WalletUnavailable appOrigin={origin?.appOrigin ?? null}/>;
  // Defence in depth: the proxy already serves this page only on the wallet host.
  if (((await headers()).get('host') ?? '').toLowerCase() !== origin.host.toLowerCase()) notFound();
  const browser = createTurnkeyServer(provider).browser();
  const config: WalletAppConfig = { appOrigin: origin.appOrigin, walletOrigin: origin.origin, otpSignerPublicKey: browser.otpSignerPublicKey,
    frames: { exportIframeUrl: browser.exportIframeUrl, importIframeUrl: browser.importIframeUrl },
    unlock: { email: true, google: oidcConfig('google', process.env, origin.origin) !== null, apple: oidcConfig('apple', process.env, origin.origin) !== null } };
  return <WalletApp config={config}/>;
}
