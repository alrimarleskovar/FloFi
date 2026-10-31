# BUILD-FLOFI-LANDING07-README-001 — Landing Page 07 and the end-user README

Status: **implemented on a review branch, not merged, not deployed.** Nothing was configured, migrated or executed; no transaction was
signed or sent. Evidence level: LOCAL (loopback production builds and MOCKED loopback providers).

| Part | Result |
| --- | --- |
| Install Caio's Landing 07 at `/`, unchanged | Done. Package files byte-identical. `/` renders pixel-identically to the package's own route (§3, §6). |
| Route its entry links into PR #143's sign-in | Done. Only the destination of the 8 `/app` links changed, to `/login` (§4). |
| Rewrite `README.md` for end users | Done (§7). |

## 1. Base

- Repository: `FloFi-xyz/FloFi`. The session's remote, `alrimarleskovar/FloFi`, redirects there.
- Dependency: PR #143 `BUILD-FLOFI-AUTH-WALLETS-001`.
  - State: **open, not merged**.
  - Head: branch `claude/wonderful-shannon-nacbbz`. This build started from `a5fa5c838b4bd4f2b6a00b826383f0ec31c194cb` and is
    synchronized with `a0414d45ad61414e6949bc0f40dd0f3995b1b85a` (§1.1).
  - `main`: `6b7bd62` (RELEASE A, schema 0018 certificate), already contained in PR #143's head.
- This build: branch `claude/build-flofi-landing07-readme-001`, stacked on PR #143.
  - PR #143's branch was not modified.
  - If both are accepted, merge PR #143 first.

### 1.1 Synchronization with PR #143 (2026-10-31)

PR #143 gained 21 commits: FloFi Wallet on its own origin, managed signing bound to reviewed attempts, mainnet-only FloFi Wallet, the
account/wallet proxy policy, the minimatch audit fix, the auth-wallets CI profile and RELEASE A from `main`. They were brought in with
a merge commit (`8c52274`), with no rebase and no force-push.

Conflicts resolved:
- `e2e/brand-ux-001.spec.ts`: keeps the Landing 07 entry flow and adds PR #143's `/login` checks (`lang` en, no overflow).
- `docs/engineering/coverage.json` and `COVERAGE.md`: PR #143's version plus this build's Landing 07 files and suites; the report is
  regenerated with `scripts/agent_guard.py report`.
- `e2e/auth-wallets.spec.ts`: auto-merged; the Landing 07 entry and returning-visitor steps apply to PR #143's new version.

Nothing in the Landing 07 files, assets, route, font, README or the 8 `/login` links changed in the merge. All 11 package payload files
still match `SHA256SUMS.txt`, except `landing07-page.tsx`, whose only difference is the 8 destinations.

CircleCI findings on this PR and their causes:
- **`certification-checks` failed on `ecfa90e`** at `pnpm audit --audit-level low`. The cause was GHSA-g3hv-75wg-m249 (minimatch
  < 11.0.1 via ESLint), already present on PR #143's old head. The audit fails the same way on `ecfa90e` here. PR #143's
  `106cf08`/`fe4b26f` patch it, and after the merge `pnpm audit` reports no known vulnerabilities.
- **`governance` failed on the merge commit `8c52274`** at `git diff --check HEAD^1 HEAD`. On a merge commit that range carries PR
  #143's new code, which has two whitespace-only defects:
  - `i18n/pt-wallet.ts:82`: a line holding one space, from `13c5c59`;
  - `wallet/flofi-wallet-channel.ts`: a blank line at EOF, from `25e6489`.

  PR #143's own gate passes because its last commit does not touch those lines. Both lines are fixed in a separate commit with no
  change to any string, translation or behaviour. The same two lines would trip the gate when PR #143 is merged into `main`;
  applying the identical fix there is recommended.

## 2. Package received

`FloFi-Landing-07-Alrimar-2026-10-30.zip` (uploaded by the owner on 2026-10-31):
- 18,118,868 bytes; SHA-256 `293b7fc4a0c68ae4d35f61182e2d974fe8ac482b3a8211f26cd9107e78db2fc5`.
- Unpacked into an isolated scratch folder.
- Its documentation was read as data. `APPLY_COPY_ONLY.ps1` was not executed.
- All 34 entries of `SHA256SUMS.txt` verify, and the file list matches exactly.

| Installed file (from `COPY_INTO_REPO/`) | SHA-256 | In repo |
| --- | --- | --- |
| `src/components/marketing/landing07-page.tsx` | `e620623f24475af1e1829e416df82b69ae5f14d927ee79e64b5ab46f386aadf1` | changed: 8 destinations only (§4) → `9b77213e…b1f2ba` |
| `src/components/marketing/landing07-demo.tsx` | `2c876746c727ef533d05a4fcf86a135a9c76b2d50c4b27365e15732385b41a74` | identical |
| `src/components/marketing/landing07-copy.ts` | `5a686a3061cb88215502d1eb98ea227fc4e0052b81f189d61c96d7ab6fb259a8` | identical |
| `src/components/marketing/landing07.module.css` | `c3816f1bbaaef896456942f2e7cea156930e9c410dc89093c8d6337f885287ce` | identical |
| `public/landing07/ribbon-reference-v2.png` | `2b0acc79dd59b22bf0fdc504a2286c0b2d65123323f9e187ed91f31f263af14f` | identical |
| `public/landing07/mascot-reference-v2.png` | `ac3e12093be0c56345e553d0a43d821a627fb78cb83bd29af3f4b8d64ce2ffcf` | identical |
| `public/landing07/bubble-reference-v2.png` | `bed026403c94af2ffe67d44416910713d5b12c511a0847ca44e49eeb5148132f` | identical |
| `public/landing07/swap-sculpture.png` | `141465f1157e8947a61eb43ce5b7c832173db113883d6bad348baf59d0fd3278` | identical |
| `public/landing07/transfer-sculpture.png` | `268496fb033fe319783e7ffda5417bf8a5fec9a364f7b190e91e6c3b7d5e64a9` | identical |
| `public/landing07/strategy-sculpture.png` | `012891ec99dd89e1a25c5865ad5b64f24ae3ace1ae0e8337f0232d1b0ea4a292` | identical |
| `public/landing07/clock.webp` | `dbaec3dc60229b75101f5cff2ee2ad11260c3be33aba794c2dd6d93d6648d396` | identical |
| `public/landing07/ASSET_NOTES.md` | `9fb1e39120c8a2a5805afdf8bbb2ec037a47983f5afbfb694b23119c9be3f1bb` | identical |

Paths are relative to `apps/reference-dapp/`.
- `BRAND_REFERENCE/` (6 files) is byte-identical to the repository's current `public/brand/` files; nothing was copied.
- `ROUTE_EXAMPLE/` was reconciled into the route (§3).
- `VISUAL_REFERENCES/`, `PREVIEWS/` and `ISSUES/` were used for review only and are not served.

## 3. Route `/` and display font

`apps/reference-dapp/src/app/page.tsx` now renders `Landing07Page`.
- **Metadata:** the package route's metadata, verbatim. The previous route took its metadata from the old landing's copy module; the
  root layout's metadata for other routes is unchanged.
- **Display font:**
  - The package declares `Anton` through `next/font/google`. FloFi deliberately does not fetch Google fonts at build time
    (`public/fonts/README.md`: a Next.js 16.4.1 URL-parser failure, and builds must not depend on Google CSS).
  - The three WOFF2 payloads that `next/font/google` generated for the package route were captured from a local production build of
    that exact route and vendored under `public/fonts/landing07/`, with `Anton.OFL.txt` (OFL-1.1), `manifest.json` and `README.md`.
  - `src/app/landing07-fonts.css` keeps the generated faces, Unicode ranges and `Anton Fallback` metrics unchanged.
  - The route preloads the Latin file, as `next/font` did, and wraps the page in `.landing07-fonts`, which sets
    `--font-landing-display`.
  - Only `/` imports this CSS. `/app`, `/login` and `/docs` keep Outfit and load no Anton (browser-tested).
  - A unit test (`src/config/landing07-fonts.test.ts`) pins the digests.
  - The landing's `--font-outfit` already comes from the root layout's `.flofi-fonts`.
- **Fidelity:** `/` built from the package's own `ROUTE_EXAMPLE/page.tsx` was compared with the integrated route over 16 captures:
  PT and EN; 1440, 1662, 800 and 390 px; full page with reduced motion, and the first viewport with motion. Result: **0 differing
  pixels** (`BUILD-FLOFI-LANDING07-README-001-EVIDENCE/pixel-comparison.json`).

## 4. Entry links → sign-in (the only change inside the package files)

PR #143 sends every landing "Launch" link to `/login`:
- A valid session continues to `/app`, or to `/onboarding` if the social account still needs it.
- `/login` validates `returnTo` (default `/app`).
- It offers *Explore the builder without an account*; `/app` stays open.

Caio's integration note anticipated this case: "adapt the CTAs in `landing07-page.tsx`". No wrapper or redirect was used: the alternative was intercepting clicks or redirecting `/app`. Either would have made links lie about their destination or changed the `/app` access policy.

Word-level diff against the package, `landing07-page.tsx`. Only `href="/app"` → `href="/login"`; every class, attribute, text and style is unchanged.

| Line | Link (PT / EN) |
| --- | --- |
| 90 | header button *Começar com FloFi / Abrir FloFi* — *Start with FloFi / Open FloFi* |
| 101 | hero primary *Começar com FloFi* — *Start with FloFi* |
| 111 | demo *Explorar o produto* — *Explore the product* |
| 116 | possibilities rail *ABRIR FLOFI* — *LAUNCH APP* |
| 119 | swap card arrow (*Explorar trocas no FloFi*) |
| 120 | transfer card arrow (*Explorar transferências no FloFi*) |
| 121 | strategies card arrow (*Explorar estratégias no FloFi*) |
| 135 | closing *Abrir o FloFi* — *Open FloFi* |

The following are unchanged:
- `/docs` (header and footer);
- in-page anchors (`#main`, `#como-funciona`);
- the owner contact `https://x.com/FloFi_xyz` (*Para empresas*, *Contato*).

Session, `returnTo`, onboarding, wallet proof and `/app` access were not modified.

## 5. Tests changed (owner review)

**New:**
- `e2e/landing07.spec.ts`, in the CI `default-product` profile and the dedicated motion config. 15 tests:
  - structure, the 8 `/login` links, Docs, anchors and the contact link;
  - PT/EN with persistence, at 320–1920 px with no overflow;
  - keyboard: skip link, language group, FAQ;
  - reduced motion, and the illustrative demo with motion (plays in view, pause, resume, restart; app origin only);
  - ribbon and section reveal on scroll;
  - served bytes equal the package hashes, the font is local, and no Google font reference;
  - `/` → `/login` → `/app` and `/docs`, and `/app`, `/login`, `/docs` without Anton.

**Retargeted to Landing 07 without changing it** (assertions about the previous landing's content replaced; their other tests are
untouched):
- `brand-ux-001`: the landing/entry test, reduced motion, scroll, and the "no landing heading in `/app`" check.
- `beta-ui`: the header CTA test. The yellow "Launch Beta FloFi" was the previous landing's; the `/app` Beta notice tests are unchanged.
- `native-docs`: the landing-links test.
- `auth-wallets`: entry from Landing 07's header link, plus a returning signed-in visitor entering from the landing → `/app`.

**Retired** — kept in Git and listed with reasons in `playwright.config.ts` (`RETIRED_LANDING_SPECS`). Each covers previous-landing
features that are no longer routed:
- `ux-ui-002-landing`: community links, MCP card, conversation demo, mascot journey;
- `landing-structure`: section layout;
- `earth-footer`: Earth closing;
- `brand-motion-001`: mascot motion;
- `brand-visual-refinement`: infrastructure diagram;
- `workflow-story`: three-phase story.

**CI profile change (intentional):**
- `scripts/guarded-release-browser.mjs` `default-product` and its mirror in `scripts/test_ci_optimization.py`:
  `ux-ui-002-landing.spec.ts` → `landing07.spec.ts`.
- `playwright.motion.config.ts` now matches `landing07.spec.ts`.

**Not removed:** the previous landing's components (`components/marketing/page.tsx` and siblings) and their unit test stay in the
repository, unrouted. Removing them is a separate decision.

`docs/engineering/coverage.json` and `COVERAGE.md` map the new files and suites (agent guard: PASS).

## 6. Validation (Node 24.21.0, pnpm 11.22.0, Chromium headless shell 1243, loopback PostgreSQL 16)

After the synchronization (§1.1), the `certification-checks` steps ran locally in CI order:

| Check | Result |
| --- | --- |
| `bootstrap-ci.py --verify-dependencies`, `pnpm audit --audit-level low`, CycloneDX SBOM | pass (no known vulnerabilities; 295 registry components) |
| typecheck, lint (+ `guarded-release-browser.mjs`), schema drift | pass |
| `agent_guard.py check`, unit tests, `verify-results` | pass. 6,086 tests passed and 2 skipped; both skips are pre-existing. |
| Screenshot-diff self-test, reference-linter exports | pass |
| `pnpm test:postgres` + `verify-results --stage postgres` | 553 passed, 3 skipped, 1 failed. The failure is `forward-compatibility.pg.test.ts`, which encodes PostgreSQL 18 catalog behaviour; this container runs PostgreSQL 16 while CircleCI runs 18.6. The failure is documented in PR #143, and `cloud-runtime` is not touched here. |
| Governance gate (governance-lite + self-tests, `test_ci_*.py`, `git diff --check`, `git diff --check HEAD^1 HEAD`) | pass |
| `landing07.spec.ts` | 15/15 |
| `brand-ux-001`, `beta-ui` (CI `default-product` members) | 15/15, 4/4 |
| `native-docs` | 8/9. The failure is **pre-existing and unrelated**: `public/docs/api-reference.json` still lists testnets while `docs/developer/openapi.json` is mainnet-only. Neither file is touched by this branch, and the docs suite is not in CI. |
| `playwright.auth-wallets.config.ts` (MOCKED loopback Google/Apple/Turnkey, FloFi Wallet origin, loopback DB) | 13/13, including PR #143's FloFi Wallet journeys. Entry is from Landing 07's header link; a returning signed-in visitor goes from the landing straight to `/app`. |
| Pixel comparison, package route vs integrated route, after the synchronization | 0 differing pixels in 16 captures |

Before the synchronization (on `ecfa90e`): `pnpm check` passed (466 files, 5,856 tests), and so did `auth-wallets` (8/8). CircleCI
`certification-browser-1` and `certification-browser-2` passed on `ecfa90e`; together they cover the guarded browser plan, including
`landing07.spec.ts` in `default-product`.

- The browser specs ran under a local app-only Playwright config: the same app server and settings, without the Mode A fork server,
  because Foundry Anvil is not installed here. CI runs the full harness.
- The fork suites and the full guarded browser plan run only in CircleCI; the PR description records the final run.
- MOCKED providers do not prove live Google, Apple or Turnkey behaviour; that remains PR #143's external gate.

Screenshots and the side-by-side with Caio's `PREVIEWS/` are in `BUILD-FLOFI-LANDING07-README-001-EVIDENCE/`.

## 7. README

Language: English. Structure:
1. Identity — logo, tagline, official links, a real Build 0 screenshot and a one-line real-funds beta notice.
2. What is FloFi — non-custodial multichain DeFi; chat (AI Copilot where enabled) and the optional visual builder; simulate, review,
   sign, track.
3. Why people use it.
4. What you can do today — action × network for the five mainnets; bridges including EVM ↔ Solana; multi-step workflows; the
   evidence boundary.
5. How it works — sign in/connect → describe or build → review → authorize → track; the canvas is optional.
6. Your account and wallets — PR #143 methods and embedded wallets, with rollout state.
7. Use FloFi where you already are — app, MCP, Telegram, WhatsApp, with real availability.
8. Pricing — the 0.1% model versus what the code does today.
9. FloFi for Developers — API, SDK, webhooks, MCP and their current limits.
10. Security — principles; no audit claim.
11. Status & evidence — features built and switched on per deployment, and the roadmap.
12. Documentation, local run (`FloFi-xyz/FloFi`), contributing, license and the Gryloo note.

### 7.1 Sources of truth for each claim

| README claim | Source |
| --- | --- |
| Mainnet-only product, five networks, actions per network | `src/engine/strategy-spec.ts`, `src/domain/network-scope.ts`, `src/components/docs/content.ts` (Supported Networks table); production MCP `get_supported_networks` / `get_capabilities` at `https://flofi.xyz/api/mcp` (read-only, 2026-10-31): every listed row `enabledByDeployment: live`, `demonstratedEvidence: NONE_DEMONSTRATED` |
| EVM ↔ Solana bridges | `packages/workflow-contracts/src/universal-router.ts`, `src/engine/strategy-engine.ts` (universal bridge, Relay execution) |
| Bridge review shows provider, fees, guaranteed minimum | `src/components/universal-bridge-panel.tsx` |
| Multi-step: in order, fresh review + signature per step, spend what was delivered | `src/domain/workflow-sequence.ts` |
| Not certified on mainnet; recorded executions are testnet owner runs | `docs/builds/BUILD-FLOFI-UNIVERSAL-E2E-001-CERTIFICATION-MATRIX.json` (11 `LIVE_CERTIFIED`, all testnet/devnet), `docs/builds/BUILD-FLOFI-UNIVERSAL-E2E-001-READINESS.md` |
| Approvals spelled out, uncapped allowance warning | `src/domain/review-presentation.ts`, `src/components/review-workspace.tsx` |
| Accounts and embedded wallets, disabled-when-unconfigured, `/app` open | PR #143: `app/(account)/login/page.tsx`, `docs/builds/BUILD-FLOFI-AUTH-WALLETS-001.md` §6–§7, §12 |
| MCP endpoint and tools; ChatGPT/Claude acceptance pending | `src/mcp/config.ts`, `src/mcp/tools.ts`, `components/marketing/assistant-onboarding.tsx`, `docs/builds/BUILD-MCP-LINK-INTEGRITY-P0.md` |
| Telegram built, live acceptance pending; WhatsApp policy-blocked | `src/channels/telegram/config.ts`, `docs/deploy/TELEGRAM.md`, `src/channels/whatsapp/config.ts` |
| 0.1% fee recorded, not collected; waived on failure; other runtimes record none | `src/server/universal-router/fee-obligation.ts` (+ test), `src/domain/conversation-lifecycle.ts`, `src/app/admin/page.tsx` |
| Developer API sandbox-only, per deployment | `src/developer/config.ts`, `src/developer/http.ts`, `src/developer/service.ts`, `src/platform/strategy.ts`, `docs/developer/README.md` |
| Automations built, opt-in; delegated execution blocked in production | `src/automations/config.ts`, `src/delegation/config.ts` |
| Social links | `src/components/marketing/social-links.tsx` (owner-supplied) |
| Website and MCP URL | `src/platform/navigation.ts`; production MCP navigation result |

`flofi.xyz` and `github.com` could not be fetched over HTTP from this session (network policy). The website and MCP URLs were confirmed
through the production MCP server's own result; the repository URL through the GitHub API.

## 8. Items from the package, recorded and not changed

**Package items:**
- **Hero "F"** (`PENDENCIA_HERO_F.md`, `ISSUES/hero-F-topo-encoberto.png`): the top bar of the F is hidden behind the ribbon on
  desktop. It is visible in the integration exactly as in Caio's preview. It is a visual decision for the owner and Caio, untouched
  here.
- **Illustrations:** `ASSET_NOTES.md` states that the ribbon, mascot, bubble and three sculptures were produced with an image tool
  from approved references. They are installed byte-for-byte as delivered. Caio's `INTEGRACAO.md` asks for final rights and approval
  review of these derived illustrations before publication.
- **"Para empresas" / "Contato"** point to `https://x.com/FloFi_xyz`. Caio asks to confirm this destination before publication.
- **Document language:**
  - On first load `<html lang>` stays the root layout's (`en`) while the landing shows PT; it follows the landing after a switch.
  - The landing root declares its own `lang`.
  - After a reload with EN chosen, the tab title keeps the route metadata (PT).
  - Same code as the package route; documented in `VALIDACAO_E_LIMITES.md`.
- **Landing copy:**
  - The FAQ and copy describe FloFi as structuring, reviewing and simulating flows, with wallet authorization for execution.
  - The demo remains illustrative and is not connected to any engine, quote or wallet.
  - Copy and claims were not edited.

**Outside the package, not changed by this build:**
- **Stale repository links:** the docs header "Source code" link and the in-app Getting Started clone command point to
  `alrimarleskovar/gryloo`.
- **Stale status documents:**
  - `docs/STATUS.md`: no entries for PRs #118–#141; "No FloFi fee exists yet" predates the recorded 0.1% obligation; matrix counts
    51/9 vs the file's 52/8.
  - `docs/deploy/TELEGRAM.md`: describes the allowlist as the default; the code defaults to public when enabled.
  - The matrix row `bridge-evm-solana` says no such route exists.
- **Published API contract:** `public/docs/api-reference.json` differs from `docs/developer/openapi.json` (§6).
- **Missing policy:** the repository has no vulnerability-disclosure policy (`SECURITY.md`); the README does not invent one.

## 9. Files changed (relative to PR #143's head)

- **Landing:**
  - `apps/reference-dapp/src/components/marketing/landing07-{page.tsx,demo.tsx,copy.ts,.module.css}`
  - `apps/reference-dapp/public/landing07/*`
- **Route and font:**
  - `apps/reference-dapp/src/app/page.tsx`, `src/app/landing07-fonts.css`
  - `public/fonts/landing07/*`
  - `src/config/landing07-fonts.test.ts`
- **Tests and CI:**
  - `apps/reference-dapp/e2e/landing07.spec.ts`; `brand-ux-001`, `beta-ui`, `native-docs`, `auth-wallets` specs
  - `playwright.config.ts`, `playwright.motion.config.ts`
  - `scripts/guarded-release-browser.mjs`, `scripts/test_ci_optimization.py`
  - `docs/engineering/coverage.json`, `COVERAGE.md`
- **Docs:**
  - `README.md`
  - this record and `BUILD-FLOFI-LANDING07-README-001-EVIDENCE/`

No dependency, lockfile, migration, provider, session, wallet, fee or execution code changed.
