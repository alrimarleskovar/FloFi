// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: landing → sign-in → wallet onboarding → Build 0, My wallets and export, on normal routes; FloFi Wallet
 * (mainnet-only) signing a reviewed Solana mainnet swap (Jupiter) and a reviewed Base mainnet transfer, and refusing what matches no reviewed
 * attempt or names a test network (MOCKED loopback Solana mainnet/Jupiter and Base mainnet harnesses: mainnet-shaped, MOCKED evidence only).
 * MOCKED loopback providers only (playwright.auth-wallets.config.ts): this proves FloFi's own flows, verification and isolation,
 * never the live Google, Apple or Turnkey services. Screenshots go to the test output directory.
 */
import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JUPITER_SOLANA_MAINNET } from '@defi-workflow-engine/action-registry';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { base58Encode } from '@defi-workflow-engine/reference-compiler';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { E2E_APP_ORIGIN } from './app-origin';
import { chooseWallet, openSimulationDetails } from './fixtures';
import { installJourneyWallet } from './journey-fixtures';
import { authorSolanaSwap, chooseSolanaWallet, jupiterControl } from './jupiter-fixtures';
import { createAccountStore } from '../src/accounts/account-store';
import { claimAttempt, signingDeps } from '../src/app/flofi-wallet-signing';
import { CATALOG_NETWORKS, localCatalogNetworkMode } from '../src/server/catalog-networks';
import { createJupiterService } from '../src/server/jupiter-service';
import { createJupiterHttp } from '../src/server/jupiter-http';
import { decodeSignedEip1559, resolveManagedSigning } from '../src/server/managed-signing';
import { createManagedWalletEvm, expectedBroadcast } from '../src/server/managed-wallet-evm';
import { createRobinhoodTransferService } from '../src/server/robinhood-transfer-service';
import { createSolanaRpc } from '../src/server/solana-rpc';
import { parseSigningContext } from '../src/wallet/flofi-signing';

const harness = process.env.FLOFI_ACCOUNT_HARNESS_ORIGIN ?? '';
/** FloFi Wallet: the same loopback server under another host name, i.e. another origin (playwright.auth-wallets.config.ts). */
const WALLET = process.env.FLOFI_E2E_WALLET_ORIGIN ?? '';
const allowed = new Set([E2E_APP_ORIGIN, WALLET, harness, harness.replace(/:(\d+)$/, (_, p: string) => `:${Number(p) + 1}`), harness.replace(/:(\d+)$/, (_, p: string) => `:${Number(p) + 2}`)]);
/** Closed loop: the app and the MOCKED loopback harness only; any other request fails the test. */
const test = base.extend<{ guard: string[] }>({
  guard: [async ({ context }, use) => {
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      let origin = '';
      try { origin = new URL(route.request().url()).origin; } catch { /* invalid URL is refused */ }
      if (allowed.has(origin)) await route.continue(); else { unexpected.push(route.request().url()); await route.abort('blockedbyclient'); }
    });
    await use(unexpected);
    expect(unexpected).toEqual([]);
  }, { auto: true }],
});
test.skip(process.env.FLOFI_AUTH_WALLETS_E2E !== 'MOCKED_LOOPBACK_ONLY', 'Runs only under playwright.auth-wallets.config.ts');

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });
async function setup(page: Page, { theme = 'dark', language = 'EN' }: { theme?: 'dark' | 'light'; language?: 'EN' | 'PT' } = {}) {
  // Reduced motion: no transition or floating animation runs, so every screenshot shows a settled frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem('flofi.theme', theme); localStorage.setItem('flofi.language', language);
    const writes: string[] = [];
    Object.defineProperty(window, 'clipboardWrites', { get: () => writes });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { writes.push(text); } } });
  }, { theme, language });
}
async function googleSignIn(page: Page, user: 'e2e-google-ana' | 'e2e-google-bruno') {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Google', exact: true }).click();
  await expect(page.getByRole('heading', { name: /MOCKED Google sign-in/ })).toBeVisible();
  await page.getByRole('button', { name: `Continue as ${user} (MOCKED)` }).click();
}
const accountCookie = async (context: BrowserContext) => (await context.cookies()).find(cookie => cookie.name === 'flofi_account_session');

test.describe.configure({ mode: 'serial' });

test('the landing opens sign-in with exactly Apple, Google, Email and Web3 Wallet (desktop, mobile, PT/EN, light/dark)', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
  await page.goto('/');
  await page.locator('header').getByRole('link', { name: 'Launch Beta FloFi', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign inyour way');
  // Never framed by another site (clickjacking), never referred.
  const headers = (await page.request.get('/login')).headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  // A per-request nonce policy: only Next.js's own scripts and what they load run; an injected inline handler does not.
  const policy = headers['content-security-policy']!, nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
  expect(policy).toContain("connect-src 'self'");
  expect(/'nonce-([^']+)'/.exec((await page.request.get('/login')).headers()['content-security-policy']!)?.[1]).not.toBe(nonce);
  const violations = await page.evaluate(() => new Promise<{ ran: boolean; blocked: string[] }>(resolve => {
    const blocked: string[] = [];
    document.addEventListener('securitypolicyviolation', event => blocked.push(event.effectiveDirective));
    const holder = document.createElement('div');
    holder.innerHTML = '<img alt="" src="data:," onerror="window.__flofiInjected = true">';
    document.body.append(holder);
    setTimeout(() => { holder.remove(); resolve({ ran: (window as unknown as { __flofiInjected?: boolean }).__flofiInjected === true, blocked }); }, 500);
  }));
  expect(violations.ran).toBe(false);
  expect(violations.blocked).toContain('script-src-attr');
  const methods = page.getByRole('group', { name: 'Sign-in methods' }).getByRole('button');
  expect(await methods.allInnerTexts()).toEqual(['Apple', 'Google', 'Email', 'Web3 Wallet']);
  await expect(page.getByText(/Telegram|Passkey|TON/)).toHaveCount(0);
  for (const button of await methods.all()) await expect(button).toBeEnabled();
  // Keyboard: the methods are reachable in order.
  await page.getByRole('button', { name: 'Apple', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Google', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 }); await shot(page, '01-sign-in-desktop-dark');
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); await shot(page, '07-sign-in-desktop-light');
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, '02-sign-in-mobile-dark');
  await page.getByRole('button', { name: 'PT', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrardo seu jeito');
  await expect(page.getByRole('button', { name: 'Carteira Web3', exact: true })).toBeVisible();
  await shot(page, '02-sign-in-mobile-dark-pt');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
});

test('a provider cancellation or a tampered state signs nobody in', async ({ page, context }) => {
  await setup(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Google', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/login\?error=OIDC_CANCELLED/);
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in was cancelled. Nothing changed.' })).toBeVisible();
  // A callback without this browser's flow cookie (another browser, replay) is refused.
  await page.goto('/auth/callback/google?code=forged&state=forged');
  await expect(page).toHaveURL(/error=OIDC_STATE_INVALID/);
  expect(await accountCookie(context)).toBeUndefined();
});

/** Opens FloFi Wallet by a click on the product page; returns its window once it shows the account it serves. */
async function walletWindow(page: Page, click: () => Promise<unknown>, account: string | RegExp) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).origin).toBe(WALLET);
  expect(popup.url()).not.toContain('handoff'); // the account arrives by postMessage from its opener, never in a URL
  await expect(popup.getByText(account).first()).toBeVisible();
  return popup;
}
/** Unlock with the account's Google identity through FloFi Wallet's own client, in a child window opened by FloFi Wallet. */
async function unlockWithGoogle(popup: Page, user: string) {
  const [child] = await Promise.all([popup.waitForEvent('popup'), popup.getByRole('button', { name: 'Continue with Google' }).click()]);
  await expect(child.getByRole('heading', { name: /MOCKED Google sign-in/ })).toBeVisible();
  await child.getByRole('button', { name: `Continue as ${user} (MOCKED)` }).click();
  await expect(popup.getByText(/^Unlocked/).first()).toBeVisible();
}
/** FloFi Wallet arms Sign only after its request has been on screen in a focused window for a moment. */
async function confirmInWallet(popup: Page, name: string | RegExp) {
  await popup.bringToFront();
  const button = popup.getByRole('button', { name, exact: typeof name === 'string' });
  await expect(button).toBeEnabled();
  await button.click();
}

test('first Google sign-in: wallet introduction, then create and import in FloFi Wallet on its own origin, Build 0, persistence', async ({ page, context }) => {
  await setup(page);
  await googleSignIn(page, 'e2e-google-ana');
  await expect(page).toHaveURL('/onboarding');
  const cookie = await accountCookie(context);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('flofi_account_session');
  await expect(page.getByRole('heading', { name: 'Your wallets. One FloFi account.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Signed-in account' })).toContainText('e2e-google-ana@flofi-e2e.test');
  await expect(page.getByText(/These are the ecosystems FloFi supports today/)).toBeVisible();
  await expect(page.getByText(/\bTON\b/)).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 }); await shot(page, '03-wallet-introduction-dark');

  await page.getByRole('link', { name: 'Add wallets' }).click();
  await expect(page).toHaveURL('/onboarding/wallets');
  // Account pages frame nothing: every provider frame lives in FloFi Wallet, on its own origin.
  expect((await page.request.get('/onboarding/wallets')).headers()['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'.*frame-src 'none'/);
  await expect(page.getByRole('note').filter({ hasText: 'Your wallets open in FloFi Wallet' })).toBeVisible();
  expect(await page.locator('input[type=password], textarea, iframe').count()).toBe(0);
  const proceed = page.getByRole('button', { name: 'Continue to FloFi' });
  await expect(proceed).toBeDisabled();

  // Create EVM: FloFi Wallet opens inside the click, receives the account by postMessage, and asks for an unlock first.
  const popup = await walletWindow(page, () => page.getByRole('button', { name: 'Create EVM wallet' }).click(), 'e2e-google-ana@flofi-e2e.test');
  await expect(popup.getByRole('heading', { name: 'Create a EVM wallet' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Create wallet' })).toBeDisabled();
  await shot(popup, '08-flofi-wallet-locked');
  await unlockWithGoogle(popup, 'e2e-google-ana');
  await popup.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'EVM wallet created' })).toBeVisible();
  await expect(proceed).toBeEnabled();
  // Solana: the same window, still unlocked: no second unlock.
  await page.getByRole('button', { name: 'Create Solana wallet' }).click();
  await expect(popup.getByRole('heading', { name: 'Create a Solana wallet' })).toBeVisible();
  await popup.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Solana wallet created' })).toBeVisible();
  // Import: the key is typed only into the provider's frame inside FloFi Wallet; the product page never has a key field.
  await page.getByRole('button', { name: 'Import EVM key' }).click();
  await expect(popup.getByRole('heading', { name: 'Import a EVM key' })).toBeVisible();
  await popup.frameLocator('#flofi-import-evm').getByRole('textbox', { name: 'Private key' }).fill('not-a-real-key-e2e-only');
  await shot(popup, '09-flofi-wallet-import');
  await popup.getByRole('button', { name: 'Import wallet', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'EVM key imported' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Wallets saved to your account' }).getByRole('listitem')).toHaveCount(3);
  expect(await page.locator('input[type=password], textarea, iframe').count()).toBe(0);
  await shot(page, '04-create-import-wallets-dark');
  await page.getByRole('switch', { name: 'Dark theme' }).click(); await shot(page, '07-create-import-wallets-light');
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await shot(page, '04-create-import-wallets-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
  // The product origin never holds a provider key or session.
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toEqual([]);
  await proceed.click();
  await expect(page).toHaveURL('/app');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.goto('/app/credentials');
  const mine = page.getByRole('region', { name: 'My wallets' });
  await expect(mine.locator('.workspace-wallet-card')).toHaveCount(3);
  await expect(mine.locator('[data-origin="generated"]')).toHaveCount(2);
  await expect(mine.locator('[data-origin="imported"]')).toHaveCount(1);
  await expect(mine.getByText('FloFi wallet · Ethereum · Generated')).toBeVisible();
  // Managed wallets sign in FloFi Wallet, after the person reviews the transaction in FloFi.
  await expect(mine.locator('[data-managed-signing="flofi-wallet"]')).toHaveCount(3);
  await expect(mine.locator('[data-origin="generated"]').first()).toContainText('Signs in FloFi Wallet, after you review the transaction in FloFi.');
  await page.reload();
  await expect(page.getByRole('region', { name: 'My wallets' }).locator('.workspace-wallet-card')).toHaveCount(3);
  await shot(page, '05-credentials-my-wallets');
  await page.goto('/login'); await expect(page).toHaveURL('/app');
});

test('export: only in FloFi Wallet, after a fresh unlock and an explicit acknowledgement, shown only in the provider frame', async ({ page }) => {
  await setup(page);
  await googleSignIn(page, 'e2e-google-ana');
  await expect(page).toHaveURL('/app');
  await page.goto('/app/credentials');
  const mine = page.getByRole('region', { name: 'My wallets' });
  const generated = mine.locator('[data-origin="generated"]').first(), imported = mine.locator('[data-origin="imported"]').first();
  await imported.getByRole('button', { name: /^Export / }).click();
  let dialog = page.getByRole('dialog', { name: 'Export wallet' });
  // An imported key has no recovery phrase, and none is ever derived from it.
  await expect(dialog.getByRole('button', { name: 'Export private key in FloFi Wallet' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export recovery phrase in FloFi Wallet' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await generated.getByRole('button', { name: /^Export / }).click();
  dialog = page.getByRole('dialog', { name: 'Export wallet' });
  await expect(dialog.getByRole('note')).toContainText('Never share your private key or recovery phrase');
  await shot(page, '06-export-wallet-modal-dark');
  // The product page shows no secret and no frame of its own: it only opens FloFi Wallet.
  const popup = await walletWindow(page, () => dialog.getByRole('button', { name: 'Export recovery phrase in FloFi Wallet' }).click(), 'e2e-google-ana@flofi-e2e.test');
  await expect(popup.getByRole('heading', { name: /Show the recovery phrase of/ })).toBeVisible();
  const show = popup.getByRole('button', { name: 'Show recovery phrase' });
  await expect(show).toBeDisabled();
  await unlockWithGoogle(popup, 'e2e-google-ana');
  await expect(show).toBeDisabled(); // still needs the acknowledgement
  await popup.getByRole('checkbox').check();
  await confirmInWallet(popup, 'Show recovery phrase');
  await expect(popup.frameLocator('#flofi-export-wallet').getByText(/MOCKED recovery phrase would be shown here/)).toBeVisible();
  await shot(popup, '06-export-revealed-in-flofi-wallet');
  await popup.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Export finished in FloFi Wallet.' })).toBeVisible();
  expect(await page.locator('iframe').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites)).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toMatch(/mnemonic|seed|privateKey|private_key|exportBundle|mock-export-bundle|recovery/i);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await generated.getByRole('button', { name: /^Export / }).click();
  await shot(page, '07-export-wallet-modal-light');
});

test('an email account unlocks FloFi Wallet only with its own 8-character code; a sign-in code never unlocks it', async ({ page, context }) => {
  await setup(page);
  const bodies: string[] = [];
  context.on('request', request => { const origin = new URL(request.url()).origin; if (origin === E2E_APP_ORIGIN || origin === WALLET) bodies.push(request.postData() ?? ''); });
  await page.goto('/login');
  await expect(async () => {
    if (!await page.getByLabel('Email address').isVisible()) await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByLabel('Email address').fill('erin@flofi-e2e.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel(/Enter the 6-digit code/).fill('246810');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL('/onboarding');
  await page.goto('/onboarding/wallets');
  const popup = await walletWindow(page, () => page.getByRole('button', { name: 'Create Solana wallet' }).click(), 'erin@flofi-e2e.test');
  await popup.getByRole('button', { name: 'Email me a code' }).click();
  await expect(popup.getByText('We emailed an 8-character FloFi Wallet code to erin@flofi-e2e.test.')).toBeVisible();
  // The sign-in code shape is refused before anything is sent; then the wallet code unlocks.
  await popup.getByLabel('FloFi Wallet code').fill('246810');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByRole('alert').filter({ hasText: 'Enter the 8-character code from the email.' }).first()).toBeVisible();
  await shot(popup, '10-flofi-wallet-email-code-refused');
  await popup.getByLabel('FloFi Wallet code').fill('FLOFI246');
  await popup.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(popup.getByText(/^Unlocked/).first()).toBeVisible();
  await popup.getByRole('button', { name: 'Create wallet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Solana wallet created' })).toBeVisible();
  // Neither code ever travelled in plaintext to FloFi's product or wallet origin.
  expect(bodies.filter(body => /246810|FLOFI246/.test(body))).toEqual([]);
  // Lock ends FloFi Wallet's session in this browser: nothing can be signed from the window until FloFi opens it again (and it is unlocked).
  await popup.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(popup.getByRole('heading', { name: 'FloFi Wallet is locked' })).toBeVisible();
  expect((await popup.request.get(`${WALLET}/api/wallet/session`)).status()).toBe(401);
});

test('skip for now reaches Build 0 and is remembered; another account sees none of the first account’s wallets; deletion', async ({ page, context }) => {
  await setup(page);
  await googleSignIn(page, 'e2e-google-bruno');
  await expect(page).toHaveURL('/onboarding');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL('/app');
  await page.goto('/login'); await expect(page).toHaveURL('/app');
  await page.goto('/app/credentials');
  await expect(page.getByRole('region', { name: 'My wallets' }).getByText('No wallets in your account yet')).toBeVisible();
  // Deleting the account (recent sign-in) removes it and signs out; the wallets themselves are untouched.
  const mine = page.getByRole('region', { name: 'My wallets' });
  await mine.getByRole('button', { name: 'Delete FloFi account' }).click();
  await expect(mine.getByText(/Your wallets and their funds are not affected/)).toBeVisible();
  const cookie = (await accountCookie(context))!;
  await mine.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page).toHaveURL('/login');
  // The deleted session's cookie (replayed, or tampered) is rejected by the server: nobody is signed in.
  await context.addCookies([cookie]);
  await page.goto('/onboarding'); await expect(page).toHaveURL(/\/login/);
  await context.addCookies([{ ...cookie, value: cookie.value.replace(/.$/, c => c === 'A' ? 'B' : 'A') }]);
  await page.goto('/onboarding'); await expect(page).toHaveURL(/\/login/);
});

test('FloFi Wallet is another origin: each host serves only its own routes and the product origin holds no wallet key or provider route', async ({ page, request }) => {
  expect(WALLET).toMatch(/^http:\/\/localhost:\d+$/);
  // The wallet host serves only FloFi Wallet; the product host has none of it; no server action runs on the wallet host.
  expect((await request.get(`${WALLET}/app`)).status()).toBe(404);
  expect((await request.get(`${WALLET}/login`)).status()).toBe(404);
  expect((await request.get(`${E2E_APP_ORIGIN}/wallet`)).status()).toBe(404);
  expect((await request.get(`${E2E_APP_ORIGIN}/api/wallet/session`)).status()).toBe(404);
  expect((await request.post(`${WALLET}/wallet`, { headers: { 'next-action': '0'.repeat(42) } })).status()).toBe(404);
  // The old product-origin provider relay no longer exists: no provider request can be stamped or relayed from the product origin.
  expect((await request.post(`${E2E_APP_ORIGIN}/api/account/provider/submit/export_wallet`, { data: '{}' })).status()).toBe(404);
  const wallet = await request.get(`${WALLET}/wallet`);
  expect(wallet.headers()['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic';/);
  expect(wallet.headers()['content-security-policy']).not.toContain('unsafe-eval');
  expect(wallet.headers()['x-frame-options']).toBe('DENY');
  // A product page cannot use FloFi Wallet's routes: a cross-origin POST is refused before anything else.
  await setup(page);
  await page.goto('/app');
  const status = await page.evaluate(async origin => (await fetch(`${origin}/api/wallet/session`, { method: 'POST', mode: 'no-cors', credentials: 'include',
    body: '{"handoff":"x"}' }).then(() => 'sent', () => 'failed')), WALLET);
  // The product page's own policy (connect-src 'self') stops it in the browser; a form post or another client is refused by the server (below).
  expect(status).toBe('failed');
  const refused = await request.post(`${WALLET}/api/wallet/session`, { headers: { origin: E2E_APP_ORIGIN, 'sec-fetch-site': 'same-site' }, data: { handoff: 'x' } });
  expect(refused.status()).toBe(403);
  // No provider key store on the product origin.
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).not.toContain('TurnkeyStamperDB');
});

test('Apple and email sign-in create verified accounts; a wrong email code signs nobody in', async ({ page, context }) => {
  await setup(page);
  // The code is encrypted to the provider in the browser: no request to FloFi carries it in plaintext.
  const bodies: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin === E2E_APP_ORIGIN) bodies.push(request.postData() ?? ''); });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Apple', exact: true }).click();
  await page.getByRole('button', { name: 'Continue as e2e-apple-carla (MOCKED)' }).click();
  await expect(page).toHaveURL('/onboarding');
  await expect(page.getByRole('region', { name: 'Signed-in account' })).toContainText('Apple');
  await page.getByRole('region', { name: 'Signed-in account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  expect(await accountCookie(context)).toBeUndefined();

  // After the full-page sign-out redirect, a click before hydration is lost: retry until the email form is open.
  await expect(async () => {
    if (!await page.getByLabel('Email address').isVisible()) await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByLabel('Email address').fill('dora@flofi-e2e.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel(/Enter the 6-digit code we sent to dora@flofi-e2e.test/).fill('000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /not valid or has expired/ })).toBeVisible();
  expect(await accountCookie(context)).toBeUndefined();
  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A new code was sent to dora@flofi-e2e.test.' })).toBeVisible();
  await page.getByLabel(/Enter the 6-digit code/).fill('246810');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL('/onboarding');
  await expect(page.getByRole('region', { name: 'Signed-in account' })).toContainText('dora@flofi-e2e.test');
  expect(bodies.some(body => body.includes('encryptedOtpBundle') || body.includes('encappedPublic'))).toBe(true);
  expect(bodies.filter(body => body.includes('246810') || body.includes('000000'))).toEqual([]);
});

test('Web3 Wallet sign-in proves ownership with a signature, skips onboarding and never offers key export', async ({ page, context }) => {
  const wallet = createTestWallet(), transactions: string[] = [];
  await setup(page);
  // Any transaction-path call would land here, in the test process: sign-in must never make one.
  await installJourneyWallet(page, [wallet], { chain: '0x2105', transactionControl: async (method: string) => { transactions.push(method); throw new Error('NO_TRANSACTIONS_IN_SIGN_IN'); } });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Web3 Wallet', exact: true }).click();
  await page.getByRole('button', { name: 'EVM wallet', exact: true }).click();
  await chooseWallet(page, 'Browser wallet');
  await expect(page).toHaveURL('/app');
  // The server sealed the wallet session only after verifying the EIP-4361 signature, then the account session from it.
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === 'flofi_wallet_session')).toMatchObject({ httpOnly: true });
  expect(cookies.find(cookie => cookie.name === 'flofi_account_session')).toMatchObject({ httpOnly: true });
  expect(transactions).toEqual([]);
  await page.goto('/app/credentials');
  const card = page.getByRole('region', { name: 'My wallets' }).locator('[data-origin="external"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('code')).toHaveAttribute('title', wallet.address.toLowerCase());
  await expect(card.getByRole('button', { name: /^Export / })).toHaveCount(0);
  // The person's own wallet signs FloFi workflows as before: no managed-wallet signing notice on it.
  await expect(card.locator('[data-managed-signing]')).toHaveCount(0);
  await expect(page.getByText('Creating or importing wallets needs')).toHaveCount(0);
});

// ── FloFi Wallet signs reviewed FloFi strategies on mainnet, on MOCKED loopback harnesses (MOCKED evidence only) ──
// FloFi Wallet is a mainnet wallet (Ethereum, Base, Arbitrum One and Robinhood Chain; Solana mainnet), so its journeys sign mainnet-shaped
// transactions: a Jupiter swap on the MOCKED loopback Solana mainnet harness (127.0.0.1:8551) and a Base mainnet transfer on the MOCKED loopback
// Base chain (127.0.0.1:8562). Never a public network or provider, never a real key or real funds. MOCKED results never authorize FloFi's own
// UI (release-financial-provenance.spec.ts): the canvas keeps "Authorize in wallet" disabled for them. So the browser runs everything the UI
// allows (authoring, simulation, the FloFi Wallet entry, FloFi Wallet itself), and FloFi's own flow services, composed in this process exactly as
// their server actions compose them for these harnesses (the app's journals, the MOCKED loopback RPCs), perform the steps the UI may not perform
// for a MOCKED result: the owner's Review acceptance and Execute's durable attempt (and, for EVM, FloFi's broadcast of the owner-signed bytes).
// The signing request then reaches FloFi Wallet from the window that opened it, in the form FloFi's channel posts it (flofi-wallet-channel.ts).
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, JUPITER_RUN = /^jupiter-[a-f0-9]{32}$/, BASE_TRANSFER_RUN = /^bat-[a-f0-9]{32}$/;
type SigningActivity = { sign_raw_payload: number; sign_transaction: number };
type WalletAnswer = { ok: boolean; code?: string; result?: { signedTransaction?: string } };
/** Signing activities that reached the MOCKED provider stand-in so far, whatever their outcome (e2e/account-harness.ts). */
const providerSigningActivity = async () => await (await fetch(`${harness}/__e2e/signing-activity`)).json() as SigningActivity;
/** The app's run journal of a MOCKED loopback mainnet flow (playwright.auth-wallets.config.ts); anything else is refused. */
function mockedJournal(flow: 'jupiter' | 'base'): string {
  const [gate, journal, prefix] = flow === 'jupiter' ? [process.env.GRYLOO_JUPITER_E2E, process.env.GRYLOO_JUPITER_JOURNAL, 'gryloo-build014-']
    : [process.env.GRYLOO_BASE_MAINNET_E2E, process.env.GRYLOO_BASE_JOURNAL, 'gryloo-base-001-'];
  if (gate !== 'MOCKED_LOOPBACK_ONLY' || !journal?.startsWith(join(tmpdir(), prefix))) throw Error('MOCK_MAINNET_DENIED');
  return journal;
}
const JUPITER_HARNESS = 'http://127.0.0.1:8551';
/** FloFi's Jupiter swap service on the app's journal and the MOCKED loopback Solana mainnet harness (the composition of src/app/jupiter-action.ts). */
const jupiterSwapService = () => createJupiterService({ journalDir: mockedJournal('jupiter'), provenance: 'MOCKED', executionEnabled: true,
  rpc: createSolanaRpc(`${JUPITER_HARNESS}/rpc`, true), http: createJupiterHttp(`${JUPITER_HARNESS}/swap/v2/build`, undefined) });
/** The app's MOCKED Base mainnet mode (playwright.auth-wallets.config.ts): the loopback harness, which never reads or sends to a public network. */
const BASE_HARNESS_ENV = Object.freeze({ GRYLOO_BASE_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' });
/** FloFi's Base mainnet transfer service on the app's journal and the MOCKED loopback Base chain (the composition of src/app/robinhood-transfer-action.ts). */
function baseTransferService() {
  const base = CATALOG_NETWORKS.base;
  expect(localCatalogNetworkMode(base, BASE_HARNESS_ENV)).toBe('harness');
  return createRobinhoodTransferService({ journalDir: join(mockedJournal('base'), 'mainnet-transfer'), idPrefix: base.prefixes.transfer, provenance: 'MOCKED',
    rpcs: { [base.chain]: base.rpc('harness', BASE_HARNESS_ENV) }, catalogFor: base.catalogFor('harness'), executionEnabled: base.ownerExecutionEnabled('harness', BASE_HARNESS_ENV) });
}
/** FloFi's managed EVM network side on the same MOCKED harness (the local composition of src/app/flofi-wallet-signing.ts). */
const managedEvm = () => createManagedWalletEvm({ env: BASE_HARNESS_ENV, mode: network => localCatalogNetworkMode(network, BASE_HARNESS_ENV) });
/** The MOCKED Base chain's test control (e2e/base-mainnet-serve.ts): reset and fund one address, mine confirmations, count accepted sends. */
const baseChain = async (body: Record<string, unknown>) => (await (await fetch('http://127.0.0.1:8562/__harness/chain', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as { result: unknown }).result;
/** Base units as an exact decimal (trailing zeros removed, never rounded), as FloFi Wallet prints amounts below one unit. */
const decimal = (value: bigint, decimals: number) => {
  const digits = value.toString().padStart(decimals + 1, '0'), fraction = digits.slice(-decimals).replace(/0+$/, '');
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
};
/** A labelled value of a definition list (`<dt>label</dt><dd>value</dd>`). */
const definition = (scope: Locator, label: string) => scope.getByRole('term').filter({ hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) })
  .locator('xpath=following-sibling::dd[1]');
/** Every window this page opens, kept by an init script (as any script on the product origin could keep it). */
const keepOpenedWindows = (page: Page) => page.addInitScript(() => {
  const opened: (Window | null)[] = [], open = window.open.bind(window);
  Object.defineProperty(window, '__openedWindows', { value: opened });
  window.open = (...args: Parameters<typeof window.open>) => { const handle = open(...args); opened.push(handle); return handle; };
});
/** One request to FloFi Wallet from the window that opened it, as FloFi's channel posts it; resolves with FloFi Wallet's answer. */
const askFloFiWallet = (page: Page, request: Record<string, unknown>) => page.evaluate(({ request, origin }) => new Promise<unknown>(resolve => {
  const target = (window as unknown as { __openedWindows: (Window | null)[] }).__openedWindows.filter(handle => handle && !handle.closed).at(-1)!;
  const id = `e2e-${crypto.randomUUID()}`;
  addEventListener('message', function answer(event) {
    const data = event.data as { type?: unknown; id?: unknown } | null;
    if (event.source === target && data?.type === 'response' && data.id === id) { removeEventListener('message', answer); resolve(data); }
  });
  target.postMessage({ protocol: 'flofi-wallet/1', type: 'request', id, request }, origin);
}), { request, origin: WALLET }) as Promise<WalletAnswer>;
/** The calls FloFi Wallet's window makes to its own origin's API: path, JSON body, the relay's signing binding header and the status. */
function recordWalletCalls(context: BrowserContext) {
  const calls: { path: string; body: string; signing: string | null; status: Promise<number> }[] = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === WALLET && url.pathname.startsWith('/api/wallet/')) calls.push({ path: url.pathname, body: request.postData() ?? '',
      signing: request.headers()['x-flofi-signing'] ?? null, status: request.response().then(response => response?.status() ?? 0) });
  });
  return calls;
}
/** FloFi Wallet records the first signable state of a request as it renders (Sign and its hint): Sign is still disabled then. */
const firstSignableState = (popup: Page) => popup.waitForFunction(() => {
  const button = [...document.querySelectorAll('button')].find(element => element.textContent === 'Sign');
  const hint = button && document.getElementById(button.getAttribute('aria-describedby') ?? '');
  return hint?.textContent ? { disabled: button!.disabled, hint: hint.textContent } : null;
}, undefined, { polling: 50 });
const ARMING_HINT = /^(Sign becomes available in a moment\.|Click this window to continue\.)$/;
const jupiterPanel = (page: Page) => page.getByRole('region', { name: 'Jupiter swap', exact: true });
/**
 * In FloFi: author the canonical Solana mainnet swap (10 USDC → SOL through Jupiter), connect the "FloFi Wallet" Solana entry (Wallet Standard
 * connect on solana:mainnet: the account's public address only, nothing is signed), fund only that address on the MOCKED Solana mainnet harness,
 * and simulate. Returns the managed address, the run FloFi simulated and the Review's amounts as FloFi shows them.
 */
async function simulateJupiterSwapWithFloFiWallet(page: Page) {
  await rm(mockedJournal('jupiter'), { recursive: true, force: true });
  await authorSolanaSwap(page);
  await page.getByRole('button', { name: 'Simulate workflow' }).click();
  await openSimulationDetails(page);
  await chooseSolanaWallet(jupiterPanel(page), 'FloFi Wallet');
  const connected = jupiterPanel(page).locator('p', { hasText: 'Wallet connected:' }).locator('span');
  await expect(connected).toHaveText(SOLANA_ADDRESS);
  const owner = (await connected.textContent())!;
  // MOCKED balances on the loopback harness only (3 SOL, 100 USDC): nothing exists or moves on a public network.
  await jupiterControl({ action: 'reset', owner });
  await jupiterPanel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await expect(jupiterPanel(page).getByRole('definition').filter({ hasText: '→ expected' })).toContainText('10 USDC → expected');
  await expect(definition(jupiterPanel(page), 'Network')).toHaveText('Solana');
  await expect(definition(jupiterPanel(page), 'Provider')).toHaveText('Jupiter');
  // MOCKED: the product's own Review stays closed to authorization.
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Authorize in wallet', exact: true })).toBeDisabled();
  const reviewed = Object.fromEntries(await Promise.all(['Quoted output', 'Minimum received', 'Slippage', 'Estimated network fee'].map(async label =>
    [label, (await definition(jupiterPanel(page), label).textContent())!] as const)));
  const runId = await page.evaluate(() => (JSON.parse(localStorage.getItem('gryloo:build014:jupiter') ?? 'null') as { id?: string } | null)?.id ?? '');
  expect(runId).toMatch(JUPITER_RUN);
  return { owner, runId, reviewed };
}
/**
 * FloFi opens FloFi Wallet only inside a click, bound to this account by a handoff it posts to the window it opened. The test uses the Export
 * action of My wallets and cancels the export in FloFi Wallet; then unlocks FloFi Wallet with the account's own Google identity.
 */
async function openFloFiWallet(page: Page): Promise<Page> {
  await page.goto('/app/credentials');
  await page.getByRole('region', { name: 'My wallets' }).locator('[data-origin="generated"]').first().getByRole('button', { name: /^Export / }).click();
  const dialog = page.getByRole('dialog', { name: 'Export wallet' });
  const popup = await walletWindow(page, () => dialog.getByRole('button', { name: 'Export recovery phrase in FloFi Wallet' }).click(), 'e2e-google-ana@flofi-e2e.test');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await unlockWithGoogle(popup, 'e2e-google-ana');
  return popup;
}
/** The owner's Review acceptance and Execute's durable attempt, by FloFi's own Jupiter service (the UI does not authorize MOCKED results). */
async function prepareReviewedSwap(runId: string, owner: string) {
  const service = jupiterSwapService(), run = await service.load(runId);
  expect(run).toMatchObject({ provenance: 'MOCKED', verdict: 'PENDING', authorization: null,
    review: { owner, chain: JUPITER_SOLANA_MAINNET.chain, cluster: 'mainnet-beta', format: 'gryloo.jupiter-review.v1' } });
  await service.review(runId, run.review.commitment, run.review.workflow);
  const begun = await service.begin(runId, owner, run.review.workflow);
  expect(begun).toMatchObject({ walletChain: 'solana:mainnet', record: { attempt: { state: 'PREPARED' } } });
  return { service, unsignedTransaction: begun.unsignedTransaction };
}
/** The same unsigned v0 transaction with one byte of its recent blockhash changed. */
function otherBlockhash(unsigned: string): string {
  const wire = Buffer.from(unsigned, 'base64'), keys = wire[69]!;
  expect([wire[0], wire[65], keys < 0x80]).toEqual([1, 0x80, true]);
  wire[70 + 32 * keys]! ^= 0xff;
  return wire.toString('base64');
}

test('FloFi Wallet signs a reviewed Solana mainnet swap (Jupiter): it names the run, shows FloFi’s own Review, arms Sign, and FloFi submits and reconciles it', async ({ page, context }) => {
  await setup(page);
  await keepOpenedWindows(page);
  const before = await providerSigningActivity();
  const wallet = recordWalletCalls(context);
  await googleSignIn(page, 'e2e-google-ana');
  await expect(page).toHaveURL('/app');
  const { owner, runId, reviewed } = await simulateJupiterSwapWithFloFiWallet(page);
  const popup = await openFloFiWallet(page);
  const { service, unsignedTransaction } = await prepareReviewedSwap(runId, owner);
  expect(await jupiterControl({ action: 'sent' })).toBe(0);

  // The request names its run. FloFi Wallet records the first signable state as it renders: Sign is still disabled then.
  const firstSignable = firstSignableState(popup);
  const answered = askFloFiWallet(page, { op: 'solana_sign_transaction', address: owner, chain: 'solana:mainnet', transaction: unsignedTransaction,
    signing: { flow: 'jupiter-swap', runId } });
  const card = popup.getByRole('region', { name: 'Sign a Solana transaction' });
  await expect(card).toContainText(`Requested by ${new URL(E2E_APP_ORIGIN).host}`);
  // What FloFi Wallet shows next to Sign is its own server's Review of that run, with the amounts FloFi showed when it simulated. FloFi Wallet
  // marks every mainnet flow as real funds; this run's funds and evidence are MOCKED (asserted below).
  const summary = card.getByRole('group', { name: 'Prepared by FloFi' });
  await expect(summary).toContainText('Exactly the transaction FloFi prepared for this strategy');
  await expect(summary).toContainText('Swap');
  await expect(definition(summary, 'Network')).toHaveText('Solana Real funds');
  await expect(definition(summary, 'You pay')).toHaveText('10 USDC');
  await expect(definition(summary, 'Expected to receive')).toHaveText(reviewed['Quoted output']!);
  await expect(definition(summary, 'Minimum received')).toHaveText(reviewed['Minimum received']!);
  await expect(definition(summary, 'Max slippage')).toHaveText(reviewed.Slippage!);
  await expect(definition(summary, 'Network fee (estimate)')).toHaveText(reviewed['Estimated network fee']!);
  await expect(definition(summary, 'Provider')).toHaveText('Jupiter');
  await expect(definition(card, 'Fee payer')).toHaveText(owner);
  const asked = wallet.filter(call => call.path === '/api/wallet/sign-context');
  expect(asked.map(call => JSON.parse(call.body) as unknown)).toEqual([{ flow: 'jupiter-swap', runId, address: owner, op: 'solana_sign_transaction',
    chain: 'solana:mainnet', transaction: unsignedTransaction }]);
  expect(await asked[0]!.status).toBe(200);
  expect(await (await firstSignable).jsonValue()).toEqual({ disabled: true, hint: expect.stringMatching(ARMING_HINT) });
  await popup.bringToFront();
  const sign = card.getByRole('button', { name: 'Sign', exact: true });
  await expect(sign).toBeEnabled();
  await shot(popup, '11-flofi-wallet-signing-review');
  await sign.click();
  await expect(popup.getByRole('status').filter({ hasText: 'Signed. FloFi sends the transaction and records the result.' })).toBeVisible();

  // FloFi Wallet answers with the same transaction, the owner's signature in slot 0; it broadcasts nothing itself.
  const answer = await answered;
  expect(answer.ok).toBe(true);
  const signed = Buffer.from(answer.result!.signedTransaction!, 'base64'), unsigned = Buffer.from(unsignedTransaction, 'base64');
  expect(signed.length).toBe(unsigned.length);
  expect(signed.subarray(65).equals(unsigned.subarray(65))).toBe(true);
  expect(signed.subarray(1, 65).some(byte => byte !== 0)).toBe(true);
  expect(await jupiterControl({ action: 'sent' })).toBe(0);
  // Exactly one signing activity reached the provider, relayed with the same run binding.
  const relayed = wallet.filter(call => call.path.startsWith('/api/wallet/provider/submit/sign'));
  expect(relayed.map(call => [call.path, call.signing])).toEqual([['/api/wallet/provider/submit/sign_raw_payload', `jupiter-swap:${runId}`]]);
  expect(await relayed[0]!.status).toBe(200);
  expect(await providerSigningActivity()).toEqual({ ...before, sign_raw_payload: before.sign_raw_payload + 1 });

  // FloFi's submit verifies the signed bytes against the Review and broadcasts them once (MOCKED Solana mainnet), then reconciles the swap
  // independently. (The product UI cannot show a MOCKED run it could not authorize, and the Dashboard reads only the cloud API: FloFi's record is
  // checked.)
  let record = await service.submit(runId, answer.result!.signedTransaction!);
  expect(record.attempt).toMatchObject({ state: 'PENDING', signature: base58Encode(signed.subarray(1, 65)) });
  expect(await jupiterControl({ action: 'sent' })).toBe(1);
  for (let poll = 0; poll < 10 && !record.evidence; poll++) record = await service.observe(runId);
  expect(record).toMatchObject({ verdict: 'RECONCILED', provenance: 'MOCKED', evidenceClass: 'MOCKED', attempt: { state: 'CONFIRMED' } });
  const observation = record.observations.at(-1)!;
  expect(observation.signature).toBe(base58Encode(signed.subarray(1, 65)));
  expect(observation.explorer).toMatch(/^https:\/\/solscan\.io\/tx\/[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  expect(observation.inputSpent).toBe(record.review.amount);
  expect(BigInt(observation.outputReceived!)).toBeGreaterThanOrEqual(BigInt(record.review.quote.otherAmountThreshold));
  expect(record.evidence).toMatchObject({ bundle: { environment: 'MOCKED', outcome: 'RECONCILED' }, evidenceClass: 'MOCKED',
    publicExecution: { environment: 'MOCKED', cluster: 'mainnet-beta', chain: JUPITER_SOLANA_MAINNET.chain, provider: 'Jupiter Swap API V2 /build (Metis)',
      provenance: 'MOCKED', realFunds: false } });
  expect(await jupiterControl({ action: 'sent' })).toBe(1);
  expect(await providerSigningActivity()).toEqual({ ...before, sign_raw_payload: before.sign_raw_payload + 1 });
});

test('FloFi Wallet refuses what matches no reviewed attempt (other bytes, no FloFi binding, Solana Devnet) and nothing reaches the provider', async ({ page, context }) => {
  await setup(page);
  // Any script on the product origin (its /app pages run without a script-src policy) can keep the handle of FloFi Wallet's window and post
  // to it from the window that opened it: the threat FloFi Wallet's run binding exists for.
  await keepOpenedWindows(page);
  const wallet = recordWalletCalls(context);
  await googleSignIn(page, 'e2e-google-ana');
  await expect(page).toHaveURL('/app');
  const { owner, runId } = await simulateJupiterSwapWithFloFiWallet(page);
  const popup = await openFloFiWallet(page);
  const { service, unsignedTransaction } = await prepareReviewedSwap(runId, owner);
  const before = await providerSigningActivity();
  const request = { op: 'solana_sign_transaction', address: owner, chain: 'solana:mainnet' };
  const binding = { flow: 'jupiter-swap', runId };
  const refused = (code: string) => popup.getByRole('alert').filter({ hasText: code === 'FLOFI_WALLET_NO_MATCHING_REVIEW'
    ? 'FloFi found no reviewed strategy that matches this request, so FloFi Wallet signed nothing.'
    : 'FloFi Wallet signs only actions you reviewed and authorized in FloFi. Nothing was signed.' });

  // 1. The reviewed run's own binding, its prepared attempt, the account's managed signer, an unlocked FloFi Wallet: only one byte of the
  // transaction differs from the Review (its recent blockhash). FloFi Wallet's server finds no match; FloFi Wallet never offers Sign.
  const tampered = otherBlockhash(unsignedTransaction);
  expect(await askFloFiWallet(page, { ...request, transaction: tampered, signing: binding })).toMatchObject({ ok: false, code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
  await expect(refused('FLOFI_WALLET_NO_MATCHING_REVIEW')).toBeVisible();
  const asked = wallet.filter(call => call.path === '/api/wallet/sign-context');
  expect(asked.map(call => JSON.parse(call.body) as unknown)).toEqual([expect.objectContaining({ runId, transaction: tampered })]);
  expect(await asked[0]!.status).toBe(403);
  // 2. The exact reviewed bytes without a FloFi binding: refused before FloFi Wallet asks its server anything.
  expect(await askFloFiWallet(page, { ...request, transaction: unsignedTransaction })).toMatchObject({ ok: false, code: 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED' });
  await expect(refused('FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED')).toBeVisible();
  expect(wallet.filter(call => call.path === '/api/wallet/sign-context')).toHaveLength(1);
  // 3. The exact reviewed bytes and binding on Solana Devnet: FloFi Wallet is mainnet-only, so its protocol does not accept the request at all
  // (FLOFI_WALLET_REQUEST_INVALID); nothing is shown as signable and its server is not asked.
  expect(await askFloFiWallet(page, { ...request, chain: 'solana:devnet', transaction: unsignedTransaction, signing: binding }))
    .toMatchObject({ ok: false, code: 'FLOFI_WALLET_REQUEST_INVALID' });
  await expect(popup.getByRole('button', { name: 'Sign', exact: true })).toHaveCount(0);
  expect(wallet.filter(call => call.path === '/api/wallet/sign-context')).toHaveLength(1);
  // 4. Control: the same request with the reviewed bytes on mainnet matches the Review; the person cancels it in FloFi Wallet.
  const control = askFloFiWallet(page, { ...request, transaction: unsignedTransaction, signing: binding });
  const card = popup.getByRole('region', { name: 'Sign a Solana transaction' });
  await expect(card.getByRole('group', { name: 'Prepared by FloFi' })).toContainText('Exactly the transaction FloFi prepared for this strategy');
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await control).toMatchObject({ ok: false, code: 'FLOFI_WALLET_REJECTED' });

  // No signing activity was relayed or reached the provider; nothing was sent; the reviewed attempt is still unsigned.
  expect(wallet.filter(call => call.path.startsWith('/api/wallet/provider/submit/sign'))).toEqual([]);
  expect(await providerSigningActivity()).toEqual(before);
  expect(await jupiterControl({ action: 'sent' })).toBe(0);
  expect((await service.load(runId)).attempt).toMatchObject({ state: 'PREPARED', signature: null });
});

/** A MOCKED externally owned recipient on the MOCKED Base chain (no code there). */
const BASE_RECIPIENT = '0x3333333333333333333333333333333333333333';
/** The canonical Base mainnet native transfer as FloFi authors it: 0.001 ETH to an explicit recipient. */
const baseTransferWorkflow = (): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain: 'eip155:8453', amount: '1000000000000000', recipient: BASE_RECIPIENT })] });
/** The public address of the account's generated EVM wallet, as My wallets shows it. */
async function managedEvmAddress(page: Page): Promise<string> {
  await page.goto('/app/credentials');
  const card = page.getByRole('region', { name: 'My wallets' }).locator('[data-origin="generated"]').filter({ hasText: 'FloFi wallet · Ethereum · Generated' });
  const address = await card.locator('code').getAttribute('title');
  expect(address).toMatch(/^0x[0-9a-f]{40}$/);
  return address!;
}

test('FloFi Wallet signs a reviewed Base mainnet transfer: FloFi’s Review next to its own decoding, Sign armed, a testnet refused, FloFi broadcasts and reconciles', async ({ page, context }) => {
  await setup(page);
  await keepOpenedWindows(page);
  const before = await providerSigningActivity();
  const wallet = recordWalletCalls(context);
  await googleSignIn(page, 'e2e-google-ana');
  await expect(page).toHaveURL('/app');
  const owner = await managedEvmAddress(page);
  // 0.01 MOCKED ETH for the managed address on the MOCKED loopback Base chain only.
  await baseChain({ action: 'reset', owner, wei: (10n ** 16n).toString() });
  const popup = await openFloFiWallet(page);

  // FloFi's Simulate, the owner's Review acceptance, Execute's durable attempt and its handoff (SUBMITTING before any wallet request, as FloFi's
  // transfer store does), by FloFi's own Base mainnet transfer service.
  const service = baseTransferService(), workflow = baseTransferWorkflow();
  const simulated = await service.simulate(workflow, owner), runId = simulated.id;
  expect(runId).toMatch(BASE_TRANSFER_RUN);
  expect(simulated).toMatchObject({ provenance: 'MOCKED', verdict: 'PENDING', authorization: null, review: { format: 'gryloo.native-transfer-review.v1',
    chain: 'eip155:8453', chainId: 8453, account: owner, recipient: BASE_RECIPIENT, value: '1000000000000000', nonce: '0' } });
  await service.review(runId, simulated.review.commitment, workflow);
  const { record: prepared, transaction } = await service.begin(runId, owner, workflow);
  expect(prepared.attempt).toMatchObject({ state: 'PREPARED', nonce: '0', transactionHash: null });
  expect((await service.handoff(runId)).attempt).toMatchObject({ state: 'SUBMITTING' });
  // The request FloFi's EVM provider posts for this attempt: every EIP-1559 field as a 0x quantity, the attempt's own nonce.
  const tx = { from: owner, to: transaction.to, value: transaction.value, data: transaction.data, chainId: transaction.chainId,
    nonce: `0x${BigInt(prepared.attempt!.nonce).toString(16)}`, gas: transaction.gas,
    maxFeePerGas: transaction.maxFeePerGas, maxPriorityFeePerGas: transaction.maxPriorityFeePerGas };
  expect(tx).toMatchObject({ to: BASE_RECIPIENT, value: '0x38d7ea4c68000', data: '0x', chainId: '0x2105' });
  const signing = { flow: 'base-mainnet-transfer', runId };
  expect(await baseChain({ action: 'sent' })).toBe(0);

  // A test network is refused before anything reaches FloFi Wallet's server or the provider: the same transaction on Base Sepolia (84532).
  expect(await askFloFiWallet(page, { op: 'evm_sign_transaction', address: owner, tx: { ...tx, chainId: '0x14a34' }, signing }))
    .toMatchObject({ ok: false, code: 'FLOFI_WALLET_NETWORK_UNSUPPORTED' });
  await expect(popup.getByRole('alert').filter({ hasText: 'FloFi Wallet signs only on Ethereum, Base, Arbitrum and Robinhood Chain. Nothing was signed.' })).toBeVisible();
  expect(wallet.filter(call => call.path === '/api/wallet/sign-context' || call.path.startsWith('/api/wallet/provider/submit/sign'))).toEqual([]);
  expect(await providerSigningActivity()).toEqual(before);

  // The request names its run. FloFi Wallet records the first signable state as it renders: Sign is still disabled then.
  const firstSignable = firstSignableState(popup);
  const answered = askFloFiWallet(page, { op: 'evm_sign_transaction', address: owner, tx, signing });
  const card = popup.getByRole('region', { name: 'Sign a transaction on Base' });
  await expect(card).toContainText(`Requested by ${new URL(E2E_APP_ORIGIN).host}`);
  // FloFi's server Review of that run (amount, recipient, fee budget, nonce) …
  const summary = card.getByRole('group', { name: 'Prepared by FloFi' });
  await expect(summary).toContainText('Exactly the transaction FloFi prepared for this strategy');
  await expect(summary).toContainText('Transfer');
  await expect(definition(summary, 'Network')).toHaveText('Base Real funds');
  await expect(definition(summary, 'You send')).toHaveText('0.001 ETH');
  await expect(definition(summary, 'Recipient')).toHaveText(BASE_RECIPIENT);
  await expect(definition(summary, 'Max network cost')).toHaveText(`${decimal(BigInt(prepared.review.feeBudget), 18)} ETH`);
  await expect(definition(summary, 'Nonce')).toHaveText('0');
  // … next to FloFi Wallet's own decoding of the exact bytes it signs.
  const details = card.getByText('What you are signing', { exact: true }).locator('xpath=following-sibling::dl[1]');
  await expect(definition(details, 'Network')).toHaveText('Base (8453)');
  await expect(definition(details, 'From')).toHaveText(owner);
  await expect(definition(details, 'To')).toHaveText(BASE_RECIPIENT);
  await expect(definition(details, 'Sends')).toHaveText('0.001 ETH');
  await expect(definition(details, 'Action')).toHaveText('Plain transfer, no contract call');
  await expect(definition(details, 'Nonce')).toHaveText('0');
  await expect(definition(details, 'Gas limit')).toHaveText(BigInt(tx.gas).toString());
  await expect(definition(details, 'Max fee per gas')).toHaveText(`${decimal(BigInt(tx.maxFeePerGas), 9)} gwei`);
  await expect(definition(details, 'Max priority fee')).toHaveText(`${decimal(BigInt(tx.maxPriorityFeePerGas), 9)} gwei`);
  await expect(definition(details, 'Maximum cost before the L1 data fee')).toHaveText(`${decimal(BigInt(tx.value) + BigInt(tx.gas) * BigInt(tx.maxFeePerGas), 18)} ETH`);
  const asked = wallet.filter(call => call.path === '/api/wallet/sign-context');
  expect(asked.map(call => JSON.parse(call.body) as unknown)).toEqual([{ flow: 'base-mainnet-transfer', runId, address: owner, op: 'evm_sign_transaction', tx }]);
  expect(await asked[0]!.status).toBe(200);
  expect(await (await firstSignable).jsonValue()).toEqual({ disabled: true, hint: expect.stringMatching(ARMING_HINT) });
  await popup.bringToFront();
  const sign = card.getByRole('button', { name: 'Sign', exact: true });
  await expect(sign).toBeEnabled();
  await shot(popup, '12-flofi-wallet-evm-signing-review');
  await sign.click();
  await expect(popup.getByRole('status').filter({ hasText: 'Signed. FloFi sends the transaction and records the result.' })).toBeVisible();

  // FloFi Wallet answers with the owner-signed EIP-1559 transaction of exactly these fields, sent by the managed address; it broadcasts nothing.
  const answer = await answered;
  expect(answer.ok).toBe(true);
  const raw = answer.result!.signedTransaction!, decoded = decodeSignedEip1559(raw)!;
  expect(decoded.tx).toEqual({ from: owner, to: BASE_RECIPIENT, value: 10n ** 15n, data: '0x', chainId: 8453n, nonce: 0n, gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) });
  expect(await baseChain({ action: 'sent' })).toBe(0);
  // Exactly one signing activity reached the provider, relayed with the same run binding.
  const relayed = wallet.filter(call => call.path.startsWith('/api/wallet/provider/submit/sign'));
  expect(relayed.map(call => [call.path, call.signing])).toEqual([['/api/wallet/provider/submit/sign_transaction', `base-mainnet-transfer:${runId}`]]);
  expect(await relayed[0]!.status).toBe(200);
  expect(await providerSigningActivity()).toEqual({ ...before, sign_transaction: before.sign_transaction + 1 });

  // FloFi broadcasts the owner-signed bytes once, exactly as floFiEvmBroadcast (src/app/flofi-wallet-action.ts) does after its account session
  // check: the same resolution on the signed bytes and their recovered sender (nonce and fees bounded at signing), the attempt's single
  // broadcast claim in the account store, and FloFi's managed EVM broadcast, here on the MOCKED loopback Base chain.
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try {
    const store = createAccountStore(db, 'default'), accountId = await store.walletHolder('evm', owner);
    expect(accountId).toMatch(/^acct_[0-9a-f]{32}$/);
    const resolved = await resolveManagedSigning(parseSigningContext(signing)!, { ecosystem: 'evm', tx: decoded.tx },
      { ...signingDeps(await store.wallets(accountId!)), load: async () => await service.load(runId), filledBoundedAtSigning: true });
    expect(resolved).toMatchObject({ ok: true, value: { owner, attempt: `base-mainnet-transfer:${runId}:TRANSFER:0`, evm: { chainId: 8453 } } });
    const match = (resolved as Extract<typeof resolved, { ok: true }>).value;
    expect(await claimAttempt(store, 'broadcast', match.attempt, match.expiresAtMs)).toBe(true);
    expect(await managedEvm().broadcast(`0x${match.evm!.chainId.toString(16)}`, raw.toLowerCase(), expectedBroadcast(decoded.tx, decoded.hash)))
      .toEqual({ kind: 'HASH', hash: decoded.hash });
    // One broadcast per reviewed attempt: the claim is spent.
    expect(await claimAttempt(store, 'broadcast', match.attempt, match.expiresAtMs)).toBe(false);
  } finally { await db.close(); }
  expect(await baseChain({ action: 'sent' })).toBe(1);

  // FloFi records the hash and reconciles the transfer independently from the chain: after two confirmations, value + fee + L1 fee exactly.
  let record = await service.report(runId, { kind: 'HASH', hash: decoded.hash });
  expect(record.attempt).toMatchObject({ state: 'PENDING', transactionHash: decoded.hash });
  record = await service.observe(runId);
  expect(record).toMatchObject({ verdict: 'PENDING', error: 'AWAITING_CONFIRMATIONS', evidence: null });
  await baseChain({ action: 'mine', blocks: 2 });
  record = await service.observe(runId);
  expect(record).toMatchObject({ verdict: 'RECONCILED', provenance: 'MOCKED', error: null, attempt: { state: 'CONFIRMED', reconciled: true, transactionHash: decoded.hash } });
  expect(record.observations.at(-1)).toMatchObject({ verdict: 'RECONCILED', reason: 'NATIVE_TRANSFER_VERIFIED', facts: { nonceBefore: '0', nonceAfter: '1' } });
  expect(record.evidence).toMatchObject({ bundle: { environment: 'MOCKED', outcome: 'RECONCILED' },
    publicExecution: { network: 'Base', chainId: 8453, transactionHash: decoded.hash, provenance: 'MOCKED', submissions: 1, verdict: 'RECONCILED' } });
  expect(await baseChain({ action: 'sent' })).toBe(1);
  expect(await providerSigningActivity()).toEqual({ ...before, sign_transaction: before.sign_transaction + 1 });
});

test('the database holds no secret-shaped value for any account', async () => {
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try {
    // `export` is a capability label (NONE / RECOVERY_PHRASE / PRIVATE_KEY), not secret material: every other value is scanned.
    const { rows } = await db.query(`SELECT (to_jsonb(t) - 'export')::text AS row FROM (SELECT * FROM flofi_account_wallets) t UNION ALL
      SELECT to_jsonb(t)::text FROM (SELECT * FROM flofi_account_identities) t UNION ALL SELECT to_jsonb(t)::text FROM (SELECT * FROM flofi_accounts) t
      UNION ALL SELECT to_jsonb(t)::text FROM (SELECT * FROM flofi_account_sessions) t`);
    expect(rows.length).toBeGreaterThan(5);
    for (const { row } of rows) expect(String(row)).not.toMatch(/not-a-real-key|mock-encrypted|mock-export|vt\.|eyJ|mnemonic|private.?key|seed/i);
  } finally { await db.close(); }
});
