# Live provider verification: FloFi accounts and FloFi Wallet (PR #143)

Status: not run. Every check below is still owed. The browser suite and the PostgreSQL tests run against the MOCKED loopback emulator
(`apps/reference-dapp/e2e/turnkey-emulator.ts`). That proves FloFi's own checks, not Google's, Apple's or Turnkey's behaviour. **No live
result may be claimed until this runbook has been executed and its evidence recorded.**

This runbook needs only non-production resources and disposable identities. Never use a production database, production OAuth clients,
the production Turnkey organization, a real user's identity or funds, or any secret in a report.

## 1. Isolated environment (owner provisions; nothing here touches production)

| Resource | Requirement |
| --- | --- |
| Deployment | A Vercel **Preview** of the exact commit under test (not Production). |
| Product origin | The preview URL. `FLOFI_PUBLIC_ORIGIN` must equal it exactly. |
| Wallet origin | A **second host** for the same preview. For example, add a preview-only domain `wallet-<preview>.<owner test domain>` to the same Vercel deployment, or use a dedicated test domain. It must not be a production host. Set `FLOFI_WALLET_ORIGIN` to it. Production pins `https://wallet.flofi.xyz` (`src/accounts/wallet-origin.ts`). |
| Database | A dedicated **empty** Neon/PostgreSQL branch or database that nothing else writes (`DATABASE_URL`). Apply migrations with the existing preview path (`FLOFI_MIGRATE_ON_BUILD=preview`, which refuses a shared database). |
| Session secret | A fresh random `FLOFI_SESSION_SECRET` for the preview only. |
| Turnkey | A **test** parent organization. Create a dedicated P-256 API key (`FLOFI_TURNKEY_ORGANIZATION_ID`, `FLOFI_TURNKEY_API_PUBLIC_KEY`, `FLOFI_TURNKEY_API_PRIVATE_KEY`, secret store only). Enable email OTP; enable Google and Apple OIDC for sub-organizations. If Turnkey enforces allowed origins, allow the wallet origin. |
| Google | **Two** OAuth web clients in a test project. Product client: `FLOFI_GOOGLE_CLIENT_ID`/`_SECRET`, redirect `<product origin>/auth/callback/google`. FloFi Wallet client: `FLOFI_WALLET_GOOGLE_CLIENT_ID`/`_SECRET`, redirect **only** `<wallet origin>/wallet/callback/google`. |
| Apple | **Two** Services IDs. Product: `FLOFI_APPLE_CLIENT_ID`, return URL `<product origin>/auth/callback/apple`. FloFi Wallet: `FLOFI_WALLET_APPLE_CLIENT_ID`, return URL **only** `<wallet origin>/wallet/callback/apple`. Domain verification for both hosts. |
| Identities | Disposable test accounts only: a Google test user, an Apple test Apple ID and a test mailbox. None is a real person's. |
| Chains | **Mainnet only.** FloFi Wallet signs only on Ethereum, Base, Arbitrum One and Robinhood Chain mainnet and on Solana mainnet; it refuses every Devnet/testnet chain or cluster. A signing check therefore moves real funds: one trivial amount per ecosystem, only on the owner's explicit decision, through the normal Review → Authorize flow. This runbook never runs one by itself. |

Never set `FLOFI_TURNKEY_E2E`, `FLOFI_AUTH_E2E_IDP` or `FLOFI_TURNKEY_OTP_SIGNER_PUBLIC_KEY` here. Hosted deployments refuse them.

## 2. Checks (record each with time, commit and result; redact every token, code and address you do not need)

### Sign-in (product origin)
1. **Email.** Request a code for the test mailbox. Confirm the email arrives from Turnkey as a 6-digit code labelled FloFi. Enter it on
   `/login` and confirm you are signed in. In devtools, confirm the code never appears in any request body to the product (only
   `encryptedOtpBundle`). A wrong code fails with "That code is not valid…". A 6th attempt is refused. Reusing a code is refused.
2. **Google** and **Apple**: sign in, sign out and sign in again. Cancelling on the provider page returns with "Sign-in was cancelled".
3. **Web3 Wallet** (MetaMask, Phantom): sign the FloFi sign-in message and confirm you are signed in. Confirm no transaction prompt appears.

### FloFi Wallet (wallet origin)
4. From `/onboarding/wallets`, open FloFi Wallet. Confirm:
   - the popup's URL is the wallet origin;
   - it shows the signed-in account;
   - the product page never shows a code field for it.
5. **Unlock by email.** The code arrives as an 8-character "FloFi Wallet" code and is typed only in the popup. Confirm the sub-organization
   is created in the Turnkey test organization with the test email as its only root user, and that no FloFi API key is a member.
6. **Unlock by Google / Apple** for an account created with them, through the **wallet** client. Then confirm:
   - signing in on the product does not unlock FloFi Wallet;
   - a Google/Apple account other than the linked one is refused.
7. **Create** an EVM and a Solana wallet. Confirm both addresses appear in Credentials → My wallets and in the Turnkey dashboard under the
   test sub-organization.
8. **Import** a key generated for this test only, in Turnkey's frame inside FloFi Wallet. Confirm the product page never receives it.
9. **Export.** It needs an unlock in the last 5 minutes and the checkbox. The secret appears only inside Turnkey's export frame on the
   wallet origin. Confirm the product page and the network log never contain it.
10. **Lock** in FloFi Wallet, or sign out of the product. Confirm the wallet page asks to unlock again, and that a new unlock ends the
    previous Turnkey session (`invalidateExisting`).

### Signing
11. **Solana mainnet** (owner decision; real funds): one transfer of a trivial amount to a second owner-controlled address with FloFi Wallet as
    the wallet. Check, in order:
    - Simulate, then Review and the Strategy Manifest;
    - Authorize;
    - FloFi Wallet shows "Exactly the transaction FloFi prepared for this strategy" with the same recipient, amount and fee;
    - Sign;
    - FloFi broadcasts, the run reconciles, and the evidence is recorded.
    Also confirm that a request not matching a reviewed attempt is refused, and that FloFi Wallet is not offered for a Devnet workflow.
    Without the owner's explicit go-ahead, record Solana signing as **not verified live**.
12. **EVM** (owner decision; real funds): one transfer of a trivial amount on a catalog mainnet, with the same checks. Without the owner's
    explicit go-ahead, record EVM signing as **not verified live**.
13. Confirm Turnkey accepts FloFi's encodings:
    - EVM unsigned EIP-1559 hex without `0x`;
    - Solana v0 message bytes via raw-payload signing with `HASH_FUNCTION_NOT_APPLICABLE`;
    - EIP-191 bytes with `HASH_FUNCTION_KECCAK256`.
    Record the activity ids.

### Turnkey facts still unverified (record the answer with its source)
- Whether verification tokens are single-use; whether `invalidateExisting` ends previous login sessions immediately.
- Whether root users bypass policies, and whether session profiles or MFA policies could restrict export or signing (a future
  hardening layer).
- Whether `OTP_LOGIN_V2` checks the token contact against the sub-organization's user.

## 3. Evidence and clean-up
- Keep screenshots and activity ids in the PR. They must contain no secret, code, token or full key.
- Afterwards, delete the preview's database and environment variables, revoke the test API key and remove the test OAuth clients'
  redirect URIs, unless the owner keeps them for the next run.
