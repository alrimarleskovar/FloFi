// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's bundle hygiene (spec decision 10), checked on the sources.
 *
 * The wallet pages run under a policy without `'unsafe-eval'`, and the smaller their code, the smaller what an injected or compromised
 * module could reach next to the wallet key. So:
 *  1. Nothing the browser loads for FloFi Wallet (every module under `src/wallet-app`, and what it imports) reaches the workflow engine
 *     (`@defi-workflow-engine/*`, Ajv, the action registry, workflow contracts), `src/server`, a server action, Node built-ins, or any
 *     package but React and the provider's three browser packages; from `src/accounts` it uses only browser-safe modules.
 *  2. The `(wallet)` pages themselves (server components) reach no engine, Ajv or registry either, and from `src/server` only deployment
 *     facts (to read the wallet origin and provider configuration). Route handlers under `(wallet)` (the Google/Apple callback) are server
 *     code the browser never loads; they are covered by their own module tests.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url)), src = resolve(here, '..'), app = resolve(src, '..');
const rel = (file: string) => relative(app, file).replace(/\\/g, '/');
/** Runtime imports only: `import type` / `export type` carry no code. Side-effect and dynamic imports count. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...[...text.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s+'([^']+)';/gms)].filter(m => !/^(?:import|export)\s+type\b/.test(m[0])),
    ...text.matchAll(/^import\s+'([^']+)';/gm), ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map(m => m[1]!);
}
function resolveFile(file: string, specifier: string): string | null {
  const base = resolve(dirname(file), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}
/** Every source module reachable from `entries`, and every package (bare) specifier they import. */
function closure(entries: readonly string[]) {
  const files = new Set<string>(), packages = new Set<string>(), queue = entries.map(entry => join(app, entry));
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
      const next = resolveFile(file, specifier);
      if (!next) throw new Error(`${rel(file)}: unresolved ${specifier}`);
      if (/\.(?:ts|tsx)$/.test(next)) queue.push(next);
    }
  }
  return { files: [...files].map(rel).sort(), packages: [...packages].sort() };
}
const ENGINE = /^(?:@defi-workflow-engine\/|ajv(?:\/|$)|@sinclair\/typebox)|action-registry|workflow-contracts/;
const WALLET_APP = readdirSync(here).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).map(name => rel(join(here, name)));
const PAGES = ['src/app/(wallet)/layout.tsx', 'src/app/(wallet)/wallet/page.tsx', 'src/app/(wallet)/wallet/done/page.tsx'];

describe('FloFi Wallet bundle boundary', () => {
  it('the walker sees package and server imports (it would catch a violation)', () => {
    const relay = closure(['src/accounts/wallet-relay.ts']);
    expect(relay.packages.some(name => ENGINE.test(name))).toBe(true);
    expect(relay.files).toContain('src/server/wallet-session.ts');
  });

  it('the browser modules reach no engine, Ajv, server code, server action or Node built-in, and only browser-safe account modules', () => {
    expect(WALLET_APP).toEqual(expect.arrayContaining(['src/wallet-app/wallet-app.tsx', 'src/wallet-app/protocol.ts', 'src/wallet-app/provider-client.ts',
      'src/wallet-app/evm-transaction.ts', 'src/wallet-app/solana-transaction.ts', 'src/wallet-app/signing.tsx']));
    const reached = closure(WALLET_APP);
    expect(reached.packages).toEqual(['@turnkey/crypto', '@turnkey/iframe-stamper', '@turnkey/indexed-db-stamper', 'react']);
    expect(reached.files.filter(file => file.startsWith('src/server/') || file.startsWith('src/app/') || file.startsWith('src/state/') || /-action\.ts$/.test(file))).toEqual([]);
    expect(reached.files.filter(file => file.startsWith('src/accounts/')))
      .toEqual(['src/accounts/account-model.ts', 'src/accounts/account-theme.ts', 'src/accounts/otp-browser.ts']);
    expect(reached.files.filter(file => file.startsWith('src/wallet/'))).toEqual(['src/wallet/flofi-signing.ts', 'src/wallet/wallet-registry.ts']);
    for (const file of reached.files) {
      const code = readFileSync(join(app, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\bnew Function\(|\beval\(|\bsetTimeout\(\s*['"`]/);
    }
  });

  it('the (wallet) pages reach no engine or Ajv, and from src/server only deployment facts', () => {
    const reached = closure(PAGES);
    expect(reached.packages.filter(name => ENGINE.test(name))).toEqual([]);
    expect(reached.packages.filter(name => !/^(?:react|next\/(?:headers|server|navigation)|node:crypto|@turnkey\/(?:crypto|iframe-stamper|indexed-db-stamper))$/.test(name))).toEqual([]);
    expect(reached.files.filter(file => file.startsWith('src/server/'))).toEqual(['src/server/deployment.ts']);
    expect(reached.files.filter(file => /-action\.ts$|^src\/(?:state|components\/(?!account\/account-icons))/.test(file))).toEqual([]);
    // The client root is what the page renders; the browser gets nothing else from these pages.
    expect(reached.files).toEqual(expect.arrayContaining(['src/wallet-app/wallet-app.tsx', 'src/wallet-app/wallet-done.tsx']));
  });
});
