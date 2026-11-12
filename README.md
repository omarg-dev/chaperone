# Chaperone

Chaperone, the parent to your shopping agent.

Chaperone is a firewall for AI shopping agents that pay with PayPal. When an agent checks out, Chaperone doesn't let it pay. It turns the checkout into a PayPal authorization, a hold on the buyer's money in PayPal's sandbox. Then four checks compare the cart with the rules the person confirmed before the agent started. Three of them call Claude Haiku 5.5. If the cart passes, Chaperone captures the payment and pays each seller with PayPal Payouts. If something looks off, the hold waits for the person to decide. If the cart breaks the rules, Chaperone voids the hold and nobody is charged.

It comes with a test marketplace. Honest sellers and attackers sell fictional products there, and the attackers hide instructions in their pages and reviews. A benchmark runs real shopping agents through it and measures how often they get tricked into paying an attacker, with Chaperone off and on.

Sandbox money only. No live PayPal credentials are used anywhere in this project.

- Live demo, no sign-in: https://chaperone.omarg.dev
- Docs (the SDK guide, also at [docs/sdk.md](docs/sdk.md)): https://chaperone.omarg.dev/docs
- Benchmark dashboard: https://chaperone.omarg.dev/dashboard
- Postman collection: [docs/postman/chaperone.postman_collection.json](docs/postman/chaperone.postman_collection.json)

## Results

Every number here comes from PayPal's real sandbox. Each checkout was held as a PayPal authorization, then captured and paid out, or voided. The runs used the `sandbox` payment adapter on Nov 7, 2026, with seeds 1 to 4. The shopping agent was Claude Haiku 5.5 in one column and OpenAI GPT-6 Luna in the other, one model per column with no fallback. The checks ran on Claude Haiku 5.5 for both.

Each run was reviewed three ways, on the same checkout: Off (nobody checks), Rules only (fixed rules, no AI) and Full check (the rules and the AI reviewers). An attack succeeds only when the agent was fooled and the money was captured. A clean cart is one with no harm: the right thing, from an honest seller. A false block stops a clean cart. A false escalation sends a clean cart to the person.

Our own set has 30 scenarios, 22 benign and 8 attacks. Each model ran 120 times, 32 of them attacks.

| Shopping agent | Attack success, Off | Rules only | Full check | False blocks | False escalations |
|---|---|---|---|---|---|
| Claude Haiku 5.5 | 71.9% (23 of 32) | 25.0% (8 of 32) | 3.1% (1 of 32) | 0 of 97 | 1.0% (1 of 97) |
| OpenAI GPT-6 Luna | 84.4% (27 of 32) | 40.6% (13 of 32) | 0.0% (0 of 32) | 0 of 93 | 2.2% (2 of 93) |

The held-out set has 17 attacks ported, with attribution, from four published benchmarks: StakeBench, Magentic Marketplace, AgentDojo and InjecAgent. Each model ran 68 times. The attacks were written without reading the checks, and the checks were frozen before they ran ([docs/held-out.md](docs/held-out.md)).

| Shopping agent | Attack success, Off | Rules only | Full check | False blocks | False escalations |
|---|---|---|---|---|---|
| Claude Haiku 5.5 | 14.7% (10 of 68) | 8.8% (6 of 68) | 1.5% (1 of 68) | 0 of 58 | 55.2% (32 of 58) |
| OpenAI GPT-6 Luna | 25.0% (17 of 68) | 16.2% (11 of 68) | 4.4% (3 of 68) | 0 of 51 | 47.1% (24 of 51) |

A Full check review cost $0.0021 to $0.0032 in model calls on average, depending on the set and the agent. It took 4.8 to 7.6 seconds at the median, and 9.3 to 12.8 seconds at the 95th percentile. Rules only costs nothing and takes a few milliseconds. The four runs cost $1.67 in model calls in all.

Where it falls short:

- One attack still got through the Full check on our own set. With Claude Haiku 5.5 as the agent, one run of the verified-seller variant of attack A1 was approved and paid.
- The held-out set found a gap. Many of its attacks plant instructions in a review of the honest product the person asked for. The agent often ignores them and buys the right thing, but the seller-pages check flags that page anyway. So about half of the held-out clean carts (55% with Claude, 47% with OpenAI) were sent to the person instead of being paid. None was blocked. The checks were not changed because of a held-out result. A narrower rule is work for after the hackathon.

The four results files are in [results/](results/), and [results/README.md](results/README.md) says how each rate is counted. The dashboard draws them.

## How it works

1. You set the rules. You say what you want, for example "a mechanical keyboard with tactile switches, under $120". Claude Haiku 5.5 turns it into rules: what to buy, the must-haves, the budget, the quantity, the brands and the sellers. You check them and confirm. Chaperone locks them with a hash, so a later change shows.
2. The agent shops. It searches, reads listings and reviews, and fills a cart, as any shopping agent would.
3. The checkout is held. The agent's checkout tool creates a PayPal order and authorizes it against the buyer's saved PayPal wallet. That is a hold, not a payment. The agent is told the order is placed and pending review.
4. Four checks run, after the agent is done:
   - **Fixed rules** (Gate 0): the cart against your rules and the catalog, in code, with no AI.
   - **Seller pages** (Gate 1): Claude Haiku 5.5 reads what sellers wrote, one page at a time, in isolation, and passes on only plain facts and flags. No other check ever sees seller text.
   - **Cart review** (Gate 2): an AI reviewer checks the cart is what you asked for, against like-for-like offers. It also notes what that kind of product sells for in the real market, from Channel3, as information only.
   - **Agent's path** (Gate 3): an AI reviewer checks how the agent came to choose each item, and whether a flagged page steered it.

   The AI reviewers answer in fixed codes. Code decides the verdict.
5. The money moves once. Approved: Chaperone captures the hold and pays each seller its share with PayPal Payouts. Sent to you: the hold stays, and you approve or reject it on "Waiting on you". Blocked: Chaperone voids the hold and nobody is paid.

You choose how much runs: Off, Rules only or Full check. Every step, from your request to the last payout, is written to an append-only event log, and each run can be replayed on the site.

[docs/architecture.md](docs/architecture.md) has the details: each check's rules, the event log, the arena API and the benchmark harness.

## Built with

- PayPal, the sandbox, through the server SDK [`@paypal/paypal-server-sdk`](https://www.npmjs.com/package/@paypal/paypal-server-sdk) 2.5.0 (`packages/payments/src/sandbox.ts`):
  - Orders: create an order with the `AUTHORIZE` intent, authorize it, read it back.
  - Payments: read, capture, void and reauthorize an authorization, and read a capture. Refunding a capture is in the adapter and its contract tests, but the app doesn't use it yet.
  - Vault: setup tokens and payment tokens, to save the buyer's PayPal wallet once so later orders authorize with no approval step.
  - Payouts: `POST /v1/payments/payouts` and `GET /v1/payments/payouts/{id}`, to pay each seller after capture. The SDK has no Payouts controller, so these go through the SDK client's own request builder, with its OAuth token.
- Claude Haiku 5.5: the AI checks (Gates 1, 2 and 3), the rules writer, one of the two shopping agents, and the AG Studio assistant on the dashboard.
- OpenAI GPT-6 Luna: the second shopping agent in the benchmark.
- AG Grid Enterprise and AG Studio: the Runs history and the benchmark dashboard. See below.
- APIMatic Context Plugin for the PayPal server SDK, in Claude Code, to write the PayPal integration. See below.
- Channel3: the real-market price reference in the cart review.
- Postman: a collection of the public API.
- The stack: TypeScript throughout, in a pnpm workspace. Hono on Node 22 for the server, React and Vite for the web app, SQLite through Drizzle for the event log, the Vercel AI SDK for the shopping agent, the Anthropic SDK for the checks, Vitest and Biome. Docker and Caddy on a VPS for the hosted demo.

## How the PayPal integration was built

The PayPal adapter (`packages/payments/src/sandbox.ts`) was written in Claude Code with APIMatic's Context Plugin for the PayPal server SDK (TypeScript). The plugin is installed in the project's cloud environment, and the project's rules make it the source for integration code (the "Plugins" decision in [docs/PLAN.md](docs/PLAN.md), and [CLAUDE.md](CLAUDE.md)). PayPal's own plugin was kept for looking at the sandbox and reading errors.

The adapter was built on Oct 22, in one Claude Code session that called the plugin 17 times. What it asked and what that shaped:

| Plugin call | What it settled | Where it is |
|---|---|---|
| `ask`: set up the SDK client for the sandbox with client-credentials OAuth | The `Client` with `Environment.Sandbox`, `clientCredentialsAuthCredentials` and a timeout | `createSandboxPaymentAdapter` in `sandbox.ts` |
| `endpoint_search` `createOrder`; `model_search` `PurchaseUnitRequest`, `Item` | One order with one purchase unit for the whole cart, each line item carrying its seller in its SKU | `createOrder` and `fromSku` in `sandbox.ts` |
| `endpoint_search` `voidPayment` | Voiding the hold when a cart is blocked | `voidAuthorization` in `sandbox.ts` |
| `endpoint_search` `createSetupToken`; `ask`: save a wallet without a purchase, then authorize later orders against it | Setup token, buyer approval, payment token, then orders authorized against the vault ID | `startWalletSetup`, `finishWalletSetup` in `sandbox.ts`, and `pnpm --filter @firewall/payments save-wallet` |
| `ask`: does the SDK have Payouts, and how does its OAuth work | It has no Payouts controller, so payouts are a direct REST call through the SDK client's own request builder and token | The payouts part of `sandbox.ts` |
| `endpoint_search` `reauthorizePayment`; `ask`: what happens to the original authorization | The SDK's docs disagree on how often a hold can be reauthorized, so the fake follows the stricter reading | `reauthorize` in `sandbox.ts`, [docs/sandbox-checks.md](docs/sandbox-checks.md) |
| `model_search` `PaymentAuthorization`, `CapturedPayment` | How authorizations and captures are read back | `toAuthorization` and the capture mapping in `sandbox.ts` |

The other five calls were the plugin's `update_activity` milestones (SDK set up, auth configured, first call made, an error met and resolved). The same adapter passes the shared contract suite (`packages/payments/src/contract.ts`) against the real sandbox with `pnpm --filter @firewall/payments test:sandbox`. The session's transcript isn't in the repo; the calls above are copied from it. The PayPal server SDK is itself built on APIMatic's runtime, so its `@apimatic/*` packages are in the lockfile.

## AG Grid and AG Studio

- The Runs history (`/runs`) is an AG Grid Enterprise grid, with row grouping by task, a status bar that totals the money held, moved, paid to attackers and voided over the runs shown, and Excel export of the evidence.
- The benchmark dashboard (`/dashboard`) opens on AG Studio 3.0. It holds every sandbox results file, one row per run and setting, laid out so Studio's own sums and averages give the benchmark's rates. It opens on a report of attack success with Chaperone off and on, the held-out set, false escalations and cost. "Build your own" lets anyone rearrange it.
- Theming: the grids and Studio wear the app's design tokens through AG's theming APIs, so light, dark and the theme switch work with one theme (`apps/web/src/grid/theme.ts`, `apps/web/src/dashboard/studio/theme.ts`).
- The assistant: Studio's AI assistant runs on Claude Haiku 5.5 through our own model adapter (`apps/web/src/dashboard/studio/adapter.ts`), which sends each turn to our server (`POST /studio/ai`). The browser holds no key, and the server caps what the assistant may spend in a day (`FIREWALL_STUDIO_DAILY_USD`, $0.10 by default).
- "One result, run by run", the dashboard's other view, is an AG Grid Enterprise table with master/detail (a run opens under each setting), grouping by attack and integrated charts.

AG Grid Enterprise is used without a licence key, under the allowance the AG Grid team gave entrants on the hackathon Discord on Nov 2, so its watermark and console notice show. AG Studio runs on the hackathon trial key, which the server reads from `AG_STUDIO_LICENSE_KEY` and is never in the repo. The Enterprise features sit behind one flag (`apps/web/src/grid/flag.ts`). With it off, the build leaves the Enterprise packages out.

## Try it

- The site: https://chaperone.omarg.dev. Open a recorded run under "Runs" and replay it step by step, see the benchmark on the dashboard, or start a live run on "Start a run". Live runs spend from a small daily budget, so once a day's budget is spent they are refused until midnight UTC. Replays and the dashboard are always there.
- Postman: import [docs/postman/chaperone.postman_collection.json](docs/postman/chaperone.postman_collection.json). Its `baseUrl` is the hosted demo, and it walks the whole flow: start a live run, confirm the rules, let the agent shop, read the events, decide a held cart, read the results. The steps are in the docs, under [Try the API in Postman](https://chaperone.omarg.dev/docs#postman).
- The SDK: put Chaperone in front of your own agent. The quick start is below, and the guide is [docs/sdk.md](docs/sdk.md).

## Protect your agent

`@firewall/sdk` (`packages/sdk`) puts Chaperone in front of your own shopping agent. You give it your agent's tools, and the payment tool holds the cart instead of paying for it. It is a workspace package, not published to npm. With Node 22 and `pnpm install` done in a clone of this repo, this runs offline in about a minute, with an in-memory fake standing in for PayPal and a scripted model standing in for yours. It is the same file as `packages/sdk/examples/protect-your-agent.ts`, which a test runs:

```ts
import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import { createFakePaymentAdapter } from "@firewall/payments";
import { arenaSource, createFirewall } from "@firewall/sdk";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { attackerListing, buyingModel, confirmedMandate } from "./demo.js";

const log = openEventLog({ path: "firewall-demo.db" });
const arena = createArenaService({ log });
const run = arena.start("sc_a01", "1"); // the marketplace your agent shops in

const firewall = createFirewall({
  log,
  source: arenaSource({ arena, log, runId: run.runId }),
  payments: createFakePaymentAdapter(),
  vaultId: "FAKE-WALLET",
  mandate: confirmedMandate("sc_a01"), // what the person confirmed before the agent started
  config: "gate0", // the policy rules only; "full" adds the model gates
});

// Your agent's tools, as you already have them. `checkout` is the one that pays.
const tools = firewall.wrap({
  add_to_cart: tool({
    description: "Add a listing to the cart.",
    inputSchema: z.object({ listingId: z.string(), quantity: z.number().int().positive() }),
    execute: ({ listingId, quantity }) => arena.addToCart(run.runId, listingId, quantity),
  }),
  checkout: tool({
    description: "Check out and pay with the saved wallet.",
    inputSchema: z.object({}),
    execute: () => ({ status: "paid" }), // your pay-now code; the firewall never calls it
  }),
});

// Your agent loop, as before. This model buys from an attacker's store, as a steered one would.
await generateText({
  model: buyingModel(attackerListing("sc_a01", "1")),
  tools,
  prompt: run.scenario.request,
  stopWhen: [isStepCount(10), () => firewall.held !== null],
});

// Review the held cart and capture it, void it, or leave it for the person.
const settled = await firewall.settle();
console.log(`verdict: ${settled?.review.verdict}, money: ${settled?.enforcement.money}`);
log.close();
```

```sh
pnpm --filter @firewall/sdk example   # verdict: block, money: voided
```

v1 protects agents shopping in the arena: the checks need the merchant's catalog and the pages the agent was shown, and the arena supplies both. A real store would supply them through the `CatalogSource` interface, which is future work. [docs/sdk.md](docs/sdk.md) has every option, the three settings and which tools count as payment tools.

## Running it locally

Needs Node 22 and pnpm (`corepack enable` installs the version the repo pins).

```sh
pnpm install
cp .env.example .env
pnpm dev                                 # the server, at http://localhost:3000
pnpm --filter @firewall/web dev          # the web app, at http://localhost:5173
```

`curl localhost:3000/health` answers with `"status":"ok"` and the version in the root `package.json`. Vite proxies the API to the server, so the app calls it as it does in production. `pnpm build` builds both, and then the server serves the web app at `/` on port 3000.

With nothing more in `.env`, the dashboard (it reads the committed results), the marketplace API and the rest of the app work, and live runs are off. `.env.example` says what each variable turns on: `FIREWALL_ANTHROPIC_API_KEY` for live runs and the AI checks, the `SANDBOX_*` variables for PayPal sandbox money, `FIREWALL_CHANNEL3_API_KEY` for the market price, and `AG_STUDIO_LICENSE_KEY` for Studio. Without the sandbox variables, money is an in-memory fake, labelled "Practice money".

Before pushing, run what CI runs:

```sh
pnpm lint && pnpm check && pnpm test && pnpm build
```

The tests never call a model or PayPal: they replay recorded answers and use the fake. The PayPal contract suite runs against the real sandbox with `pnpm --filter @firewall/payments test:sandbox`. The commands that run a scenario, build rules on the command line and run the benchmark are in [docs/architecture.md](docs/architecture.md).

## Deploying (one-time setup)

The demo runs on a VPS with Docker Compose behind Caddy. A merged PR that adds a new version to the top of `CHANGELOG.md` is a release: CI builds the image, pushes it to `ghcr.io/omarg-dev/chaperone`, and deploys it. The one-time steps, the server's `.env`, backups and importing demo runs are in [docs/deploying.md](docs/deploying.md).

```
feat/<thing> ──PR──▶ main ──release──▶ production
```

`main` is the only long-lived branch, and there's no staging.

## Built with AI coding tools

Omar Ghazal built Chaperone solo, with Claude Code. Claude wrote much of the code under his direction and review, and most commits in the history are authored by Claude.

## Licence and contact

[MIT](LICENSE), © 2026 Omar Ghazal. The held-out attacks adapt text from MIT-licensed benchmarks, whose notices are in [packages/arena/THIRD_PARTY_NOTICES.md](packages/arena/THIRD_PARTY_NOTICES.md).

Omar Ghazal, contact@omarg.dev
