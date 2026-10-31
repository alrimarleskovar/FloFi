// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// The same explicit profiles run locally and in CI. Financial diagnostic specs
// remain available independently; none of their results are counted as passes.
const usage = 'Usage: node scripts/guarded-release-browser.mjs critical | extended [--shard <n>/<total>] | product | composition | profile <name> | list [--collect-failures]';
const [phase, ...args] = process.argv.slice(2);
// Cloud Build collects independent failures on its single worker. Other callers
// retain fail-fast behavior; neither mode can turn a failed profile into a pass.
const collectFailures = args.includes('--collect-failures');
if (args.filter(arg => arg === '--collect-failures').length > 1) throw new Error(usage);
const rest = args.filter(arg => arg !== '--collect-failures');
if (phase === 'list' && collectFailures) throw new Error(usage);
const boundary = 'release-financial-provenance.spec.ts';
const definitions = [
  ['default-product', ['brand-ux-001.spec.ts', 'base-observation.spec.ts', 'build-roundtrip.spec.ts', 'build009.spec.ts', 'across.spec.ts',
    'canvas-keyboard.spec.ts', 'canvas-ux.spec.ts', 'contextual-proposals.spec.ts', 'cross-chain-liquidity-recovery.spec.ts',
    'cross-chain-liquidity.spec.ts', 'execution-capabilities.spec.ts', 'interface-honesty.spec.ts', 'mock-artifact-chain.spec.ts',
    'network-isolation.spec.ts', 'public-testnet.spec.ts', 'robinhood-network.spec.ts', 'swap-authoring.spec.ts', 'visual-shell.spec.ts', 'credentials.spec.ts',
    'build-fix-ux.spec.ts', 'beta-ui.spec.ts', 'landing07.spec.ts', 'build-entry.spec.ts'], {}],
  ['review-execute-recovery-components', ['simulate-review-acceptance.spec.ts', 'execute-product-workspace.spec.ts', 'execute-workflow.spec.ts'], {}],
  // Direct chat signing and optional Canvas, with no application server, RPC, wallet or database; requests are intercepted by the spec.
  ['solana-transfer-ux', ['--config', 'playwright.transfer-ux.config.ts'], {}],
  ['workflow-acceptance', ['acceptance-workflows.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', GRYLOO_ROUTER_TESTNET_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['swap-read-acceptance', ['acceptance-swap-read.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-EXECUTION-CONTINUITY-001: production UI/API/durable lifecycle, isolated synthetic RPC and scripted owner wallet confirmations.
  // BUILD-FLOFI-CONVERSATIONAL-001: the same harness drives the whole workflow from the FloFi chat (review, two confirmations, wallet, reconciliation).
  // BUILD-FLOFI-CHAT-E2E-FIX-002: a multi-action workflow run from the chat as a sequence of one-action steps (funded Swap → Swap reconciled step by
  // step, an unapplied Canvas amount, the wallet network switch, a missing quote and a balance too low), on the same loopback harness.
  ['execution-continuity', ['execution-continuity.spec.ts', 'workflow-ux-execution.spec.ts', 'conversational-workflow.spec.ts', 'chat-sequence.spec.ts', 'chat-assistant.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_SWAP_EXECUTION_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-AUTOMATION-001: Automations (fixture price source, test clock) into the owner's /approve → Simulate → Review; never a transaction.
  ['automations', ['e2e/automations.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', GRYLOO_AUTOMATION_E2E: 'FIXTURE_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['canvas-automation-ux', ['canvas-automation-ux.spec.ts', 'canvas-cta.spec.ts'], { GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['chat-automations', ['copilot-automations.spec.ts'], { FLOFI_COPILOT: 'replay', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', GRYLOO_AUTOMATION_E2E: 'FIXTURE_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-AUTOMATION-002: "Automatic within limits" — MOCKED loopback chain doubles, virtual passkey, disposable signers under /tmp; MOCKED evidence only.
  ['delegated-execution', ['e2e/delegated-execution.spec.ts'], { FLOFI_COPILOT: 'replay', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', GRYLOO_AUTOMATION_E2E: 'FIXTURE_LOOPBACK_ONLY', GRYLOO_DELEGATION_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['supply-provenance', ['release-provenance.spec.ts'], { GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['unsafe-lending-simulations', ['borrow.spec.ts', 'repay.spec.ts', '--grep', 'read-only simulation blocks unsafe Borrow before Review|insufficient debt blocks read-only simulation'], { GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['copilot', ['copilot.spec.ts', 'copilot-conversation.spec.ts'], { FLOFI_COPILOT: 'replay', GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  // BUILD-CHAT-LEARNING-001/002: invisible learning (in-conversation adaptation, consent in Privacy & memory, learned across sessions, no inheritance)
  // and the published glossary on a disposable loopback database (replay answers, injected sign-in wallet).
  ['copilot-learning', ['copilot-learning-memory.spec.ts'], { FLOFI_COPILOT: 'replay', FLOFI_LEARNING_E2E: 'LOOPBACK_ONLY',
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // PR B: context-aware Solana Devnet authoring (swap → position, "these tokens", yes/no, chat position management) on replay answers and the MOCKED Devnet loopback.
  ['copilot-solana', ['copilot-solana.spec.ts'], { FLOFI_COPILOT: 'replay', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  // BUILD-SOLANA-MAINNET-001: the Solana Mainnet/Testnet header switch, family-preserving re-networking and Orca mainnet liquidity authoring on the
  // MOCKED loopback (the Devnet harness also serves a MOCKED copy of the mainnet-beta pool); MOCKED cannot authorize, nothing is signed or sent.
  // BUILD-FLOFI-MAINNET-PRODUCT-001: the public Mainnet-only product exactly as deployed (no engineering opt-in); every other profile certifies the engines.
  ['solana-mainnet-network', ['solana-mainnet-network.spec.ts'], { GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_E2E_NETWORK_SCOPE: 'PUBLIC_MAINNET' }],
  // BUILD-SOLANA-MAINNET-001 PR B: empty Canvas on Launch App, unrestricted card deletion, and the Swap arrow's From/To inversion (MOCKED estimates).
  ['canvas-corrections', ['canvas-corrections.spec.ts'], {}],
  // P0: a wallet that changes the reviewed Solana Devnet swap is refused before broadcast, Execute says why, and Simulate again runs the swap
  // once and the position; a wallet behaving like the captured Phantom (adds a compute-unit price when none is set) signs the reviewed bytes
  // and completes both steps. MOCKED Devnet loopback; only these cases of the diagnostic spec.
  ['solana-wallet-refusal', ['solana-swap-liquidity-composition.spec.ts', '--grep', 'a wallet that changes the reviewed swap|a Phantom-like wallet signs the exact reviewed swap|a Phantom wallet with Lighthouse protections|a reconciled swap continues to its Orca position'], { GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['lending-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'lending', GRYLOO_LENDING_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['jupiter-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'jupiter', GRYLOO_JUPITER_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['devnet-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'solana-devnet', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['orca-liquidity-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'solana-liquidity', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['solana-composition-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'solana-composition', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['transfer-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'transfer', GRYLOO_ROBINHOOD_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  // BUILD-RH-002: Robinhood Chain authoring against the committed official registry capture on loopback (MOCKED; nothing is quoted or sent).
  ['robinhood-mainnet-authoring', ['robinhood-stocks.spec.ts'], { GRYLOO_ROBINHOOD_MAINNET_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_COPILOT: 'replay' }],
  // BUILD-BASE-001: Base as a catalog network in the existing cards (shortcuts, search, a non-featured token, provider logos through a closed
  // replay) and in the natural-language Copilot (committed replay answers), MOCKED list only.
  // BUILD-ARB-001 Phase 6: one authoring-only product profile, replay model and passive wallet; every financial gate stays off.
  ['ethereum-authoring-certification', ['--config', 'playwright.ethereum-authoring.config.ts'], {}],
  ['arbitrum-authoring-certification', ['--config', 'playwright.arbitrum-authoring.config.ts'], {}],
  // BUILD-ARB-001 Phase 7: owner-approved workflow UX (authoring only; replay Copilot, passive wallet, MOCKED registry harness).
  ['workflow-ux-authoring', ['--config', 'playwright.workflow-ux.config.ts'], {}],
  // Phase 7B: toolbar geometry, insertion viewport and canonical connections use the same passive-wallet profile.
  ['canvas-workflow-ux', ['--config', 'playwright.canvas-workflow-ux.config.ts', 'canvas-workflow-ux.spec.ts'], {}],
  ['base-mainnet-authoring', ['base-mainnet-authoring.spec.ts'], { GRYLOO_BASE_MAINNET_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_COPILOT: 'replay' }],
  ['uniswap-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'uniswap', GRYLOO_UNISWAP_LIQUIDITY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['router-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'router', GRYLOO_ROUTER_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['journey-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'journey', GRYLOO_ROUTER_TESTNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  // BUILD-ADMIN-001: the private Admin console (sign-in refusal and grant, dashboards, AI settings) on a disposable loopback database.
  ['admin-console', ['admin-console.spec.ts'], { FLOFI_ADMIN_E2E: 'LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['cloud-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'cloud', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['synthetic-fork-provenance', ['release-fork-provenance.spec.ts'], { GRYLOO_MODE_A_E2E: 'synthetic' }],
  ['cow-loopback', ['cow-intent.spec.ts', 'cow-recovery.spec.ts'], { GRYLOO_COW: 'loopback' }],
  ['card-provider-loopback', ['card-provider.spec.ts'], { GRYLOO_CARD_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  // MCP route presentation runs twice on purpose: here with OAuth disabled (no MCP harness), below with OAuth enabled on the embedded harness.
  ['mcp-routes-oauth-disabled', ['mcp-route-presentation.spec.ts'], {}],
  // BUILD-DEVELOPER-001: a third-party server integrates with the SDK alone (operator CLI key, strategy, approval, signed loopback
  // webhooks) and the end user reaches FloFi's Review, where MOCKED financial authority stays blocked (no wallet transaction), on the
  // same embedded loopback harness (no public network, no real transaction). The full lifecycle is proven by journey.pg.test.ts.
  ['developer-journey', ['developer-journey.spec.ts'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-MCP-002: consumer OAuth and in-chat approval on disposable loopback infrastructure.
  ['mcp-in-chat', ['mcp-in-chat.spec.ts', 'mcp-route-presentation.spec.ts', '--grep-invert', 'embedded wallet proof'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_MCP_OAUTH_ACCESS: 'open', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // Each invocation gets a fresh disposable database; keep the production OAuth registration rate limit intact.
  // Fresh database preserves the production OAuth registration limit while certifying the new in-chat wallet journeys.
  ['mcp-embedded-signing', ['mcp-in-chat.spec.ts', '--grep', 'embedded wallet proof'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_MCP_OAUTH_ACCESS: 'open', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['channel-signing', ['channel-signing.spec.ts'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-CHANNELS-001: the channels' /approve paths on the same embedded loopback harness — WhatsApp with the FIXTURE provider (nothing
  // is sent to Meta) and Telegram against the loopback Bot API double (nothing reaches Telegram): the real webhook routes, the
  // intended-wallet rule, the owner's Review where MOCKED authority stays blocked, the status ping and the scheduled dispatch.
  ['channel-approve', ['whatsapp-approve.spec.ts', 'telegram-approve.spec.ts'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', GRYLOO_CHANNEL_E2E: 'FIXTURE_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-SOLANA-TRANSFER-UX-001: both /approve journeys (chat-first signing surface and optional Canvas) from an MCP request through one
  // Authorize in wallet, the wallet's confirmation, submission and reconciliation to the receipt in the chat: the MCP harness with the
  // synthetic loopback swap RPC and scripted owner confirmations on disposable PostgreSQL (no public network or broadcast).
  ['approve-authorize-journeys', ['approve-authorize-journeys.spec.ts'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY',
    FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_SWAP_EXECUTION_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-CHAT-E2E-001: a two-step workflow from an MCP request, one approval, each step signed on /approve after the previous one reconciled,
  // on the same MCP harness and synthetic loopback swap RPC with workflow runs enabled (confirm each step; no delegated signer exists here).
  ['approve-workflow-run', ['approve-workflow-run.spec.ts'], { GRYLOO_MCP_E2E: 'EMBEDDED_LOOPBACK_ONLY', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY',
    FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_SWAP_EXECUTION_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_WORKFLOW_RUNS: 'enabled',
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-CROSSCHAIN-UNIVERSAL-001: the universal Cross-chain Router (Solana ⇄ EVM mainnets, Canvas card, chat, Review, one owner signature, verified
  // delivery and evidence) on its MOCKED loopback chains and Relay double; the wallets are the test's own disposable in-memory keys.
  ['universal-bridge', ['universal-bridge.spec.ts'], { GRYLOO_UNIVERSAL_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_COPILOT: 'replay' }],
  ['owner-history', ['--config', 'playwright.owner-history.config.ts'], { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-FLOFI-AUTH-WALLETS-001: FloFi accounts and FloFi Wallet on its own origin (sign-in, encrypted email codes, unlock, create, import,
  // export) against the MOCKED loopback identity and wallet provider (e2e/account-harness.ts) on a disposable PostgreSQL database.
  ['auth-wallets', ['--config', 'playwright.auth-wallets.config.ts'], { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
];
const composition = [['composition-provenance', ['release-composition-provenance.spec.ts'], {}]];

// Critical tier, run before every other browser profile in all CI systems (GitHub Actions: right after the build, before the unit,
// PostgreSQL and fork suites; CircleCI: at the head of browser job 1): Copilot learning and wallet isolation, Canvas basics, the P0
// wallet refusal and the financial Review/Execute boundaries.
const critical = ['copilot-learning', 'canvas-corrections', 'solana-wallet-refusal', 'supply-provenance', 'review-execute-recovery-components', 'solana-transfer-ux'];
// The other product profiles, as CircleCI's parallel browser jobs (each its own container, loopback ports and PostgreSQL; ~13 min each
// with critical in job 1, from CircleCI jobs 53/55 profile seconds). Each list runs in order: fast financial boundaries before long suites.
const shards = [
  ['default-product', 'lending-provenance', 'jupiter-provenance', 'devnet-provenance', 'orca-liquidity-provenance', 'solana-composition-provenance',
    'transfer-provenance', 'uniswap-provenance', 'router-provenance', 'unsafe-lending-simulations', 'copilot', 'copilot-solana', 'solana-mainnet-network',
    'robinhood-mainnet-authoring', 'base-mainnet-authoring', 'arbitrum-authoring-certification', 'ethereum-authoring-certification', 'workflow-ux-authoring', 'canvas-workflow-ux'],
  ['cloud-provenance', 'journey-provenance', 'synthetic-fork-provenance', 'execution-continuity', 'workflow-acceptance', 'swap-read-acceptance',
    'automations', 'chat-automations', 'delegated-execution', 'canvas-automation-ux', 'admin-console', 'cow-loopback', 'card-provider-loopback',
    'mcp-routes-oauth-disabled', 'developer-journey', 'mcp-in-chat', 'mcp-embedded-signing', 'channel-signing', 'channel-approve', 'approve-authorize-journeys',
    'approve-workflow-run', 'universal-bridge', 'owner-history', 'auth-wallets'],
];
// Fail closed on any plan drift: every product profile runs in exactly one place, and every name in the plan exists.
const names = definitions.map(([name]) => name), planned = [...critical, ...shards.flat()];
if (new Set(names).size !== names.length || planned.length !== names.length || new Set(planned).size !== planned.length
  || !planned.every(name => names.includes(name))) throw new Error('Guarded browser plan must place every product profile exactly once');

const byName = new Map([...definitions, ...composition].map(entry => [entry[0], entry]));
const extended = shards.flat();
let selection, shard = null;
if (phase === 'critical' && !rest.length) selection = critical;
else if (phase === 'extended' && !rest.length) selection = extended;
else if (phase === 'extended' && rest.length === 2 && rest[0] === '--shard' && /^\d+\/\d+$/.test(rest[1])) {
  const [index, total] = rest[1].split('/').map(Number);
  if (total !== shards.length || index < 1 || index > total) throw new Error(`Guarded browser shard must be 1/${shards.length} … ${shards.length}/${shards.length}`);
  selection = shards[index - 1];
  shard = rest[1];
} else if (phase === 'product' && !rest.length) selection = [...critical, ...extended];
else if (phase === 'composition' && !rest.length) selection = composition.map(([name]) => name);
else if (phase === 'profile' && rest.length === 1 && byName.has(rest[0])) selection = rest;
else if (phase === 'list' && !rest.length) {
  // The plan only (no command runs); the database URL is shown as a placeholder.
  const profiles = Object.fromEntries([...byName.values()].map(([name, specs, settings]) => [name, { specs, settings: Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, key === 'TEST_DATABASE_URL' ? '<TEST_DATABASE_URL>' : value])) }]));
  console.log(JSON.stringify({ critical, shards, extended, product: [...critical, ...extended], composition: composition.map(([name]) => name), profiles }, null, 2));
  process.exit(0);
} else throw new Error(usage);
const label = shard ? `${phase}-shard-${shard.replace('/', '-of-')}` : phase === 'profile' ? `profile-${rest[0]}` : phase;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = join(root, 'apps/reference-dapp/test-results');
const report = { kind: 'guarded-browser', phase, shard, label, status: 'RUNNING',
  profiles: selection.map(name => ({ name, specs: byName.get(name)[1], status: 'NOT_RUN', seconds: null, exitCode: null })) };
const reportFiles = [join(results, `guarded-${label}.json`), ...(process.env.RUNNER_TEMP ? [join(process.env.RUNNER_TEMP, 'flofi-ci-metrics', 'browser', `${label}.json`)] : [])];
function writeReport() {
  for (const file of reportFiles) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
}
function printTimings() {
  const ran = report.profiles.filter(row => row.seconds !== null);
  console.log(`Guarded release ${label} timings (slowest first; total ${ran.reduce((sum, row) => sum + row.seconds, 0).toFixed(2)}s):`);
  for (const row of [...ran].sort((a, b) => b.seconds - a.seconds)) console.log(`  ${row.seconds.toFixed(2).padStart(8)}s  ${row.status}  ${row.name}`);
}
const rel = path => relative(root, path);
let failureExitCode = 0;
writeReport();
console.log(`Guarded release ${label}: ${selection.length} profiles: ${selection.join(', ')}`);

for (const [index, name] of selection.entries()) {
  const [, specs, settings] = byName.get(name), row = report.profiles[index];
  const env = { ...process.env, GRYLOO_MODE_A_E2E: 'synthetic' };
  for (const key of ['FLOFI_COPILOT', 'FLOFI_RELEASE_PROVENANCE_PROFILE', 'GRYLOO_SUPPLY_E2E', 'GRYLOO_LENDING_E2E',
    'GRYLOO_JUPITER_E2E', 'GRYLOO_SOLANA_DEVNET_E2E', 'GRYLOO_ROBINHOOD_E2E', 'GRYLOO_ROBINHOOD_MAINNET_E2E', 'GRYLOO_BASE_MAINNET_E2E', 'GRYLOO_UNISWAP_LIQUIDITY_E2E',
    'GRYLOO_ROUTER_E2E', 'GRYLOO_ROUTER_TESTNET_E2E', 'GRYLOO_CLOUD_RUNTIME_E2E', 'FLOFI_SWAP_READ_E2E', 'FLOFI_SWAP_EXECUTION_E2E', 'GRYLOO_COW', 'GRYLOO_CARD_E2E', 'GRYLOO_AUTOMATION_E2E', 'GRYLOO_DELEGATION_E2E',
    'FLOFI_ADMIN_E2E', 'FLOFI_LEARNING_E2E', 'GRYLOO_MCP_E2E', 'GRYLOO_CHANNEL_E2E', 'FLOFI_E2E_DATABASE_URL', 'FLOFI_WORKFLOW_RUNS', 'FLOFI_E2E_NETWORK_SCOPE', 'FLOFI_NETWORK_SCOPE']) delete env[key];
  Object.assign(env, settings);
  // Each profile keeps its own artifacts (a later profile never wipes them) and its own JUnit file for the CI test report.
  const output = join(results, name), junit = join(results, 'junit', `${name}.xml`);
  console.log(`Guarded release profile: ${name}`);
  const started = performance.now();
  const result = spawnSync('pnpm', ['--filter', '@defi-workflow-engine/reference-dapp', 'exec', 'playwright', 'test', ...specs, '--output', output, '--add-reporter', 'junit'],
    { env: { ...env, PLAYWRIGHT_JUNIT_OUTPUT_FILE: junit }, stdio: 'inherit' });
  Object.assign(row, { seconds: (performance.now() - started) / 1000, exitCode: result.status, status: result.error || result.status !== 0 ? 'FAIL' : 'PASS' });
  if (existsSync(junit)) writeFileSync(junit, ciTestReport(readFileSync(junit, 'utf8'), name));
  writeReport();
  console.log(`Guarded release profile duration: ${name}: ${row.seconds.toFixed(2)}s; ${row.status}`);
  if (row.status === 'FAIL') {
    report.status = 'FAIL';
    writeReport();
    const shown = Object.entries(settings).map(([key, value]) => `${key}=${key === 'TEST_DATABASE_URL' ? '<loopback>' : value}`).join(' ') || '(none)';
    console.error([`Guarded release FAIL: profile ${name} (${label}), ${result.error ? `could not start: ${result.error.message}` : `exit code ${result.status ?? `signal ${result.signal}`}`}.`,
      `  Specs: ${specs.join(' ')}`, `  Settings: ${shown}`, `  Artifacts: ${rel(output)} (failure screenshots, error context), JUnit ${rel(junit)}`,
      `  Reproduce: node scripts/guarded-release-browser.mjs profile ${name}`,
      `  Not run (never counted as passes): ${report.profiles.filter(other => other.status === 'NOT_RUN').map(other => other.name).join(', ') || 'none'}`].join('\n'));
    diagnose(name, specs, env, output);
    printTimings();
  }
  if (row.status === 'FAIL') {
    failureExitCode ||= result.status || 1;
    if (!collectFailures) {
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
report.status = failureExitCode ? 'FAIL' : 'PASS';
writeReport();
printTimings();
console.log(`Guarded release ${label}: ${report.status} (${selection.length} profiles)`);
process.exitCode = failureExitCode;

/**
 * The profile's JUnit for the CI test report. One spec can run in several profiles (the financial boundary runs in ten), so the profile
 * names each suite and class. A passing test's captured output (already in the step log) is dropped: CircleCI lists a passing test case
 * that carries output as "system-out" instead of a pass. Failing and skipped cases keep everything.
 */
function ciTestReport(xml, name) {
  return xml.replaceAll('<testsuite name="', `<testsuite name="${name} › `).replaceAll(' classname="', ` classname="${name} › `)
    .replace(/<testcase\b[^>]*[^/]>[\s\S]*?<\/testcase>/g, testcase => /<(failure|error|skipped)\b/.test(testcase) ? testcase
      : testcase.replace(/\s*<system-(out|err)>[\s\S]*?<\/system-\1>/g, ''));
}

/**
 * After a profile has already failed, re-runs only its failed tests once with a full trace, for diagnosis. Its outcome never changes the
 * profile's result or the exit code (a pass here only reports that the failure is intermittent). Tracing every run instead would cost
 * about a quarter more browser time (measured +26% on review-execute-recovery-components). FLOFI_BROWSER_FAILURE_TRACE=off skips it.
 */
function diagnose(name, specs, env, output) {
  if (process.env.FLOFI_BROWSER_FAILURE_TRACE === 'off') return;
  const lastRun = join(output, '.last-run.json');
  let failed = [];
  try { failed = JSON.parse(readFileSync(lastRun, 'utf8')).failedTests ?? []; } catch { /* no test recorded */ }
  if (!existsSync(lastRun) || !failed.length) {
    console.error('  Diagnostic trace: no failed test was recorded (the failure is outside a test: configuration, global setup or a server start); see the log above.');
    return;
  }
  const traces = `${output}-trace`;
  console.error(`  Diagnostic trace rerun of ${failed.length} failed test(s), never counted as a pass: ${rel(traces)}`);
  const rerun = spawnSync('pnpm', ['--filter', '@defi-workflow-engine/reference-dapp', 'exec', 'playwright', 'test', ...specs, '--last-failed', '--last-failed-file', lastRun,
    '--trace', 'on', '--output', traces, '--max-failures', '3', '--global-timeout', '300000'], { env, stdio: 'inherit' });
  console.error(`  Diagnostic trace rerun ${rerun.status === 0 ? 'passed: the failure is intermittent; the profile stays FAILED' : 'failed again'}; traces in ${rel(traces)} (open with \`pnpm exec playwright show-trace <trace.zip>\`).`);
  report.profiles.find(row => row.name === name).diagnostic = { rerunExitCode: rerun.status, traces: rel(traces) };
  writeReport();
}
