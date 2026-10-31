// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Version-controlled schema migrations. Files `migrations/NNNN_name.sql` apply in numeric order, each in its
 * own transaction, serialized across concurrent runners by a transaction-scoped advisory lock. The SHA-256 of
 * every applied file is recorded; an edited, missing or reordered migration fails closed. Application
 * processes never migrate implicitly: they call `assertSchemaCompatible` and refuse to start when behind.
 *
 * BUILD-DB-COMPAT-001: a database AHEAD of a build is served only under an explicit forward-compatibility
 * certificate of that build (`CERTIFIED_FORWARD_MIGRATIONS`), which pins every newer migration to its exact
 * identity. Nothing is inferred from a version number or from SQL: an unknown, edited or reordered newer
 * migration fails closed exactly as before, and a runner never changes a database that is ahead of it.
 * See docs/deploy/SCHEMA-COMPATIBILITY.md.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Queryable } from './db.js';

export type Migration = { readonly version: number; readonly name: string; readonly sql: string; readonly sha256: string };
/** What the schema check compares: a migration's identity without its SQL. */
export type MigrationIdentity = Pick<Migration, 'version' | 'name' | 'sha256'>;
// A path computation, not a bundler asset reference: bundled serverless functions never read it (they use SHIPPED_MIGRATIONS).
export const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/**
 * BUILD-CLOUD-PARITY-001: the identities of the migrations this package ships, so a bundled serverless function (where the
 * `migrations/` directory is not next to the code) can still verify the schema. A unit test proves it equals the SQL files;
 * migrating still reads the files.
 */
export const SHIPPED_MIGRATIONS: readonly MigrationIdentity[] = Object.freeze([
  { version: 1, name: 'execution_core', sha256: '66f8f10018153ea96209c6d83e16dc8fc85649792b64c69cdbb217a34ab3890e' },
  { version: 2, name: 'swap_attempt_states', sha256: 'ec0486c47f6ec6e1f24824e58eb92a1cf25f53457097c9e417da94a6a16733be' },
  { version: 3, name: 'solana_identities', sha256: 'a79ac40c257d6618762ec56ffbfb54d0d5e40771a569da74051805dfb3a2c365' },
  { version: 4, name: 'owner_run_history', sha256: 'be6edd07d29fd741a421c925a87f0bd0274904244e8a43c36be78e9d3b90bc9a' },
  { version: 5, name: 'mcp_oauth', sha256: '7130a683de4f7e7ec28158cfcf2022f1fdc9583b6f47b540f39f97b4803115da' },
  { version: 6, name: 'approval_requesters', sha256: '00c9efc7d09f473c9fd2067c04c149762d7a2061f6f8bf9faf0a5a53a766736c' },
  { version: 7, name: 'developer_platform', sha256: 'b70b6a4ab0e0d82414ba3363eb5b6909cf652fc41a768652c6ce0237de6e26be' },
  { version: 8, name: 'saved_workflows', sha256: '608eac6117a6d12f8c5f1bbe1deb4e9b783d8172ba70a1e35ba017e6fcab700d' },
  { version: 9, name: 'channel_conversations', sha256: '4bd8e0659f7465bc67ede38621770959f43b6e2b20ddf113fbc01c21b9f0b8f1' },
  { version: 10, name: 'automations', sha256: '33eabd57e662b422243305c7fb64580f37a86c314c34990a370a214837d1fa12' },
  { version: 11, name: 'delegated_execution', sha256: '0c6572af43ffe278df7724241ae30b1d1c15ab59b85941e2266b1b3294220202' },
  { version: 12, name: 'admin_control_plane', sha256: '25556fbfd8e45acf0e692fc340eee56fa2f064f4106225960d63e3da9c303af2' },
  { version: 13, name: 'copilot_learning', sha256: '109be0d34ea5b21ae42b1fda2c4e7fe87254a21ef1264a8235d57e8f1823bfc0' },
  { version: 14, name: 'learning_automatic', sha256: '624884d98407383c7093f6a56885ec13001614ddb9e2dcc2ac203451b519314e' },
  { version: 15, name: 'workflow_runs', sha256: '5dfefcf7465d874da5880ae5a082f7f47e28ede51adfdef46dbbe3e3f7ba945f' },
  { version: 16, name: 'owner_history_purge', sha256: 'a3c258cadd9d7865ad9d36d63ec0921fc47455bb3651c201074f3b0486b4be6f' },
  { version: 17, name: 'copilot_metrics', sha256: 'c20a07de7bb504cbb8d95776796a0e6b412a1130c0539aee3449ceb6f89c45bf' },
  { version: 18, name: 'flofi_accounts', sha256: '0919a57a5af80a1376ada213bb00ac5db79c434ab7a9ff0ebea50e6a9664ae75' },
].map(migration => Object.freeze(migration)));

/**
 * BUILD-DB-COMPAT-001: a reviewed statement that an application build whose shipped history ends exactly at `base` keeps working,
 * unchanged, on a database that also has `migrations` applied (contiguous from `base.version + 1`). Each identity is the exact
 * migration that will be released: a certificate is written one release before its migration ships, because an old build can only
 * verify bytes it knew when it was built. `assessment` names the evidence a reviewer checked.
 */
export type ForwardCompatibilityCertificate = {
  readonly base: MigrationIdentity; readonly migrations: readonly MigrationIdentity[]; readonly assessment: string };
/**
 * The certificates this package carries. Only the one whose `base` is a build's newest shipped migration applies to that build;
 * the others are the record of earlier releases (a unit test proves every certified migration that has since shipped is
 * byte-identical to what was certified).
 */
export const CERTIFIED_FORWARD_MIGRATIONS: readonly ForwardCompatibilityCertificate[] = Object.freeze([
  {
    base: { version: 17, name: 'copilot_metrics', sha256: 'c20a07de7bb504cbb8d95776796a0e6b412a1130c0539aee3449ceb6f89c45bf' },
    // BUILD-FLOFI-AUTH-WALLETS-001: six new flofi_account* tables; nothing on any pre-existing relation, function, trigger or index.
    migrations: [{ version: 18, name: 'flofi_accounts', sha256: '0919a57a5af80a1376ada213bb00ac5db79c434ab7a9ff0ebea50e6a9664ae75' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#12-certificate-0018_flofi_accounts',
  },
  {
    base: { version: 16, name: 'owner_history_purge', sha256: 'a3c258cadd9d7865ad9d36d63ec0921fc47455bb3651c201074f3b0486b4be6f' },
    migrations: [{ version: 17, name: 'copilot_metrics', sha256: 'c20a07de7bb504cbb8d95776796a0e6b412a1130c0539aee3449ceb6f89c45bf' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#11-certificate-0017_copilot_metrics',
  },
  {
    base: { version: 15, name: 'workflow_runs', sha256: '5dfefcf7465d874da5880ae5a082f7f47e28ede51adfdef46dbbe3e3f7ba945f' },
    migrations: [{ version: 16, name: 'owner_history_purge', sha256: 'a3c258cadd9d7865ad9d36d63ec0921fc47455bb3651c201074f3b0486b4be6f' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#10-certificate-0016_owner_history_purge',
  },
  {
    base: { version: 11, name: 'delegated_execution', sha256: '0c6572af43ffe278df7724241ae30b1d1c15ab59b85941e2266b1b3294220202' },
    // BUILD-ADMIN-001 at 53b1a8b: five new admin_* tables and one new index on automation_evaluations; no existing object changes.
    migrations: [{ version: 12, name: 'admin_control_plane', sha256: '25556fbfd8e45acf0e692fc340eee56fa2f064f4106225960d63e3da9c303af2' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#3-certificate-0012_admin_control_plane',
  },
  {
    base: { version: 12, name: 'admin_control_plane', sha256: '25556fbfd8e45acf0e692fc340eee56fa2f064f4106225960d63e3da9c303af2' },
    // BUILD-CHAT-LEARNING-001: seven new learning_* tables with their own functions and triggers; nothing on any pre-existing relation.
    migrations: [{ version: 13, name: 'copilot_learning', sha256: '109be0d34ea5b21ae42b1fda2c4e7fe87254a21ef1264a8235d57e8f1823bfc0' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#7-certificate-0013_copilot_learning',
  },
  {
    base: { version: 13, name: 'copilot_learning', sha256: '109be0d34ea5b21ae42b1fda2c4e7fe87254a21ef1264a8235d57e8f1823bfc0' },
    // BUILD-CHAT-LEARNING-002: two new learning_* tables (automatic-learning choices, evidence) with foreign keys to learning_subjects (ON DELETE CASCADE).
    migrations: [{ version: 14, name: 'learning_automatic', sha256: '624884d98407383c7093f6a56885ec13001614ddb9e2dcc2ac203451b519314e' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#8-certificate-0014_learning_automatic',
  },
  {
    base: { version: 14, name: 'learning_automatic', sha256: '624884d98407383c7093f6a56885ec13001614ddb9e2dcc2ac203451b519314e' },
    // BUILD-CHAT-E2E-001: three new workflow_run* tables; two delegated_* tables gain a nullable workflow-run source (rule/occurrence columns become
    // nullable, new column, checks, foreign keys, one index, one column-scoped trigger). No pre-existing function, trigger or index is redefined.
    migrations: [{ version: 15, name: 'workflow_runs', sha256: '5dfefcf7465d874da5880ae5a082f7f47e28ede51adfdef46dbbe3e3f7ba945f' }],
    assessment: 'docs/deploy/SCHEMA-COMPATIBILITY.md#9-certificate-0015_workflow_runs',
  },
].map(certificate => Object.freeze({ base: Object.freeze(certificate.base),
  migrations: Object.freeze(certificate.migrations.map(migration => Object.freeze(migration))), assessment: certificate.assessment })));

/** What a schema check established: the database's version, this build's, and the certified newer migrations in between. */
export type SchemaCompatibility = { readonly version: number; readonly application: number; readonly forward: readonly MigrationIdentity[] };
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_ID = 7_340_032_001; // Constant advisory lock key for migration runners.

export async function loadMigrations(directory = MIGRATIONS_DIRECTORY): Promise<readonly Migration[]> {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const migrations = await Promise.all(files.map(async (file, index) => {
    const match = FILE.exec(file);
    if (!match || Number(match[1]) !== index + 1) throw new Error('MIGRATION_SEQUENCE_INVALID');
    const sql = await readFile(`${directory}/${file}`, 'utf8');
    return { version: Number(match[1]), name: match[2]!, sql, sha256: createHash('sha256').update(sql).digest('hex') };
  }));
  return Object.freeze(migrations);
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY CHECK (version >= 1), name text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now())`;

type Applied = { version: number; name: string; sha256: string };
function verifyPrefix(applied: readonly Applied[], migrations: readonly MigrationIdentity[]): void {
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.sha256 !== expected.sha256)
      throw new Error('MIGRATION_HISTORY_MISMATCH');
  }
}

const SHA256 = /^[0-9a-f]{64}$/, NAME = /^[a-z0-9_]+$/;
const sameIdentity = (a: MigrationIdentity, b: MigrationIdentity) => a.version === b.version && a.name === b.name && a.sha256 === b.sha256;
const wellFormed = (m: MigrationIdentity) => Number.isSafeInteger(m.version) && m.version >= 1 && NAME.test(m.name) && SHA256.test(m.sha256);
/** The one certificate for the build whose newest shipped migration is `head`, if any. A malformed or ambiguous manifest fails closed. */
function certificateFor(head: MigrationIdentity | undefined, certificates: readonly ForwardCompatibilityCertificate[]): ForwardCompatibilityCertificate | undefined {
  if (!head) return undefined;
  const matching = certificates.filter(certificate => sameIdentity(certificate.base, head));
  if (matching.length > 1) throw new Error('MIGRATION_CERTIFICATE_INVALID');
  const certificate = matching[0];
  if (certificate && (!wellFormed(certificate.base) || !certificate.migrations.length
    || certificate.migrations.some((m, index) => !wellFormed(m) || m.version !== certificate.base.version + index + 1)))
    throw new Error('MIGRATION_CERTIFICATE_INVALID');
  return certificate;
}

/**
 * Whether a build that ships `shipped` may serve on a database whose ledger (ordered by version) is `applied`. Its known history must
 * match exactly (version, name, SHA-256). Behind it: `SCHEMA_NOT_MIGRATED`. Ahead of it: only when this build's certificate names
 * every newer row exactly and in order; any other newer row — unknown, edited, renamed, out of sequence — is `MIGRATION_HISTORY_MISMATCH`.
 * With no applicable certificate this is exactly `assertSchemaCurrent`'s rule.
 */
export function schemaCompatibility(applied: readonly MigrationIdentity[], shipped: readonly MigrationIdentity[],
  certificates: readonly ForwardCompatibilityCertificate[] = CERTIFIED_FORWARD_MIGRATIONS): SchemaCompatibility {
  verifyPrefix(applied.slice(0, shipped.length), shipped);
  if (applied.length < shipped.length) throw new Error('SCHEMA_NOT_MIGRATED');
  const newer = applied.slice(shipped.length);
  if (newer.length) verifyPrefix(newer, certificateFor(shipped.at(-1), certificates)?.migrations ?? []);
  return Object.freeze({ version: applied.length, application: shipped.length,
    forward: Object.freeze(newer.map(({ version, name, sha256 }) => Object.freeze({ version, name, sha256 }))) });
}

/**
 * Applies every pending migration. Safe to run concurrently and repeatedly; returns the versions applied now. A database ahead of
 * this runner is never changed: it is left untouched when this build is certified for every newer migration (nothing to apply; a
 * rollback to this build can still run its deploy step), and fails closed with `MIGRATION_HISTORY_MISMATCH` otherwise.
 */
export async function migrate(db: Database, migrations?: readonly Migration[],
  certificates: readonly ForwardCompatibilityCertificate[] = CERTIFIED_FORWARD_MIGRATIONS): Promise<readonly number[]> {
  const all = migrations ?? await loadMigrations();
  const appliedNow: number[] = [];
  for (;;) {
    const done = await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
      await tx.query(LEDGER);
      const applied = (await tx.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows;
      if (applied.length > all.length) { schemaCompatibility(applied, all, certificates); return true; }
      verifyPrefix(applied, all);
      const next = all[applied.length];
      if (!next) return true;
      await tx.query(next.sql);
      await tx.query('INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)', [next.version, next.name, next.sha256]);
      appliedNow.push(next.version);
      return false;
    });
    if (done) return appliedNow;
  }
}

/** Fails closed unless the database has exactly the migrations this build ships. */
export async function assertSchemaCurrent(db: Database, migrations?: readonly MigrationIdentity[]): Promise<number> {
  const all = migrations ?? await loadMigrations();
  let applied: Applied[];
  try { applied = (await db.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows; }
  catch (cause) { throw new Error('SCHEMA_NOT_MIGRATED', { cause }); }
  verifyPrefix(applied, all);
  if (applied.length !== all.length) throw new Error('SCHEMA_NOT_MIGRATED');
  return applied.length;
}

/**
 * BUILD-DB-COMPAT-001: the application readiness check. Fails closed unless the database has exactly the migrations this build ships,
 * or those followed only by newer migrations this build's certificate names exactly (`schemaCompatibility`). It reads the ledger and
 * never changes the database.
 */
export async function assertSchemaCompatible(db: Queryable, migrations?: readonly MigrationIdentity[],
  certificates: readonly ForwardCompatibilityCertificate[] = CERTIFIED_FORWARD_MIGRATIONS): Promise<SchemaCompatibility> {
  const all = migrations ?? await loadMigrations();
  let applied: Applied[];
  try { applied = (await db.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows; }
  catch (cause) { throw new Error('SCHEMA_NOT_MIGRATED', { cause }); }
  return schemaCompatibility(applied, all, certificates);
}
