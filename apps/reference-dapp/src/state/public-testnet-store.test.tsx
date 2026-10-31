// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicTestnetProvider, usePublicTestnet } from './public-testnet-store';
import { catalogSwapAvailability, publicAvailability, publicBegin, publicPrepare, publicRefresh, publicReport, publicReview, publicStatus } from '../app/public-testnet-action';
import type { PublicRun } from '../server/public-testnet-service';
import type { Workflow } from '../domain/initial-workflow';
import { initialEditor } from '../domain/editor';
import { deferred, HookHarness } from '../test-utils/hook-harness';
import { reviewFixture } from '../test-utils/review-fixture';
import { composeStrategy } from '../engine/strategy-engine';
import { floFiRefusal, rejected } from './public-testnet-store';
import { FloFiProviderError } from '../wallet/flofi-evm-provider';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const f = vi.hoisted(() => ({ workflow: null as Workflow | null, restore: vi.fn(), session: vi.fn() }));
vi.mock('./workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: f.workflow }, runtimeWorkflow: f.workflow, restoreWorkflow: f.restore }) }));
vi.mock('./build009-wallet-store', () => ({ useBuild009Wallet: () => ({ session: f.session }), injected: () => null }));
vi.mock('../app/public-testnet-action', () => ({ publicAvailability: vi.fn(), publicStatus: vi.fn(), publicPrepare: vi.fn(), publicRefresh: vi.fn(),
  publicReview: vi.fn(), publicBegin: vi.fn(), publicObserve: vi.fn(), publicReport: vi.fn(), catalogSwapAvailability: vi.fn(async () => false) }));
let host: HookHarness, store: ReturnType<typeof usePublicTestnet>, run: PublicRun;
function Probe() { store = usePublicTestnet(); return null; }
const read = () => host.render(() => renderToStaticMarkup(<PublicTestnetProvider><Probe/></PublicTestnetProvider>));
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); read(); }
beforeEach(() => {
  vi.clearAllMocks(); host = new HookHarness(); f.workflow = initialEditor().workflow;
  f.restore.mockImplementation(workflow => { f.workflow = workflow as Workflow; });
  const fixture = reviewFixture();
  if (fixture.source.kind !== 'public') throw Error('fixture');
  run = { ...fixture.source.state.run!, attempts: [{ step: 'approval', state: 'CONFIRMED' }] } as unknown as PublicRun;
  const values = new Map([['gryloo:public-testnet-execution-id', run.quote.executionId]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.mocked(publicAvailability).mockResolvedValue(true);
  vi.mocked(catalogSwapAvailability).mockResolvedValue(false);
  vi.mocked(publicStatus).mockResolvedValue({ ok: true, value: run });
  vi.mocked(publicRefresh).mockResolvedValue({ ok: true, value: { ...run, quote: { ...run.quote, manifestHash: 'fresh-manifest' }, reviewedManifestHash: null } });
  vi.mocked(publicReview).mockImplementation(async () => ({ ok: true, value: { ...run, reviewedManifestHash: 'fresh-manifest' } }));
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });

describe('public swap durable recovery and explicit fresh Review', () => {
  it('prepares Arbitrum through the existing server action with the connected owner, without requesting a signature', async () => {
    const composed = composeStrategy({ action: 'swap', network: 'arbitrum-one', inputAsset: 'USDC', outputAsset: 'WETH', amount: '10' });
    if (!composed.ok) throw Error(composed.code);
    const workflow = composed.workflow as PublicRun['workflow'];
    f.workflow = workflow as Workflow;
    vi.mocked(publicStatus).mockResolvedValue({ ok: false, code: 'EXECUTION_NOT_FOUND' });
    vi.mocked(catalogSwapAvailability).mockResolvedValue(true);
    f.session.mockResolvedValue({ account: '0x1111111111111111111111111111111111111111', chainId: '0xa4b1' });
    vi.mocked(publicPrepare).mockResolvedValue({ ok: true, value: { ...run, workflow, quote: { ...run.quote, chainId: 42161 } } });
    read(); await settle(); store.simulate(); await settle();
    expect(publicPrepare).toHaveBeenCalledExactlyOnceWith(composed.workflow, '0x1111111111111111111111111111111111111111');
    expect(publicBegin).not.toHaveBeenCalled(); expect(publicReport).not.toHaveBeenCalled();
  });
  it('reports a browser-saved hash after an UNKNOWN wallet result during recovery', async () => {
    const attemptId = run.quote.executionId + '.swap.1', hash = '0x' + 'a'.repeat(64);
    run = { ...run, attempts: [{ step: 'swap', state: 'UNKNOWN', attemptId, txHash: null }] } as unknown as PublicRun;
    vi.mocked(publicStatus).mockResolvedValue({ ok: true, value: run });
    const saved = new Map([['gryloo:public-testnet-execution-id', run.quote.executionId], ['gryloo:public-testnet-execution-id:' + attemptId, hash]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: vi.fn() });
    vi.mocked(publicReport).mockResolvedValue({ ok: true, value: run });
    read(); await settle();
    expect(publicReport).toHaveBeenCalledExactlyOnceWith(run.quote.executionId, attemptId, { kind: 'HASH', txHash: hash });
    expect(publicBegin).not.toHaveBeenCalled();
  });
  it('restores the recorded canonical workflow over the untouched template without granting execution authority', async () => {
    read(); await settle();
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(run.workflow);
    expect(store).toMatchObject({ run, recoveryOnly: true, retired: true });
    expect(publicPrepare).not.toHaveBeenCalled(); expect(publicBegin).not.toHaveBeenCalled(); expect(publicReview).not.toHaveBeenCalled();
  });
  it('refreshes and reviews the existing run after confirmed approval, preserving its attempt', async () => {
    read(); await settle(); store.simulate(); await settle();
    expect(publicRefresh).toHaveBeenCalledExactlyOnceWith(run.quote.executionId); expect(publicPrepare).not.toHaveBeenCalled();
    expect(store).toMatchObject({ recoveryOnly: false, retired: false, run: { attempts: run.attempts, reviewedManifestHash: null } });
    store.review(); await settle();
    expect(publicReview).toHaveBeenCalledExactlyOnceWith(run.quote.executionId, 'fresh-manifest'); expect(publicBegin).not.toHaveBeenCalled();
  });
  it('does not overwrite an owner edit while the status response is pending', async () => {
    const response = deferred<Awaited<ReturnType<typeof publicStatus>>>(); vi.mocked(publicStatus).mockReturnValue(response.promise);
    read(); f.workflow = reviewFixture().workflow; read(); response.resolve({ ok: true, value: run }); await settle();
    expect(f.restore).not.toHaveBeenCalled(); expect(store.recoveryOnly).toBe(true); expect(publicBegin).not.toHaveBeenCalled();
  });
  it('does not replace a non-template workflow that was already open on mount', async () => {
    f.workflow = reviewFixture().workflow; read(); await settle(); expect(f.restore).not.toHaveBeenCalled();
  });
  it('keeps uncertain submission closed after recovery and refuses a duplicate preparation', async () => {
    run = { ...run, attempts: [{ step: 'swap', state: 'UNKNOWN' }] } as unknown as PublicRun;
    vi.mocked(publicStatus).mockResolvedValue({ ok: true, value: run });
    read(); await settle(); store.simulate(); await settle();
    expect(store.error).toContain('transaction is already in progress');
    expect(publicPrepare).not.toHaveBeenCalled(); expect(publicRefresh).not.toHaveBeenCalled(); expect(publicBegin).not.toHaveBeenCalled();
  });
});

describe('wallet outcomes (BUILD-FLOFI-AUTH-WALLETS-001)', () => {
  it('treats a FloFi Wallet refusal proven before any signature as a rejection, and everything else unclear as unknown', () => {
    for (const code of ['FLOFI_WALLET_REVIEW_EXPIRED', 'FLOFI_WALLET_NONCE_MISMATCH', 'FLOFI_WALLET_FEE_TOO_HIGH', 'FLOFI_WALLET_NO_MATCHING_REVIEW']) {
      expect(floFiRefusal(new FloFiProviderError(4100, code))).toBe(code);
      expect(rejected(new FloFiProviderError(4100, code))).toBe(true);
    }
    expect(rejected({ code: 4001 })).toBe(true);
    // Not proven before signing: a 4100 with another code, an already-signed attempt, or a plain failure after FloFi Wallet may have signed.
    expect(rejected(new FloFiProviderError(4100, 'SOMETHING_ELSE'))).toBe(false);
    expect(rejected(new FloFiProviderError(4100, 'FLOFI_WALLET_ALREADY_SIGNED'))).toBe(false);
    expect(rejected(new Error('FLOFI_WALLET_SUBMISSION_UNKNOWN'))).toBe(false);
    expect(rejected({ code: 4100 })).toBe(false);
  });
});
