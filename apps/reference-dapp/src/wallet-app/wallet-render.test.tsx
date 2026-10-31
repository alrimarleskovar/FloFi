// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-FLOFI-AUTH-WALLETS-001: what FloFi Wallet's screens show before any interaction: an honest unavailable page, a server render that
// touches no browser state, unlock methods with their availability, Sign disabled until armed, the Review gate, FloFi Wallet's own
// decoding of EVM and Solana bytes, and the export warning.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMessageV0, serializeMessageV0, serializeTransaction, base58Encode } from '@defi-workflow-engine/reference-compiler';
import { walletSignInMessage } from '../server/wallet-session';
import { reviewEvmTransaction } from './evm-transaction';
import { ExportRequest } from './operations';
import type { RequestEnv, WalletAppConfig } from './request-parts';
import { SignControls } from './request-parts';
import { EvmDetails, EvmTransactionRequest, SignMessageRequest, SolanaDetails } from './signing';
import { bytesToBase64, parseUnsignedTransaction, reviewSolanaTransaction, SYSTEM_PROGRAM } from './solana-transaction';
import { UnlockPanel } from './unlock-panel';
import type { WalletContext } from './wallet-api';
import { WalletApp } from './wallet-app';
import { WalletDone } from './wallet-done';
import { WalletUnavailable } from './wallet-shell';

vi.mock('./provider-client', () => ({ walletPublicKey: vi.fn(), clientSignatureOver: vi.fn(), forgetWalletKey: vi.fn(), createWallet: vi.fn(), openImportFrame: vi.fn(),
  openExportFrame: vi.fn(), signEvmTransaction: vi.fn(), signSolanaMessage: vi.fn(), signSignInMessage: vi.fn(), WalletSigningError: class extends Error {} }));

const EVM = '0x' + 'a'.repeat(40), SPENDER = '0x' + 'b'.repeat(40);
const config: WalletAppConfig = { appOrigin: 'https://flofi.xyz', walletOrigin: 'https://wallet.flofi.xyz', otpSignerPublicKey: null,
  frames: { exportIframeUrl: 'https://export.turnkey.com', importIframeUrl: 'https://import.turnkey.com' }, unlock: { email: true, google: false, apple: true } };
const wallet = { id: `evm:${EVM}`, ecosystem: 'evm', address: EVM, origin: 'generated', provider: 'turnkey', providerName: 'FloFi wallet', export: 'recovery-phrase',
  label: 'Main EVM', addedAt: '2026-10-31T10:00:00.000Z' } as const;
const context: WalletContext = { accountId: `acct_${'1'.repeat(32)}`, label: 'ana@example.com', methods: ['email', 'google'], unlocked: true, wallets: [wallet],
  organization: { organizationId: '0b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', userId: '1b5f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', login: 'email' },
  unlockedAt: null, unlockedUntil: null, unlockedKey: null };
const env = (patch: Partial<RequestEnv> = {}): RequestEnv => ({ id: 'req_12345678', config, appHost: 'flofi.xyz', context, unlocked: true, freshUnlock: true,
  onUnlocked: vi.fn(), onContext: vi.fn(), onLockRequired: vi.fn(), setSigning: vi.fn(), succeed: vi.fn(), refuse: vi.fn(), ...patch });
const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('FloFi Wallet screens', () => {
  it('says plainly when this deployment has no FloFi Wallet', () => {
    const html = renderToStaticMarkup(<WalletUnavailable appOrigin="https://flofi.xyz"/>);
    expect(text(html)).toContain('FloFi Wallet isn’t available here');
    expect(html).toContain('href="https://flofi.xyz/app"');
  });
  it('renders on the server without touching the browser, waiting for its opener', () => {
    const html = renderToStaticMarkup(<WalletApp config={config}/>);
    expect(html).toMatch(/role="status"[^>]*>Opening FloFi Wallet…/);
    expect(text(html)).toContain('only here, at wallet.flofi.xyz');
    expect(html).not.toContain('FloFi account');
  });
  it('the sign-in result page reports success or the reason', () => {
    expect(text(renderToStaticMarkup(<WalletDone result="unlocked"/>))).toContain('FloFi Wallet is unlocked');
    expect(renderToStaticMarkup(<WalletDone result="WALLET_UNLOCK_IDENTITY_MISMATCH"/>)).toMatch(/role="alert"[^>]*>That Google or Apple account isn’t the one linked/);
  });
  it('offers the account’s unlock methods, disabling those this deployment cannot run', () => {
    const html = renderToStaticMarkup(<UnlockPanel config={config} context={context} onUnlocked={vi.fn()}/>);
    expect(html).toMatch(/<button type="button" class="[^"]*"[^>]*>.*?Email me a code/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Not available on this deployment yet"[^>]*>.*?Continue with Google/);
    expect(html).not.toContain('Continue with Apple');
    expect(text(renderToStaticMarkup(<UnlockPanel config={config} context={{ ...context, methods: [] }} onUnlocked={vi.fn()}/>)))
      .toContain('This FloFi account has no sign-in that can unlock FloFi Wallet');
  });
  it('keeps Sign disabled until the window has had attention', () => {
    const html = renderToStaticMarkup(<SignControls id="req_12345678" ready busy={false} label="Sign" busyLabel="Signing…" onSign={vi.fn()} onCancel={vi.fn()}/>);
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="" aria-describedby="req_12345678-arming">Sign<\/button>/);
    expect(text(html)).toContain('Click this window to continue.');
  });
  it('shows nothing signable until the server matched the request to a Review', () => {
    const tx = { from: EVM, to: SPENDER, value: '0x0', data: '0x', chainId: '0x2105', nonce: '0x1', gas: '0x5208', maxFeePerGas: '0x10', maxPriorityFeePerGas: '0x1' };
    const html = renderToStaticMarkup(<EvmTransactionRequest env={env()} address={EVM} tx={tx} signing={{ flow: 'base-swap', runId: `bas-${'c'.repeat(24)}` }}/>);
    expect(text(html)).toContain('Checking this request against your Review in FloFi…');
    expect(text(html)).not.toContain('Exactly the transaction FloFi prepared for this strategy');
    expect(html).toMatch(/disabled="" aria-describedby="req_12345678-arming">Sign</);
    // No binding, or a foreign signer: nothing is rendered (the request is refused when it mounts).
    expect(renderToStaticMarkup(<EvmTransactionRequest env={env()} address={EVM} tx={tx} signing={undefined}/>)).toBe('');
    expect(renderToStaticMarkup(<EvmTransactionRequest env={env()} address={SPENDER} tx={{ ...tx, from: SPENDER }} signing={{ flow: 'base-swap', runId: `bas-${'c'.repeat(24)}` }}/>)).toBe('');
  });
  it('decodes an unlimited token approval with the maximum total cost', () => {
    const review = reviewEvmTransaction({ from: EVM, to: SPENDER, value: '0x0', data: `0x095ea7b3${word(EVM)}${'f'.repeat(64)}`, chainId: '0xa4b1', nonce: '0x7',
      gas: '0x186a0', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x0' })!;
    const shown = text(renderToStaticMarkup(<EvmDetails review={review}/>));
    expect(shown).toContain('This gives the spender unlimited access to this token');
    expect(shown).toMatch(/Network Arbitrum One \(42161\).*Action Token approval.*Token contract 0xb{40}.*Spender 0xa{40}.*Allowance Unlimited/);
    expect(shown).toMatch(/Nonce 7 Gas limit 100000 Max fee per gas 1 gwei Max priority fee 0 gwei Maximum total cost 0\.0001 ETH/);
  });
  it('decodes a Solana transfer, names programs and warns about a durable nonce', () => {
    const key = (n: number) => base58Encode(new Uint8Array(32).fill(n)), owner = key(7);
    const message = serializeMessageV0(compileMessageV0(owner, [
      { programId: SYSTEM_PROGRAM, accounts: [{ pubkey: key(8), isSigner: false, isWritable: true }, { pubkey: key(9), isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: true, isWritable: false }], data: Uint8Array.from([4, 0, 0, 0]) },
      { programId: SYSTEM_PROGRAM, accounts: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: key(10), isSigner: false, isWritable: true }],
        data: Uint8Array.from([2, 0, 0, 0, 0, 0x65, 0xcd, 0x1d, 0, 0, 0, 0]) }], key(12), {}));
    const review = reviewSolanaTransaction(parseUnsignedTransaction(bytesToBase64(serializeTransaction(null, message)), owner));
    const shown = text(renderToStaticMarkup(<SolanaDetails review={review} hash="0xabc"/>));
    expect(shown).toContain('This transaction uses a durable nonce');
    expect(shown).toContain(`Fee payer ${owner}`);
    expect(shown).toContain('System Program · 11111111111111111111111111111111');
    expect(shown).toContain(`Send 0.5 SOL ${owner} → ${key(10)}`);
    expect(shown).toContain('Message SHA-256 0xabc');
  });
  it('shows FloFi’s full sign-in message before signing it', () => {
    const now = new Date(Date.now() - 60_000), expires = new Date(Date.now() + 240_000);
    const message = walletSignInMessage({ domain: 'flofi.xyz', uri: 'https://flofi.xyz', address: EVM, chainId: 8453, nonce: 'a'.repeat(32), issuedAt: now.toISOString(),
      expirationTime: expires.toISOString() });
    const html = renderToStaticMarkup(<SignMessageRequest env={env()} ecosystem="evm" address={EVM} message={message}/>);
    expect(text(html)).toContain('FloFi’s own sign-in message');
    expect(html).toContain('flofi.xyz wants you to sign in with your Ethereum account:');
    expect(renderToStaticMarkup(<SignMessageRequest env={env()} ecosystem="evm" address={EVM} message={message.replace('flofi.xyz', 'evil.example')}/>)).toBe('');
  });
  it('asks for a fresh unlock before export, then for an explicit acknowledgement', () => {
    const stale = text(renderToStaticMarkup(<ExportRequest env={env({ freshUnlock: false })} walletId={wallet.id} kind="recovery-phrase"/>));
    expect(stale).toContain('Unlock again to export');
    expect(stale).not.toContain('I understand');
    const fresh = renderToStaticMarkup(<ExportRequest env={env()} walletId={wallet.id} kind="recovery-phrase"/>);
    expect(text(fresh)).toContain('Anyone who sees this recovery phrase can take everything in this wallet');
    expect(fresh).toMatch(/<input type="checkbox"\/>/);
    expect(fresh).toMatch(/disabled=""[^>]*>Show recovery phrase<\/button>/);
    expect(renderToStaticMarkup(<ExportRequest env={env()} walletId={`evm:0x${'c'.repeat(40)}`} kind="recovery-phrase"/>)).toBe('');
  });
});
