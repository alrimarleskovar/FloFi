// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The backend runs on Node 24's native TypeScript support, not through a bundler: every module it reaches must
 * resolve with explicit extensions. This loads the real entry modules in a plain Node process (no database,
 * no network) so an extensionless import can never ship a backend that crashes at startup.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('BUILD-CLOUD-001 backend entry point loads under plain Node', () => {
  it('imports app, flows and every flow service without a bundler', async () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      "const f = await import('./backend/flows.ts'); await import('./backend/app.ts'); console.log(Object.keys(f.FLOWS).sort().join(','));"],
    { cwd, timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } });
    // BUILD-RH-002 adds the Robinhood Chain swap, mainnet transfer, liquidity and the four Robinhood bridge routes; BUILD-BASE-001 the Base
    // mainnet swap, transfer, liquidity and Aave flows and the Router's Arbitrum One → Base route; the Solana Devnet Swap → Orca liquidity composition;
    // BUILD-SOLANA-MAINNET-001 Orca liquidity on Solana mainnet-beta; BUILD-SOLANA-TRANSFER-UX-001 the direct Solana and Solana Devnet transfers;
    // BUILD-CROSSCHAIN-UNIVERSAL-001 the universal Cross-chain Router; BUILD-FLOFI-AUTH-WALLETS-001 FloFi Wallet's EVM reads and attempt-bound
    // broadcast (`managed-wallet-evm`, no runs of its own).
    expect(stdout.trim()).toBe('aave-supply,arbitrum-aave,arbitrum-liquidity,arbitrum-mainnet-transfer,arbitrum-swap,base-aave,base-liquidity,base-mainnet-transfer,base-sepolia-swap,base-swap,crosschain-router,crosschain-router-arbitrum-to-base,crosschain-router-arbitrum-to-ethereum,' +
      'crosschain-router-arbitrum-to-robinhood,crosschain-router-base-to-ethereum,crosschain-router-base-to-robinhood,crosschain-router-ethereum-to-arbitrum,crosschain-router-ethereum-to-base,crosschain-router-ethereum-to-robinhood,' +
      'crosschain-router-robinhood-to-arbitrum,crosschain-router-robinhood-to-base,crosschain-router-robinhood-to-ethereum,crosschain-router-testnet,crosschain-universal,ethereum-aave,ethereum-liquidity,ethereum-mainnet-transfer,ethereum-swap,jupiter-swap,lending-composition,managed-wallet-evm,orca-liquidity,orca-liquidity-mainnet,pix-payment,' +
      'robinhood-liquidity,robinhood-mainnet-transfer,robinhood-swap,robinhood-transfer,solana-devnet-composition,solana-devnet-swap,solana-devnet-transfer,solana-transfer,uniswap-liquidity');
  });
  it('refuses to start without configuration instead of running unconfigured', async () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    const result = await promisify(execFile)(process.execPath, ['backend/main.ts', 'api'], { cwd, timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } })
      .then(() => ({ code: 0, stdout: '' }), (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"stage":"config","error_code":"DATABASE_URL_REQUIRED"');
  });
});
