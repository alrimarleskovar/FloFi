<p align="center">
  <img src="apps/reference-dapp/public/brand/flofi-symbol-light.svg" width="72" alt="FloFi" />
</p>

<h1 align="center">FloFi</h1>

<p align="center"><strong>Many ways in. One clear path.</strong><br />
Tell FloFi what you want to do with your crypto. It turns your goal into a clear DeFi workflow that you review, approve and sign with your own wallet.</p>

<p align="center">
  <a href="https://flofi.xyz"><strong>Open FloFi</strong></a> ·
  <a href="https://flofi.xyz/docs">Docs</a> ·
  <a href="https://flofi.xyz/docs/developer-api">FloFi for Developers</a> ·
  <a href="https://x.com/FloFi_xyz">X</a> ·
  <a href="https://discord.gg/36rEhdUa">Discord</a> ·
  <a href="https://www.linkedin.com/company/flofixyz/home/">LinkedIn</a>
</p>

<p align="center">
  <img src="docs/builds/BUILD0-UX-001-EVIDENCE/build0-desktop-dark-1240.png" width="860" alt="FloFi app: “What do you want to do?” with a goal typed into the composer and suggestions for earning yield, swapping, providing liquidity, using collateral and multi-step strategies" />
</p>

> **FloFi is in public beta on mainnet.** Workflows use real funds. Every transaction is simulated and shown to you before your wallet asks you to sign it, but on-chain actions carry market, protocol and smart-contract risk. Start small.

---

## What is FloFi?

FloFi is a **non-custodial, multichain DeFi platform**. Instead of jumping between bridges, DEXs, lending apps and block explorers, you describe a goal — *“swap 50 USDC to ETH on Base”*, *“move my USDC to Arbitrum and supply it to Aave”* — and FloFi builds the workflow for you.

- **Ask in plain language.** FloFi's chat — assisted by its AI Copilot where a deployment enables it — turns your request into proposed steps and asks for anything that is missing. You accept or change them.
- **Or build visually.** The optional canvas shows the same workflow as connected cards you can edit, reorder or delete.
- **See it before you sign it.** FloFi simulates the supported path and shows a review of assets, amounts, limits, permissions and costs.
- **You stay in control.** Your own wallet signs every transaction. FloFi never holds your keys, and an AI suggestion can never move funds.
- **Follow it to the end.** FloFi tracks each step, helps you recover from an interrupted run and checks the result against what you approved.

## Why people use it

| Without FloFi | With FloFi |
| --- | --- |
| Several apps, tabs and networks for one strategy | One workflow, from goal to result |
| Guessing at routes, approvals and fees | A simulated preview and an itemized review before signing |
| Token approvals you can't easily read | Every approval spelled out in review, with a clear warning if one has no spending cap |
| Lost track when a bridge or step stalls | Step-by-step status, recovery and a reconciled outcome |
| Copying addresses between chains | One account with your EVM and Solana wallets side by side |

## What you can do today

FloFi is a **mainnet product** on five networks. It resolves every request by **action × network**: the paths below are implemented end to end in the app — author, quote, simulate, review, authorize, execute, reconcile and recover — and switched on in FloFi's hosted beta at [flofi.xyz](https://flofi.xyz).

| Network | Swap | Bridge | Transfer | Lend & borrow | Add liquidity |
| --- | --- | --- | --- | --- | --- |
| **Ethereum** | Uniswap v3 | ✓ | ✓ | Aave V3 (USDC) — supply, borrow, repay, withdraw | Uniswap v3 |
| **Base** | Uniswap v3 | ✓ | ✓ | Aave V3 (USDC) — supply, borrow, repay, withdraw | Uniswap v3 |
| **Arbitrum One** | Uniswap v3 | ✓ | ✓ | Aave V3 (USDC) — supply, borrow, repay, withdraw | Uniswap v3 |
| **Robinhood Chain** | Uniswap v3, including stock tokens | ✓ | ✓ | — | Uniswap v3 |
| **Solana** | Jupiter | ✓ | SOL and SPL tokens | — | Orca Whirlpools (SOL/USDC) |

**Bridges** connect any of the five networks — including EVM ↔ Solana — through FloFi's cross-chain router, which shows the provider, its fees and the guaranteed minimum you receive before you sign. Supported assets differ per network and protocol; the app offers only the combinations it can execute and explains anything it refuses.

**Multi-step workflows.** Chain actions together — for example *bridge, then swap what arrived*. FloFi runs the steps in order: each one gets a fresh review and your wallet's signature, and starts only after the previous step has settled. A later step can spend exactly what an earlier step actually delivered, never more than you authored.

**Honest status.** These mainnet paths are live in beta but not yet certified: FloFi's recorded, reconciled executions so far are owner runs on test networks, and FloFi does not claim a security audit. Every run records its own evidence; see [Status & evidence](#status--evidence).

## How it works

```
 Sign in or connect   →   Describe or build   →   Review   →   Authorize   →   Track
```

1. **Sign in or connect a wallet.** Use your FloFi account, connect an existing wallet, or just explore the builder without an account.
2. **Describe your goal or build it.** Type what you want on the start screen (*What do you want to do?*) or in the chat. Prefer cards? Open the visual builder. The canvas is optional — you never need it to use chat.
3. **Review.** FloFi simulates the supported path and shows the Strategy Manifest: every asset, amount, limit, approval, recipient, route, provider fee and network fee. Changing anything after review requires a fresh simulation.
4. **Authorize with your wallet.** You approve the reviewed workflow and your wallet signs each transaction. Connecting a wallet never authorizes anything by itself.
5. **Track the result.** Follow progress step by step, check status if a confirmation is slow, recover an interrupted run, and find past workflows and their outcomes in your Dashboard.

## Your account and wallets

FloFi accounts give you one place for your workflows and wallets, without giving FloFi your keys.

- **Sign in your way:** Apple, Google, email code or a Web3 wallet signature (EVM or Solana).
- **Bring or create wallets:** connect wallets you already use, or create and import EVM and Solana wallets secured by [Turnkey](https://www.turnkey.com)'s non-custodial embedded wallets. Imports and exports happen inside Turnkey's own secure frames, never in FloFi's page.
- **Manage them in Credentials → My wallets:** rename, remove, link and — after a recent sign-in and an explicit confirmation — export.
- **No account required to look around:** the builder at `/app` stays open to everyone.

> **Rolling out:** accounts and embedded wallets are new. Apple, Google, email and embedded wallets depend on provider configuration and live verification on each deployment; until a method is enabled, the sign-in screen shows it as unavailable. Embedded wallets do not sign FloFi transactions yet — you sign with a connected wallet.

## Use FloFi where you already are

| Surface | What it does | Availability |
| --- | --- | --- |
| **FloFi app** — [flofi.xyz](https://flofi.xyz) | Chat, visual builder, review, signing, dashboard | Live (beta) |
| **AI assistants via MCP** — `https://flofi.xyz/api/mcp` | Connect an MCP client such as ChatGPT or Claude to plan, compose, validate and simulate strategies with FloFi; the assistant hands the approval back to you in FloFi | Endpoint live; assistants have no signing authority. Acceptance testing with ChatGPT and Claude is still in progress |
| **Telegram** — [@FloFiAppBot](https://t.me/FloFiAppBot) | Compose a proposal in chat, then open it in FloFi to review and sign | Built; live activation pending acceptance testing |
| **WhatsApp** | Same channel model as Telegram | Built; not activated (policy review) |

Whatever the surface, the money moves only after you review in FloFi and sign with your own wallet. Saying *“yes”* or *“execute”* in a chat authorizes nothing.

## Pricing

FloFi's business model is a **0.1% fee on each completed workflow**, calculated on the workflow's input and due only when it completes — failed, refunded or mismatched runs are waived.

**Today, FloFi does not charge or collect this fee.** For completed bridges through FloFi's cross-chain router, FloFi already calculates the 0.1% and records it, and the review screen says it is not collected on-chain yet; other workflows record no fee. How the fee will be settled is still an open decision. You pay only the network's gas and any protocol or provider fees, which are itemized in review before you sign.

## FloFi for Developers

Building a wallet, dapp, agent or fintech? FloFi can be the DeFi workflow layer behind your own experience.

- **Developer API** (`/api/developer/v1`) — discover capabilities, create an immutable strategy, validate and preview it, then hand the approval to your user. Follow status and evidence your user chooses to share.
- **TypeScript SDK** — a zero-dependency client in [`packages/developer-sdk`](packages/developer-sdk/README.md) (Apache-2.0; not yet published to npm).
- **Webhooks** — signed notifications ([Standard Webhooks](https://www.standardwebhooks.com)) derived from durable workflow state.
- **MCP** — the same engine for AI clients over Streamable HTTP with OAuth.

API keys are server-side credentials with **zero financial authority**: nothing they can call signs, submits or approves. The Developer API is enabled per deployment and currently issues **sandbox (test-funds) keys only**. Because FloFi's hosted product is mainnet-only, today you build and test an integration against a local engineering deployment; production keys are not issued yet.

Start with the [Developer API docs](https://flofi.xyz/docs/developer-api), the [quickstart](docs/developer/QUICKSTART.md), the [API reference](docs/developer/API.md), [webhooks](docs/developer/WEBHOOKS.md) and the [MCP guide](docs/deploy/MCP.md).

## Security

- **Non-custodial.** FloFi never stores your private keys or recovery phrase and never asks for them.
- **Your wallet is the only authority.** AI proposals, chat messages, MCP tools and API keys cannot authorize or move funds.
- **Review before signing.** Execution needs a fresh simulation, an explicit review of the Strategy Manifest and your wallet's signature. Material edits or expired quotes send you back to review.
- **Fail closed.** Unsupported combinations, mismatched wallets or networks, expired artifacts and unexpected results stop the workflow instead of guessing.
- **Evidence you can inspect.** Results are reconciled against what you approved and recorded with their real evidence level — never upgraded.

Simulation is a preview, not a guarantee of price or outcome. Open-source code and automated tests are not a security audit, and FloFi does not claim one. Read the [security model](docs/SECURITY_MODEL.md) and the [authority matrix](docs/AUTHORITY_MATRIX.md).

## Status & evidence

FloFi is in active development and released as a beta. Capabilities can differ between deployments and are always resolved per action and network.

- [Current status](docs/STATUS.md) and [build reports](docs/builds) — what each release delivered and what it did not verify.
- [Evidence levels](docs/EVIDENCE_LEVELS.md) — how FloFi labels proof, from mocked tests to recorded on-chain execution.

**Built, switched on per deployment:** Automations — scheduled DCA, price triggers and daily market watches — that propose each occurrence for you to confirm and sign. Optional *automatic within limits* execution is built but stays blocked in production until a custody-grade signing service exists.

**On the roadmap:** Tempo as the next network, more protocols, certified mainnet execution, live activation of conversational channels, production Developer API keys and settlement of the workflow fee. Roadmap items are not shipped features.

## Documentation

| | |
| --- | --- |
| [FloFi Docs](https://flofi.xyz/docs) | Getting started, your first workflow, networks, simulation, review, wallet authorization |
| [Developer docs](docs/developer/README.md) | API, SDK, webhooks, OpenAPI |
| [MCP](docs/deploy/MCP.md) · [Telegram](docs/deploy/TELEGRAM.md) · [WhatsApp](docs/deploy/WHATSAPP.md) | Connecting AI clients and channels |
| [Product specification](docs/specs/MASTER_SPEC_V3.2.md) | Product model and intended scope |
| [Security model](docs/SECURITY_MODEL.md) · [Authority matrix](docs/AUTHORITY_MATRIX.md) | Who can do what |
| [Deployment guides](docs/deploy) | Operating a FloFi deployment |
| [Engineering history](docs/builds/README-ENGINEERING-HISTORY.md) | The previous, build-oriented README |

## Run FloFi locally (developers)

Requires **Node 24.21.0** and **pnpm 11.22.0** (pinned).

```bash
git clone https://github.com/FloFi-xyz/FloFi.git
cd FloFi
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm --filter @defi-workflow-engine/reference-dapp dev
```

Open `http://127.0.0.1:3000` for the landing page, `/app` for the builder and `/docs` for the documentation. A plain local run lets you author workflows without a wallet, with every execution flow off: quotes, simulation, accounts, channels and execution each need their documented configuration ([environment reference](docs/deploy/ENVIRONMENT.md)). Test networks are available only on a local engineering server (`FLOFI_NETWORK_SCOPE=ENGINEERING_TESTNETS`). Some runtime settings keep their legacy `GRYLOO_*` names for compatibility.

```bash
pnpm check                              # typecheck, lint, build, schema drift, unit tests
python3 scripts/governance_lite.py      # repository safety checks
```

Browser, PostgreSQL and fork suites need extra local tooling; see the [CI workflow](.github/workflows/contracts.yml).

## Contributing

Contributions follow [GOVERNANCE-LITE](docs/SCOPE_GUARD.md): branch → change → tests → pull request → CI → maintainer review and merge. Keep wallet authority, fail-closed checks, evidence levels, dependency integrity and attribution intact, and say in your PR what you did not test. Questions and bugs: [GitHub issues](https://github.com/FloFi-xyz/FloFi/issues).

## License

FloFi is multi-licensed. Workflow contracts, the action registry, the Developer SDK and eligible documentation are **Apache-2.0**; the reference app and the reference linter, compiler, executor and reconciler are **AGPL-3.0-only**. See [LICENSE](LICENSE), the [license map](docs/LICENSE_MAP.md), [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The FloFi name and marks are not licensed by the source licenses; see [TRADEMARKS.md](TRADEMARKS.md).

FloFi was formerly named Gryloo. Historical records and some runtime identifiers keep that name ([brand ADR](docs/adr/ADR-0006-flofi-product-brand.md)).
