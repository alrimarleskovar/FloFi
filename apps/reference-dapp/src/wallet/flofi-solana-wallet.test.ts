// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet works through the existing Solana wallet module unchanged (explicit selection, exact-bytes
// signing, session retirement), signs only for a bound reviewed run, and returns only the same transaction with the owner's signature.
import { afterEach, describe, expect, it, vi } from 'vitest';

const OWNER = '7'.repeat(32) + 'abcd';
const message = Uint8Array.from([0x80, 1, 0, 1, 2, ...new Array(64).fill(9)]);
const unsigned = Uint8Array.from([1, ...new Array(64).fill(0), ...message]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const signedWire = () => { const bytes = unsigned.slice(); bytes.fill(5, 1, 65); return bytes; };
const SIGNING = { flow: 'jupiter-swap', runId: 'jupiter-' + 'c'.repeat(32) };

async function setup(request: (input: unknown) => Promise<unknown> = async () => ({ signedTransaction: b64(signedWire()) })) {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  const solana = await import('./solana-wallet'), channel = await import('./flofi-wallet-channel'), module = await import('./flofi-solana-wallet');
  const deps = { request: vi.fn(request), connected: vi.fn() };
  const wallet = module.createFloFiSolanaWallet(OWNER, module.FLOFI_WALLET_NAME, deps as never);
  const unregister = solana.registerSolanaWallet(wallet);
  return { solana, channel, module, wallet, deps, unregister };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('FloFi Wallet as a Wallet Standard wallet', () => {
  it('is offered on Solana mainnet only and connects (silently too) to the account’s own address', async () => {
    const { solana, deps } = await setup();
    expect(solana.solanaWalletChoices('solana:mainnet').map(choice => choice.name)).toEqual(['FloFi Wallet']);
    // Never advertised for Devnet or Testnet.
    expect(solana.solanaWalletNames('solana:devnet')).toEqual([]);
    const session = await solana.connectSolanaWallet('FloFi Wallet', 'solana:mainnet', 'JUPITER', { silent: true });
    expect(session.account.address).toBe(OWNER);
    expect(deps.connected).toHaveBeenCalledWith(OWNER, true);
  });
  it('ignores another script registering the FloFi Wallet name through the global event', async () => {
    const { solana } = await setup();
    const impostor = { name: 'FloFi Wallet', chains: ['solana:mainnet'], accounts: [], features: { 'standard:connect': {}, 'solana:signTransaction': {} } };
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api: { register(w: unknown): void }) => api.register(impostor) }));
    expect(solana.solanaWallets('solana:mainnet').filter(wallet => wallet.name === 'FloFi Wallet')).toHaveLength(1);
    await expect(solana.connectSolanaWallet('FloFi Wallet')).resolves.toBeTruthy();
  });
  it('signs the exact transaction through signWithSolanaWallet when the store bound its reviewed run', async () => {
    const { solana, channel, wallet, deps } = await setup();
    const session = await solana.connectSolanaWallet('FloFi Wallet');
    channel.bindFloFiSigning(session.wallet, SIGNING);
    expect(await solana.signWithSolanaWallet(session, b64(unsigned))).toBe(b64(signedWire()));
    expect(deps.request).toHaveBeenCalledWith({ op: 'solana_sign_transaction', address: OWNER, chain: 'solana:mainnet', transaction: b64(unsigned), signing: SIGNING });
    expect(session.wallet).toBe(wallet);
  });
  it('refuses a Devnet or Testnet transaction before asking FloFi Wallet, even with a bound run', async () => {
    const { solana, wallet, channel, deps } = await setup();
    const account = (await solana.connectSolanaWallet('FloFi Wallet')).account;
    const sign = (wallet.features['solana:signTransaction'] as { signTransaction: (...inputs: unknown[]) => Promise<unknown> }).signTransaction;
    for (const chain of ['solana:devnet', 'solana:testnet']) {
      channel.bindFloFiSigning(wallet, SIGNING);
      await expect(sign({ account, transaction: unsigned, chain })).rejects.toThrow('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    }
    expect(deps.request).not.toHaveBeenCalled();
  });
  it('refuses a signature with no bound run before asking FloFi Wallet', async () => {
    const { solana, deps } = await setup();
    const session = await solana.connectSolanaWallet('FloFi Wallet');
    await expect(solana.signWithSolanaWallet(session, b64(unsigned))).rejects.toThrow('FLOFI_WALLET_FLOW_NOT_SUPPORTED');
    expect(deps.request).not.toHaveBeenCalled();
  });
  it.each([
    ['another message', () => { const bytes = signedWire(); bytes[bytes.length - 1] = 0; return bytes; }],
    ['no signature', () => unsigned.slice()],
    ['another length', () => Uint8Array.from([...signedWire(), 0])],
  ])('drops a signed answer with %s', async (_name, answer) => {
    const { solana, channel } = await setup(async () => ({ signedTransaction: b64(answer()) }));
    const session = await solana.connectSolanaWallet('FloFi Wallet');
    channel.bindFloFiSigning(session.wallet, SIGNING);
    await expect(solana.signWithSolanaWallet(session, b64(unsigned))).rejects.toThrow('FLOFI_WALLET_SIGNATURE_UNKNOWN');
  });
  it('carries 4001 only for a cancel before Sign; any later failure never reads as a rejection', async () => {
    for (const [code, expected] of [['FLOFI_WALLET_REJECTED', { code: 4001, message: 'FLOFI_WALLET_REJECTED' }],
      ['FLOFI_WALLET_NO_MATCHING_REVIEW', { message: 'FLOFI_WALLET_NO_MATCHING_REVIEW' }], ['FLOFI_WALLET_CLOSED', { message: 'FLOFI_WALLET_SIGNATURE_UNKNOWN' }]] as const) {
      const { solana, channel } = await setup(async () => { throw new Error(code); });
      const session = await solana.connectSolanaWallet('FloFi Wallet');
      channel.bindFloFiSigning(session.wallet, SIGNING);
      const error = await solana.signWithSolanaWallet(session, b64(unsigned)).catch((cause: { code?: number; message: string }) => cause);
      expect(error).toMatchObject(expected);
      if (code !== 'FLOFI_WALLET_REJECTED') { expect((error as { code?: unknown }).code).toBeUndefined(); expect((error as Error).message).not.toMatch(/reject|declin|denied|cancel/i); }
    }
  });
  it('signs FloFi’s sign-in text through signSolanaMessage and returns the 64-byte signature', async () => {
    const { solana, deps } = await setup(async () => ({ signature: 'ab'.repeat(64) }));
    const session = await solana.connectSolanaWallet('FloFi Wallet');
    const signature = await solana.signSolanaMessage(session, 'flofi.xyz wants you to sign in with your Solana account:');
    expect(Buffer.from(signature, 'base64').toString('hex')).toBe('ab'.repeat(64));
    expect(deps.request).toHaveBeenCalledWith({ op: 'solana_sign_message', address: OWNER, message: 'flofi.xyz wants you to sign in with your Solana account:' });
  });
  it('retires every session when FloFi Wallet leaves the account', async () => {
    const { solana, module, wallet, unregister } = await setup();
    const session = await solana.connectSolanaWallet('FloFi Wallet'), changed = vi.fn();
    solana.subscribeSolanaSession(session, changed);
    await module.retireFloFiSolanaWallet(wallet); unregister();
    expect(changed).toHaveBeenCalledWith(null);
    await expect(solana.signWithSolanaWallet(session, b64(unsigned))).rejects.toThrow('JUPITER_WALLET_CHANGED');
  });
  it('accepts only the same transaction with a non-zero first signature', async () => {
    const { module } = await setup();
    expect(module.signedSameTransaction(unsigned, signedWire())).toBe(true);
    expect(module.signedSameTransaction(unsigned, unsigned)).toBe(false);
  });
});
