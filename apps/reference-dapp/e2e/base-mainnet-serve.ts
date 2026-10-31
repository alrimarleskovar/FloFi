// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-BASE-001 loopback harness (127.0.0.1:8562), MOCKED and loopback only.
 *
 * - `/token-list`: FloFi's own Base token-list fixture (packages/action-registry/test/fixtures: token-list format, Base assets read from
 *   chain; the GPL-3.0 Uniswap list itself is never committed) at the path the MOCKED mode reads, so the Canvas search runs over a validated
 *   Base catalog with no public network. `POST /__harness/token-list` switches it between `ok`, `unavailable` (HTTP 503) and `slow`
 *   (answers after 1.5 s).
 * - `/rpc`: the MOCKED in-memory Base mainnet chain (8453) of the unit tests (src/server/robinhood-mainnet.test-harness.ts, Base mode: OP
 *   Stack L1 fee, Uniswap/USDC code) at the URL the MOCKED mode reads and sends to (`BASE_MAINNET_HARNESS.rpc`). Its one write method,
 *   `eth_sendRawTransaction`, takes only a canonical owner-signed EIP-1559 transaction for chain 8453 at the sender's next nonce that the
 *   sender can pay for, includes it in a new block under its real hash, and never forwards anything: there is no public transport here.
 *   The chain exists only once a test starts it: `POST /__harness/chain` `reset` (optionally funding one address with MOCKED ETH); until
 *   then `/rpc` answers 503 and every read fails closed, so a suite that never starts it (Base authoring) sees what it saw before there was one.
 *   `mine` adds empty blocks (confirmations) and `sent` reports how many raw transactions it accepted. The auth-wallets suite uses it for
 *   FloFi Wallet's MOCKED Base mainnet signing journey.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { createRobinhoodMockChain } from '../src/server/robinhood-mainnet.test-harness.ts';
import { baseCatalog } from '../src/server/base-mainnet.test-harness.ts';

const LIST = readFileSync(new URL('../../../packages/action-registry/test/fixtures/base-token-list-fixture.json', import.meta.url), 'utf8');
let mode: 'ok' | 'unavailable' | 'slow' = 'ok', reads = 0;
const BASE_CHAIN_ID = 8453n, ADDRESS = /^0x[0-9a-f]{40}$/;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const newChain = () => createRobinhoodMockChain(baseCatalog(), { now: Date.now, network: 'base' });
let chain: ReturnType<typeof newChain> | null = null, accepted = 0;
const rpcError = (message: string) => Object.assign(new Error(message), { rpc: -32000 });

/** A node's acceptance rules for one raw transaction, then inclusion in a new block under the transaction's own hash. */
async function sendRawTransaction(chain: ReturnType<typeof newChain>, raw: unknown): Promise<string> {
  let decoded: ReturnType<typeof erc7710.decodeSignedEip1559>;
  try { decoded = erc7710.decodeSignedEip1559(String(raw)); } catch { throw rpcError('invalid transaction'); }
  const { tx } = decoded, from = decoded.from.toLowerCase(), hash = decoded.hash.toLowerCase();
  if (tx.chainId !== BASE_CHAIN_ID) throw rpcError('invalid chain id');
  if (chain.state.transactions.has(hash)) return hash; // already known: never a second inclusion
  const nonce = BigInt(String(await chain.rpc('eth_getTransactionCount', [from, 'latest'])));
  if (tx.nonce !== nonce) throw rpcError(tx.nonce < nonce ? 'nonce too low' : 'nonce too high');
  const balance = BigInt(String(await chain.rpc('eth_getBalance', [from, 'latest'])));
  if (tx.value + tx.gasLimit * tx.maxFeePerGas > balance) throw rpcError('insufficient funds for gas * price + value');
  const mocked = chain.apply({ from, to: tx.to.toLowerCase(), data: tx.data.toLowerCase(), value: hex(tx.value), gas: hex(tx.gasLimit), maxFeePerGas: hex(tx.maxFeePerGas) });
  // The in-memory chain names its records by a synthetic id; a node names them by the signed transaction's hash.
  const included = chain.state.transactions.get(mocked)!, receipt = chain.state.receipts.get(mocked)!;
  chain.state.transactions.delete(mocked); chain.state.receipts.delete(mocked);
  chain.state.transactions.set(hash, { ...included, hash, maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas) });
  chain.state.receipts.set(hash, { ...receipt, transactionHash: hash });
  accepted += 1;
  return hash;
}
async function read(request: AsyncIterable<unknown>): Promise<string> {
  let body = '';
  for await (const chunk of request) { body += String(chunk); if (body.length > 1_048_576) throw new Error('MOCK_INPUT_TOO_LARGE'); }
  return body;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8562');
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (request.method === 'POST' && url.pathname === '/__harness/token-list') {
    const next = (JSON.parse(await read(request) || '{}') as { mode?: unknown }).mode;
    if (next !== 'ok' && next !== 'unavailable' && next !== 'slow') { response.writeHead(400).end(); return; }
    mode = next; reads = 0;
    json(200, { mode });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__harness/token-list') { json(200, { mode, reads }); return; }
  if (request.method === 'GET' && url.pathname === '/token-list') {
    reads += 1;
    if (mode === 'unavailable') { response.writeHead(503, { 'content-type': 'text/plain' }).end('MOCKED token list unavailable'); return; }
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1_500));
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(LIST) }).end(LIST);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/__harness/chain') {
    try {
      const control = JSON.parse(await read(request) || '{}') as { action?: unknown; owner?: unknown; wei?: unknown; blocks?: unknown };
      if (control.action === 'reset') {
        chain = newChain(); accepted = 0;
        if (control.owner !== undefined) {
          if (typeof control.owner !== 'string' || !ADDRESS.test(control.owner) || typeof control.wei !== 'string' || !/^[1-9][0-9]{0,30}$/.test(control.wei)) throw new Error('MOCK_CONTROL_DENIED');
          chain.fundNative(control.owner, BigInt(control.wei));
        }
        json(200, { result: true });
      } else if (control.action === 'mine' && chain && Number.isSafeInteger(control.blocks) && (control.blocks as number) > 0 && (control.blocks as number) <= 64) {
        chain.mine(control.blocks as number);
        json(200, { result: chain.state.head });
      } else if (control.action === 'sent') json(200, { result: accepted });
      else throw new Error('MOCK_CONTROL_DENIED');
    } catch { json(400, { error: 'MOCK_CONTROL_DENIED' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/rpc') {
    if (!chain) { response.writeHead(503, { 'content-type': 'text/plain' }).end('MOCKED Base chain not started'); return; }
    let id: unknown = null;
    try {
      const call = JSON.parse(await read(request)) as { id?: unknown; method?: unknown; params?: unknown };
      id = call.id ?? null;
      const params = Array.isArray(call.params) ? call.params : [];
      const result = call.method === 'eth_sendRawTransaction' ? await sendRawTransaction(chain, params[0]) : await chain.rpc(String(call.method), params);
      json(200, { jsonrpc: '2.0', id, result });
    } catch (cause) {
      const error = cause as { message?: unknown; rpc?: unknown };
      json(200, { jsonrpc: '2.0', id, error: { code: typeof error.rpc === 'number' ? error.rpc : -32000, message: String(error.message ?? 'MOCK_RPC_DENIED') } });
    }
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' }).end('MOCKED Base mainnet harness');
}).listen(8562, '127.0.0.1');
