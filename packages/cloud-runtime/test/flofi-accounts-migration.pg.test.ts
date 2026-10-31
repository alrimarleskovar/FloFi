// SPDX-License-Identifier: AGPL-3.0-only
/** Schema 17 → 18 against real disposable PostgreSQL. The prior build must already carry the reviewed certificate. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertSchemaCompatible, assertSchemaCurrent, CERTIFIED_FORWARD_MIGRATIONS, loadMigrations, migrate, SHIPPED_MIGRATIONS } from '../src/index.js';
import { createTestDatabase } from './pg-harness';

const ACCOUNT_TABLES = ['flofi_account_email_challenges', 'flofi_account_identities', 'flofi_account_sessions', 'flofi_account_used_proofs', 'flofi_account_wallets', 'flofi_accounts'];

describe('FloFi accounts additive migration', () => {
  it('cold starts under the exact v17 certificate and keeps every pre-existing relation unchanged', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      // Pinned to schema 18 so later migrations do not change this test.
      const all = (await loadMigrations()).slice(0, 18), base = all.slice(0, 17);
      expect(all[17]).toMatchObject({ version: 18, name: 'flofi_accounts', sha256: SHIPPED_MIGRATIONS[17]!.sha256 });
      await migrate(t.db, base);
      const shape = async () => (await t.db.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND NOT (table_name = ANY($1)) ORDER BY table_name, ordinal_position`, [ACCOUNT_TABLES])).rows;
      const before = await shape();
      expect(await migrate(t.db, all)).toEqual([18]);
      expect(await shape()).toEqual(before);
      expect((await t.db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`,
        [ACCOUNT_TABLES])).rows.map(row => row.table_name)).toEqual(ACCOUNT_TABLES);
      expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS.slice(0, 18))).toBe(18);
      expect(await migrate(t.db, all)).toEqual([]);
      expect(await assertSchemaCompatible(t.open(1), SHIPPED_MIGRATIONS.slice(0, 17))).toMatchObject({ version: 18, application: 17, forward: [SHIPPED_MIGRATIONS[17]] });
      await expect(assertSchemaCompatible(t.db, SHIPPED_MIGRATIONS.slice(0, 17), CERTIFIED_FORWARD_MIGRATIONS.filter(c => c.base.version !== 17))).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
    } finally { await t.drop(); }
  });

  it('admits no secret-shaped column and refuses unsafe wallet rows', async () => {
    const t = await createTestDatabase();
    try {
      const columns = (await t.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1)`, [ACCOUNT_TABLES])).rows
        .map(row => String(row.column_name));
      expect(columns.filter(name => /key|seed|mnemonic|secret|password|token|otp|phrase/i.test(name))).toEqual([]);
      await t.db.query("INSERT INTO flofi_accounts (tenant_id, account_id) VALUES ('default', 'acct_' || repeat('a', 32))");
      const wallet = (values: string) => t.db.query(`INSERT INTO flofi_account_wallets (tenant_id, account_id, ecosystem, address, origin, provider, provider_name,
        provider_resource, export, label) VALUES ('default', 'acct_' || repeat('a', 32), ${values})`);
      // An external wallet can never be exportable or carry a provider resource.
      await expect(wallet("'EVM', '0x' || repeat('1', 40), 'EXTERNAL', 'io.metamask', 'MetaMask', NULL, 'PRIVATE_KEY', 'MetaMask'")).rejects.toThrow();
      await expect(wallet("'EVM', '0x' || repeat('1', 40), 'EXTERNAL', 'io.metamask', 'MetaMask', 'wallet-12345678', 'NONE', 'MetaMask'")).rejects.toThrow();
      // An imported key never claims a recovery phrase; a mixed-case EVM address is refused.
      await expect(wallet("'EVM', '0x' || repeat('2', 40), 'IMPORTED', 'turnkey', 'FloFi wallet', 'key-12345678', 'RECOVERY_PHRASE', 'Imported'")).rejects.toThrow();
      await expect(wallet("'EVM', '0xABCDEF' || repeat('2', 34), 'EXTERNAL', 'io.metamask', 'MetaMask', NULL, 'NONE', 'MetaMask'")).rejects.toThrow();
      await wallet("'EVM', '0x' || repeat('3', 40), 'GENERATED', 'turnkey', 'FloFi wallet', 'wallet-12345678', 'RECOVERY_PHRASE', 'EVM wallet'");
    } finally { await t.drop(); }
  });

  it('rolls failed DDL back together with its ledger entry', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations(), next = all[17]!;
      await migrate(t.db, all.slice(0, 17));
      const sql = next.sql + '\nSELECT missing_accounts_migration_test_function();\n';
      await expect(migrate(t.db, [...all.slice(0, 17), { ...next, sql, sha256: createHash('sha256').update(sql).digest('hex') }])).rejects.toThrow();
      expect((await t.db.query('SELECT max(version)::int AS version FROM schema_migrations')).rows).toEqual([{ version: 17 }]);
      expect((await t.db.query("SELECT to_regclass('public.flofi_accounts') AS relation")).rows).toEqual([{ relation: null }]);
    } finally { await t.drop(); }
  });
});
