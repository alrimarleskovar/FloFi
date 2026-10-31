// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-FLOFI-AUTH-WALLETS-001 browser-suite harness — MOCKED, LOOPBACK ONLY. Never a public provider, never a real key or identity.
 *
 * - Identity provider: `/google/*` (authorization code + PKCE S256, token endpoint, JWKS) and `/apple/*` (form_post ID token, JWKS).
 *   ID tokens are real RS256 JWTs signed by a key generated at start-up, so FloFi's server verification runs unchanged.
 * - Wallet provider: `/public/v1/*` is the shared emulator (e2e/turnkey-emulator.ts): verified stamps, encrypted OTP, client signatures
 *   and DISPOSABLE in-memory signing keys that exist only in this process for this run.
 * - Two relying parties per provider: the product clients (redirect to the product's `/auth/callback/*`) and FloFi Wallet's own clients
 *   (redirect only to the wallet origin's `/wallet/callback/*`), as production registers them.
 * - Ports +1 (export) and +2 (import) serve stand-ins for the provider's frames, speaking the iframe-stamper message protocol. The export
 *   frame shows a MOCKED notice, never a secret.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createTurnkeyEmulator } from './turnkey-emulator.ts';

const port = Number(process.env.FLOFI_ACCOUNT_HARNESS_PORT ?? '8571');
const origin = `http://127.0.0.1:${port}`;
const appOrigin = process.env.FLOFI_ACCOUNT_HARNESS_APP_ORIGIN ?? '';
const parentKey = (process.env.FLOFI_ACCOUNT_HARNESS_PARENT_PUBLIC_KEY ?? '').toLowerCase();
const parentOrg = process.env.FLOFI_ACCOUNT_HARNESS_PARENT_ORG ?? '';
const googleClient = process.env.FLOFI_ACCOUNT_HARNESS_GOOGLE_CLIENT ?? '', googleSecret = process.env.FLOFI_ACCOUNT_HARNESS_GOOGLE_SECRET ?? '';
const appleClient = process.env.FLOFI_ACCOUNT_HARNESS_APPLE_CLIENT ?? '';
const walletOrigin = process.env.FLOFI_ACCOUNT_HARNESS_WALLET_ORIGIN ?? '';
const walletGoogleClient = process.env.FLOFI_ACCOUNT_HARNESS_WALLET_GOOGLE_CLIENT ?? '', walletGoogleSecret = process.env.FLOFI_ACCOUNT_HARNESS_WALLET_GOOGLE_SECRET ?? '';
const walletAppleClient = process.env.FLOFI_ACCOUNT_HARNESS_WALLET_APPLE_CLIENT ?? '';
/** Each client's only allowed redirect prefix (product clients → product callbacks; wallet clients → wallet callbacks). */
const CLIENTS: Readonly<Record<string, { readonly provider: 'google' | 'apple'; readonly secret: string | null; readonly redirect: string }>> = Object.freeze({
  [googleClient]: { provider: 'google', secret: googleSecret, redirect: `${appOrigin}/auth/callback/` },
  [appleClient]: { provider: 'apple', secret: null, redirect: `${appOrigin}/auth/callback/` },
  ...walletOrigin ? { [walletGoogleClient]: { provider: 'google' as const, secret: walletGoogleSecret, redirect: `${walletOrigin}/wallet/callback/` },
    [walletAppleClient]: { provider: 'apple' as const, secret: null, redirect: `${walletOrigin}/wallet/callback/` } } : {},
});
// The MOCKED stand-in for the provider's OTP signing key (Turnkey's TLS fetcher key in production): it signs the encryption target and
// the verification tokens. Generated per run by the Playwright config; the app is told its public half only in MOCKED mode.
const otpSignerPrivate = (process.env.FLOFI_ACCOUNT_HARNESS_OTP_SIGNER_PRIVATE_KEY ?? '').toLowerCase();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(appOrigin) || !/^0[23][0-9a-f]{64}$/.test(parentKey) || !parentOrg || !googleClient || !appleClient
  || !/^[0-9a-f]{64}$/.test(otpSignerPrivate)) throw new Error('ACCOUNT_HARNESS_CONFIG_INVALID');
// The provider stand-in (stamps, encrypted OTP, client signatures, disposable signing keys): e2e/turnkey-emulator.ts.
const emulator = createTurnkeyEmulator({ parentPublicKey: parentKey, parentOrg, otpSignerPrivateKey: otpSignerPrivate });
/**
 * How many signing activities reached this provider stand-in, whatever their outcome: the browser suite reads it (GET
 * `/__e2e/signing-activity`, from the test process) to prove that a request FloFi Wallet refused never got here. Counts only, never content.
 */
const signingActivity = { sign_raw_payload: 0, sign_transaction: 0 };

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e-1', alg: 'RS256', use: 'sig' };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(provider: 'google' | 'apple', sub: string, nonce: string, aud: string) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'e2e-1', typ: 'JWT' })}.${b64({ iss: `${origin}/${provider}`, aud, ...provider === 'google' ? { azp: aud } : {}, sub, nonce,
    email: `${sub}@flofi-e2e.test`, email_verified: provider === 'apple' ? 'true' : true, iat: now, exp: now + 600 })}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
}
const FRAME = (kind: 'import' | 'export') => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:13px "IBM Plex Mono",monospace;background:#15181F;color:#F4F5F7}textarea{box-sizing:border-box;width:100%;height:96px;border:0;background:#1C2029;color:#F4F5F7;padding:10px;resize:none}
p{margin:8px 10px;color:#A4ABB8}strong{color:#F5B94A}</style></head><body>
${kind === 'import' ? '<p><strong>MOCKED</strong> test frame standing in for the provider’s secure field</p><textarea aria-label="Private key" spellcheck="false"></textarea>'
    : '<p id="out"><strong>MOCKED</strong> export frame. The provider’s real frame shows the secret here; this test harness has none.</p>'}
<script>
let port=null;const key=[...crypto.getRandomValues(new Uint8Array(33))].map(b=>b.toString(16).padStart(2,'0')).join('');
const reply=(type,value,requestId)=>port&&port.postMessage({type,value,requestId});
addEventListener('message',e=>{if(e.data&&e.data.type==='TURNKEY_INIT_MESSAGE_CHANNEL'&&e.ports[0]){port=e.ports[0];port.onmessage=handle;reply('PUBLIC_KEY_READY',key);}});
async function handle(e){const {type,requestId}=e.data||{};
 if(type==='APPLY_SETTINGS')return reply('SETTINGS_APPLIED',true,requestId);
 if(type==='INJECT_IMPORT_BUNDLE')return reply('BUNDLE_INJECTED',true,requestId);
 if(type==='EXTRACT_KEY_ENCRYPTED_BUNDLE'){const t=document.querySelector('textarea');const v=(t&&t.value||'').trim();if(!v)return reply('ERROR','empty key',requestId);
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));t.value='';return reply('ENCRYPTED_BUNDLE_EXTRACTED','mock-encrypted:'+[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join(''),requestId);}
 if(type==='INJECT_WALLET_EXPORT_BUNDLE'||type==='INJECT_KEY_EXPORT_BUNDLE'){document.getElementById('out').innerHTML='<strong>MOCKED</strong> '+(type==='INJECT_WALLET_EXPORT_BUNDLE'?'recovery phrase':'private key')+' would be shown here by the provider. No secret exists in this test.';return reply('BUNDLE_INJECTED',true,requestId);}
 reply('ERROR','unsupported',requestId);}
</script></body></html>`;

const authorizePage = (provider: 'google' | 'apple', params: URLSearchParams) => {
  const users = provider === 'google' ? ['e2e-google-ana', 'e2e-google-bruno'] : ['e2e-apple-carla'];
  const buttons = users.map(user => `<button name="user" value="${user}">Continue as ${user} (MOCKED)</button>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>MOCKED ${provider} sign-in</title></head><body style="font:16px sans-serif;padding:32px">
<h1>MOCKED ${provider === 'google' ? 'Google' : 'Apple'} sign-in (loopback test identity provider)</h1>
<form method="post" action="/${provider}/consent">${[...params].map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('')}${buttons}
<button name="user" value="__cancel">Cancel</button></form></body></html>`;
};
const codes = new Map<string, { sub: string; nonce: string; challenge: string; redirect: string; client: string }>();

async function read(request: IncomingMessage): Promise<string> { let body = ''; for await (const chunk of request) body += chunk; return body; }
function send(response: ServerResponse, status: number, body: string, type = 'application/json', headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': type, 'access-control-allow-origin': appOrigin, 'access-control-allow-headers': 'content-type, x-stamp',
    'access-control-allow-methods': 'POST, OPTIONS', 'cache-control': 'no-store', ...headers });
  response.end(body);
}
// Like the provider's own frames, each stand-in frame is served at the root of its own origin: export on port + 1, import on port + 2.
for (const [offset, kind] of [[1, 'export'], [2, 'import']] as const)
  createServer((_, response) => send(response, 200, FRAME(kind), 'text/html; charset=utf-8')).listen(port + offset, '127.0.0.1');
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', origin);
  try {
    if (request.method === 'OPTIONS') return send(response, 204, '');
    if (url.pathname === '/google/jwks' || url.pathname === '/apple/jwks') return send(response, 200, JSON.stringify({ keys: [jwk] }));
    if (url.pathname === '/google/authorize' || url.pathname === '/apple/authorize') return send(response, 200, authorizePage(url.pathname.startsWith('/google') ? 'google' : 'apple', url.searchParams), 'text/html; charset=utf-8');
    if (url.pathname === '/google/consent' || url.pathname === '/apple/consent') {
      const form = new URLSearchParams(await read(request)), redirect = form.get('redirect_uri') ?? '', state = form.get('state') ?? '', user = form.get('user') ?? '';
      const client = CLIENTS[form.get('client_id') ?? ''], provider = url.pathname.startsWith('/google') ? 'google' : 'apple';
      if (!client || client.provider !== provider) return send(response, 400, 'client refused', 'text/plain');
      if (!redirect.startsWith(client.redirect)) return send(response, 400, 'redirect refused', 'text/plain');
      if (url.pathname === '/google/consent') {
        const target = new URL(redirect);
        if (user === '__cancel') target.searchParams.set('error', 'access_denied');
        else { const code = randomBytes(16).toString('hex'); codes.set(code, { sub: user, nonce: form.get('nonce') ?? '', challenge: form.get('code_challenge') ?? '', redirect, client: form.get('client_id')! }); target.searchParams.set('code', code); }
        target.searchParams.set('state', state);
        return send(response, 303, '', 'text/plain', { location: target.toString() });
      }
      const fields = user === '__cancel' ? { state, error: 'user_cancelled_authorize' } : { state, code: randomBytes(8).toString('hex'), id_token: idToken('apple', user, form.get('nonce') ?? '', form.get('client_id')!) };
      return send(response, 200, `<!doctype html><html><body><form id="f" method="post" action="${redirect}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')}</form>
<script>document.getElementById('f').submit()</script></body></html>`, 'text/html; charset=utf-8');
    }
    if (url.pathname === '/google/token' && request.method === 'POST') {
      const form = new URLSearchParams(await read(request)), entry = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      const client = CLIENTS[form.get('client_id') ?? ''];
      if (!entry || !client || entry.client !== form.get('client_id') || form.get('client_secret') !== client.secret || entry.challenge !== challenge || form.get('redirect_uri') !== entry.redirect)
        return send(response, 400, JSON.stringify({ error: 'invalid_grant' }));
      return send(response, 200, JSON.stringify({ id_token: idToken('google', entry.sub, entry.nonce, entry.client), token_type: 'Bearer' }));
    }
    const match = /^\/public\/v1\/((?:submit|query)\/[a-z_]+)$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      if (match[1] === 'submit/sign_raw_payload') signingActivity.sign_raw_payload += 1;
      if (match[1] === 'submit/sign_transaction') signingActivity.sign_transaction += 1;
      const [status, value] = emulator.request(match[1]!, await read(request), request.headers['x-stamp'] as string | undefined);
      return send(response, status, JSON.stringify(value));
    }
    if (url.pathname === '/__e2e/signing-activity' && request.method === 'GET') return send(response, 200, JSON.stringify(signingActivity));
    if (url.pathname === '/health') return send(response, 200, '{"ok":true}');
    send(response, 404, '{}');
  } catch (error) { send(response, 500, JSON.stringify({ message: String(error) })); }
}).listen(port, '127.0.0.1');
