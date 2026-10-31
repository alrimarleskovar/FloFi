# BUILD-FLOFI-AUTH-WALLETS-001 — screenshots

Produced by `apps/reference-dapp/e2e/auth-wallets.spec.ts` under `playwright.auth-wallets.config.ts` (verified headless Chromium 1243,
reduced motion, 1440×900 desktop and 390×844 mobile), then palette-compressed (except the sign-in screens, kept lossless so the provider marks keep their colours). **MOCKED provenance**: the identity provider and the
wallet provider are the loopback harness `e2e/account-harness.ts`; identities (`e2e-google-ana@flofi-e2e.test` …) and addresses are
synthetic. The export screenshots show the harness's MOCKED frame text — no real or test secret exists anywhere. These images prove
FloFi's own screens and flows, not live Google, Apple or Turnkey behaviour.

| File | Screen |
| --- | --- |
| `01-sign-in-desktop-dark.png` | Sign in — desktop, dark |
| `02-sign-in-mobile-dark.png`, `02-sign-in-mobile-dark-pt.png` | Sign in — mobile, EN and PT |
| `03-wallet-introduction-dark.png` | Post-login wallet introduction (Google account) |
| `04-create-import-wallets-dark.png`, `04-create-import-wallets-mobile.png` | Create / import wallets after creating EVM + Solana and importing an EVM key |
| `05-credentials-my-wallets.png` | Credentials → My wallets (two generated, one imported) |
| `06-export-wallet-modal-dark.png` | Export wallet modal before confirmation |
| `06-export-wallet-revealed-in-provider-frame.png` | After confirmation: the (MOCKED) provider frame shows where the secret would appear |
| `07-sign-in-desktop-light.png`, `07-create-import-wallets-light.png`, `07-export-wallet-modal-light.png` | Light variants |
