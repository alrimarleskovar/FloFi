// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's window protocol, end to end inside the page: `ready` to the product origin, a handoff only from
// the opener at that origin, the bound account on screen, one request at a time, answers only to the product origin, and an account switch
// that cancels the open request and forgets the wallet key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HookHarness } from '../test-utils/hook-harness';
import { WALLET_PROTOCOL } from './protocol';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const provider = vi.hoisted(() => ({ forgetWalletKey: vi.fn(async () => {}) }));
vi.mock('./provider-client', () => ({ walletPublicKey: vi.fn(async () => '02' + 'ab'.repeat(32)), forgetWalletKey: provider.forgetWalletKey, clientSignatureOver: vi.fn(),
  createWallet: vi.fn(), openImportFrame: vi.fn(), openExportFrame: vi.fn(), signEvmTransaction: vi.fn(), signSolanaMessage: vi.fn(), signSignInMessage: vi.fn(),
  WalletSigningError: class extends Error {} }));
const { WalletApp } = await import('./wallet-app');

const APP = 'https://flofi.xyz', EVM = '0x' + 'a'.repeat(40);
const config = { appOrigin: APP, walletOrigin: 'https://wallet.flofi.xyz', otpSignerPublicKey: null,
  frames: { exportIframeUrl: 'https://export.turnkey.com', importIframeUrl: 'https://import.turnkey.com' }, unlock: { email: true, google: true, apple: true } };
const wallet = { id: `evm:${EVM}`, ecosystem: 'evm', address: EVM, origin: 'generated', provider: 'turnkey', providerName: 'FloFi wallet', export: 'recovery-phrase',
  label: 'Main EVM', addedAt: '2026-10-31T10:00:00.000Z' };
const account = (n: number, label: string) => ({ accountId: `acct_${String(n).repeat(32)}`, label, methods: ['email'], unlocked: true, wallets: [wallet],
  organization: { organizationId: '0b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', userId: '1b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', login: 'email' } });
const token = (c: string) => `h1.${c.repeat(40)}.${'b'.repeat(43)}`;

let host: HookHarness, listeners: Map<string, (event: unknown) => void>, opener: { postMessage: ReturnType<typeof vi.fn> }, sessions: Record<string, unknown>;
const posted = () => opener.postMessage.mock.calls.map(([message, origin]) => ({ message: message as Record<string, unknown>, origin }));
const read = () => host.render(() => renderToStaticMarkup(<WalletApp config={config}/>));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); read(); };
const send = (data: unknown, patch: Partial<{ origin: string; source: unknown }> = {}) => listeners.get('message')!({ data, origin: APP, source: opener, ...patch });
const request = (id: string, operation: Record<string, unknown>) => ({ protocol: WALLET_PROTOCOL, type: 'request', id, request: operation });

beforeEach(() => {
  vi.useFakeTimers();
  host = new HookHarness(); listeners = new Map(); opener = { postMessage: vi.fn() }; provider.forgetWalletKey.mockClear();
  sessions = { [token('a')]: account(1, 'ana@example.com'), [token('c')]: account(2, 'bruno@example.com') };
  vi.stubGlobal('window', { opener, addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn), removeEventListener: vi.fn(), focus: vi.fn() });
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() { /* other windows */ } close() { /* closed */ } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/wallet/session' && init.method === 'GET') return new Response(JSON.stringify({ code: 'WALLET_SESSION_REQUIRED' }), { status: 401 });
    const handoff = (JSON.parse(init.body as string) as { handoff: string }).handoff, context = sessions[handoff];
    return context ? new Response(JSON.stringify({ context, appOrigin: APP })) : new Response(JSON.stringify({ code: 'WALLET_HANDOFF_INVALID' }), { status: 401 });
  }));
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('FloFi Wallet window', () => {
  it('says ready to the product origin, takes the handoff only from its opener at that origin, and shows the bound account', async () => {
    read(); await settle();
    expect(posted()).toEqual([{ message: { protocol: WALLET_PROTOCOL, type: 'ready' }, origin: APP }]);
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('a') }, { origin: 'https://evil.example' });
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('a') }, { source: {} });
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST')).toHaveLength(0);
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('a') });
    await settle();
    const html = read();
    expect(html).toContain('ana@example.com');
    expect(html).toContain('Main EVM');
    expect(posted().at(-1)).toEqual({ message: { protocol: WALLET_PROTOCOL, type: 'unlocked' }, origin: APP });
  });

  it('answers connect with public addresses only, one request at a time, and refuses malformed requests explicitly', async () => {
    read(); await settle();
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('a') }); await settle();
    send(request('req_connect1', { op: 'connect' })); await settle();
    expect(posted().find(entry => entry.message.id === 'req_connect1')).toEqual({ origin: APP,
      message: { protocol: WALLET_PROTOCOL, type: 'response', id: 'req_connect1', ok: true, result: { wallets: [{ ecosystem: 'evm', address: EVM, label: 'Main EVM' }] } } });
    send(request('req_create01', { op: 'create', ecosystem: 'evm' })); await settle();
    send(request('req_create02', { op: 'create', ecosystem: 'solana' })); await settle();
    expect(posted().find(entry => entry.message.id === 'req_create02')?.message).toMatchObject({ ok: false, code: 'FLOFI_WALLET_BUSY' });
    expect(posted().some(entry => entry.message.id === 'req_create01')).toBe(false);
    send(request('req_create01', { op: 'create', ecosystem: 'evm' })); await settle();
    expect(posted().filter(entry => entry.message.id === 'req_create01')).toHaveLength(0);
    send({ ...request('req_bad00001', { op: 'drain' }) }); await settle();
    expect(posted().find(entry => entry.message.id === 'req_bad00001')?.message).toMatchObject({ ok: false, code: 'FLOFI_WALLET_REQUEST_INVALID' });
    expect(posted().every(entry => entry.origin === APP)).toBe(true);
  });

  it('a handoff for another account cancels the open request, forgets the wallet key and says whose wallets these are', async () => {
    read(); await settle();
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('a') }); await settle();
    send(request('req_create01', { op: 'create', ecosystem: 'evm' })); await settle();
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('c') }); await settle();
    expect(posted().find(entry => entry.message.id === 'req_create01')?.message).toMatchObject({ ok: false, code: 'FLOFI_WALLET_ACCOUNT_MISMATCH' });
    expect(provider.forgetWalletKey).toHaveBeenCalledTimes(1);
    expect(read()).toContain('bruno@example.com');
  });

  it('a used handoff ends the window and later requests are refused before anything is shown', async () => {
    read(); await settle();
    send({ protocol: WALLET_PROTOCOL, type: 'handoff', token: token('z') }); await settle();
    expect(read()).toContain('This FloFi Wallet link expired or was already used.');
    send(request('req_late0001', { op: 'evm_sign_message', address: EVM, message: 'hello' })); await settle();
    expect(posted().find(entry => entry.message.id === 'req_late0001')?.message).toMatchObject({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
  });

  it('without a handoff in time, the window says it is not connected', async () => {
    read(); await settle();
    await vi.advanceTimersByTimeAsync(20_000); read();
    expect(read()).toContain('FloFi Wallet is not connected');
  });
});
