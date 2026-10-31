# FloFi: release of PR #143 (BUILD-FLOFI-AUTH-WALLETS-001, migration 0018)

Status: preparation only. Nothing here was run against a production or shared database. The owner separately authorizes every
deployment, migration and configuration change below; this document authorizes none of them.

## How 0018 can reach a production database

| Path | Applies migrations? | Evidence |
| --- | --- | --- |
| Railway API deployment | **Yes, before the new API starts.** `preDeployCommand: node apps/reference-dapp/backend/main.ts migrate` | `deploy/railway/api.railway.json` |
| Vercel Production build | No. `deploy/vercel/build.sh` migrates only when `FLOFI_MIGRATE_ON_BUILD=preview` **and** `VERCEL_ENV=preview`; any other combination exits 1 | `deploy/vercel/build.sh` |
| Vercel Preview build | Only with that opt-in, and only on a database no non-Preview deployment writes to (`PREVIEW_DATABASE_NOT_DEDICATED`) | `apps/reference-dapp/backend/preview-migration.ts` |
| Manual `main.ts migrate` | Yes, with the advisory lock and SHA-256 ledger | `packages/cloud-runtime/src/migrations.ts` |

So the first **Railway API deployment of any commit that contains `0018_flofi_accounts.sql`** applies it. Whether merging to `main`
triggers that deployment automatically is a Railway/Vercel project setting that is not in this repository and was not inspected.
**PR #143 must not be merged into a branch that deploys production until Release A below is live on every database consumer.**

Why: the version-17 artifacts in production carry no certificate for 0018. After 0018 is applied, any of them that checks the schema
(cold start, readiness, a restarted worker, a rollback) refuses it with `MIGRATION_HISTORY_MISMATCH`, and none of them can serve as a
rollback target. In the other direction, a Vercel Production build of this PR deployed *before* the migration runs on schema 17 and
refuses it with `SCHEMA_NOT_MIGRATED`.

## Identities

| | Version | Name | SHA-256 |
| --- | --- | --- | --- |
| Base (current `main`) | 17 | `copilot_metrics` | `c20a07de7bb504cbb8d95776796a0e6b412a1130c0539aee3449ceb6f89c45bf` |
| This PR | 18 | `flofi_accounts` | `0919a57a5af80a1376ada213bb00ac5db79c434ab7a9ff0ebea50e6a9664ae75` |

Assessment: [SCHEMA-COMPATIBILITY.md §12](./SCHEMA-COMPATIBILITY.md#12-certificate-0018_flofi_accounts). 0018 is additive (six new
tables, no change to any existing relation, no function or trigger) and atomic.

## Before authorization

1. Confirm production's ledger is exactly versions 1–17 with the shipped SHA-256s (`SELECT version, name, sha256 FROM schema_migrations
   ORDER BY version`, read-only). If production is still at 16, release 0017 first under its own certificate (§11) and do not continue.
2. All CircleCI contexts green on the exact final commit of #143, including the dependency audit (see the build report for the
   `minimatch` release-age gate) and both browser jobs.
3. Live provider verification on a non-production deployment with a dedicated empty database, following
   [LIVE-VERIFICATION-AUTH-WALLETS.md](./LIVE-VERIFICATION-AUTH-WALLETS.md):
   - Google, Apple, email and Web3 Wallet sign-in;
   - FloFi Wallet unlock, create, import and export with a Turnkey **test** organization and disposable identities. FloFi Wallet signs on
     mainnet only (EVM and Solana), so a live signing check moves real funds: a trivial amount, on the owner's explicit decision only.
   The email flow already uses Turnkey's encrypted OTP activities (`INIT_OTP_V3` / `VERIFY_OTP_V2` / `OTP_LOGIN_V2`).

## Release A: certificate only (no migration)

Build from the commit production runs today (version 17), adding only:

1. In `packages/cloud-runtime/src/migrations.ts`, the certificate entry exactly as on this branch:

   ```ts
   { base: { version: 17, name: 'copilot_metrics', sha256: 'c20a07de7bb504cbb8d95776796a0e6b412a1130c0539aee3449ceb6f89c45bf' },
     migrations: [{ version: 18, name: 'flofi_accounts', sha256: '0919a57a5af80a1376ada213bb00ac5db79c434ab7a9ff0ebea50e6a9664ae75' }],
     assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#12-certificate-0018_flofi_accounts' },
   ```

2. `packages/cloud-runtime/test/fixtures/0018_flofi_accounts.sql`: this branch's `packages/cloud-runtime/migrations/0018_flofi_accounts.sql`,
   byte for byte (`sha256sum` must print the value above). Until a certified migration ships, its SQL is a test fixture.
3. `docs/deploy/SCHEMA-COMPATIBILITY.md` §12 from this branch (the certificate's `assessment` anchor must exist).

Run the normal CI on Release A, then deploy it to **every** consumer of the production database: Railway API and worker, every embedded
backend/operator process and the Vercel Production artifact (its BFF reads the same database). Its `migrate` pre-deploy is a no-op
on schema 17. Check `/readyz`, logs (`migrate.applied versions=none schema_version=17`) and normal product reads.

## Release B: this PR

1. **Railway API first.** Deploy #143. Its pre-deploy applies 0018 once, inside one transaction under the migration advisory lock; a
   failure rolls back to 17 and the deployment stops. Verify the ledger (18 rows, the SHA-256 above), `/readyz` on the new API, and that
   Release A processes still report ready on schema 18 (their certificate accepts it).
2. **Worker and other backends** next, then **Vercel Production** last.
3. What goes live: accounts exist wherever `DATABASE_URL` is set, so **Web3 Wallet sign-in (EIP-4361 / Sign-In With Solana, verified
   by FloFi's server) is available as soon as Release B serves `/login`**; it needs only the database and the existing wallet-session
   secret. `/app` keeps working without an account.
4. Everything else stays disabled, and is shown as unavailable, until its settings exist:
   - Google, Apple and email sign-in.
   - FloFi Wallet (managed wallets). It needs the Turnkey settings **and** its own origin: `FLOFI_WALLET_ORIGIN`, pinned to
     `https://wallet.flofi.xyz` in production. That host must be added to the same Vercel deployment (DNS + domain). FloFi Wallet also
     uses its own Google client (`FLOFI_WALLET_GOOGLE_CLIENT_ID` / `_SECRET`) and Apple Services ID (`FLOFI_WALLET_APPLE_CLIENT_ID`),
     whose only redirect URIs are `https://wallet.flofi.xyz/wallet/callback/{google,apple}`.
     Its EVM nonce/fee reads and its attempt-bound broadcast run on the API's `managed-wallet-evm` flow (Railway API first, as above),
     with each catalog network's existing RPC setting (`GRYLOO_BASE_RPC_URL`, …) and existing live gate: nothing new to configure, and a
     network that is not live there is refused, never simulated.
   Configure each only after the live verification above, then check each method once with an owner-controlled identity.
   None of these settings changes the database: migration 0018 is the same in this round.

## Rollback

| Point | Action |
| --- | --- |
| Release A misbehaves | Restore the previous version-17 artifact; schema stays 17. |
| 0018 fails | Its transaction rolls back to 17. Keep Release A; fix the cause; retry the exact migration. Never edit the SQL (a new certificate and Release A would be needed). |
| Release B misbehaves, schema 18 | Restore Release A (certified for 18). Account tables stay; Release A never reads them. Sign-in is unavailable until B returns. |
| After real accounts exist | Same as above. Do not drop or truncate account tables, and do not run a downmigration: people's account ↔ wallet links (and Turnkey sub-organization ids) live there. |

No rollback touches funds: accounts and saved wallets authorize nothing. A managed wallet signs only in FloFi Wallet, after the person
unlocks it and confirms a request that matches a reviewed FloFi attempt, and FloFi broadcasts only what was signed. A rollback leaves
the keys at Turnkey, and the person can still export them from FloFi Wallet once it is restored.
