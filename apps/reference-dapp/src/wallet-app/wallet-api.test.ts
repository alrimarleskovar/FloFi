// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet reads its own server strictly and fails closed: malformed contexts, foreign origins, unsafe
// sign-in URLs, export grants for another wallet and Review summaries for another run are all refused.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWalletContext, walletApi, WalletApiError } from './wallet-api';

const APP = 'https://flofi.xyz', EVM = '0x' + 'a'.repeat(40);
const wallet = { id: `evm:${EVM}`, ecosystem: 'evm', address: EVM, origin: 'generated', provider: 'turnkey', providerName: 'FloFi wallet', export: 'recovery-phrase',
  label: 'FloFi EVM wallet', addedAt: '2026-10-31T10:00:00.000Z' };
const context = { accountId: `acct_${'1'.repeat(32)}`, label: 'ana@example.com', methods: ['email'], unlocked: false, wallets: [wallet],
  organization: { organizationId: '0b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', userId: '1b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', login: 'email' } };
const summary = { flow: 'robinhood-swap', runId: `rhs-${'c'.repeat(24)}`, network: 'Robinhood Chain', chain: 'eip155:4663', realFunds: true, action: 'Swap 10 USDC for ETH',
  owner: EVM, lines: [{ label: 'Minimum received', value: '0.0031 ETH' }], expiresAt: '2026-10-31T12:05:00.000Z' };
function respond(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('wallet context', () => {
  it('reads the context, with the optional unlock fields when present', () => {
    expect(parseWalletContext(context)).toMatchObject({ accountId: context.accountId, label: 'ana@example.com', wallets: [wallet], unlockedAt: null, unlockedUntil: null, unlockedKey: null });
    expect(parseWalletContext({ ...context, unlocked: true, unlockedAt: 1_700_000_000, unlockedUntil: 1_700_001_800, unlockedKey: '02' + 'a'.repeat(64) }))
      .toMatchObject({ unlocked: true, unlockedAt: 1_700_000_000, unlockedUntil: 1_700_001_800 });
  });
  it('fails closed on anything malformed, including an external or extended wallet record', () => {
    for (const bad of [{ ...context, accountId: 'acct_x' }, { ...context, methods: ['email', 'eip155'] }, { ...context, label: '' }, { ...context, unlocked: 'yes' },
      { ...context, organization: { ...context.organization, login: 'eip155' } }, { ...context, wallets: [{ ...wallet, origin: 'external', provider: 'io.metamask', export: 'none' }] },
      { ...context, wallets: [{ ...wallet, privateKey: '00' }] }, { ...context, unlockedKey: 'zz' }, { ...context, unlockedUntil: -1 }, null, []])
      expect(parseWalletContext(bad)).toBeNull();
  });
});

describe('wallet routes', () => {
  it('calls same-origin routes without a referrer and refuses a session for another product origin', async () => {
    const fetch = respond(200, { context, appOrigin: APP });
    await expect(walletApi.session(APP)).resolves.toMatchObject({ accountId: context.accountId });
    expect(fetch).toHaveBeenCalledWith('/api/wallet/session', expect.objectContaining({ method: 'GET', credentials: 'same-origin', referrerPolicy: 'no-referrer', cache: 'no-store' }));
    await expect(walletApi.session('https://other.example')).rejects.toThrow('MANAGED_WALLETS_NOT_CONFIGURED');
    respond(200, { context, appOrigin: APP });
    await walletApi.redeem('h1.token', APP);
  });
  it('surfaces the server’s code, or a fallback for the call when there is none', async () => {
    respond(401, { code: 'WALLET_HANDOFF_INVALID' });
    await expect(walletApi.redeem('h1.token', APP)).rejects.toMatchObject({ message: 'WALLET_HANDOFF_INVALID', status: 401 });
    respond(500, { code: '<script>' });
    await expect(walletApi.session(APP)).rejects.toThrow('WALLET_SESSION_REQUIRED');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(walletApi.lock()).rejects.toBeInstanceOf(WalletApiError);
  });
  it('validates every email unlock step', async () => {
    respond(200, { challengeId: 'f'.repeat(32), email: 'ana@example.com', targetBundle: '{"enclaveQuorumPublic":"04"}' });
    await expect(walletApi.emailStart('02' + 'a'.repeat(64))).resolves.toMatchObject({ email: 'ana@example.com' });
    respond(200, { challengeId: 'nope', email: 'ana@example.com', targetBundle: '{"enclaveQuorumPublic":"04"}' });
    await expect(walletApi.emailStart('02' + 'a'.repeat(64))).rejects.toThrow('WALLET_REQUEST_FAILED');
    respond(200, { tokenId: 'not a token id', email: 'ana@example.com', signup: false });
    await expect(walletApi.emailVerify('f'.repeat(32), '{}')).rejects.toThrow('WALLET_REQUEST_FAILED');
    const fetch = respond(200, { context: { ...context, unlocked: true }, unlockedUntil: 1_700_001_800 });
    await expect(walletApi.emailFinish('a'.repeat(128), null)).resolves.toMatchObject({ unlockedUntil: 1_700_001_800 });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ step: 'finish', loginSignature: 'a'.repeat(128) });
  });
  it('opens only https (or the loopback harness) sign-in URLs', async () => {
    respond(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' });
    await expect(walletApi.oidcStart('google', '02' + 'a'.repeat(64))).resolves.toBe('https://accounts.google.com/o/oauth2/v2/auth?state=x');
    for (const url of ['javascript:alert(1)', 'http://accounts.google.com/', 'https://user:pass@accounts.google.com/', 'data:text/html,x']) {
      respond(200, { url });
      await expect(walletApi.oidcStart('google', '02' + 'a'.repeat(64))).rejects.toThrow('WALLET_REQUEST_FAILED');
    }
  });
  it('accepts an export grant only for the wallet and kind the person chose', async () => {
    const grant = { organizationId: context.organization.organizationId, kind: 'recovery-phrase', resource: 'wallet-id-123456', address: EVM, keyFormat: 'HEXADECIMAL', source: 'wallet' };
    respond(200, { grant });
    await expect(walletApi.exportGrant(wallet as never, 'recovery-phrase')).resolves.toEqual({ organizationId: grant.organizationId, source: 'wallet', resource: grant.resource,
      address: EVM, keyFormat: 'HEXADECIMAL' });
    for (const patch of [{ address: '0x' + 'b'.repeat(40) }, { kind: 'private-key' }, { source: 'wallet-account' }, { keyFormat: 'SOLANA' }, { resource: '../x' }]) {
      respond(200, { grant: { ...grant, ...patch } });
      await expect(walletApi.exportGrant(wallet as never, 'recovery-phrase')).rejects.toThrow('WALLET_REQUEST_FAILED');
    }
  });
  it('shows a Review summary only for the same run, flow and owner; network failures are pre-signature refusals', async () => {
    const binding = { flow: summary.flow, runId: summary.runId };
    const fetch = respond(200, { summary });
    await expect(walletApi.signingContext(binding, EVM, { op: 'evm_sign_transaction' })).resolves.toMatchObject({ action: 'Swap 10 USDC for ETH' });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ flow: summary.flow, runId: summary.runId, address: EVM, op: 'evm_sign_transaction' });
    respond(200, { summary: { ...summary, owner: '0x' + 'b'.repeat(40) } });
    await expect(walletApi.signingContext(binding, EVM, {})).rejects.toThrow('FLOFI_WALLET_NO_MATCHING_REVIEW');
    respond(200, { summary: { ...summary, runId: `rhs-${'d'.repeat(24)}` } });
    await expect(walletApi.signingContext(binding, EVM, {})).rejects.toThrow('FLOFI_WALLET_NO_MATCHING_REVIEW');
    respond(200, { summary: { ...summary, lines: 'x' } });
    await expect(walletApi.signingContext(binding, EVM, {})).rejects.toThrow('FLOFI_WALLET_REVIEW_UNAVAILABLE');
    respond(409, { code: 'FLOFI_WALLET_NO_MATCHING_REVIEW' });
    await expect(walletApi.signingContext(binding, EVM, {})).rejects.toThrow('FLOFI_WALLET_NO_MATCHING_REVIEW');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(walletApi.signingContext(binding, EVM, {})).rejects.toThrow('FLOFI_WALLET_REVIEW_UNAVAILABLE');
  });
});
