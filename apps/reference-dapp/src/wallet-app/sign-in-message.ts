// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001: the only messages FloFi Wallet signs are FloFi's own sign-in messages (security review finding 10).
 *
 * A Sign-In With Ethereum/Solana signature is a FloFi session credential, and a signature over another dapp's domain, another statement or
 * a transaction's bytes could be used elsewhere. So FloFi Wallet accepts exactly the text FloFi's server writes (`server/wallet-session.ts`
 * `walletSignInMessage` / `solanaSignInMessage`): this product host as the domain, the signing wallet's own address, FloFi's fixed
 * statement, `URI: <product origin>`, version 1, then the chain (EVM), a server nonce and the issue and expiry times, and nothing else.
 * An expired message is refused. The statements are copied here because the wallet bundle may not import `src/server`; the unit test
 * checks they are byte-identical to the server's and that every message the server builds is accepted.
 */
import { FLOFI_WALLET_EVM_CHAIN_IDS } from '../wallet/flofi-signing';

export const EVM_SIGN_IN_STATEMENT = 'Sign in to Flofi to operate your own workflow runs. This signature authorizes no transaction and moves no funds.';
export const SOLANA_SIGN_IN_STATEMENT = 'Sign in to Flofi to prove you control this Solana wallet. This signature authorizes no transaction and moves no funds.';

export type SignInMessage = { readonly domain: string; readonly address: string; readonly uri: string; readonly chainId: number | null; readonly nonce: string;
  readonly issuedAt: string; readonly expirationTime: string };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, NONCE = /^[0-9a-f]{32}$/, EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The parsed message when `message` is exactly FloFi's sign-in message for `address` on `app`, unexpired at `now`; otherwise null.
 * EVM addresses compare case-insensitively (the server writes the checksum form); Solana addresses exactly.
 */
export function parseFloFiSignIn(message: string, ecosystem: 'evm' | 'solana', address: string, app: { readonly host: string; readonly origin: string },
  now = Date.now()): SignInMessage | null {
  if (message.length > 2_048 || /[\0\r]/.test(message)) return null;
  const lines = message.split('\n'), evm = ecosystem === 'evm';
  if (lines.length !== (evm ? 11 : 10)) return null;
  const [domain, signer, blank1, statement, blank2, uri, version, ...rest] = lines as [string, string, string, string, string, string, string, ...string[]];
  if (domain !== `${app.host} wants you to sign in with your ${evm ? 'Ethereum' : 'Solana'} account:`) return null;
  if (evm ? !EVM_ADDRESS.test(signer) || signer.toLowerCase() !== address.toLowerCase() : signer !== address) return null;
  if (blank1 !== '' || blank2 !== '' || statement !== (evm ? EVM_SIGN_IN_STATEMENT : SOLANA_SIGN_IN_STATEMENT) || uri !== `URI: ${app.origin}` || version !== 'Version: 1') return null;
  let chainId: number | null = null;
  if (evm) {
    const chain = /^Chain ID: ([1-9][0-9]{0,15})$/.exec(rest.shift() ?? '');
    // FloFi Wallet signs for its four EVM mainnets only: a testnet or unknown chain id is not a FloFi sign-in it will sign.
    if (!chain || !Number.isSafeInteger(Number(chain[1])) || !FLOFI_WALLET_EVM_CHAIN_IDS.has(Number(chain[1]))) return null;
    chainId = Number(chain[1]);
  }
  const [nonceLine = '', issuedLine = '', expiresLine = ''] = rest;
  const nonce = nonceLine.startsWith('Nonce: ') ? nonceLine.slice(7) : '', issuedAt = issuedLine.startsWith('Issued At: ') ? issuedLine.slice(11) : '';
  const expirationTime = expiresLine.startsWith('Expiration Time: ') ? expiresLine.slice(17) : '';
  if (!NONCE.test(nonce) || !ISO.test(issuedAt) || !ISO.test(expirationTime)) return null;
  const issued = Date.parse(issuedAt), expires = Date.parse(expirationTime);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires <= now) return null;
  return { domain: app.host, address: signer, uri: app.origin, chainId, nonce, issuedAt, expirationTime };
}
