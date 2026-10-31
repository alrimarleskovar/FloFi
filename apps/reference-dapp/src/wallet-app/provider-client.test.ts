// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's signing calls send exactly the activity the person approved, bound to its FloFi run, and
// classify failures honestly: only a refusal by FloFi's relay before forwarding proves nothing was signed (spec decision 5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@turnkey/indexed-db-stamper', () => ({ IndexedDbStamper: class {
  async init() { /* key ready */ }
  getPublicKey() { return '02' + 'ab'.repeat(32); }
  async stamp() { return { stampHeaderName: 'X-Stamp', stampHeaderValue: 'stamp-value' }; }
  async sign() { return 'cd'.repeat(64); }
  async clear() { /* forgotten */ }
} }));
const { signEvmTransaction, signSignInMessage, signSolanaMessage, WalletSigningError } = await import('./provider-client');

const ORG = '0b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', EVM = '0x' + 'a'.repeat(40), SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const signing = { flow: 'base-swap', runId: `bas-${'c'.repeat(24)}` };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const completed = (result: Record<string, unknown>) => ({ activity: { id: 'activity-1234', status: 'ACTIVITY_STATUS_COMPLETED', result } });
let fetch: ReturnType<typeof vi.fn>;
const sent = (index = 0) => { const [url, init] = fetch.mock.calls[index] as [string, RequestInit]; return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }; };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function respond(...responses: (Response | Error)[]) {
  fetch = vi.fn(async () => { const next = responses.shift()!; if (next instanceof Error) throw next; return next; });
  vi.stubGlobal('fetch', fetch);
}

describe('signEvmTransaction', () => {
  it('submits SIGN_TRANSACTION_V2 for the exact unsigned bytes with the run binding header', async () => {
    respond(json(200, completed({ signTransactionResult: { signedTransaction: '0x02F0' } })));
    await expect(signEvmTransaction(ORG, EVM, '02c0', signing)).resolves.toBe('02f0');
    const call = sent();
    expect(call.url).toBe('/api/wallet/provider/submit/sign_transaction');
    expect(call.headers['x-flofi-signing']).toBe(`base-swap:bas-${'c'.repeat(24)}`);
    expect(call.headers['X-Stamp']).toBe('stamp-value');
    expect(call.body).toMatchObject({ type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2', organizationId: ORG,
      parameters: { signWith: EVM, unsignedTransaction: '02c0', type: 'TRANSACTION_TYPE_ETHEREUM' } });
  });
  it('refuses locally, before any request, what the relay would refuse', async () => {
    respond();
    for (const [address, hex] of [[EVM, 'f8c0'], [EVM, '02c'], ['0x' + 'A'.repeat(40), '02c0']] as const)
      await expect(signEvmTransaction(ORG, address, hex, signing)).rejects.toMatchObject({ message: 'SIGN_REQUEST_INVALID', submitted: false });
    await expect(signEvmTransaction(ORG, EVM, '02c0', { flow: 'x', runId: 'y' })).rejects.toMatchObject({ submitted: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a relay refusal of the submit proves nothing was signed', async () => {
    respond(json(403, { code: 'WALLET_UNLOCK_REQUIRED' }));
    const failure = await signEvmTransaction(ORG, EVM, '02c0', signing).catch(error => error);
    expect(failure).toBeInstanceOf(WalletSigningError);
    expect(failure).toMatchObject({ message: 'WALLET_UNLOCK_REQUIRED', submitted: false });
  });
  it('anything after the provider has the activity, or a lost submit, is unknown', async () => {
    respond(json(200, { activity: { id: 'activity-1234', status: 'ACTIVITY_STATUS_FAILED', result: {} } }));
    await expect(signEvmTransaction(ORG, EVM, '02c0', signing)).rejects.toMatchObject({ message: 'MANAGED_ACTIVITY_NOT_COMPLETED', submitted: true });
    respond(new TypeError('network'));
    await expect(signEvmTransaction(ORG, EVM, '02c0', signing)).rejects.toMatchObject({ message: 'MANAGED_PROVIDER_UNAVAILABLE', submitted: true });
    respond(json(500, { code: 3, message: 'internal' }));
    await expect(signEvmTransaction(ORG, EVM, '02c0', signing)).rejects.toMatchObject({ submitted: true });
    respond(json(200, { activity: { id: 'activity-1234', status: 'ACTIVITY_STATUS_PENDING' } }), json(403, { code: 'WALLET_UNLOCK_REQUIRED' }));
    const pending = signEvmTransaction(ORG, EVM, '02c0', signing).catch(error => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ message: 'WALLET_UNLOCK_REQUIRED', submitted: true });
    respond(json(200, completed({ signTransactionResult: { signedTransaction: 'zz' } })));
    await expect(signEvmTransaction(ORG, EVM, '02c0', signing)).rejects.toMatchObject({ message: 'MANAGED_RESPONSE_INVALID', submitted: true });
  });
});

describe('signSolanaMessage', () => {
  it('signs the exact v0 message as a raw payload with no hashing and returns r‖s', async () => {
    respond(json(200, completed({ signRawPayloadResult: { r: 'ab', s: 'cd'.repeat(32), v: '00' } })));
    await expect(signSolanaMessage(ORG, SOL, '80010203', signing)).resolves.toBe('ab'.padStart(64, '0') + 'cd'.repeat(32));
    const call = sent();
    expect(call.url).toBe('/api/wallet/provider/submit/sign_raw_payload');
    expect(call.headers['x-flofi-signing']).toBe(`base-swap:bas-${'c'.repeat(24)}`);
    expect(call.headers['x-flofi-message']).toBeUndefined();
    expect(call.body.parameters).toEqual({ signWith: SOL, payload: '80010203', encoding: 'PAYLOAD_ENCODING_HEXADECIMAL', hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE' });
  });
  it('refuses anything but a v0 message locally', async () => {
    respond();
    await expect(signSolanaMessage(ORG, SOL, '0102', signing)).rejects.toMatchObject({ message: 'SIGN_REQUEST_INVALID', submitted: false });
    await expect(signSolanaMessage(ORG, EVM, '8001', signing)).rejects.toMatchObject({ submitted: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('signSignInMessage', () => {
  it('sends the EIP-191 bytes for keccak256 with the message in its header, and returns r‖s‖v', async () => {
    respond(json(200, completed({ signRawPayloadResult: { r: '11'.repeat(32), s: '22'.repeat(32), v: '01' } })));
    await expect(signSignInMessage(ORG, EVM, 'evm', 'hi')).resolves.toBe('11'.repeat(32) + '22'.repeat(32) + '1c');
    const call = sent();
    expect(call.body.parameters).toEqual({ signWith: EVM, payload: Buffer.from('\x19Ethereum Signed Message:\n2hi').toString('hex'),
      encoding: 'PAYLOAD_ENCODING_HEXADECIMAL', hashFunction: 'HASH_FUNCTION_KECCAK256' });
    expect(Buffer.from(call.headers['x-flofi-message']!, 'base64url').toString()).toBe('hi');
    expect(call.headers['x-flofi-signing']).toBeUndefined();
  });
  it('returns r‖s for Solana and treats a malformed answer as unknown', async () => {
    respond(json(200, completed({ signRawPayloadResult: { r: '11'.repeat(32), s: '22'.repeat(32), v: '00' } })));
    await expect(signSignInMessage(ORG, SOL, 'solana', 'hi')).resolves.toBe('11'.repeat(32) + '22'.repeat(32));
    respond(json(200, completed({ signRawPayloadResult: { r: '11'.repeat(32), s: '22'.repeat(32), v: '05' } })));
    await expect(signSignInMessage(ORG, EVM, 'evm', 'hi')).rejects.toMatchObject({ message: 'MANAGED_RESPONSE_INVALID', submitted: true });
  });
});
