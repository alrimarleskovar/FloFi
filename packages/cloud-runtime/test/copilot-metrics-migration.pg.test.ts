// SPDX-License-Identifier: AGPL-3.0-only
/** Schema 16 → 17 against real disposable PostgreSQL. The prior build must already carry the reviewed certificate. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertSchemaCompatible, assertSchemaCurrent, CERTIFIED_FORWARD_MIGRATIONS, loadMigrations, migrate, SHIPPED_MIGRATIONS } from '../src/index.js';
import { createTestDatabase } from './pg-harness';

describe('copilot metrics additive migration', () => {
  it('cold starts under the exact v16 certificate and keeps financial relations unchanged', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      // Pinned to schema 17: later releases add migrations after it (BUILD-FLOFI-AUTH-WALLETS-001 added 0018).
      const all = (await loadMigrations()).slice(0, 17), base = all.slice(0, 16);
      await migrate(t.db, base);
      const shape = async () => (await t.db.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name <> 'copilot_daily_metrics' ORDER BY table_name, ordinal_position`)).rows;
      const before = await shape();
      expect(await migrate(t.db, all)).toEqual([17]);
      expect(await shape()).toEqual(before);
      expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS.slice(0, 17))).toBe(17);
      expect(await migrate(t.db, all)).toEqual([]);
      expect(await assertSchemaCompatible(t.open(1), SHIPPED_MIGRATIONS.slice(0, 16))).toMatchObject({ version: 17, application: 16, forward: [SHIPPED_MIGRATIONS[16]] });
      await expect(assertSchemaCompatible(t.db, SHIPPED_MIGRATIONS.slice(0, 16), CERTIFIED_FORWARD_MIGRATIONS.filter(c => c.base.version !== 16))).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
      expect(await migrate(t.db, base)).toEqual([]);
    } finally { await t.drop(); }
  });

  it('rolls failed DDL back together with its ledger entry', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations(), next = all[16]!;
      await migrate(t.db, all.slice(0, 16));
      const sql = next.sql + '\nSELECT missing_copilot_migration_test_function();\n';
      await expect(migrate(t.db, [...all.slice(0, 16), { ...next, sql, sha256: createHash('sha256').update(sql).digest('hex') }])).rejects.toThrow();
      expect((await t.db.query('SELECT max(version)::int AS version FROM schema_migrations')).rows).toEqual([{ version: 16 }]);
      expect((await t.db.query("SELECT to_regclass('public.copilot_daily_metrics') AS relation")).rows).toEqual([{ relation: null }]);
    } finally { await t.drop(); }
  });
});
