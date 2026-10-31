// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { basename, dirname, join } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { E2E_APP_ORIGIN, E2E_APP_PORT, e2eNetworkScopeEnv } from './e2e/app-origin';
import { MCP_E2E_INVITE } from './e2e/mcp-constants';
import { SERVER_ONLY_WOOVI_APP_ID } from './e2e/card-provider-fixtures';
import { E2E_PORTS } from './e2e/fork/ports';
import { CHANNEL_E2E, channelE2eEnv } from './e2e/channel-constants';

const cache = process.env.BUILD002_BROWSER_CACHE;
if (!cache || basename(cache) !== 'chromium_headless_shell-1243') {
  throw new Error('BUILD002_BROWSER_CACHE must name the verified headless-shell revision 1243');
}
const executablePath = join(cache, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
if (!existsSync(executablePath)) throw new Error('Verified headless-shell executable is missing');
if (process.env.NEXT_TELEMETRY_DISABLED !== '1' || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1') {
  throw new Error('BUILD-002 telemetry and browser-download controls are required');
}
// BUILD-003C: E2E serves only committed recordings. Live Base reads are never made from tests.
const observation = process.env.GRYLOO_BASE_OBSERVATION;
if (observation !== undefined && observation !== 'replay') {
  throw new Error('E2E runs only with the recorded Base replay; live Base reads are forbidden in tests');
}

// BUILD-003F: local-fork Mode A always runs on loopback chain 31337. CI uses the MOCKED synthetic fork;
// `replay` serves the committed Base transcript and is an owner-only local acceptance mode.
const modeA = process.env.GRYLOO_MODE_A_E2E ?? 'synthetic';
if (modeA !== 'synthetic' && modeA !== 'replay') throw new Error('GRYLOO_MODE_A_E2E must be synthetic or replay');
if (modeA === 'replay' && process.env.FLOFI_E2E_FORK_PORT) throw Error('REPLAY_PORTS_ARE_PINNED');
const anvil = process.env.GRYLOO_ANVIL_BIN;
if (!anvil || basename(anvil) !== 'anvil' || basename(dirname(anvil)) !== 'foundry-v1.8.3') {
  throw new Error('GRYLOO_ANVIL_BIN must name the verified foundry-v1.8.3/anvil binary');
}
const runtime = process.env.GRYLOO_MODE_A_RUNTIME ?? join(tmpdir(), 'gryloo-build003f-mode-a-e2e');
if (!runtime.startsWith('/')) throw new Error('GRYLOO_MODE_A_RUNTIME must be absolute');
// Test workers inherit the runner environment, so fixtures and servers share one runtime directory.
process.env.GRYLOO_MODE_A_RUNTIME = runtime;
// BUILD-FLOFI-MAINNET-PRODUCT-001: a spec that runs a server handler in the test process (the WhatsApp fixture turns) runs it in the
// network scope of the app server it drives.
Object.assign(process.env, e2eNetworkScopeEnv());
process.env.GRYLOO_MODE_A_E2E = modeA;

const supplyHarness = process.env.GRYLOO_SUPPLY_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_SUPPLY_E2E && !supplyHarness) throw new Error('Supply E2E permits only the MOCKED loopback harness');
const supplyJournal = process.env.GRYLOO_SUPPLY_JOURNAL ?? join(tmpdir(), 'gryloo-build012a-' + Date.now() + '-' + process.pid);
if (supplyHarness) process.env.GRYLOO_SUPPLY_JOURNAL = supplyJournal;
const lendingHarness = process.env.GRYLOO_LENDING_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_LENDING_E2E && !lendingHarness) throw new Error('Lending E2E permits only the MOCKED loopback harness');
const lendingJournal = process.env.GRYLOO_LENDING_JOURNAL ?? join(tmpdir(), 'gryloo-build013-' + Date.now() + '-' + process.pid);
if (lendingHarness) process.env.GRYLOO_LENDING_JOURNAL = lendingJournal;
// BUILD-014: Jupiter/Solana browser tests use only the MOCKED loopback harness; never a public provider or broadcast.
const jupiterHarness = process.env.GRYLOO_JUPITER_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_JUPITER_E2E && !jupiterHarness) throw new Error('Jupiter E2E permits only the MOCKED loopback harness');
const jupiterJournal = process.env.GRYLOO_JUPITER_JOURNAL ?? join(tmpdir(), 'gryloo-build014-' + Date.now() + '-' + process.pid);
if (jupiterHarness) process.env.GRYLOO_JUPITER_JOURNAL = jupiterJournal;
// BUILD-DEMO-001: Solana Devnet browser tests use only the MOCKED loopback harness; never public Devnet or a broadcast.
const devnetHarness = process.env.GRYLOO_SOLANA_DEVNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_SOLANA_DEVNET_E2E && !devnetHarness) throw new Error('Solana Devnet E2E permits only the MOCKED loopback harness');
const devnetJournal = process.env.GRYLOO_SOLANA_DEVNET_JOURNAL ?? join(tmpdir(), 'gryloo-demo001-' + Date.now() + '-' + process.pid);
if (devnetHarness) process.env.GRYLOO_SOLANA_DEVNET_JOURNAL = devnetJournal;
// BUILD-SOLANA-MAINNET-001: the same loopback harness also serves a MOCKED copy of the mainnet-beta Orca SOL/USDC pool (`/mainnet-rpc`); its runs use
// their own journal. Nothing reaches a public network; MOCKED evidence only.
const orcaMainnetJournal = process.env.GRYLOO_ORCA_MAINNET_JOURNAL ?? join(tmpdir(), 'gryloo-orca-mainnet-' + Date.now() + '-' + process.pid);
if (devnetHarness) process.env.GRYLOO_ORCA_MAINNET_JOURNAL = orcaMainnetJournal;

// RH-DEMO-001: Robinhood Testnet self-transfer browser tests use only the MOCKED loopback chain; never the public network or a broadcast.
const robinhoodHarness = process.env.GRYLOO_ROBINHOOD_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROBINHOOD_E2E && !robinhoodHarness) throw new Error('Robinhood E2E permits only the MOCKED loopback harness');
const robinhoodJournal = process.env.GRYLOO_ROBINHOOD_JOURNAL ?? join(tmpdir(), 'gryloo-rh-demo-001-' + Date.now() + '-' + process.pid);
if (robinhoodHarness) process.env.GRYLOO_ROBINHOOD_JOURNAL = robinhoodJournal;
// BUILD-RH-002: Robinhood Chain mainnet authoring browser tests read only the committed official registry capture on loopback 8561 (MOCKED);
// never the public registry, a public chain or a broadcast.
const robinhoodMainnetHarness = process.env.GRYLOO_ROBINHOOD_MAINNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROBINHOOD_MAINNET_E2E && !robinhoodMainnetHarness) throw new Error('Robinhood Chain mainnet E2E permits only the MOCKED loopback harness');
const robinhoodMainnetJournal = join(tmpdir(), 'gryloo-rh-002-' + Date.now() + '-' + process.pid);
// BUILD-BASE-001: Base mainnet authoring browser tests read only FloFi's Base token-list fixture on loopback 8562 (MOCKED); never the public
// list, a public chain or a broadcast.
const baseMainnetHarness = process.env.GRYLOO_BASE_MAINNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_BASE_MAINNET_E2E && !baseMainnetHarness) throw new Error('Base mainnet E2E permits only the MOCKED loopback harness');
const baseMainnetJournal = join(tmpdir(), 'gryloo-base-001-' + Date.now() + '-' + process.pid);

// BUILD-UNISWAP-LIQUIDITY-PUBLIC: Base Sepolia Uniswap liquidity browser tests use only the MOCKED loopback chain; never the public network or a broadcast.
const uniswapHarness = process.env.GRYLOO_UNISWAP_LIQUIDITY_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_UNISWAP_LIQUIDITY_E2E && !uniswapHarness) throw new Error('Uniswap liquidity E2E permits only the MOCKED loopback harness');
const uniswapJournal = process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL ?? join(tmpdir(), 'gryloo-unilp-' + Date.now() + '-' + process.pid);
if (uniswapHarness) process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL = uniswapJournal;
// BUILD-ROUTER-001: Cross-chain Router browser tests use only the MOCKED loopback Base/Arbitrum chains and providers; never a public network or a broadcast.
const routerHarness = process.env.GRYLOO_ROUTER_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROUTER_E2E && !routerHarness) throw new Error('Router E2E permits only the MOCKED loopback harness');
const routerJournal = process.env.GRYLOO_ROUTER_JOURNAL ?? join(tmpdir(), 'gryloo-router-' + Date.now() + '-' + process.pid);
if (routerHarness) process.env.GRYLOO_ROUTER_JOURNAL = routerJournal;
// BUILD-JOURNEY-001: the permissionless testnet journey runs only on the MOCKED loopback Base Sepolia/Arbitrum Sepolia chains and providers.
// BUILD-CROSSCHAIN-UNIVERSAL-001: the universal Cross-chain Router on its MOCKED loopback chains (five networks) and Relay double.
const universalHarness = process.env.GRYLOO_UNIVERSAL_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_UNIVERSAL_E2E && !universalHarness) throw new Error('Universal router E2E permits only the MOCKED loopback harness');
const universalJournal = process.env.GRYLOO_UNIVERSAL_ROUTER_JOURNAL ?? join(tmpdir(), 'gryloo-universal-' + Date.now() + '-' + process.pid);
if (universalHarness) process.env.GRYLOO_UNIVERSAL_ROUTER_JOURNAL = universalJournal;

const routerTestnetHarness = process.env.GRYLOO_ROUTER_TESTNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROUTER_TESTNET_E2E && !routerTestnetHarness) throw new Error('Router testnet E2E permits only the MOCKED loopback harness');
const routerTestnetJournal = process.env.GRYLOO_ROUTER_TESTNET_JOURNAL ?? join(tmpdir(), 'gryloo-router-testnet-' + Date.now() + '-' + process.pid);
if (routerTestnetHarness) process.env.GRYLOO_ROUTER_TESTNET_JOURNAL = routerTestnetJournal;

// HOTFIX-WALLET-SELECTOR: Credentials → Add card runs only against the MOCKED loopback Mercado Pago harness and a routed SDK stand-in;
// never Mercado Pago, a real card or a charge.
const cardHarness = process.env.GRYLOO_CARD_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_CARD_E2E && !cardHarness) throw new Error('Card E2E permits only the MOCKED loopback harness');

// BUILD-CLOUD-PARITY-001: the app on the embedded PostgreSQL runtime (the path a Vercel deployment runs) with the MOCKED loopback
// Robinhood chain. A disposable LOOPBACK database is created for the run (e2e/cloud-runtime-setup.ts) and dropped afterwards; the
// server gets no journal directory.
const cloudRuntime = process.env.GRYLOO_CLOUD_RUNTIME_E2E === 'EMBEDDED_LOOPBACK_ONLY';
if (process.env.GRYLOO_CLOUD_RUNTIME_E2E && !cloudRuntime) throw new Error('Cloud runtime E2E permits only the embedded loopback runtime');
// BUILD-ADMIN-001: the private Admin console on the same kind of disposable LOOPBACK database (platform state only; flows stay local). Its
// session key is random per run; the spec grants administrators through the operator CLI's commands, never through the console.
const adminHarness = process.env.FLOFI_ADMIN_E2E === 'LOOPBACK_ONLY';
if (process.env.FLOFI_ADMIN_E2E && !adminHarness) throw new Error('Admin E2E permits only the loopback database');
// BUILD-CHAT-LEARNING-001: the Copilot's learning (private memory, global glossary) on the same kind of disposable LOOPBACK database, with a
// random per-run learning secret; the Copilot answers only from committed replay recordings.
const learningHarness = process.env.FLOFI_LEARNING_E2E === 'LOOPBACK_ONLY';
if (process.env.FLOFI_LEARNING_E2E && !learningHarness) throw new Error('Learning E2E permits only the loopback database');
if (learningHarness && process.env.FLOFI_COPILOT !== 'replay') throw new Error('Learning E2E needs FLOFI_COPILOT=replay');
if ((cloudRuntime || adminHarness || learningHarness) && !process.env.FLOFI_E2E_DATABASE_URL) {
  const server = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) throw new Error('Cloud runtime E2E needs a loopback TEST_DATABASE_URL');
  server.pathname = `/flofi_e2e_${Date.now()}_${process.pid}`;
  // Test workers inherit it, so the setup, the server and the spec share one database.
  process.env.FLOFI_E2E_DATABASE_URL = server.href;
}

// The real estimate API and public-swap service read only a synthetic HTTPS loopback provider in acceptance.
const swapReadHarness = process.env.FLOFI_SWAP_READ_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.FLOFI_SWAP_READ_E2E && !swapReadHarness) throw Error('Swap read E2E permits only the MOCKED loopback harness');
if (process.env.FLOFI_SWAP_EXECUTION_E2E && (!swapReadHarness || process.env.FLOFI_SWAP_EXECUTION_E2E !== 'MOCKED_LOOPBACK_ONLY')) throw Error('Swap execution E2E requires the MOCKED loopback read harness');
let swapReadEnv: Record<string, string> = {};
if (swapReadHarness) {
  if (!cloudRuntime) throw Error('Swap read E2E requires disposable PostgreSQL');
  const directory = mkdtempSync(join(tmpdir(), 'flofi-swap-read-')), certificate = join(directory, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(directory, 'key.pem'), '-out', certificate], { stdio: 'pipe' });
  if (generated.status !== 0) throw Error('READ_HARNESS_CERTIFICATE_FAILED');
  process.env.FLOFI_SWAP_READ_TLS = directory;
  swapReadEnv = { NODE_EXTRA_CA_CERTS: certificate, GRYLOO_PUBLIC_TESTNET: 'record',
    GRYLOO_BASE_SEPOLIA_RPC_URL: 'https://127.0.0.1:8558/base', GRYLOO_ETHEREUM_SEPOLIA_RPC_URL: 'https://127.0.0.1:8558/ethereum' };
}
// BUILD-MCP-002: consumer OAuth, the MCP App test host, /approve and the owner's existing flows on disposable PostgreSQL.
// Loopback chains, a random per-run OAuth secret and a test invite only; no public broadcast.
const mcpHarness = process.env.GRYLOO_MCP_E2E === 'EMBEDDED_LOOPBACK_ONLY';
if (process.env.GRYLOO_MCP_E2E && !mcpHarness) throw new Error('MCP E2E permits only the embedded loopback runtime');
if (mcpHarness && !process.env.FLOFI_E2E_DATABASE_URL) {
  const server = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) throw new Error('MCP E2E needs a loopback TEST_DATABASE_URL');
  server.pathname = `/flofi_e2e_${Date.now()}_${process.pid}`;
  process.env.FLOFI_E2E_DATABASE_URL = server.href;
}
// BUILD-DEVELOPER-001: the Developer API on the same embedded loopback harness (its database and MOCKED router chains), with loopback
// webhooks only. Per-run secrets generated here are inherited by the workers: the operator CLI digests keys with the developer secret
// and the scheduler call presents the dispatch token. Keys exist only in mode-0600 files under the run's temporary directory.
if (mcpHarness) {
  process.env.FLOFI_E2E_DEVELOPER_SECRET ??= randomBytes(32).toString('hex');
  process.env.FLOFI_E2E_DEVELOPER_DISPATCH_TOKEN ??= randomBytes(24).toString('base64url');
}
const mcpServerEnv = mcpHarness ? { FLOFI_RUNTIME: 'embedded', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_MCP: 'enabled', FLOFI_MCP_OAUTH: 'enabled',
  FLOFI_PUBLIC_ORIGIN: E2E_APP_ORIGIN, FLOFI_MCP_OAUTH_SECRET: randomBytes(32).toString('hex'), FLOFI_MCP_OAUTH_DCR: 'enabled',
  FLOFI_MCP_OAUTH_ACCESS: process.env.FLOFI_MCP_OAUTH_ACCESS ?? 'invite',
  FLOFI_MCP_OAUTH_INVITES: createHash('sha256').update(MCP_E2E_INVITE).digest('hex'), FLOFI_MCP_INFRAME_WALLET_HOSTS: 'flofi-e2e-host',
  FLOFI_DEVELOPER: 'enabled', FLOFI_DEVELOPER_SECRET: process.env.FLOFI_E2E_DEVELOPER_SECRET!, FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY',
  FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256: createHash('sha256').update(process.env.FLOFI_E2E_DEVELOPER_DISPATCH_TOKEN!).digest('hex'),
  GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY' } : {};

// BUILD-CHANNELS-001: the channels' /approve paths, on the MCP embedded loopback harness (its database, chains and lending harness):
// WhatsApp with the FIXTURE provider (nothing is ever sent to Meta), Telegram against the loopback Bot API double on 8559 (nothing
// reaches Telegram), and the scheduled dispatch behind a per-run bearer. Per-run secrets are generated here and inherited by the
// workers, which sign or authenticate webhook deliveries with them. So are the synthetic chat users: a run never continues a
// conversation an earlier run left in a reused database.
const channelHarness = process.env.GRYLOO_CHANNEL_E2E === CHANNEL_E2E;
if (process.env.GRYLOO_CHANNEL_E2E && !channelHarness) throw new Error('Channel E2E permits only the fixture provider on loopback');
if (channelHarness && !mcpHarness) throw new Error('Channel E2E runs on the MCP embedded loopback harness (GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY)');
if (channelHarness) {
  process.env.FLOFI_E2E_WHATSAPP_APP_SECRET ??= randomBytes(16).toString('hex');
  process.env.FLOFI_E2E_WHATSAPP_VERIFY_TOKEN ??= randomBytes(24).toString('base64url');
  process.env.FLOFI_E2E_CHANNEL_SECRET ??= randomBytes(32).toString('hex');
  process.env.FLOFI_E2E_TELEGRAM_TOKEN ??= `7000000001:${randomBytes(30).toString('base64url').slice(0, 35)}`;
  process.env.FLOFI_E2E_TELEGRAM_WEBHOOK_SECRET ??= randomBytes(32).toString('base64url');
  process.env.FLOFI_E2E_CHANNEL_DISPATCH_TOKEN ??= randomBytes(24).toString('base64url');
  process.env.FLOFI_E2E_WHATSAPP_USER ??= `BR.FLOFIE2E${randomBytes(8).toString('hex').toUpperCase()}`;
  process.env.FLOFI_E2E_TELEGRAM_USER ??= String(900_000_000 + randomBytes(4).readUInt32BE() % 99_999_000);
}
const channelServerEnv = channelHarness ? channelE2eEnv() : {};

// BUILD-AUTOMATION-001: Automations on the embedded PostgreSQL runtime with the FIXTURE price source (a per-run JSON file under /tmp the
// specs rewrite; never a live price provider), the deterministic test clock (refused on any hosted deployment) and the bearer-only
// scheduler endpoint. Per-run secrets are generated here and inherited by the workers. No price provider, chat or chain is contacted.
const automationHarness = process.env.GRYLOO_AUTOMATION_E2E === 'FIXTURE_LOOPBACK_ONLY';
if (process.env.GRYLOO_AUTOMATION_E2E && !automationHarness) throw new Error('Automation E2E permits only the fixture price source on loopback');
if (automationHarness && !cloudRuntime && !mcpHarness) throw new Error('Automation E2E runs on an embedded loopback runtime');
if (automationHarness) {
  process.env.FLOFI_E2E_AUTOMATION_SECRET ??= randomBytes(32).toString('hex');
  process.env.FLOFI_E2E_AUTOMATION_DISPATCH_TOKEN ??= randomBytes(24).toString('base64url');
  process.env.FLOFI_E2E_AUTOMATION_PRICES ??= join(mkdtempSync('/tmp/flofi-automation-e2e-'), 'prices.json');
}
const automationServerEnv = automationHarness ? { FLOFI_AUTOMATIONS: 'enabled', FLOFI_AUTOMATION_SECRET: process.env.FLOFI_E2E_AUTOMATION_SECRET!,
  FLOFI_PUBLIC_ORIGIN: E2E_APP_ORIGIN, FLOFI_AUTOMATION_TEST_CLOCK: 'enabled', FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture',
  FLOFI_AUTOMATION_PRICE_FIXTURE: process.env.FLOFI_E2E_AUTOMATION_PRICES!,
  FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256: createHash('sha256').update(process.env.FLOFI_E2E_AUTOMATION_DISPATCH_TOKEN!).digest('hex') } : {};

// BUILD-AUTOMATION-002: delegated execution on the automation harness, against the MOCKED loopback chain doubles (127.0.0.1:8560), a WebAuthn
// virtual authenticator and disposable session signers in a per-run directory under /tmp (mode-0600 keys, never committed). WebAuthn refuses
// IP-address RP ids, so passkeys are bound to http://localhost:<app port>, the same server. No public chain or provider is contacted.
const delegationHarness = process.env.GRYLOO_DELEGATION_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_DELEGATION_E2E && !delegationHarness) throw new Error('Delegation E2E permits only the MOCKED loopback chains');
if (delegationHarness && !automationHarness) throw new Error('Delegation E2E runs on the automation harness');
if (delegationHarness) {
  process.env.FLOFI_E2E_DELEGATION_DISPATCH_TOKEN ??= randomBytes(24).toString('base64url');
  process.env.FLOFI_E2E_DELEGATED_SIGNER_DIR ??= mkdtempSync('/tmp/flofi-delegation-e2e-');
}
const delegationServerEnv = delegationHarness ? { FLOFI_DELEGATION: 'enabled', FLOFI_DELEGATION_HARNESS: 'MOCKED_LOOPBACK_ONLY',
  FLOFI_DELEGATION_HARNESS_URL: 'http://127.0.0.1:8560', FLOFI_PASSKEY_ORIGIN: `http://localhost:${E2E_APP_PORT}`, FLOFI_DELEGATED_SIGNER: 'local-disposable',
  FLOFI_DELEGATED_SIGNER_DIR: process.env.FLOFI_E2E_DELEGATED_SIGNER_DIR!, FLOFI_DELEGATED_EXECUTION: 'enabled',
  FLOFI_DELEGATION_DISPATCH_TOKEN_SHA256: createHash('sha256').update(process.env.FLOFI_E2E_DELEGATION_DISPATCH_TOKEN!).digest('hex') } : {};

// BUILD-COPILOT-001: the Copilot runs in browser tests only on committed replay answers; a live model is never called from tests.
const copilot = process.env.FLOFI_COPILOT;
if (copilot !== undefined && copilot !== 'off' && copilot !== 'replay') throw new Error('Copilot E2E permits only FLOFI_COPILOT=replay');

// BUILD-FLOFI-MAINNET-PRODUCT-001: retired specs, kept in Git for history and never run. None is in a CI profile. Each drives the
// Testnet/Mainnet header selector that the Mainnet-only product removed:
//  - wallet-environment: its subject was that selector; the Mainnet-only successor is covered by the solana-mainnet-network profile
//    and the wallet/product-shell unit tests.
//  - the other six: every one of their tests already failed on `main` cbf340e before this build (2026-10-24 baseline run), for
//    reasons unrelated to it (typography, picker contents, layout and focus).
// Rewriting them is a separate decision (BUILD-FLOFI-MAINNET-PRODUCT-001 report, §8).
// BUILD-FLOFI-LANDING07-README-001: retired with the landing they describe. `/` now renders Caio's Landing 07, so the previous
// landing's sections are no longer routed: its community links, MCP card, conversation demo and mascot journey (ux-ui-002-landing),
// section layout and Earth closing (landing-structure, earth-footer), mascot motion (brand-motion-001), connected-infrastructure
// diagram (brand-visual-refinement) and three-phase story (workflow-story). Landing 07 is covered by landing07.spec.ts; the old
// landing's entry, Docs and sign-in assertions moved there and into brand-ux-001, beta-ui, native-docs and auth-wallets.
const RETIRED_LANDING_SPECS = ['ux-ui-002-landing', 'landing-structure', 'earth-footer', 'brand-motion-001', 'brand-visual-refinement', 'workflow-story'];
const RETIRED_SPECS = ['wallet-environment', 'brand-icon-colors', 'bridge-network-picker', 'crypto-action-picker', 'global-product-polish',
  'header-controls', 'product-typography-logo', ...RETIRED_LANDING_SPECS].map(name => `**/${name}.spec.ts`);

export default defineConfig({
  testDir: './e2e',
  testIgnore: RETIRED_SPECS,
  ...(cloudRuntime || mcpHarness || adminHarness || learningHarness ? { globalSetup: './e2e/cloud-runtime-setup.ts' } : {}),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 } },
  reporter: 'list',
  use: {
    baseURL: E2E_APP_ORIGIN,
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    serviceWorkers: 'block',
    // A failing test leaves a screenshot (no cost on a pass). Traces stay off: recording them on every run costs ~26% browser time; the
    // guarded runner re-runs a failed test once with a trace instead (scripts/guarded-release-browser.mjs).
    video: 'off', trace: 'off', screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: [...(swapReadHarness ? [{ command: 'node e2e/public-swap-read-serve.ts', url: 'https://127.0.0.1:8558', ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(supplyHarness ? [{ command: 'node e2e/supply-harness.mjs --serve', url: 'http://127.0.0.1:8549', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(lendingHarness || mcpHarness ? [{ command: 'node e2e/lending-harness.mjs --serve', url: 'http://127.0.0.1:8554', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(jupiterHarness ? [{ command: 'node e2e/jupiter-harness.mjs --serve', url: 'http://127.0.0.1:8551', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(devnetHarness || mcpHarness ? [{ command: 'node e2e/solana-devnet-harness.mjs --serve', url: 'http://127.0.0.1:8552', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(robinhoodHarness || cloudRuntime ? [{ command: 'node e2e/robinhood-transfer-harness.mjs --serve', url: 'http://127.0.0.1:8553', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(uniswapHarness ? [{ command: 'node e2e/uniswap-liquidity-serve.ts', url: 'http://127.0.0.1:8556', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(routerHarness || routerTestnetHarness || mcpHarness ? [{ command: 'node e2e/router-serve.ts', url: 'http://127.0.0.1:8557', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(universalHarness ? [{ command: 'node e2e/universal-serve.ts', url: 'http://127.0.0.1:8566', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(cardHarness ? [{ command: 'node e2e/card-provider-harness.mjs --serve', url: 'http://127.0.0.1:8555/__harness/health', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(channelHarness ? [{ command: 'node e2e/telegram-bot-serve.ts', url: 'http://127.0.0.1:8559/__flofi/calls', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(delegationHarness ? [{ command: 'node e2e/delegation-chain-serve.ts', url: 'http://127.0.0.1:8560', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(robinhoodMainnetHarness ? [{ command: 'node e2e/robinhood-mainnet-serve.ts', url: 'http://127.0.0.1:8561', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(baseMainnetHarness ? [{ command: 'node e2e/base-mainnet-serve.ts', url: 'http://127.0.0.1:8562', reuseExistingServer: false, timeout: 30_000 }] : []), {
    command: modeA === 'synthetic' ? 'node e2e/fork/offline-rehearsal.mjs --serve-synthetic' : 'node e2e/fork/owner-recording.mjs serve-replay',
    url: `http://127.0.0.1:${E2E_PORTS.health}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { GRYLOO_MODE_A_RUNTIME: runtime, GRYLOO_ANVIL_BIN: anvil,
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_TRANSCRIPT ? { GRYLOO_MODE_A_TRANSCRIPT: process.env.GRYLOO_MODE_A_TRANSCRIPT } : {}),
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_SYNTHETIC_PINS ? { GRYLOO_MODE_A_SYNTHETIC_PINS: process.env.GRYLOO_MODE_A_SYNTHETIC_PINS } : {}) },
  }, {
    command: 'pnpm --filter @defi-workflow-engine/reference-dapp start',
    url: E2E_APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 60_000,
    // `next start` listens on PORT; FLOFI_E2E_APP_PORT isolates CI from another server on 3000 (release default 3108).
    env: { FLOFI_ENGINEERING_UI: 'LOOPBACK_ONLY', ...e2eNetworkScopeEnv(), PORT: String(E2E_APP_PORT), NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', GRYLOO_BASE_OBSERVATION: 'replay',
      ...(supplyHarness ? { GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_JOURNAL: supplyJournal } : {}),
      ...(lendingHarness ? { GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_JOURNAL: lendingJournal } : {}),
      ...(jupiterHarness ? { GRYLOO_JUPITER_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_JUPITER_JOURNAL: jupiterJournal } : {}),
      ...(devnetHarness ? { GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SOLANA_DEVNET_JOURNAL: devnetJournal,
        GRYLOO_ORCA_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ORCA_MAINNET_JOURNAL: orcaMainnetJournal } : {}),
      ...(robinhoodHarness ? { GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROBINHOOD_JOURNAL: robinhoodJournal } : {}),
      ...(robinhoodMainnetHarness ? { GRYLOO_ROBINHOOD_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROBINHOOD_JOURNAL: robinhoodMainnetJournal } : {}),
      ...(baseMainnetHarness ? { GRYLOO_BASE_MAINNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_BASE_JOURNAL: baseMainnetJournal } : {}),
      ...(uniswapHarness ? { GRYLOO_UNISWAP_LIQUIDITY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_UNISWAP_LIQUIDITY_JOURNAL: uniswapJournal } : {}),
      ...(routerHarness ? { GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_JOURNAL: routerJournal } : {}),
      ...(routerTestnetHarness ? { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_TESTNET_JOURNAL: routerTestnetJournal } : {}),
      ...(universalHarness ? { GRYLOO_UNIVERSAL_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_UNIVERSAL_ROUTER_JOURNAL: universalJournal } : {}),
      ...(copilot === 'replay' ? { FLOFI_COPILOT: 'replay' } : {}),
      // The payment provider's server-only App ID is present (payments stay off) so the card spec can prove it is never served.
      ...(cardHarness ? { GRYLOO_CARD_HARNESS: 'MOCKED_LOOPBACK_ONLY', WOOVI_APP_ID: SERVER_ONLY_WOOVI_APP_ID, WOOVI_ENVIRONMENT: 'sandbox' } : {}),
      ...(cloudRuntime ? { FLOFI_RUNTIME: 'embedded', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY' } : {}),
      ...(adminHarness ? { DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_ADMIN: 'enabled', FLOFI_ADMIN_SESSION_SECRET: randomBytes(32).toString('hex') } : {}),
      // BUILD-CHAT-LEARNING-002: persistent automatic learning under the consent basis (the spec opts in through Privacy & memory).
      ...(learningHarness ? { DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_LEARNING: 'enabled', FLOFI_LEARNING_SECRET: randomBytes(32).toString('hex'),
        FLOFI_LEARNING_AUTOMATIC: 'consent' } : {}),
      ...mcpServerEnv, ...swapReadEnv,
      ...channelServerEnv, ...automationServerEnv, ...delegationServerEnv,
      GRYLOO_MODE_A: 'fork', GRYLOO_MODE_A_PROFILE: join(runtime, 'profile.json'), GRYLOO_MODE_A_JOURNAL: join(runtime, 'journal') },
  }],
});
