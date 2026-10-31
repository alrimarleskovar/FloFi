# BUILD-FLOFI-AUTH-WALLETS-001 — Authentication, wallet onboarding and secure credentials

Status: implemented on a review branch, **not merged, not deployed**. Live Google, Apple and Turnkey integrations are
**unverified** in this build (no vendor credentials or network access to those services were available); every flow is
implemented against the providers' published interfaces and exercised end to end against MOCKED loopback stand-ins only.
**Release readiness: NO-GO** — see §16 (third round: dependency policy, encrypted email codes, FloFi Wallet on its own origin, managed
signing, export boundary, CI and blockers) and §15 (second round).

Journey delivered: **Landing → Sign in → Wallet onboarding → Build 0 (`/app`)**, plus **Credentials → My wallets** and a
protected **Export wallet** flow.

> Branch note: the build prompt names `FloFi-xyz/FloFi` and `claude/build-auth-wallets-001`. This session's repository is
> `alrimarleskovar/FloFi` and its designated branch is `claude/wonderful-shannon-nacbbz`; the work is delivered there.

## 1. Inputs reviewed

- Repository rules: `CLAUDE.md`, `AGENTS.md`, `docs/SCOPE_GUARD.md`, `apps/reference-dapp/AGENTS.md`.
  `python3 scripts/agent_guard.py check` → PASS; `impact --base origin/main` → no affected modules before the change.
- Existing modules: `server/wallet-session.ts`, `server/session-principal.ts`, `server/run-ownership.ts`, `app/wallet-session-action.ts`,
  `domain/credentials.ts`, `state/credentials-store.ts`, `wallet/wallet-registry.ts`, `state/wallet-connection.ts`,
  `components/secondary-product-workspace.tsx`, `components/wallet-proof.tsx`, the landing (`components/marketing/*`), the product
  layout, `next.config.ts` (global `connect-src 'self'` CSP), platform state (PostgreSQL migrations, `platformStateHost`).
- Design references: the four owner screenshots (two-column sign-in, account + wallet introduction, create/import, export modal) and
  the brand packages (tokens and logo, "a gota" applications, dark screens, Caio's Create screen). The packages were unzipped into the
  session scratchpad and **read as data only**; none of their scripts was executed. Tokens used: light `#F7F9FC/#FFFFFF/#041B3D/#4B5B73`,
  graphite dark `#0B0D12/#15181F/#1C2029/#2A2F3A/#F4F5F7/#A4ABB8`, luminous blue `#2343D9` (link `#93A6FF` in dark), Outfit + IBM Plex
  Mono, the droplet mascot. No HeyAnon mark, copy, TON, Telegram login or Passkey login appears.

## 2. Provider decision

### 2.1 Evidence

Vendor documentation hosts (`docs.privy.io`, `docs.turnkey.com`, `auth.privy.io`, `api.turnkey.com`) were **not reachable** from this
session. Capabilities were therefore verified from the vendors' **published npm packages** (exact versions, manifests and TypeScript
declarations), and dependency impact by resolving them under this repository's real policies in a scratch worktree.

| | Privy `@privy-io/react-auth@3.51.0` | Turnkey `@turnkey/iframe-stamper@2.11.1` + `@turnkey/indexed-db-stamper@1.3.12` |
| --- | --- | --- |
| License | Apache-2.0 | Apache-2.0 (deps MIT) |
| Lockfile impact | **+709 packages** (WalletConnect/Reown, wagmi, x402, MetaMask SDK, Coinbase SDK, Stripe, styled-components…) | **+8 packages** (iframe stamper has **zero** dependencies) |
| `pnpm audit --audit-level low` (repo CI gate) | **4 high + 3 moderate** new advisories (WalletConnect tree) | no new advisory |
| `strictPeerDependencies` | **fails** (viem, React 19 vs `use-sync-external-store@1.2.0`, `@stripe/stripe-js`, `@tanstack/react-query`) | passes |
| Native build scripts | requires approving `bufferutil`, `keccak`, `utf-8-validate`, `@reown/appkit` | none |
| EVM + Solana embedded wallets | yes | yes (HD wallets, `ADDRESS_FORMAT_ETHEREUM` / `ADDRESS_FORMAT_SOLANA`) |
| Import | `importWallet({ privateKey })`, `importSeedPhrase({ mnemonic })`: **the app collects the raw secret in its own JS** | `INIT_IMPORT_PRIVATE_KEY` → key typed into the provider's **own iframe** (`import.turnkey.com`), encrypted to the enclave; the page only relays ciphertext |
| Export | provider modal on a separate origin (good) | `EXPORT_WALLET` / `EXPORT_WALLET_ACCOUNT` / `EXPORT_PRIVATE_KEY` encrypted to the **export iframe's** key; shown only inside `export.turnkey.com` |
| Recovery phrase export | yes for HD wallets | yes for HD wallets; imported keys export as private key only |
| Social / email sign-in | built in | email OTP built in; OIDC tokens accepted (`OAUTH_LOGIN`) — Google/Apple OAuth is run by FloFi |
| Server verification without SDK | ES256 token + verification key | parent API stamp (ECDSA P-256), mirrored with `node:crypto` exactly as Turnkey's own `nodecrypto` stamper |

Also considered: Dynamic (`@dynamic-labs/sdk-react-core@5.14.0`, 29 direct dependencies including MPC wallet clients), Web3Auth
(`@web3auth/modal@11.4.3`, no license field in its manifest, wide peer set). Neither offered an advantage that justified its footprint.

### 2.2 Decision

**Turnkey** as the embedded-wallet provider (non-custodial sub-organizations, isolated import and export iframes), with **FloFi as the
identity relying party**: Google and Apple through standard OpenID Connect verified by FloFi's server, email one-time codes delivered
and verified by Turnkey, Web3 Wallet sign-in through FloFi's existing EIP-4361 / Sign-In With Solana proofs.

Privy was rejected for this build because (a) it cannot meet the import constraint — its import APIs take the raw key or phrase from
application code — and (b) adding it would break three existing repository security gates (audit, strict peers, build-script
approval). Using Privy would require the owner to waive those gates and to accept FloFi-hosted raw-key input; neither was done.

**Pricing** could not be verified (vendor sites unreachable). The owner must confirm the Turnkey plan for sub-organizations, wallet
creation, exports and email OTP volume before enabling it in production.

## 3. Architecture

```
Browser                                   FloFi server (Next.js)                          Providers
───────                                   ─────────────────────                           ─────────
/login ── Google/Apple ─► startSocialSignIn ── sealed OIDC flow cookie ──► accounts.google.com / appleid.apple.com
          (nonce = sha256(session key))   /auth/callback/{google,apple}: verify ID token (JWKS, iss, aud, exp, iat, nonce)
       ── Email ─────────► startEmailSignIn ── INIT_OTP (parent stamp) ───────────────► Turnkey (sends the email)
                           completeEmailSignIn ─ VERIFY_OTP (bound to session key) ──► Turnkey
       ── Web3 Wallet ──► existing SIWE/SIWS proof (fresh ≤ 10 min) → walletAccountSignIn
                          ▼
                     account store (PostgreSQL 0018) → sealed HttpOnly account cookie + server session record
                          ▼ (Google/Apple/Email only)
                     provider organization: find or create sub-org (person = only root user) → OAUTH_LOGIN / OTP_LOGIN
                     for the browser's own session key (non-extractable WebCrypto key in IndexedDB)
/onboarding/wallets
   create ─ stamped by session key ─► /api/account/provider/* relay (session, allowlist, org pin) ─► Turnkey CREATE_WALLET
   import ─ key typed in import.turnkey.com iframe → ciphertext ─► relay ─► INIT_IMPORT / IMPORT_PRIVATE_KEY
   Save   ─► saveManagedWallets(ids) ─ server asks Turnkey (parent read) that each address is in this person's org ─► store
Credentials → My wallets → Export
   authorizeWalletExport (fresh sign-in, owned managed wallet, supported kind)
   export iframe key ─► relay (fresh sign-in + ownership re-checked) ─► EXPORT_* encrypted to the iframe ─► shown only in export.turnkey.com
```

New modules (`apps/reference-dapp/src/accounts/`): `account-model.ts` (shared strict model), `account-session.ts` (sealed cookies),
`account-store.ts` (PostgreSQL, tenant/account isolation), `oidc.ts` (relying party), `turnkey-server.ts` (parent-key client),
`account-service.ts` (orchestration), `account-host.ts` (request context), `oidc-callback.ts`, `provider-relay.ts`,
`turnkey-browser.ts` (browser provider client), `account-theme.ts`. Server actions: `app/account-action.ts`. Routes: `/login`,
`/onboarding`, `/onboarding/wallets`, `/auth/callback/google`, `/auth/callback/apple`, `/api/account/provider/[...path]`.
UI: `components/account/*`. Credentials gains **My wallets**; the Settings menu gains Sign in / My account / Sign out (only on
deployments with accounts); landing and docs "Launch" links go to `/login`.

## 4. Identity model

- One canonical account per person: `acct_<128-bit hex>`. Identities: `GOOGLE`/`APPLE` (OIDC `sub`), `EMAIL` (provider-verified, lower
  case), `EIP155` / `SOLANA` (proven address). Primary key `(tenant, kind, subject)`: **an identity belongs to at most one account**.
- First sign-in with an unknown identity creates an account; a known identity signs into its account. Concurrent first sign-ins
  converge on one account (tested).
- Linking (explicit, signed-in, **sign-in from the last 10 minutes**): an identity already held by another account fails closed with
  `ACCOUNT_IDENTITY_LINKED_ELSEWHERE` — **nothing is ever merged or moved**. Linking a wallet requires a fresh wallet signature.
- **Run access is unchanged.** Workflow runs, approvals, history and `/approve` still use the wallet session and
  `assertRunOwnership`. An account session is never consulted for run ownership, so a Google sign-in cannot reach any wallet's
  execution history. MCP OAuth accounts (`/connections`), channels and universal signing links are untouched.

## 5. Sessions

- `flofi_account_session`: HttpOnly, `SameSite=Lax`, `Secure` on HTTPS, host-bound, HMAC-sealed with a key derived (HKDF, own label)
  from the existing session secret. 12-hour lifetime.
- **Server-side verification on every request**: the sealed claims must match an unrevoked, unexpired `flofi_account_sessions` row
  (account, method and sign-in time). Sign-out revokes the row; "sign out everywhere" exists in the store. A tampered, expired,
  revoked, foreign-host or foreign-tenant cookie is rejected (unit, PostgreSQL and browser tests).
- Sensitive actions (export, linking) require a sign-in from the last 10 minutes; the UI offers "Sign in again".
- Flow cookies are sealed, single-use and expire in 10 minutes. The OIDC cookie holds state, nonce and PKCE verifier (and, for a link
  flow, the signed-in session that started it); it is `SameSite=None; Secure` on HTTPS because Apple returns with a cross-site form POST.
  The email cookie holds only FloFi's challenge id (`SameSite=Lax`). Neither holds an OTP code, an OIDC token, an email address or a key.
- A new sign-in in a browser revokes the session it replaces; deleting the account removes every session.
- The existing wallet sessions keep their own cookies, lifetimes and meaning.

## 6. Sign-in methods

| Method | Mechanism | Server-side verification |
| --- | --- | --- |
| Google | authorization code + PKCE (S256), `prompt=select_account` | code exchanged server-to-server with the client secret; ID token RS256 against Google JWKS; `iss`, `aud`, `azp`, `exp`, `iat` (≤ 15 min, ±2 min skew), `nonce`; **each ID token is accepted once** (SHA-256 digest recorded until it expires) |
| Apple | `code id_token`, `response_mode=form_post`, scope `email` | ID token RS256 against Apple JWKS; same claim checks and single use; the code is not exchanged (no Apple signing key needed) |
| Email | Turnkey email OTP (`INIT_OTP_V2`, `VERIFY_OTP`, then `OTP_LOGIN`) | FloFi's authenticated call to Turnkey verifies the code; the verification token is bound to the browser's session key. FloFi enforces **5 attempts per code**, **5 codes per address per hour** and a deployment-wide ceiling (300 per 10 min), independent of the provider's own limits; the code is never stored |
| Web3 Wallet | existing EIP-4361 (`personal_sign`) / Sign-In With Solana | existing signature verification; FloFi additionally requires the wallet session to be **≤ 10 minutes** old |

When a method is not configured the button is disabled and says so; nothing is simulated. Without `DATABASE_URL` the whole sign-in
screen states that accounts are unavailable and offers the builder without an account.

## 7. Managed wallets

- **Organization**: on the first Google/Apple/email sign-in (when Turnkey is configured) FloFi creates the person's Turnkey
  sub-organization with **one root user — the person** (their email or OIDC identity), quorum 1, **no FloFi API key, no
  authenticator, no policy, no delegated signer**. FloFi's parent key can create sub-organizations, start sign-ins and read public
  metadata; per Turnkey's model it is not a member of the sub-organization and cannot sign with or export its keys.
- **Provider session**: the OIDC `nonce` is `sha256(session public key)` and the OTP verification is bound to the same key, so the
  provider session is opened only for the browser's own non-extractable key. FloFi's server never holds a key that can stamp for the
  person.
- **Create**: `CREATE_WALLET` (HD, 12 words) with one account — EVM `m/44'/60'/0'/0/0` or Solana `m/44'/501'/0'/0'`.
- **Import**: `INIT_IMPORT_PRIVATE_KEY` → the provider's import iframe → ciphertext → `IMPORT_PRIVATE_KEY` (hex for EVM, base58 for
  Solana). FloFi renders **no private-key input** (asserted in the browser test).
- **Save wallets** is disabled until at least one wallet was really created or imported; saving sends only `<ecosystem>:<address>`
  ids and the server stores a wallet only after the provider confirms it is in this person's organization
  (`ACCOUNT_WALLET_NOT_OWNED` otherwise). Stored fields: address, ecosystem, origin (generated/imported/external), provider name,
  the provider's non-secret resource id, export capability, label.
- **Same-origin relay**: FloFi keeps `connect-src 'self'`. The browser's stamped requests go to `/api/account/provider/*`, which
  requires the account session, allowlists exactly create/import/export/get-activity, pins the organization (and user for import),
  and for any export re-checks the 10-minute sign-in and wallet ownership. It accepts only the exact canonical JSON the browser
  stamped (no duplicate keys), only same-origin fetches (`Sec-Fetch-Site`), forwards bytes verbatim (a changed byte breaks the stamp)
  and logs nothing. Signing, policy, delegation and session-signer activities are **not** relayed.
- **Export**: only for managed wallets. Generated HD wallets: *Copy private key* (`EXPORT_WALLET_ACCOUNT`) and *Copy recovery phrase*
  (`EXPORT_WALLET`); imported keys: *Copy private key* only — no phrase is ever derived. Explicit confirmation checkbox, recent sign-in,
  then the provider decrypts and shows the secret inside its own frame; FloFi never reads it, never writes the clipboard, and stores
  nothing. External wallets (MetaMask, Phantom, Solflare…) never show Export.
- **Removal** removes FloFi's association only; the copy says the wallet still exists at Turnkey and funds are unchanged.
- **Not in this build — a blocking dependency for production**: using a managed wallet to sign FloFi transactions. No
  managed-wallet signing adapter was added; Build, Simulate and Execute continue to use the connected browser wallet with the same
  review, Strategy Manifest and wallet signature. The product says so where managed wallets appear: a note on *Add your wallets*
  ("FloFi can't sign workflows with these wallets yet"), on the wallet introduction's create/import items, and on every managed wallet
  card in My wallets ("Can't sign FloFi workflows yet. Connect MetaMask, Phantom or Solflare to sign."); external wallets carry no such
  note. The browser suite asserts all three. Managed wallets can be exported to a wallet app today. The adapter is §15.7's blocker 2.

**Account deletion**: Credentials → My wallets → *Delete FloFi account* (explicit confirmation, sign-in from the last 10 minutes) deletes
the account, its identities, sessions and saved wallet metadata. Wallets kept by the provider and on-chain assets are not deleted; the
copy tells the person to export managed wallets first. Expired sessions are pruned tenant-wide (30-day grace), email challenges after
a day and used ID-token digests when they expire.

**Recovery model**: the FloFi account is recovered by signing in again with the same Google, Apple or email identity (the wallet list
is server-side and restores on any device). Managed wallets are unlocked by the identity that created their provider organization;
the screen explains this when another method is used. Loss of that identity means loss of access through FloFi; exporting the
recovery phrase is the person's independent backup. FloFi cannot recover keys.

## 8. Security boundaries and invariants

1. No private key, seed phrase, OTP code, OIDC token or export bundle is stored by FloFi (database CHECK constraints, strict readers
   that drop records with extra fields, browser test scanning storage and every account row).
2. No raw-key input in FloFi; import and export happen in the provider's frames on other origins.
3. A login session is identity only: no transaction, approval, permission, delegated signer, session signer or policy is created by
   sign-in, onboarding, saving, linking or export. The relay cannot reach signing activities.
4. Run ownership, Strategy Manifest acceptance, wallet signatures, execution, fees, quotes, recovery, reconciliation and evidence are
   unchanged (no file of those paths changed).
5. Tenant + account scoping on every statement; wallets and identities are unique per tenant; cross-account reads, saves, renames,
   removals and exports are refused (PostgreSQL and browser tests).
6. Test-only seams fail closed on hosted deployments: the loopback identity provider (`FLOFI_AUTH_E2E_IDP=MOCKED_LOOPBACK_ONLY`) and the
   loopback wallet provider (`FLOFI_TURNKEY_E2E=MOCKED_LOOPBACK_ONLY`) are refused when `VERCEL`/Railway/`FLOFI_DEPLOYMENT=hosted` is set
   and accept only `http://127.0.0.1|localhost` origins; otherwise only `https://*.turnkey.com` provider hosts are accepted.
7. Open-redirect protection: post-sign-in destinations are limited to `/app…` and `/onboarding…`.

Residual risks for owner review:
- The browser's provider session key is a root-user credential of the person's sub-organization for its lifetime (now 15 minutes,
  `MANAGED_SESSION_SECONDS`). FloFi's guarantees that it is used only for create/import/export — and that export output is decrypted
  only in the provider's frame — rest on FloFi's code and on the FloFi origin being free of XSS, not on a Turnkey policy. The relay cannot
  check that `targetPublicKey` belongs to the export frame. `/login` and `/onboarding*` now run under a per-request nonce CSP (§15.3);
  `/app` (where Export opens) does not — §15.7, blocker 4.
- Sign-in, onboarding and Credentials send `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- FloFi's server sees the Google/Apple ID token and (with `VERIFY_OTP` v1) the six-digit code. Both are bound to the browser's session
  key for provider use. **The legacy OTP activities are deprecated and, per Turnkey's migration guide, `CREATE_SUB_ORGANIZATION_V8`
  does not accept their verification tokens: new email accounts cannot be created live as implemented** (§15.4, blocker 3).
- The parent API private key is a high-value deployment secret (it can create organizations and initiate email OTPs to users). Store it
  only in the deployment secret manager; rotate on exposure.
- Activity versions (`INIT_OTP_V2`, `VERIFY_OTP`, `OTP_LOGIN`, `OAUTH_LOGIN`, `CREATE_SUB_ORGANIZATION_V8`) and result field names were
  taken from `@turnkey/http@6.7.0` declarations and are **unverified live**.

## 9. Database and migration impact

Migration `0018_flofi_accounts` (six new tables, nothing else; no function or trigger). A forward-compatibility certificate (base
0017 → 0018) and its assessment (`docs/deploy/SCHEMA-COMPATIBILITY.md#12-certificate-0018_flofi_accounts`) are included. Release order
remains certificate first: a reviewed certificate-bearing version-17 release, then the migration-bearing release. The exact sequence,
the one production path that applies migrations (the Railway API pre-deploy) and rollback are in
[`docs/deploy/RELEASE-AUTH-WALLETS-0018.md`](../deploy/RELEASE-AUTH-WALLETS-0018.md). No production migration was run.

## 10. Dependency and gate changes (owner review required)

- `apps/reference-dapp/package.json`: `@turnkey/iframe-stamper@2.11.1`, `@turnkey/indexed-db-stamper@1.3.12` (exact pins, both older
  than the 7-day release-age gate).
- `scripts/bootstrap-ci.py`: new exact direct pins (`BUILDAUTHWALLETS001_DIRECT_VERSIONS`), lock-importer check, registry count
  263 → 271 and the new lockfile baseline hash. `scripts/test_ci_optimization.py` and `.circleci/scripts/ci-sbom.sh` follow the count.
  `python3 scripts/bootstrap-ci.py --verify-dependencies` passes (271 entries, integrity, licenses, release age).
- `minimatch` (GHSA-g3hv-75wg-m249, pre-existing on `main`, the CircleCI `certification-checks` failure): exact overrides move ESLint's
  three consumers to `minimatch@11.0.3` (+ `@isaacs/nonrecursive-glob-match@1.0.3`); `minimatch@10.2.6` leaves the lockfile. Registry
  count 271 → 272, new baseline hash, both SBOM copies and the CI test follow. The exact BlueOak-1.0.0 identity exception moves from
  `minimatch@10.2.6` to the two new identities (same author and licence). **The 7-day release-age gate is unchanged and not waived**:
  both packages are younger than 7 days until 2026-11-04T20:00:34Z (§15.2).

## 11. External setup checklist (nothing below was configured by this build)

1. `DATABASE_URL` (PostgreSQL platform state) and the certificate-first release of migration 0018.
2. `FLOFI_PUBLIC_ORIGIN` = the exact public origin (e.g. `https://flofi.xyz`); `FLOFI_SESSION_SECRET` (≥ 32 chars) or the existing
   `API_AUTH_TOKEN` derivation.
3. Google: OAuth 2.0 Web client; authorized redirect URI `https://<origin>/auth/callback/google`; consent screen (scopes `openid email`);
   set `FLOFI_GOOGLE_CLIENT_ID`, `FLOFI_GOOGLE_CLIENT_SECRET` (secret store).
4. Apple: Services ID with Sign in with Apple, domain verification for the origin, return URL `https://<origin>/auth/callback/apple`;
   set `FLOFI_APPLE_CLIENT_ID` (the Services ID). No Apple private key is needed.
5. Turnkey: parent organization; an API key pair (P-256) for the parent with the minimum permissions required to create
   sub-organizations, run email OTP / OTP login / OAuth login and read sub-organization wallets; email OTP enabled with FloFi branding;
   any OIDC issuer/audience allowlisting Turnkey requires for Google and Apple tokens. Set `FLOFI_TURNKEY_ORGANIZATION_ID`,
   `FLOFI_TURNKEY_API_PUBLIC_KEY`, `FLOFI_TURNKEY_API_PRIVATE_KEY` (secret store). Optional overrides must stay on `*.turnkey.com`.
6. Verify on a non-production Turnkey organization with disposable identities: sign-in (all three), create EVM + Solana, import with a
   disposable test key, export (phrase and key), session expiry, re-authentication, and that the parent key cannot export or sign.
7. Confirm pricing/limits with Turnkey; confirm privacy-policy text for Google/Apple/email data (email address and OIDC subject are stored).

## 12. Verified vs unverified

| Capability | Status |
| --- | --- |
| Account store, sessions, revocation, isolation, identity uniqueness | **Verified** (unit + real PostgreSQL 16 + browser) |
| OIDC verification logic (RS256/JWKS, claims, nonce, PKCE, state, form_post) | **Verified** against test keys and the loopback IdP |
| Web3 Wallet sign-in (real EIP-4361 signature by a disposable in-memory test wallet) | **Verified** in the browser on loopback |
| Turnkey request stamping (format equals the vendor's Node stamper; verified with `node:crypto`) | **Verified** offline |
| UI flows, routing, PT/EN, light/dark, desktop/mobile, reduced motion, keyboard basics | **Verified** in the browser on loopback |
| Live Google sign-in, live Apple sign-in | **Unverified** — needs client registration and a real browser round trip |
| Live Turnkey email OTP, sub-organization creation, OAuth/OTP login, create, import iframe, export iframe | **Unverified** — needs a Turnkey test organization; shapes from `@turnkey/http@6.7.0` declarations |
| Turnkey security properties (parent key cannot sign/export; session binding) | **Unverified** in this build — vendor model as documented in its SDK; must be confirmed with Turnkey |
| Live email sign-up | **Blocked** — legacy OTP activities vs `CREATE_SUB_ORGANIZATION_V8` (§15.4) |
| Managed-wallet signing of FloFi workflows | **Not implemented** — blocking dependency, disclosed in the product (§7) |
| Account-page CSP (nonce, provider frames only) | **Verified** in the browser on loopback, including a blocked injected handler |

## 13. Test evidence (first round, `a5fa5c8`; the continuation is §15.6)

Run in this session with the pinned Node 24.21.0 / pnpm 11.22.0 and a disposable loopback PostgreSQL 16:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` (app `next typegen && tsc`) | pass |
| `pnpm lint` (+ the new Playwright config) | pass |
| `pnpm build` | pass |
| `pnpm schemas:check` | pass (11 schema exports) |
| `pnpm check` (typecheck, lint, build, schemas, full unit suite) | pass — 465 files, 5,855 tests, 2 skipped (pre-existing skips) |
| Account unit suites (`src/accounts/*.test.ts`) and i18n catalog | pass |
| PostgreSQL: account suites, all `packages/cloud-runtime/test`, platform/approvals/handoff/state-host, admin rollout, preview migration, schema compatibility | 190 pass, 3 skipped; 1 pre-existing failure (below) |
| Browser: `playwright.auth-wallets.config.ts` (8 journeys, MOCKED loopback providers) | 8/8 pass |
| Existing browser specs touched by the change (landing, docs, beta, earth footer, brand motion, credentials, header, shell, Build entry) under a local app-only config | 77 pass; 14 fail **identically on untouched `origin/main`** under that config (they need the full `playwright.config.ts` harness, e.g. the canonical-workflow probe, which needs Foundry Anvil not present here) |
| `python3 scripts/governance_lite.py` + `test_governance_lite.py` + `test_ci_*.py` | pass |
| `python3 scripts/agent_guard.py check` | pass (163 modules) |
| `python3 scripts/bootstrap-ci.py --verify-dependencies` | pass (271 entries) |
| `pnpm audit --audit-level low` | fails with the **pre-existing** `minimatch` advisory (also on `main`); no new advisory |
| `packages/cloud-runtime/test/forward-compatibility.pg.test.ts` | one pre-existing failure on PostgreSQL 16 (the test encodes PostgreSQL 18 catalog behaviour); same on `main` |
| CircleCI certification, full `playwright.config.ts`, fork suites | **not run** here (no Anvil, no CI) |

Screenshots: [`BUILD-FLOFI-AUTH-WALLETS-001-EVIDENCE/`](BUILD-FLOFI-AUTH-WALLETS-001-EVIDENCE/README.md) (MOCKED provenance).

## 13a. Read-only review summary (advisory)

Three read-only reviewers (security; wallet-execution/workflow integration; data-privacy/frontend) reviewed the first complete
version. Resolved in this build:

- Unlimited email-code guessing and unthrottled code emails → per-challenge attempt budget, per-address and deployment throttles.
- Apple ID-token replay within its lifetime → single-use ID tokens.
- Clickjacking of sign-in/onboarding/Credentials → `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
- Apple *link* flow failing (no Lax cookie on the cross-site POST) → sealed link session re-verified server-side.
- Half-saved state when a wallet belongs to another account → checked before linking; sign-in never moves a wallet record.
- Cancelling the wallet chooser still completing a sign-in/link with an older proof → callers act only on the exact proof outcome.
- Credentials unit tests failing without a wallet selector → proof hooks mount only for a signed-in account.
- Relay hardening: canonical JSON only, same-origin only. Superseded sessions are revoked. Account items hidden in embedded MCP approval.
- Privacy: account deletion, session pruning, a data notice on the sign-in screen, the email address no longer in any cookie.
- Copy/accessibility: no overclaims on the showcase, export buttons explain that the secret is shown in Turnkey's frame for the owner to copy,
  named provider frames, stateful tile labels, a pause control and 24 px targets for the highlights, no raw error text, PT strings added.

Open for owner decision: privacy-policy text for the new data (not edited here — a legal document), pt-BR vs the product's mixed
pt-PT/pt-BR catalog, `__Host-` cookie prefixes (incompatible with loopback HTTP tests), and the follow-ups in §14.

## 14. Follow-ups

Blocking items are in §15.7. Other follow-ups:

- Account-level "sign out everywhere" and identity management UI; discovery of provider wallets created but not saved.
- Remove `'unsafe-eval'` from the account-page CSP: precompile the Ajv validators (`action-registry`, `workflow-contracts`,
  `reference-linter`) or split wallet proof from the workflow engine — which also shrinks the sign-in bundle.
- `__Host-` cookie prefixes once the browser suites run over HTTPS.

## 15. Release-readiness review (continuation on PR #143)

Owner requirement for this review: FloFi is a production application for real end users. Nothing below is presented as live
certification; MOCKED loopback results prove FloFi's own code paths only.

### 15.1 CircleCI on `a5fa5c8` (workflow `2d20e7ad`)

| Job | Result | Cause | New or pre-existing |
| --- | --- | --- | --- |
| `governance` | ✅ | — | — |
| `certification-checks` | ❌ step 108 *Dependency audit* | `pnpm audit --audit-level low`: GHSA-g3hv-75wg-m249 (moderate), `minimatch@10.2.6` < 11.0.1 via `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree` | **Pre-existing**: the same `minimatch@10.2.6` entries are in `main`'s lockfile; the advisory is newer than `main`'s last green run. The job stops at step 108, so its typecheck, lint, schema drift, unit, PostgreSQL and fork steps **did not run in CircleCI** (on this branch or on `main`) |
| `certification-browser-1` | ❌ shard 1, profile `default-product` | 7 × `brand-ux-001.spec.ts` *landing, keyboard navigation and product entry* (320–1440 px): expected `/app` after *Launch Beta FloFi*, received `/login`. Critical tier passed first | **New, caused by this PR** (the landing now opens sign-in). Fail-fast left the rest of shard 1 unrun |
| `certification-browser-2` | ✅ | cloud and journey provenance, execution continuity, workflow/swap acceptance, automations, delegated execution, admin console, CoW, card provider, MCP routes, developer journey, MCP in chat, MCP embedded signing, channel signing, channel approve, approve/authorize journeys, approve workflow run, universal bridge, owner history | MCP, channels, approval and execution unaffected |
| `certification` | not run | depends on the jobs above | — |

**On `1ca90f6`** (workflow `808ced39`, the commit with the `brand-ux-001` fix, before the `minimatch` commit):

| Job | Result |
| --- | --- |
| `governance` | ✅ |
| `certification-checks` | ❌ step 108, the same pre-existing `minimatch` audit finding |
| `certification-browser-1` | ✅ critical tier and all of shard 1 (`default-product` with `brand-ux-001` at seven widths, provenance profiles, Copilot, Solana/Robinhood/Base/Ethereum/Arbitrum authoring, Canvas workflow UX) |
| `certification-browser-2` | ✅ after one rerun. First run: 21 of 22 profiles passed; one test, `universal-bridge.spec.ts:275` (a picker click intercepted by the Canvas navigator), timed out and **passed on the runner's own diagnostic rerun** ("the failure is intermittent; the profile stays FAILED"); fail-fast skipped `owner-history`. This build changes no Canvas, bridge or picker code. Locally `universal-bridge` passed twice (11/11) and `owner-history` once (11/11). Rerun of the failed jobs (workflow `f83ecbf0`): **✅ all 23 shard-2 profiles passed**, including `universal-bridge` and `owner-history` |

### 15.2 CI fixes

1. **`brand-ux-001`** follows the new journey: *Launch Beta FloFi* → `/login` (language kept, no horizontal overflow at every width) →
   *Explore the builder without an account* → `/app`; its other assertions are unchanged. Locally, under the CI profile with the pinned
   Anvil, all seven widths pass.
2. **`minimatch`**: exact overrides in `pnpm-workspace.yaml` move the three ESLint consumers to `minimatch@11.0.3`;
   `minimatch@10.2.6` leaves the lockfile; `pnpm audit --audit-level low` → *No known vulnerabilities found*. The dependency gate follows
   (§10). `--verify-dependencies` now reports exactly two violations — **`Minimum release age failed`** for `minimatch@11.0.3`
   (published 2026-10-28T20:00:34Z) and `@isaacs/nonrecursive-glob-match@1.0.3` (2026-10-28T19:50:48Z). No fixed version is older than
   seven days (11.0.1: 2026-10-27T22:26Z). **No waiver was added.** pnpm 11 enforces the same policy on the lockfile at install time
   (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION: 2 lockfile entries failed verification`, reproduced locally), so with this change every
   CircleCI job stops at *Frozen install* until the packages are seven days old. It is therefore the **last** commit on the branch,
   pushed after the browser jobs certified the commit before it. Either a CI rerun after **2026-11-04T20:01Z** passes with no new
   commit, or the owner approves an exact temporary waiver like the `fast-uri@3.1.9` precedent (`APPROVED_AGE_WAIVERS` in
   `scripts/governance_lite.py`, `minimumReleaseAgeExclude`, the waiver metadata JSON).

### 15.3 Security review: findings and dispositions

| Area | Finding | Disposition |
| --- | --- | --- |
| Turnkey browser session | The IndexedDB P-256 key (non-extractable) is a root-user API key of the person's sub-organization while its session lasts. It can stamp any activity; the relay forwards only create/import/export/get-activity, but a script running on the FloFi origin could obtain stamps and replay them to Turnkey directly. | Session lifetime 3600 s → **900 s** (`MANAGED_SESSION_SECONDS`, unit-tested); strict CSP on the account pages (below). Residual on `/app` → blocker 4 |
| CSP / XSS on account pages | No `script-src` anywhere in the product. | **Implemented**: `/login`, `/onboarding`, `/onboarding/*` get a per-request nonce policy from `src/proxy.ts` (`src/accounts/account-csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-eval'`, `connect-src 'self'`, `frame-src` = only the validated Turnkey iframe origins (`'none'` without a provider), `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`. The global policy is unchanged. Settings → *Sign in* and the docs *Launch* link are now full page loads, so sign-in never inherits another page's policy. Browser-tested: fresh nonce per request, an injected `onerror` handler is blocked (`script-src-attr` violation), all 8 journeys including both provider iframes pass. `'unsafe-eval'` remains because the shared wallet-proof module loads Ajv validators that compile with `new Function` (follow-up, §14) |
| CSP on Export (`/app/credentials`) | Credentials is a client route of the persistent `/app` document; a header on that path would not apply after in-app navigation. | Not changed (would have been misleading). Blocker 4 |
| Google / Apple OIDC | RS256 + JWKS (`kid`, `alg`, `use`), `iss` (Google: both documented forms), `aud`, `azp`, `exp`/`iat` with 120 s skew and 15 min max age, nonce = sha256(browser session key) from a sealed one-time flow cookie, `state`, PKCE S256 (Google), `form_post` (Apple), single-use ID tokens (digest table). Linking needs a live session, never merges or moves an identity. | Matches Google's live discovery (§15.4). Apple unverified live |
| Email OTP abuse | 5 attempts per code, 5 codes per address per hour, 300 per 10 min per deployment; code never stored by FloFi. | Unchanged. **Live sign-up blocked** by the legacy activity versions (§15.4, blocker 3) |
| Recovery and revocation | Server-side session rows checked on every request; sign-out revokes; a new sign-in supersedes; deletion revokes all; 12 h lifetime; 10 min re-auth for export/deletion. | No "sign out everywhere" list yet: a stolen cookie lives ≤ 12 h unless that device signs out or the account is deleted (follow-up) |
| Import / export isolation | Key entry and secret display only in Turnkey's frames on other origins; no FloFi key field; export needs confirmation, a sign-in from the last 10 minutes and wallet ownership; no clipboard or storage writes (browser-tested). | Unchanged; frames now also limited by `frame-src` on onboarding |
| Tenant / cross-account | Every statement tenant- and account-scoped; PostgreSQL and browser cross-account tests. | Unchanged |
| Migration 0018 | Additive and atomic; the Railway API pre-deploy is the only production path that applies it. | Release plan: [`RELEASE-AUTH-WALLETS-0018.md`](../deploy/RELEASE-AUTH-WALLETS-0018.md); blocker 6 |
| Product honesty | Managed wallets could read as ready for FloFi execution. | Notices on onboarding, the introduction and every managed card (§7), browser-asserted |
| Fail closed when unconfigured | Server: `oidcConfig`/`turnkeyConfig` return null on any missing or malformed setting; test seams refused on hosted deployments. UI: new `sign-in.test.tsx` renders each combination — every unavailable method disabled with its reason, *Continue to FloFi* and *Explore the builder* kept, no data notice without accounts. | Covered by unit tests |

### 15.4 Vendor documentation evidence

| Vendor | Source available here | Result |
| --- | --- | --- |
| Google | `https://accounts.google.com/.well-known/openid-configuration`, fetched 2026-10-31: issuer `https://accounts.google.com`, authorize `/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, JWKS `https://www.googleapis.com/oauth2/v3/certs`, `RS256`, PKCE `S256`, response modes `query`/`form_post`, claims include `email_verified` | **Matches** `src/accounts/oidc.ts` |
| Apple | `appleid.apple.com` and Apple's developer docs are refused by this session's egress policy | Endpoints (`/auth/authorize`, `/auth/keys`), issuer `https://appleid.apple.com`, `form_post` and a string-valued `email_verified` were taken from search results quoting Apple's documentation; Apple's own pages could not be loaded — **unverified** |
| Turnkey | `docs.turnkey.com` does not resolve in this session. Evidence: the published npm sources (`@turnkey/http@6.7.0` activity declarations; `@turnkey/core` and `@turnkey/crypto` for the encrypted OTP flow and client-signature messages) and the *Migrate to encrypted OTP flows* guide as indexed by search | **Discrepancy**: the guide marks `INIT_OTP`/`VERIFY_OTP`/`OTP_LOGIN` as deprecated, says **version 8 and later activities do not accept legacy OTP verification tokens**, and forbids mixing flows. FloFi passes a `VERIFY_OTP` token to `CREATE_SUB_ORGANIZATION_V8`, so first-time email sign-up will be refused live (fail closed, no false success). Fix: `INIT_OTP_V3` → browser-side `encryptOtpCodeToBundle` (HPKE to the enclave target, signature checked against Turnkey's production signer) → `VERIFY_OTP_V2` → client-signed `CREATE_SUB_ORGANIZATION_V8` (`USAGE_TYPE_SIGNUP`) / `OTP_LOGIN_V2` (`USAGE_TYPE_LOGIN`) signed by the IndexedDB key. It needs `@turnkey/crypto` (+25 lockfile packages, including `tslib@1.14.1` under 0BSD, outside the licence allowlist) — an owner dependency/licence decision, not taken here |

To confirm the unverified rows, allow `docs.turnkey.com`, `appleid.apple.com` and `developer.apple.com` in the session's network settings
or review them on an owner machine.

### 15.5 Exact production configuration (names only; values belong in the deployment secret manager)

| Setting | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Vercel + Railway (exists) | Accounts exist wherever it is set; with it, Web3 Wallet sign-in is live |
| `FLOFI_PUBLIC_ORIGIN` = `https://flofi.xyz` | Vercel | OIDC redirect URIs `https://flofi.xyz/auth/callback/google` and `/apple`; session cookie domain |
| `FLOFI_SESSION_SECRET` (≥ 32 random bytes; else `API_AUTH_TOKEN`) | Vercel | Seals account and flow cookies (HKDF) |
| `FLOFI_GOOGLE_CLIENT_ID`, `FLOFI_GOOGLE_CLIENT_SECRET` | Vercel (secret) | Google OAuth Web client; redirect URI above; scopes `openid email` |
| `FLOFI_APPLE_CLIENT_ID` (Services ID) | Vercel | Sign in with Apple, domain `flofi.xyz` verified, return URL above; no Apple private key |
| `FLOFI_TURNKEY_ORGANIZATION_ID`, `FLOFI_TURNKEY_API_PUBLIC_KEY`, `FLOFI_TURNKEY_API_PRIVATE_KEY` | Vercel (secret) | Parent organization and a least-privilege P-256 API key; email OTP enabled and branded; Google/Apple issuers accepted for OAuth login |
| `FLOFI_TURNKEY_API_BASE_URL`, `FLOFI_TURNKEY_EXPORT_IFRAME_URL`, `FLOFI_TURNKEY_IMPORT_IFRAME_URL` | optional | Must stay on `https://*.turnkey.com` (anything else disables the provider) |
| `FLOFI_AUTH_E2E_IDP`, `FLOFI_AUTH_E2E_IDP_ORIGIN`, `FLOFI_TURNKEY_E2E` | **never in production** | Test seams; refused on hosted deployments regardless |

### 15.6 Test evidence for this continuation (pinned Node 24.21.0, pnpm 11.22.0)

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, 11 schema exports, full unit suite) | pass — 467 files, 5,863 tests, 2 pre-existing skips |
| New/changed unit suites: `account-csp.test.ts` (policy, nonce, frames, scope, proxy matcher), `sign-in.test.tsx` (every availability combination), `turnkey-server.test.ts` (900 s session) | pass |
| PostgreSQL 16 loopback: accounts, all `packages/cloud-runtime/test`, platform, admin rollout, preview migration, schema compatibility | 194 pass, 3 skipped; 1 **pre-existing** failure: `forward-compatibility.pg.test.ts` encodes PostgreSQL 18 catalog behaviour (CI runs 18.6); it fails the same way on `main` here |
| Browser `playwright.auth-wallets.config.ts` with the account CSP active | 8/8 pass; new assertions: per-request nonce, an injected inline handler blocked (`script-src-attr`), `frame-src` = the provider frame origins, the managed-wallet signing notices (and none on an external wallet) |
| CI profile `default-product` run locally (`guarded-release-browser.mjs profile default-product`, pinned Anvil 1.8.3 verified by its bootstrap; the pre-installed headless shell 1243, **not** hash-verified here) | 112 pass, including `brand-ux-001` at all seven widths and `credentials`, `beta-ui`, `ux-ui-002-landing`, `build-entry`; **9 fail identically on untouched `origin/main` in this container** (7 screenshot baselines in `visual-shell`/`base-observation`/`mock-artifact-chain`/`swap-authoring`, 2 `build009` region lookups). All 9 passed in CircleCI on `a5fa5c8`: local environment, not this change |
| `governance_lite.py`, `test_governance_lite.py` (19), `test_ci_*.py` (108), `agent_guard.py check` (163 modules) | pass |
| Dependency gate with the `minimatch` change (§15.2) | `pnpm audit --audit-level low`: no known vulnerabilities; `--verify-dependencies`: exactly 2 violations, both *Minimum release age failed*; frozen install: `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (same two entries) |
| Live Google, Apple, Turnkey | **not run** — no credentials; `docs.turnkey.com` and `appleid.apple.com` are outside this session's network |

### 15.7 Merge and release blockers

1. **CI green on the final commit**: `certification-checks` passes only after 2026-11-04T20:01Z (release age) or an owner-approved
   waiver; its later steps (typecheck, lint, unit, PostgreSQL, fork) have not yet run in CircleCI. Browser jobs must pass in full.
2. **Managed-wallet signing adapter** (owner requirement 6): managed wallets cannot sign FloFi workflows. A reviewed adapter must keep
   Review → Strategy Manifest → explicit confirmation, with a Turnkey policy that limits the browser session to signing what was reviewed.
   Until then managed wallets are disclosed as unable to sign; onboarding is **not** production-ready for that capability.
3. **Email sign-up**: migrate to the encrypted OTP flow (§15.4); needs the owner's dependency/licence decision on `@turnkey/crypto`.
4. **Export under XSS**: give `/app` a strict nonce `script-src` (product-wide browser certification), or move the provider session key,
   create/import/export to a dedicated wallet origin; consider a Turnkey policy that requires FloFi's co-approval for export activities.
5. **Live provider verification** on a non-production deployment with a dedicated database and a Turnkey **test** organization:
   Google, Apple, email, Web3 Wallet; create/import/export EVM and Solana with disposable identities; session expiry; the parent key
   cannot sign or export (§11.6).
6. **Migration release order**: Release A (certificate only) on every version-17 database consumer before #143 reaches any branch that
   deploys production; then the Railway API (migration), workers, Vercel last
   ([`RELEASE-AUTH-WALLETS-0018.md`](../deploy/RELEASE-AUTH-WALLETS-0018.md)).
7. **Privacy policy** text for email addresses, OIDC subjects, wallet addresses and Turnkey as processor (owner/legal).

**Assessment: NO-GO** for merge and release until 1–7 are closed. Nothing in this build was merged, deployed, configured in
production, or executed with real funds or real identities.

## 16. Third round (2026-10-31): owner overrides, encrypted email codes, FloFi Wallet, managed signing

Owner direction for this round:
- a working end-user product, with no production mocks, owner-only flows or artificial restrictions;
- no waiting for the 7-day dependency age: resolve it with narrow, documented exceptions;
- implement encrypted email OTP;
- implement managed-wallet signing for EVM and Solana, with explicit review and confirmation;
- resolve the export security boundary without weakening the site-wide CSP;
- arrange live verification;
- respect the 0018 release order;
- do not merge, deploy or change production configuration.

### 16.1 Dependency release age (owner override)
- **Exact owner-approved waivers.** `minimatch@11.0.3` and `@isaacs/nonrecursive-glob-match@1.0.3`, for GHSA-g3hv-75wg-m249.
  - `fast-uri@3.1.9` and `source-map-js@1.2.2` are kept unchanged.
  - `minimumReleaseAge` stays 10080 and is enforced by pnpm and by `--verify-dependencies`.
- **Policy:** [`docs/security/DEPENDENCY-AGE-POLICY.md`](../security/DEPENDENCY-AGE-POLICY.md).
  - Two categories are allowed: `security-fix` and `reviewed-dependency`.
  - Each waiver has a mandatory schema: GHSA ids, the tarball integrity, the registry publication time, `eligible_at` exactly 7 days
    later, the owner approval and a review document.
  - `--verify-dependencies` binds each waiver to the lockfile integrity and the registry publication time, and reports waivers that are
    past eligibility.
  - `governance_lite` refuses ranges, globs, scoped globs and missing fields.
- **Supply-chain review.** Both tarballs are published by `isaacs`, carry the npm registry signature and have no install scripts. Neither
  does network, filesystem or `eval` access. Their SHA-512 equals the lockfile.
- **`@turnkey/crypto@2.13.3`** for encrypted OTP (+23 registry packages, 272 → 295).
  - All 23 are older than 7 days, so no age waiver was needed. `pnpm audit` finds no advisories.
  - None of the 23 has install scripts or uses `eval`/`new Function`, so it runs under the wallet page's no-eval CSP.
  - The single licence exception is `tslib@1.14.1`, under 0BSD (OSI-approved, public-domain-equivalent). It is an exact identity
    reached only through `tsyringe` → `@peculiar/x509` → `@turnkey/crypto`.
  - The existing `tslib@2.8.1` exception is unchanged, and the allowlist is not widened.
  - Re-implementing Turnkey's HPKE with the already-locked `@noble` packages was rejected because it would be custom cryptography.

### 16.2 Encrypted email codes (Turnkey INIT_OTP_V3 / VERIFY_OTP_V2 / OTP_LOGIN_V2 / CREATE_SUB_ORGANIZATION_V8)
- **The code never reaches FloFi's server.** The browser verifies the enclave signature on the target (`@turnkey/crypto`, pinned
  production key), then HPKE-encrypts `{code, public_key}`.
- **FloFi checks the provider-signed token.** `verifyOtpVerificationToken` (ES256) runs, then the token must name this address and this
  browser key, must not have expired and is used once (`flofi_account_used_proofs`).
- **The deprecated flow is removed.** INIT_OTP_V2, VERIFY_OTP with a plaintext code and OTP_LOGIN v1 no longer exist.
- **Client signatures** are built exactly as `@turnkey/core` 2.13 builds them (login and signup messages, raw P-256), always by the key
  bound in the token. The server verifies the signature before any provider call.
- **Sign-in vs unlock.**
  - Sign-in on `/login` uses a per-attempt, in-memory, non-extractable key, and opens **no** provider session.
  - FloFi Wallet unlock codes are separate challenges (`wallet-unlock:` key) with their own budget of 5 per hour and a distinct shape
    (appName "FloFi Wallet", 8 letters and digits). A sign-in code can never unlock FloFi Wallet, and an unlock code never signs anyone in.

### 16.3 Export and signing boundary: FloFi Wallet on its own origin
**The vulnerability.** Until this round, sign-in opened a Turnkey session (sole root user of the person's sub-organization) for a P-256
key held in the **product origin's** IndexedDB.
- `/app` has no `script-src`, so any script injected there could use that key to stamp `EXPORT_WALLET` with its own target or
  `SIGN_TRANSACTION`.
- It could exfiltrate the stamp through an image URL and replay it at `api.turnkey.com`, bypassing every FloFi check.
- Root users bypass Turnkey policies.

**Design and reviews.** Design and two adversarial reviews (security, feasibility):
- design: `scratchpad/design/wso-design.md`;
- reviews: `review-security.md` and `review-feasibility.md`, both "sound with changes";
- every finding is either applied or listed in §16.6.

**What changed:**
- **No provider session ever exists on the product origin.**
  - `/login` encrypts codes with a throwaway key and opens no session.
  - The product-origin relay (`/api/account/provider/*`) and `turnkey-browser.ts` are deleted.
  - Account pages now frame nothing (`frame-src 'none'`).
- **FloFi Wallet (`FLOFI_WALLET_ORIGIN`; production pinned to `https://wallet.flofi.xyz`)** is the same deployment on another host.
  - `src/proxy.ts` serves there only `/wallet*`, `/api/wallet/*` and static assets, and refuses every server action.
  - Wallet paths are 404 on the product host.
  - Wallet pages get a per-request nonce CSP **without `'unsafe-eval'`**, `connect-src 'self'`, frames limited to Turnkey's
    import/export iframes, `frame-ancestors 'none'`, and `nosniff` everywhere.
  - An import-closure test keeps the workflow engine (Ajv) out of the wallet bundle.
- **Account binding.**
  - The product page opens the popup inside the click and sends a single-use, 120 s, sealed handoff by `postMessage` (never in the URL).
    The wallet page accepts it only from its opener's exact origin.
  - The wallet session cookie is HttpOnly, `__Host-` on https, Lax and bound to the account session; signing out ends it.
  - Every wallet route requires the Host, `Sec-Fetch-Site: same-origin` and the exact Origin. A request carrying two wallet cookies is
    refused (cookie tossing from the sibling host).
- **Unlock** is always performed by the person, for a key only the wallet origin holds:
  - email code to the account's own address;
  - or Google/Apple through **FloFi Wallet's own OIDC clients**, whose audience separates them from sign-in tokens, for the same identity
    linked to the account.
  - The first unlock creates the sub-organization only from the account's **primary** identity.
  - `invalidateExisting` ends previous provider sessions, and the provider session lasts 30 minutes.
- **Export** happens only in FloFi Wallet: an unlock in the last 5 minutes, explicit confirmation there, and the secret shown only in
  Turnkey's frame.
- **Wallet relay** (`src/accounts/wallet-relay.ts`, defence in depth behind the person's confirmation):
  - The stamp key must equal the unlocked key, with canonical JSON and the account's organization.
  - Allowlist: create, import, export (fresh unlock + owned resource), `SIGN_TRANSACTION_V2` (EVM type 2 only, a managed signer of this
    account) and `SIGN_RAW_PAYLOAD_V2`.
  - Raw payloads are limited to FloFi's own SIWE/SIWS messages for the product host (EVM: EIP-191 bytes hashed by Turnkey with
    keccak256, never a pre-hashed digest) or a Solana v0 message whose fee payer is the managed wallet.
  - Never relayed: `eth_send_*`/`sol_send_*`, policies, users or API keys.

### 16.4 Managed signing (EVM and Solana), bound to the reviewed FloFi attempt
A product page can be compromised (no `script-src` on `/app`), so FloFi Wallet never signs bytes on its word.
- **Binding.** Every signing request carries `{flow, runId}`. FloFi Wallet's server (`/api/wallet/sign-context`) loads that run through
  the flow's own service (`app/flofi-wallet-signing.ts`). `server/managed-signing.ts` then accepts the bytes only when all of these hold:
  - the flow is one FloFi can bind;
  - the run is pending and authorized for its current Review;
  - its attempt is PREPARED (or SUBMITTING after the durable handoff), with no signature or hash recorded yet;
  - the owner is a managed wallet saved to this account;
  - the bytes are exactly the attempt's:
    - Solana: the reviewed v0 message;
    - EVM: chain, from, to, value, data and gas, plus the nonce and fees wherever the attempt binds them.

  The summary FloFi Wallet shows ("Exactly the transaction FloFi prepared for this strategy": amounts, minimum received, recipient, fees, expiry) comes from
  the server's Review only, never from the request.
- **One signature, one broadcast.**
  - The relay re-resolves the same binding (`x-flofi-signing`) right before forwarding and claims the attempt's single signature
    (`flofi_account_used_proofs`).
  - For EVM, FloFi broadcasts the signed bytes itself (`floFiEvmBroadcast`), and only after these steps: decode them, recover the sender,
    re-match every field to the attempt, and claim the attempt's single broadcast. An unclear send is decided with
    `eth_getTransactionByHash`; any doubt is UNKNOWN.
- **Fields FloFi Wallet fills (catalog EVM swaps only).**
  - The nonce must be the owner's pending nonce.
  - The fee cap must stay within 4× the network's current fees (`FILLED_FEE_BOUND`).
  - So two different signatures for one attempt cannot both be valid.
- **Scope.**
  - **Supported (mainnet only, see §16.11):** `jupiter-swap`, `solana-transfer`, `robinhood-`/`base-`/
    `arbitrum-`/`ethereum-mainnet-transfer`, and `robinhood-`/`base-`/`arbitrum-`/`ethereum-swap`.
  - **Refused by name** (`FLOFI_WALLET_FLOW_NOT_SUPPORTED`, which tells the person to use MetaMask, Phantom or Solflare): every other flow,
    including the EVM testnet flows. FloFi Wallet's EVM provider exposes only the four catalog mainnets.
  - **Rejected formats:** legacy `gasPrice` and any non-EIP-1559 transaction.
- **Confirmation in FloFi Wallet.**
  - The window shows the server summary next to its own decoding:
    - EVM: chain, from, to, value, function selector, decoded ERC-20 transfer/approve, nonce, gas, maximum total cost;
    - Solana: fee payer, programs, decoded System/SPL transfers and approvals, message hash.
  - Sign arms only after the request has been on screen in a focused window for a full second, and disarms on blur
    (`wallet-app/arming.ts`).
  - The provider's result is checked against the request before it is used:
    - EVM: the same transaction;
    - Solana: the same message, with the signature in slot 0.
- **Failure classes** (`wallet/flofi-signing.ts`):
  - Cancel before Sign is the only `4001`.
  - Refusals proven to happen before any signing activity are `4100`.
  - Everything else is UNKNOWN and is reconciled, never retried as "nothing signed". That includes a closed window, a provider error after
    submission, and a second request for an attempt that was already signed (`FLOFI_WALLET_ALREADY_SIGNED`, reclassified in this round).
- **Product side.**
  - Each managed address is one wallet entry: an EIP-1193 provider per EVM address, registered directly (never announced), and a Wallet
    Standard wallet per Solana address.
  - These entries are not offered inside frames or embedded hosts.
  - Authorize opens FloFi Wallet inside the click and starts only once FloFi Wallet reports itself unlocked, so a short Review cannot expire
    during an unlock.
  - Each store binds its single signature call to its run (`bindFloFiSigning`), which has no effect on any other wallet. MetaMask, Phantom
    and Solflare paths are unchanged.

### 16.5 Accounts UI matches the real capability
- **Onboarding** (`/onboarding/wallets`):
  - It says wallets open in FloFi Wallet, a separate secure window where the person unlocks and confirms every signature.
  - Its buttons are enabled only after the page has learned FloFi Wallet's origin from the server, because the window must open inside the
    click.
  - It says so when this deployment has no FloFi Wallet ("isn't available on this deployment yet"), or when the account signed in with a
    wallet only.
- **Credentials → My wallets:** each managed wallet says "Signs in FloFi Wallet, after you review the transaction in FloFi."
  - Export opens FloFi Wallet. Nothing secret is shown on the product page, and imported keys never offer a recovery phrase.
  - External wallets never offer export.
- **No mock behind production paths.** The emulator, its OTP signer key and the MOCKED IdP exist only under the `*_E2E=MOCKED_LOOPBACK_ONLY`
  gates, which hosted deployments refuse.

### 16.6 CI failure investigated: `universal-bridge.spec.ts:275` (pre-existing UI defect, fixed)
- **Symptom.** CircleCI browser job 2 failed twice on this branch (`1ca90f6`, `fe4b26f`): the canvas zoom slider intercepted the click on
  the destination picker's WETH option. A rerun on `fe4b26f` passed, as did 5/5 local runs and main's recent runs.
- **Root cause.** I measured it at 1440×900:
  - the open picker's last option ended **6 px** above the floating canvas navigator;
  - the picker's height depends on an asynchronous status line ("Arbitrum tokens are unavailable right now" + Try again).
  - The insertion fit keeps cards clear of that band only when a card is inserted.
  - So with other font metrics or timing, the option slid under the navigator, for a real person as much as for the test.
- **Fix** (`components/canvas-panel-reveal.tsx`): when a composer side panel opens, resizes or finishes animating, the canvas pans up just
  enough to lift the card and its panel above the bottom margin and any overlapping bottom control.
  - It never zooms and never pushes the card above the top margin.
  - Measured clearance is now 64 px.
  - Ten canvas-heavy browser profiles pass. `default-product`'s 9 local failures are identical on main in this container
    (environment-specific baselines; they pass in CI).

### 16.7 Independent adversarial review of the integrated code
- **Method.** Six lenses (signing binding, origin and sessions, unlock and authentication, what the person sees, product integration,
  export). Every finding was checked by two independent skeptics.
- **Result.** 19 findings: 17 confirmed (none critical or high), 2 refuted. No path was found to a signature or an export without the
  person's confirmation in FloFi Wallet.
- **All 17 confirmed findings are fixed** (commit "FloFi Wallet: fixes from the adversarial review"):
  - **Catalog swap store.** A refusal FloFi Wallet proves happened before any signature (`4100` with a pre-signature code, for example a
    Review that expired during the unlock) is now REJECTED, with FloFi Wallet's message. Before, it was UNKNOWN, which locked the run and,
    on Arbitrum and Ethereum, the reserved nonce.
  - **Relay.** An attempt's single-signature claim is given back only when the provider created no activity (`400`/`401`/`403` to the
    submit). Before, a provider auth refusal became a false "already signed".
  - **Broadcast.** The nonce and fees that FloFi Wallet filled are not re-derived from a newer network read: they were bounded when the
    signature was granted. All bound fields, the sender and the expiry are still checked.
  - **FloFi Wallet root.** Only the identity the account was created with (Google, Apple or email) can create the provider organization,
    never a sign-in linked later on the product origin. This includes accounts first created with a Web3 wallet (PostgreSQL test).
  - **Sessions.**
    - An open FloFi Wallet window that lost its session asks for a new handoff, and a click on a locked or unbound window binds it again.
    - Tokens decode canonically, and a handoff is single-use per verified nonce (one handoff could be redeemed under several spellings).
  - **Host routing.** The wallet host never serves the product, even with an invalid `FLOFI_WALLET_ORIGIN`.
  - **Unlock and sign-in.**
    - A Google/Apple unlock waits for a new unlock of the window's own key.
    - A sign-in address cannot contain `:`, so it can never name a wallet-unlock budget key.
  - **Honest display.**
    - The summary says "Exactly the transaction FloFi prepared for this strategy". The server proves FloFi built those bytes, not who
      reviewed them, so the person checks every line there.
    - Base fees are labelled "before the L1 data fee".
    - Solana compute limits decode unsigned, with the runtime's 1.4M clamp.
    - Sign is not offered, and no success is announced, once the requesting FloFi page has been closed.
    - An expiring sign-in request stays answerable.
  - **Selector.** Each FloFi Wallet EVM address has its own key, so a saved second address reconnects that address.
- **Refuted.**
  - A claimed gap between the broadcast record and the attempt: FloFi's existing observation reconciles by nonce and hash.
  - A claim about FloFi Wallet behaviour that MetaMask, Phantom and Solflare share.
- **Noted, not changed.** A run that cannot be loaded at all, including an unknown run id, is "Review unavailable" (`503`, fail closed),
  not "no matching review". Run ids are 128-bit random.

### 16.8 Test evidence (pinned Node 24.21.0, pnpm 11.22.0)
| Check | Result |
| --- | --- |
| `tsc` (app), ESLint (repo `pnpm lint`) | clean |
| Unit (app + backend, CI exclusions) | 373 files / 4,767 tests pass, 2 skipped (on `34790730`); affected areas re-run after the review fixes: 4,799 pass (the only failures are `*.live`/`*.remote` tests, which need public networks and are excluded in CI) |
| PostgreSQL (accounts) | 59 / 59 (account service, store, FloFi Wallet service: replay, rate limits, cross-account, identity mismatch, wallet-first root) |
| `auth-wallets` browser profile (MOCKED loopback, new in the guarded CI plan) | **13 / 13** locally via `guarded-release-browser.mjs` after the mainnet-only change (details below) |
| Canvas-heavy profiles after the canvas fix | universal-bridge 11, canvas-corrections 6, canvas-workflow-ux 8, workflow-ux-authoring 11, base/robinhood/arbitrum/ethereum authoring 4/4/18/18, canvas-automation-ux 18: all pass. `default-product` 112 pass, with 9 failures identical on main in this container (environment-specific baselines). |
| `governance_lite` + 21 tests, `test_ci_*` (109), `agent_guard check` | pass |
| CircleCI `34790730` (workflow `a129af2e`) | governance, certification-checks, browser-1, browser-2 (incl. `auth-wallets`), certification: **all succeeded on the first run** |
| Vercel Preview `34790730` | READY (`dpl_HKDYRazp2pa2mZj7gDfj6wo4cCJM`); not production |

The 13 `auth-wallets` journeys cover:
- sign-in (Apple, Google, encrypted email, Web3 wallet), cancellation and tampered state;
- FloFi Wallet on its own origin:
  - unlock with Google, through its own client;
  - unlock with the 8-character email code, where a sign-in code is refused;
  - create EVM and Solana wallets, import in the provider frame, export only after a fresh unlock and the acknowledgement;
  - Lock, and the host and CSP isolation;
- **signing, on mainnet-shaped transactions only** (MOCKED loopback harnesses, MOCKED evidence class; §16.11):
  - **Solana (`jupiter-swap`, Jupiter mainnet harness).** The UI authors a 10 USDC → SOL swap and connects the "FloFi Wallet" Solana
    entry. FloFi Wallet names the run, shows FloFi's own Review values (amounts, minimum received, slippage, fee, provider, fee payer)
    and arms Sign only in a focused window. One `sign_raw_payload` is relayed with the binding; the signature is in slot 0 and every
    other byte is unchanged. FloFi then submits and reconciles the swap (RECONCILED/CONFIRMED).
  - **Solana refusals.** One changed blockhash byte, a missing binding, and the same bytes and binding on `solana:devnet` are all
    refused. Nothing reaches the provider and the attempt stays PREPARED.
  - **EVM (`base-mainnet-transfer`, Base mainnet harness chain).** A 0.001 ETH transfer from the account's generated wallet. A copy on
    Base Sepolia (84532) is refused with `FLOFI_WALLET_NETWORK_UNSUPPORTED` before anything reaches FloFi Wallet's server or the
    provider. FloFi Wallet shows FloFi's Review next to its own decoding (Base 8453, from, to, value, nonce, gas, fees, maximum cost
    before the L1 data fee). One `sign_transaction` is relayed with the binding, and the signed bytes decode to the same fields.
  - **EVM broadcast and reconciliation.** FloFi broadcasts as `floFiEvmBroadcast` does: a single broadcast claim (a second is refused),
    and the `managed-wallet-evm` broadcast on the harness chain under the real hash. FloFi then reconciles after two confirmations.
    The browser cannot call the server action directly, so the test composes these same steps in its process;
- the database scan for secret-shaped values.

### 16.9 What is not proven, and what the owner must provide
- **No live provider has been exercised.** Google, Apple and Turnkey ran only through the MOCKED loopback emulator, which verifies FloFi's
  own checks (HPKE, ES256 tokens, client signatures, stamps, disposable keys).
  - [`LIVE-VERIFICATION-AUTH-WALLETS.md`](../deploy/LIVE-VERIFICATION-AUTH-WALLETS.md) is the isolated non-production runbook. **It has not
    been run.**
  - The Turnkey behaviours it lists remain unverified: single-use tokens, `invalidateExisting`, root users and policies, and the contact
    check in `OTP_LOGIN_V2`.
- **The product's Authorize → FloFi Wallet path for a MOCKED run is not driven by a browser.**
  - By existing policy, a MOCKED simulation cannot authorize in the UI.
  - The browser journey therefore accepts the Review through FloFi's own service. It then exercises FloFi Wallet, its server binding, the
    relay, the provider signature, submission and reconciliation.
  - The product side is covered by unit tests: the providers, the channel, the stores' binding and the error classes.
- **Live signing (EVM and Solana).** FloFi Wallet signs on mainnet only (§16.11). A live check in either ecosystem would move real funds,
  so it needs the owner's explicit decision.
- **Owner provisioning.** None of the following is done by this PR:
  - Production: `wallet.flofi.xyz` added to the same Vercel project (DNS and domain), and FloFi Wallet's own Google client and Apple
    Services ID.
  - The live run: a Turnkey **test** organization, a Preview-only wallet host and test OAuth clients.
- **Release order.** Release A must come before migration 0018
  ([`RELEASE-AUTH-WALLETS-0018.md`](../deploy/RELEASE-AUTH-WALLETS-0018.md)).

### 16.10 GO / NO-GO
- **Code: ready for owner review.** It implements the requested scope:
  - encrypted email OTP compatible with `CREATE_SUB_ORGANIZATION_V8`;
  - FloFi Wallet on its own origin, with create, import and export;
  - EVM and Solana signing on mainnet only, bound to reviewed FloFi attempts, with the person's confirmation in FloFi Wallet;
  - accurate account UI, a fixed CI root cause, and the dependency policy.
- **Merge or production: NO-GO** until all of the following hold:
  1. Release A is deployed and verified, then 0018 is applied in order.
  2. The live verification runbook passes on an isolated Preview with disposable identities. At minimum:
     - Google, Apple and email sign-in;
     - FloFi Wallet unlock, create, import and export.

     Its unverified Turnkey facts must be recorded. FloFi Wallet signs on mainnet only (§16.11), so any live signature moves real
     funds. It is a trivial-amount check per ecosystem, run only on the owner's explicit decision. Until then, it is recorded as
     **not verified live**.
  3. The owner provisions the wallet domain and FloFi Wallet's OIDC clients.
  4. CI is green on the final head.

  Until then, managed wallets stay off wherever `FLOFI_WALLET_ORIGIN` or the Turnkey settings are absent, and the product says so.

### 16.11 Final owner requirement: FloFi Wallet is mainnet only (EVM and Solana)
FloFi is a mainnet product. FloFi Wallet now signs only on **Ethereum (1), Base (8453), Arbitrum One (42161) and Robinhood Chain
mainnet (4663)**, and on **Solana mainnet**. `FLOFI_WALLET_EVM_CHAIN_IDS` and `FLOFI_WALLET_SOLANA_CHAIN` (`wallet/flofi-signing.ts`) are
the single source of truth. Every other wallet (MetaMask, Phantom, Solflare) and every mainnet workflow, token, bridge and swap is
unchanged.
- **Removed from FloFi Wallet.**
  - The `solana-devnet-swap` and `solana-devnet-transfer` signing flows. They are now refused by name (`FLOFI_WALLET_FLOW_NOT_SUPPORTED`).
  - Their run loaders on the sign-context server.
  - `solana:devnet` from the chains the product's FloFi Wallet entry advertises.
  - Devnet wording in FloFi Wallet's window.
- **Refused at every signing boundary** with `FLOFI_WALLET_NETWORK_UNSUPPORTED`, before anything reaches the provider:
  - **Product page, Solana.** The FloFi Wallet entry refuses `solana:devnet` and `solana:testnet` before it asks FloFi Wallet anything.
  - **Product page, EVM.** The provider exposes only the four mainnets. Switching to any other chain returns `4902`, and
    `wallet_addEthereumChain` is refused.
  - **FloFi Wallet's window.** Its protocol parses Solana requests for `solana:mainnet` only. An EVM sign-in message must name one of the
    four mainnet chain ids.
  - **Sign-context server.**
    - Jupiter swaps: the resolver binds only the mainnet review format (`gryloo.jupiter-review.v1`, cluster `mainnet-beta`).
    - Solana transfers: it binds only mainnet transfers.
    - A Devnet record never matches, even behind a mainnet flow name.
    - The request parser accepts `solana:mainnet` only.
  - **Relay.**
    - An EVM transaction on any other chain id gets `403`. That happens before the reviewed attempt is looked up, so no signature claim is
      consumed.
    - An EVM sign-in message on a testnet chain is refused.
  - **EVM reads and broadcast** (`managed-wallet-evm`): these resolve only the four catalog mainnets.
- **Tests stay offline and deterministic.**
  - The unit tests use mainnet-shaped transactions with mocked providers. They assert the refusals at every layer above: resolver, relay,
    product wallet, protocol, catalogue and run loader.
  - The browser signing journeys run against MOCKED loopback mainnet harnesses (§16.8).
  - None of this is reachable by an end user: the harnesses and the emulator exist only under the `*_E2E=MOCKED_LOOPBACK_ONLY` gates,
    which hosted deployments refuse.
- **Consequence for live verification.** Any live FloFi Wallet signature now moves real funds. The runbook keeps live signing as a
  trivial-amount check that runs only on the owner's explicit decision. It is never autonomous.
