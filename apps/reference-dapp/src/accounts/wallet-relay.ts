// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: FloFi Wallet's relay for its stamped provider requests (wallet origin only).
 *
 * The wallet page stamps each request with the wallet-origin key that the person unlocked; the relay forwards body and stamp byte for
 * byte and can neither create nor alter either. Before forwarding it requires: a valid wallet session for a valid account session, a
 * stamp by exactly the unlocked key, canonical JSON, the account's own provider organization, an allowlisted activity, and per activity:
 * - create / import: the organization's own user;
 * - export: an unlock in the last 5 minutes and a managed wallet saved to this account;
 * - sign transaction: `signWith` is a managed EVM wallet saved to this account; EIP-1559 (type 2) only;
 * - Solana transactions: sign raw payload over the exact v0 message, whose fee payer must be that managed Solana wallet;
 * - both transaction kinds, in addition: the `x-flofi-signing: <flow>:<runId>` binding to a reviewed FloFi attempt (spec §2). The caller's
 *   `attempt` gate loads that run through its own service and requires its PREPARED/SUBMITTING attempt to belong to this signer and to
 *   carry exactly these bytes, and claims that attempt's single signature. No binding, or no gate, is a refusal (fail closed);
 * - sign raw payload: only a sign-in message naming the signing wallet (EIP-191 personal message bytes hashed by the provider with
 *   keccak256 for EVM, the UTF-8 text for Solana), never a pre-hashed digest or transaction bytes: the original message travels in a
 *   header and the relay recomputes the payload from it.
 * Broadcasting activities (eth_send_*, sol_send_*), policies, users and API keys are never relayed: FloFi alone broadcasts, after its
 * own verification of the signed bytes. These checks are defence in depth; the person's confirmation in the wallet page comes first.
 */
import { publicKeyBytes } from '@defi-workflow-engine/reference-compiler';
import { accountWalletId, canonicalAddress, MANAGED_PROVIDER, type AccountWallet } from './account-model.ts';
import { SOLANA_SIGN_IN_STATEMENT, WALLET_SIGN_IN_STATEMENT } from '../server/wallet-session.ts';
import { unlockedFor, WALLET_EXPORT_UNLOCK_SECONDS, type WalletSession } from './wallet-session.ts';
import { decodeUnsignedEip1559, type ManagedSigningRequest } from '../server/managed-signing.ts';
import { FLOFI_WALLET_EVM_CHAIN_IDS, parseSigningHeader, type SigningContext } from '../wallet/flofi-signing.ts';

const ALLOWED = new Map<string, string | null>([
  ['submit/create_wallet', 'ACTIVITY_TYPE_CREATE_WALLET'], ['submit/init_import_private_key', 'ACTIVITY_TYPE_INIT_IMPORT_PRIVATE_KEY'],
  ['submit/import_private_key', 'ACTIVITY_TYPE_IMPORT_PRIVATE_KEY'], ['submit/export_wallet', 'ACTIVITY_TYPE_EXPORT_WALLET'],
  ['submit/export_wallet_account', 'ACTIVITY_TYPE_EXPORT_WALLET_ACCOUNT'], ['submit/export_private_key', 'ACTIVITY_TYPE_EXPORT_PRIVATE_KEY'],
  ['submit/sign_transaction', 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'], ['submit/sign_raw_payload', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2'],
  ['query/get_activity', null],
]);
const STAMP = /^[A-Za-z0-9_-]{40,2048}$/, MAX_BODY = 65_536, HEX = /^(?:0x)?[0-9a-fA-F]*$/;
/** A sign-in message only: SIWE/EIP-4361 or Sign-In With Solana text, bounded, printable. */
const SIGN_IN_MESSAGE = /^[^\n]{1,256} wants you to sign in with your (?:Ethereum|Solana) account:\n[^\0]{1,4000}$/;
export type WalletRelayDecision = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly status: number; readonly code: string };
type Organization = { readonly organizationId: string; readonly userId: string } | null;
/** Resolves a signing binding to its reviewed attempt and claims it (`app/flofi-wallet-signing.ts` `signingGate`, with `claim: true`). */
export type WalletSigningGate = (context: SigningContext, request: ManagedSigningRequest) => Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }>;

/** The public key inside an `X-Stamp` header (base64url JSON), or null. */
export function stampPublicKey(stamp: string): string | null {
  try {
    const value = JSON.parse(Buffer.from(stamp, 'base64url').toString('utf8')) as { publicKey?: unknown; scheme?: unknown };
    return value.scheme === 'SIGNATURE_SCHEME_TK_API_P256' && typeof value.publicKey === 'string' && /^0[23][0-9a-f]{64}$/.test(value.publicKey) ? value.publicKey : null;
  } catch { return null; }
}
const strip = (value: string) => value.replace(/^0x/i, '').toLowerCase();

/**
 * Whether `message` is exactly a FloFi sign-in message for the product host: `<appHost> wants you to sign in with your <chain> account:`,
 * the signing address, FloFi's own statement and `URI: <appOrigin>`. Another dapp's domain or statement is never signed.
 */
export function floFiSignInMessage(message: string, ecosystem: 'evm' | 'solana', address: string, app: { readonly host: string; readonly origin: string }): boolean {
  if (!SIGN_IN_MESSAGE.test(message)) return false;
  const lines = message.split('\n'), chain = ecosystem === 'evm' ? 'Ethereum' : 'Solana';
  const statement = ecosystem === 'evm' ? WALLET_SIGN_IN_STATEMENT : SOLANA_SIGN_IN_STATEMENT;
  // EVM: the message's chain must be one of FloFi Wallet's mainnets (Solana sign-in messages name no cluster).
  const evmChain = ecosystem === 'evm' ? /^Chain ID: ([1-9][0-9]{0,15})$/.exec(lines[7] ?? '') : null;
  if (ecosystem === 'evm' && (!evmChain || !FLOFI_WALLET_EVM_CHAIN_IDS.has(Number(evmChain[1])))) return false;
  return lines[0] === `${app.host} wants you to sign in with your ${chain} account:` && canonicalAddress(ecosystem, lines[1] ?? '') === address
    && lines[2] === '' && lines[3] === statement && lines[4] === '' && lines[5] === `URI: ${app.origin}` && lines[6] === 'Version: 1';
}

export async function walletRelayDecision(input: { readonly path: string; readonly body: string; readonly stamp: string | null; readonly message: string | null;
  readonly app: { readonly host: string; readonly origin: string };
  /** The `x-flofi-signing` header and the gate that checks it; both are required to relay a transaction signature. */
  readonly signing?: string | null; readonly attempt?: WalletSigningGate;
  readonly session: WalletSession | null; readonly organization: Organization; readonly apiBaseUrl: string | null;
  readonly wallets: () => Promise<readonly AccountWallet[]>; readonly managedResource: (wallet: AccountWallet) => Promise<{ origin: string; resource: string } | null>;
  readonly now: Date }): Promise<WalletRelayDecision> {
  const deny = (status: number, code: string): WalletRelayDecision => ({ ok: false, status, code });
  if (!input.apiBaseUrl) return deny(503, 'MANAGED_WALLETS_NOT_CONFIGURED');
  if (!input.session) return deny(401, 'WALLET_SESSION_REQUIRED');
  if (!input.organization) return deny(403, 'MANAGED_ORGANIZATION_MISSING');
  if (!ALLOWED.has(input.path)) return deny(404, 'PROVIDER_ROUTE_NOT_ALLOWED');
  if (!input.stamp || !STAMP.test(input.stamp)) return deny(400, 'PROVIDER_STAMP_REQUIRED');
  // Only the key this wallet session unlocked may be relayed (no other browser key, and nothing once the unlock has ended).
  const key = stampPublicKey(input.stamp);
  if (!key || !input.session.unlockedKey || !unlockedFor(input.session, key, input.now)) return deny(403, 'WALLET_UNLOCK_REQUIRED');
  if (input.body.length > MAX_BODY) return deny(413, 'PROVIDER_REQUEST_TOO_LARGE');
  let body: Record<string, unknown>;
  try { body = JSON.parse(input.body) as Record<string, unknown>; } catch { return deny(400, 'PROVIDER_REQUEST_INVALID'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny(400, 'PROVIDER_REQUEST_INVALID');
  // The exact serialization the page stamped: duplicate keys or a re-encoding could make these checks and the provider read different values.
  if (JSON.stringify(body) !== input.body) return deny(400, 'PROVIDER_REQUEST_NOT_CANONICAL');
  if (body.organizationId !== input.organization.organizationId) return deny(403, 'PROVIDER_ORGANIZATION_MISMATCH');
  const type = ALLOWED.get(input.path);
  if (type && body.type !== type) return deny(400, 'PROVIDER_ACTIVITY_MISMATCH');
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters) ? body.parameters as Record<string, unknown> : {};
  const managed = async () => (await input.wallets()).filter(wallet => wallet.provider === MANAGED_PROVIDER && wallet.origin !== 'external');
  const signer = async (address: unknown) => typeof address === 'string'
    ? (await managed()).find(wallet => canonicalAddress(wallet.ecosystem, address) === wallet.address) ?? null : null;
  /** The reviewed attempt these exact bytes belong to (the gate claims it), or the refusal; checked last, after every local rule. */
  const bound = async (request: ManagedSigningRequest): Promise<WalletRelayDecision | null> => {
    const context = parseSigningHeader(input.signing);
    if (!context || !input.attempt) return deny(403, 'FLOFI_WALLET_SIGNING_CONTEXT_REQUIRED');
    const decision = await input.attempt(context, request);
    return decision.ok ? null : deny(403, decision.code);
  };

  if (input.path === 'submit/init_import_private_key' || input.path === 'submit/import_private_key') {
    if (parameters.userId !== input.organization.userId) return deny(403, 'PROVIDER_USER_MISMATCH');
  }
  if (input.path.startsWith('submit/export_')) {
    if (!unlockedFor(input.session, key, input.now, WALLET_EXPORT_UNLOCK_SECONDS)) return deny(403, 'WALLET_UNLOCK_REQUIRED');
    let owned = false;
    for (const wallet of await managed()) {
      const resource = await input.managedResource(wallet);
      if (!resource) continue;
      if (input.path === 'submit/export_wallet' && resource.origin === 'generated' && parameters.walletId === resource.resource) owned = true;
      if (input.path === 'submit/export_private_key' && resource.origin === 'imported' && parameters.privateKeyId === resource.resource) owned = true;
      if (input.path === 'submit/export_wallet_account' && resource.origin === 'generated'
        && accountWalletId(wallet.ecosystem, canonicalAddress(wallet.ecosystem, parameters.address) ?? '') === wallet.id) owned = true;
    }
    if (!owned) return deny(403, 'EXPORT_NOT_SUPPORTED');
  }
  if (input.path === 'submit/sign_transaction') {
    const wallet = await signer(parameters.signWith);
    if (!wallet) return deny(403, 'SIGNER_NOT_MANAGED');
    // EVM only, EIP-1559 (type 2) only: never a blob (3), EIP-7702 (4), Tempo or legacy transaction. Solana transactions are signed as
    // their exact v0 message (sign_raw_payload below), so the provider cannot re-encode them.
    if (wallet.ecosystem !== 'evm' || parameters.type !== 'TRANSACTION_TYPE_ETHEREUM' || typeof parameters.unsignedTransaction !== 'string'
      || !HEX.test(parameters.unsignedTransaction) || !strip(parameters.unsignedTransaction).startsWith('02') || strip(parameters.unsignedTransaction).length > 262_144
      || 'externalSignerPubkey' in parameters) return deny(400, 'SIGN_REQUEST_INVALID');
    const unsigned = decodeUnsignedEip1559(parameters.unsignedTransaction);
    if (!unsigned) return deny(400, 'SIGN_REQUEST_INVALID');
    // Mainnet only: any other chain id (a testnet, an unknown chain) is refused here, before the reviewed attempt is even looked up.
    if (unsigned.chainId > BigInt(Number.MAX_SAFE_INTEGER) || !FLOFI_WALLET_EVM_CHAIN_IDS.has(Number(unsigned.chainId))) return deny(403, 'FLOFI_WALLET_NETWORK_UNSUPPORTED');
    const refused = await bound({ ecosystem: 'evm', tx: { ...unsigned, from: wallet.address } });
    if (refused) return refused;
  }
  if (input.path === 'submit/sign_raw_payload') {
    const wallet = await signer(parameters.signWith);
    if (!wallet) return deny(403, 'SIGNER_NOT_MANAGED');
    if (typeof parameters.payload !== 'string' || !HEX.test(parameters.payload) || 'externalSignerPubkey' in parameters) return deny(400, 'SIGN_REQUEST_INVALID');
    // Solana transaction: the exact v0 message (0x80 prefix, at least one required signature) whose fee payer is this wallet.
    if (wallet.ecosystem === 'solana' && input.message === null) {
      const bytes = Buffer.from(strip(parameters.payload), 'hex');
      const payer = bytes.length >= 37 && bytes.length <= 1_232 && bytes[0] === 0x80 && bytes[1]! >= 1 && bytes[4]! >= 1 && bytes[4]! < 0x80 ? bytes.subarray(5, 37) : null;
      if (!payer || parameters.encoding !== 'PAYLOAD_ENCODING_HEXADECIMAL' || parameters.hashFunction !== 'HASH_FUNCTION_NOT_APPLICABLE'
        || !Buffer.from(publicKeyBytes(wallet.address)).equals(payer)) return deny(400, 'SIGN_REQUEST_INVALID');
      const refused = await bound({ ecosystem: 'solana', address: wallet.address, message: new Uint8Array(bytes) });
      if (refused) return refused;
      return { ok: true, url: `${input.apiBaseUrl}/public/v1/${input.path}` };
    }
    // Only FloFi's own sign-in message for this product host, naming the signing wallet itself.
    if (!input.message || !floFiSignInMessage(input.message, wallet.ecosystem, wallet.address, input.app)) return deny(400, 'SIGN_REQUEST_INVALID');
    // EVM: the EIP-191 personal-message bytes, hashed by the provider with keccak256 (so no pre-hashed digest, which could be a
    // transaction's signing hash, is ever accepted). Solana: the UTF-8 message itself (Ed25519 signs the bytes).
    const bytes = Buffer.from(input.message, 'utf8');
    const expected = wallet.ecosystem === 'evm' ? Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, 'utf8'), bytes]).toString('hex')
      : bytes.toString('hex');
    const encoding = 'PAYLOAD_ENCODING_HEXADECIMAL', hash = wallet.ecosystem === 'evm' ? 'HASH_FUNCTION_KECCAK256' : 'HASH_FUNCTION_NOT_APPLICABLE';
    if (parameters.encoding !== encoding || parameters.hashFunction !== hash || strip(parameters.payload) !== expected) return deny(400, 'SIGN_REQUEST_INVALID');
  }
  return { ok: true, url: `${input.apiBaseUrl}/public/v1/${input.path}` };
}
