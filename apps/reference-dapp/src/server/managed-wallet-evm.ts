// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the network side of FloFi Wallet's EVM provider (spec §4), on the four catalog mainnets only (Base, Arbitrum,
 * Ethereum, Robinhood Chain). The product page has no RPC of its own (`connect-src 'self'`), so the managed provider reads the owner's
 * pending nonce and the current fees here, and hands the owner-signed transaction to `broadcast`.
 *
 * Why broadcast stays FloFi's: FloFi Wallet only signs; FloFi sends exactly one transaction per reviewed attempt, after the caller has
 * re-resolved that attempt (`managed-signing.ts`) and passes its exact fields here. `broadcast` decodes the signed bytes itself (canonical
 * re-encoding and sender recovery), requires every field and the hash to equal the attempt's, refuses a network without the deployment's
 * real-funds owner-execution opt-in, and sends once through a transport that allows `eth_sendRawTransaction` and nothing else. An ambiguous
 * send is decided by `eth_getTransactionByHash`, never by a second send; anything still unclear is UNKNOWN and left to observation.
 *
 * Shared by the in-process server actions (local development, MOCKED harness) and the `managed-wallet-evm` backend flow (hosted). Plain-Node
 * safe: explicit `.ts` imports, no TypeScript-only runtime syntax.
 */
import { BASE_MAINNET_HARNESS, baseRpcUrl } from './base-mainnet.ts';
import { arbitrumRpcUrl } from './arbitrum-mainnet.ts';
import { ethereumRpcUrl } from './ethereum-mainnet.ts';
import { ROBINHOOD_MAINNET_HARNESS, robinhoodRpcUrl } from './robinhood-mainnet.ts';
import { catalogNetworkOfChain, type CatalogNetworkId, type CatalogNetworkMode, type CatalogNetworkRuntime } from './catalog-networks.ts';
import { decodeSignedEip1559, type ManagedEvmTransaction } from './managed-signing.ts';
import type { Rpc } from './public-testnet-service.ts';

type Env = Readonly<Record<string, string | undefined>>;
/** Read methods this module needs (each network's read client is built with exactly these). */
export const MANAGED_EVM_READ_METHODS = Object.freeze(['eth_chainId', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_maxPriorityFeePerGas',
  'eth_getTransactionByHash']);
/** The only write method, on its own transport. */
export const MANAGED_EVM_SEND_METHOD = 'eth_sendRawTransaction';
export type ManagedEvmFees = { readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string };
/** What the caller re-resolved from the attempt: the transaction FloFi may broadcast, as decimal or hex strings (JSON-safe). */
export type ManagedEvmExpected = { readonly hash: string; readonly from: string; readonly to: string; readonly value: string; readonly data: string; readonly nonce: string;
  readonly gas: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string };
export type ManagedEvmBroadcast = { readonly kind: 'HASH'; readonly hash: string } | { readonly kind: 'UNKNOWN'; readonly code: string };
type SendRpc = (raw: string) => Promise<{ ok: true; result: unknown } | { ok: false; definite: boolean }>;
const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/;
const fail = (code: string): never => { throw new Error(code); };
const SEND_URL: Readonly<Record<CatalogNetworkId, (mode: 'live' | 'harness', env: Env) => string>> = Object.freeze({
  robinhood: (mode, env) => mode === 'harness' ? ROBINHOOD_MAINNET_HARNESS.rpc : robinhoodRpcUrl(env.GRYLOO_ROBINHOOD_RPC_URL),
  base: (mode, env) => mode === 'harness' ? BASE_MAINNET_HARNESS.rpc : baseRpcUrl(env.GRYLOO_BASE_RPC_URL),
  'arbitrum-one': (mode, env) => mode === 'harness' ? fail('ARBITRUM_MAINNET_NOT_ENABLED') : arbitrumRpcUrl(env.GRYLOO_ARBITRUM_RPC_URL),
  ethereum: (mode, env) => mode === 'harness' ? fail('ETHEREUM_MAINNET_NOT_ENABLED') : ethereumRpcUrl(env.GRYLOO_ETHEREUM_RPC_URL),
});
const quantity = (value: unknown, code: string): bigint => typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value) ? BigInt(value) : fail(code);
const hex = (value: bigint) => `0x${value.toString(16)}`;
const big = (value: string) => /^(?:0x[0-9a-fA-F]{1,64}|0|[1-9][0-9]{0,77})$/.test(value) ? BigInt(value) : fail('FLOFI_WALLET_REQUEST_INVALID');

/** The catalog mainnet of a chain id FloFi Wallet serves, or null. */
export function managedEvmNetwork(chainId: unknown): CatalogNetworkRuntime | null {
  const id = typeof chainId === 'number' ? chainId : typeof chainId === 'string' && QUANTITY.test(chainId.toLowerCase()) ? Number(BigInt(chainId)) : null;
  return id === null || !Number.isSafeInteger(id) ? null : catalogNetworkOfChain(id);
}
/** A JSON-RPC transport that can send one raw transaction and nothing else; an error reply is `definite` (the node refused it). */
export function rawTransactionSender(url: string, transport: typeof fetch = fetch): SendRpc {
  return async raw => {
    let response: Response;
    try {
      response = await transport(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: MANAGED_EVM_SEND_METHOD, params: [raw] }) });
    } catch { return { ok: false, definite: false }; }
    const body = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok || !body) return { ok: false, definite: false };
    return body.error ? { ok: false, definite: true } : 'result' in body ? { ok: true, result: body.result } : { ok: false, definite: false };
  };
}

export function createManagedWalletEvm(input: { readonly env: Env; readonly mode: (network: CatalogNetworkRuntime) => CatalogNetworkMode;
  /** Test seams (MOCKED chains); production builds both from the network's configuration. */
  readonly read?: (network: CatalogNetworkRuntime, mode: 'live' | 'harness') => Rpc; readonly send?: (network: CatalogNetworkRuntime, mode: 'live' | 'harness') => SendRpc }) {
  const reads = new Map<string, Rpc>();
  function network(chainId: unknown): { network: CatalogNetworkRuntime; mode: 'live' | 'harness' } {
    const found = managedEvmNetwork(chainId) ?? fail('FLOFI_WALLET_NETWORK_UNSUPPORTED');
    const mode = input.mode(found!);
    return mode === 'off' ? fail(found!.disabledCode) : { network: found!, mode };
  }
  function read(chainId: unknown): Rpc {
    const { network: n, mode } = network(chainId), key = `${n.id}:${mode}`;
    let rpc = reads.get(key);
    if (!rpc) { rpc = input.read ? input.read(n, mode) : n.rpc(mode, input.env, MANAGED_EVM_READ_METHODS); reads.set(key, rpc); }
    return rpc;
  }
  return {
    /** The owner's next nonce (`pending`), hex. */
    async pendingNonce(chainId: unknown, address: unknown): Promise<string> {
      const owner = typeof address === 'string' ? address.toLowerCase() : '';
      if (!ADDRESS.test(owner)) fail('FLOFI_WALLET_REQUEST_INVALID');
      const rpc = read(chainId);
      try {
        await rpc('eth_chainId', []);
        return hex(quantity(await rpc('eth_getTransactionCount', [owner, 'pending']), 'FLOFI_WALLET_NETWORK_READ_FAILED'));
      } catch (cause) { throw new Error('FLOFI_WALLET_NETWORK_READ_FAILED', { cause }); }
    },
    /** EIP-1559 fees for a request whose Review left them to the wallet: twice the latest base fee plus the node's suggested priority fee. */
    async fees(chainId: unknown): Promise<ManagedEvmFees> {
      const rpc = read(chainId);
      try {
        await rpc('eth_chainId', []);
        const block = await rpc('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas?: unknown } | null;
        const base = quantity(block?.baseFeePerGas, 'FLOFI_WALLET_NETWORK_READ_FAILED');
        const priority = quantity(await rpc('eth_maxPriorityFeePerGas', []), 'FLOFI_WALLET_NETWORK_READ_FAILED');
        return { maxFeePerGas: hex(base * 2n + priority), maxPriorityFeePerGas: hex(priority) };
      } catch (cause) { throw new Error('FLOFI_WALLET_NETWORK_READ_FAILED', { cause }); }
    },
    /**
     * Broadcasts `raw` once if it is exactly `expected` (the re-resolved attempt), signed by its owner, on an owner-enabled network.
     * Throws before sending (nothing left the server); after a send attempt it returns HASH or UNKNOWN, never throws.
     */
    async broadcast(chainId: unknown, raw: unknown, expected: ManagedEvmExpected): Promise<ManagedEvmBroadcast> {
      const { network: n, mode } = network(chainId);
      if (!n.ownerExecutionEnabled(mode, input.env)) fail('OWNER_EXECUTION_NOT_ENABLED');
      const decoded = typeof raw === 'string' ? decodeSignedEip1559(raw) : null;
      if (!decoded) fail('FLOFI_WALLET_SIGNED_TRANSACTION_INVALID');
      const tx: ManagedEvmTransaction = decoded!.tx;
      if (!HASH.test(expected.hash) || decoded!.hash !== expected.hash || tx.chainId !== BigInt(n.chainId) || tx.from !== expected.from.toLowerCase()
        || tx.to !== expected.to.toLowerCase() || tx.value !== big(expected.value) || tx.data !== expected.data.toLowerCase() || tx.nonce !== big(expected.nonce)
        || tx.gas !== big(expected.gas) || tx.maxFeePerGas !== big(expected.maxFeePerGas) || tx.maxPriorityFeePerGas !== big(expected.maxPriorityFeePerGas))
        fail('FLOFI_WALLET_SIGNER_MISMATCH');
      const rpc = read(chainId), sender = input.send ? input.send(n, mode) : rawTransactionSender(SEND_URL[n.id](mode, input.env));
      await rpc('eth_chainId', []).catch(() => fail('FLOFI_WALLET_NETWORK_READ_FAILED'));
      const sent = await sender((raw as string).toLowerCase()).catch(() => ({ ok: false as const, definite: false }));
      if (sent.ok && typeof sent.result === 'string' && sent.result.toLowerCase() === decoded!.hash) return { kind: 'HASH', hash: decoded!.hash };
      // Already known, or accepted while the reply was lost: the network decides, never a second send.
      const known = await rpc('eth_getTransactionByHash', [decoded!.hash]).catch(() => null);
      if (known && typeof known === 'object') return { kind: 'HASH', hash: decoded!.hash };
      return { kind: 'UNKNOWN', code: sent.ok ? 'FLOFI_WALLET_BROADCAST_RESULT_INVALID' : sent.definite ? 'FLOFI_WALLET_BROADCAST_REFUSED' : 'FLOFI_WALLET_BROADCAST_UNCONFIRMED' };
    },
  };
}
export type ManagedWalletEvm = ReturnType<typeof createManagedWalletEvm>;
/** The fields `broadcast` must see, from a resolved attempt's transaction and its signed hash. */
export const expectedBroadcast = (tx: ManagedEvmTransaction, hash: string): ManagedEvmExpected => ({ hash, from: tx.from, to: tx.to, value: hex(tx.value),
  data: tx.data, nonce: hex(tx.nonce), gas: hex(tx.gas), maxFeePerGas: hex(tx.maxFeePerGas), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas) });
