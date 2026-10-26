# Agent checkout firewall (working title)

An intent firewall and adversarial test arena for AI shopping agents. Every purchase an agent makes is held as a payment authorization while a tree of reviewers checks that the cart still matches what the person asked for; only then is the money captured. The arena attacks shopping agents with poisoned listings, so you can measure how often they get tricked with and without the firewall.

Built solo for the hackathon. Sandbox payments only; no live credentials ever touch this project.

The product name isn't final, and the repository will be renamed before submission.

## Status

Building the MVP. The decisions, milestones and the step in progress are in [docs/PLAN.md](docs/PLAN.md).

## Running it locally

Needs Node 22 and pnpm (`corepack enable` installs the version the repo pins).

```sh
pnpm install
cp .env.example .env
pnpm dev            # the server, restarting on changes, at http://localhost:3000
```

`curl localhost:3000/health` answers `{"status":"ok","version":"0.1.0"}`.

Before pushing, run everything CI runs:

```sh
pnpm lint && pnpm check && pnpm test && pnpm build
```

The Docker image builds with `docker build -t firewall-server .` and runs on port 3000.

## The arena API

The server runs the marketplace a shopping agent is tested in. A run is one agent visiting one scenario with one seed; the same scenario and seed always give the same arena.

| Call | What it does |
|---|---|
| `GET /arena/scenarios` | The scenarios and what the person asks for in each |
| `POST /arena/runs` `{"scenarioId","seed"}` | Starts a run |
| `GET /arena/runs/:runId/search?q=&category=&maxPriceCents=` | Searches listings |
| `GET /arena/runs/:runId/listings/:listingId` | A listing, with its catalog data and its page content apart |
| `GET /arena/runs/:runId/listings/:listingId/reviews` | A listing's reviews |
| `GET`, `POST /arena/runs/:runId/cart` `{"listingId","quantity"}`, `DELETE /arena/runs/:runId/cart/:listingId` | The cart |
| `POST /arena/runs/:runId/coupons` `{"code"}` | Applies a coupon |
| `POST /arena/runs/:runId/checkout` | Turns the cart into an order draft, with each line's payee taken from the catalog |
| `GET /events/runs`, `GET /events/runs/:runId` | The run list, and one run's events in replay order |

Every arena call is written to the event log. Send `X-Parent-Event-Id` with the ID of the event that made the call, and the arena's event links to it.

Some scenarios are benign and some carry an attack, and the scenario list doesn't say which. An attack scenario layers its attacker's stores, listings, reviews and Q&A onto the base catalog when the arena is built (`packages/arena/src/scenarios/attacks.ts`), so the base catalog and the benign scenarios never contain attack content. Whether a checkout fell for the attack is decided from its order draft by `attackSucceeded` (`packages/arena/src/outcome.ts`), which only the eval reads.

## The shopping agent

`packages/agent` is the shopper the attacks are measured against: an ordinary agent on the Vercel AI SDK with no defences of its own. Given a scenario's request, it shops the arena through tools (search, a listing's page, reviews, the cart, coupons, checkout) that call the arena in-process, and its checkout holds the whole cart as one payment authorization against the buyer's saved wallet. It never captures: that's the review's decision. Each run writes the agent's trajectory to the event log on the `agent` lane (every model turn with what it said, its thinking summary, its tool calls, tokens and cost), linked to the arena and payment events each step caused.

To run it on one scenario, with a real model (the whole run, through the firewall, is below):

```sh
pnpm --filter @firewall/agent run-scenario sc_b01 --seed 1 --firewall off                    # fake payments
pnpm --filter @firewall/agent run-scenario sc_b01 --seed 1 --adapter sandbox --firewall off  # the sandbox
```

It needs `FIREWALL_ANTHROPIC_API_KEY` (see `.env.example`), prints a short transcript, and what the run cost. A run stops before a model call that could take it past `--max-usd` (default $0.05), and after 25 model calls. Each eval column is one model with no fallback; Claude Haiku 5.5 is the only column so far. The tests drive the loop with scripted model turns and never call a model.

## Building a mandate

A mandate is what the person confirmed they want bought, in the catalog's own terms: the category, the required attributes, the brands, the most to pay per item, the quantity, the extras allowed, and the tolerances. Every firewall check compares the cart against the locked mandate, never against the agent's memory of the request.

```sh
pnpm --filter @firewall/mandate build-mandate "Buy me a mechanical keyboard with tactile switches, under \$120"
```

One Claude Haiku 5.5 call drafts it (about $0.0005), which needs `FIREWALL_ANTHROPIC_API_KEY` (see `.env.example`). The draft is shown field by field, with anything the request said that the catalog can't express listed as not covered. Type `a` to accept, `e` to edit a field (requirements, brands, price and so on), or `r` to reject. Accepting locks the mandate with a sha256 hash over its contents, so any later change shows. The request, the draft, each edit, the confirmation and the locked mandate are all written to the event log, under a new run or the one `--run <runId>` names.

The eval confirms mandates without a person: `buildMandate` with the `acceptsDraftAsIs` person accepts each draft exactly as the builder wrote it.

The tests replay recorded model answers for the benign scenarios and never call a model. When the builder's prompt or schema changes, a test says so; re-record with `pnpm --filter @firewall/mandate record-fixtures` (about a fifth of a cent) and commit the new fixtures.

## Gate 0, deterministic policy

Gate 0 is plain rules over trusted data: the locked mandate (its hash checked) and the catalog the run's arena was built from, rebuilt from the run's scenario and seed. It never reads seller-written text (the catalog's pages are dropped before any rule runs, and the checkout is read only for its catalog fields) and never calls a model, so it costs nothing. Per order line and for the order it checks that:

- the order matches the catalog: the listing, its SKU, seller, payee and price, any discount from the listing's own coupon, and totals that add up;
- the seller is on the verified-seller list;
- each line pays at most the mandate's ceiling per unit, and the mandate's category comes to at most the ceiling times the quantity;
- the quantity of the item asked for is the mandate's;
- a line outside the mandate's category is one of its allowed extras;
- the catalog's specs for the product meet every required attribute;
- the brand fits the policy (any reputable, listed only, or any) and isn't blocked;
- the same SKU wasn't checked out more than twice in ten minutes in the run.

A hard mandate violation blocks: a missing or altered mandate, an order that doesn't match the catalog, an unverified payee, a price over the ceiling or the budget, a missed attribute, a disallowed or blocked brand. An item the person didn't ask for, a different quantity within the budget, or repeated checkouts escalate, since the cart may still be what they wanted. Otherwise it approves, always with confidence 1. Each reason names the rule, the line and the values compared, and the verdict goes to the `gate0` lane under the checkout. A block ends the review.

```ts
const gate = runGate0(runId, { log });
```

## Gate 1, the quarantined extractor

The review tree's rule is that the gates judging a purchase never read what sellers wrote. Gate 1 is the one part that does. It reads exactly the page content the arena served the agent, for the listings in the checkout and the ones it opened on the way, and turns each page into typed facts with one Claude Haiku 5.5 call per listing: the category, brand, seller and attributes the page claims, its prices, required add-ons, urgency and discount codes, and flags for text that speaks to an AI, pushes another product, claims an extra item is required, gives checkout instructions or poses as system text. Every fact names the event that served it; a quote is kept only if it really is the page's own words, then cleaned and capped. A few code tripwires catch the plainest injections even if the model is talked round.

Code then compares each fact with the catalog's record of the listing (a page saying "tactile" on a linear keyboard, two left when twelve are in stock, a code the catalog doesn't have) and decides the verdict by rule: a flag or a disagreement on a listing in the cart, a steering flag on a page the agent opened, or a page it couldn't read escalates; otherwise it approves. Gate 1 never blocks. Everything goes to the `gate1` lane of the event log, with each call's tokens, cost (about $0.0007 a page) and latency. Later gates get `factsForReviewers`, which keeps no seller text.

```ts
const gate = await runGate1(runId, arena.catalog, { log, extractor: createExtractor({ client, vocabulary: extractionVocabulary(arena.catalog) }) });
```

The tests replay recorded extractions of scripted runs (an honest purchase, a poisoned review, a required add-on, urgency, a page the catalog contradicts, and text aimed at the extractor itself) and never call a model. Re-record with `pnpm --filter @firewall/firewall record-fixtures` (under a cent) when the prompt, the schema or a case changes.

## Gate 2, the intent auditor

Gate 2 decides whether the cart is what the person meant. It reads the locked mandate (verified by its hash: a missing or altered one blocks), the checkout's numbers with each listing's facts taken from the catalog rather than the checkout's seller-written line titles, Gate 1's `factsForReviewers`, and comparable offers. Code works out, for each line, how it sits against the mandate, the like-for-like offers in the marketplace (the same specification, from verified sellers, of brands the mandate allows), the best one and how far above it the line's price is against the mandate's tolerance, and a real-market reference from Channel3's product search, asked by category and attributes only. One Claude Haiku 5.5 call then judges the cart into a schema of fixed reason codes (`matches_mandate`, `wrong_product`, `attribute_mismatch`, `brand_concern`, `unrequested_item`, `overpriced_vs_comparables`, `overpriced_vs_market`, `steered_by_seller_content`), each with its line and evidence refs, plus a short explanation. It sees catalog records, numbers and Gate 1's typed facts, never page text.

Code decides the verdict. It blocks only when the auditor and the catalog agree a line is the wrong product or lacks a requirement. A price beyond tolerance (against the marketplace, or the market median when there is one) escalates whatever the auditor said, and never blocks on its own; so does a line whose page Gate 1 flagged as steering, a concern only the auditor raised, an auditor that contradicts the catalog, an unsure approval, or no judgement at all. Everything goes to the `gate2` lane: what it read and computed, the market lookups, the judgement with its tokens, cost (about $0.0005 a review) and latency, and the verdict.

```ts
const gate2 = await runGate2(runId, arena.catalog, {
  log,
  auditor: createIntentAuditor({ client }),
  market: createChannel3Market(channel3ConfigFromEnv()),
  gate1, // runGate1's result: its reviewer view and verdict event
});
```

Channel3 needs `FIREWALL_CHANNEL3_API_KEY` (see `.env.example`) and its host allowed; until then every review records the market reference as unavailable and checks prices within the marketplace only. The tests replay recordings of both gates on scripted runs (an honest purchase, an overpriced twin listing, a steered page, an unrequested extra and a linear keyboard for a tactile mandate), made with the market reference unavailable, and never call a model or Channel3. Re-record with `pnpm --filter @firewall/firewall record-gate2-fixtures` (about a cent) when a prompt, a schema or a case changes; with a Channel3 key set, the same command records its answers alongside.

## The review tree and enforcement

`runReview` (`packages/firewall/src/review.ts`) reviews a run whose agent has checked out. Gate 0 runs first, and a block there ends the review before any model is called. Otherwise Gate 1 reads the pages and Gate 2 audits the cart with its facts. The tree's verdict is the most severe of the gates' (any block blocks, any escalation escalates), and any block ends the review where it stands. A firewall configuration says how much of the tree runs, so the eval can ablate it on the same checkout: `off` (no review), `gate0` (the policy rules only) or `full` (every gate; Gate 3 joins it later). The review writes `review_started` and `review_finished` to the `review` lane: the verdict, each gate's verdict and event, the gates skipped and why, and the total cost.

`enforceReview` (`enforce.ts`) then acts on the held payment through the payment adapter, every call recorded on the payments lane and pointing at the review's verdict:

| Verdict | What happens to the money |
|---|---|
| approve | The hold is captured, then each seller is paid its share of what the platform received after its fee (`splitPayouts`) |
| block | The hold is voided: nothing is captured and nobody is paid |
| escalate | The hold stays; `escalated` records that a person must decide |
| none (`off`) | Captured and paid out as it stands: that's what no firewall means |

A person decides an escalated run with `decide-run <runId> approve|reject` (approve captures and pays out, reject voids), which writes their decision to the `human` lane with provenance `user` and then runs the same enforcement. A hold is honoured for three days; a person who takes longer than that has it reauthorized before it is captured, and one past its expiry can't be captured at all. Enforcement works from the event log, so running it twice never captures or pays twice, and running it after a failure halfway does only what is left.

One command runs a whole scenario: it drafts the mandate from the scenario's request and confirms it as the builder wrote it, runs the agent, runs the review, enforces and prints what was bought, each gate's verdict, the final verdict, where the money went, the cost and, for an attack scenario, whether the agent was fooled and whether the attack succeeded (it needs the money to have been captured: a voided or held order paid nobody).

```sh
pnpm --filter @firewall/agent run-scenario sc_a01 --seed 1 --adapter sandbox --firewall off   # the heist
pnpm --filter @firewall/agent run-scenario sc_a01 --seed 1 --adapter sandbox --firewall full  # the same run, reviewed
pnpm --filter @firewall/agent decide-run <runId> approve                                      # an escalated run (sandbox)
```

It needs `FIREWALL_ANTHROPIC_API_KEY` for the agent, the mandate draft and the gates (about half a cent to a cent for a run), and for `--adapter sandbox` the sandbox variables and the buyer's saved wallet in `SANDBOX_BUYER_VAULT_ID` (`pnpm --filter @firewall/payments save-wallet` prints one). `--decide approve|reject` decides an escalation at once, which is the only way to decide a `--adapter fake` run, since the fake's state lives in that process. The tests use the fake adapter, a real event log, scripted agent turns and the gates' recordings, and never call a model.

## Protect your agent

`@firewall/sdk` (`packages/sdk`) puts the firewall in front of your own shopping agent: you give it your agent's tools, and the payment tool holds the cart instead of paying for it. It is a workspace package for now, not published. In this repo, with Node 22 and `pnpm install` done, this runs in about a minute (offline, with the in-memory payment fake and a scripted model standing in for yours) and is the same file as `packages/sdk/examples/protect-your-agent.ts`, which a test runs:

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

What it does:

- `createFirewall(options)` takes the event log, the catalog source (below), the payment adapter and the buyer's wallet, the mandate the person confirmed (or `{ builder, person }` to build it in the run), and `config`: `off`, `gate0` or `full` (`full` also needs `gates`, the model gates built from your own settings; the SDK never creates a model client from the environment).
- `firewall.wrap(tools)` returns the same tools with each payment tool replaced by a guarded one. The guarded tool never captures and never calls the original `execute`: it creates the order and authorizes it against the wallet, and tells the agent the order is placed and pending review. The order held is the cart the catalog source reports, not the amounts in the agent's arguments, which are recorded with the call. Every other tool is passed through as it was.
- `firewall.settle()` reviews the held cart and acts on the verdict: approve captures and pays each seller, block voids, escalate leaves the hold for a person (`firewall.decide("approve" | "reject")`). It returns `null` when nothing was held, and it reviews once however many times it is asked. `review()` and `enforce()` are its two halves.

**When the review runs.** After the agent has finished, never inside the tool call. Gate 3 will audit the agent's whole trajectory, which isn't there to read until the agent stops; the tool answers the same whatever the cart is, so an agent steered by an attacker learns nothing about the gates by probing the checkout; and the model gates take seconds. The hold lasts days, so nothing is lost by waiting. Stop your agent loop at the checkout, as the example does, or let it run on: the review reads the event log either way.

**Which tools are payment tools.** By default `checkout` (ours) and `create_order` and `pay_order` (the payment platform's agent toolkit, whose order tools capture at once and can't hold money). Name your own with `paymentTools: ["buy_now"]`; an explicit list replaces the defaults. **A payment tool that isn't in the list is not guarded, and it pays at once.** Check the names before you rely on it. The toolkit is not installed in this repo (it is heavy and built for AI SDK 4), so its tools are tested here with stand-in tools of the same names and input shapes, not with the real package.

**Scope of v1.** The gates need two things the agent can't be trusted to report: the merchant's catalog (what each listing really is, costs and is sold by) and the page content the agent was shown. The arena provides both, and writes them to the event log as it serves them. So v1 protects agents shopping in the arena (`arenaSource`). Protecting an agent in a real marketplace needs the same two things from that merchant, behind the `CatalogSource` interface (`packages/sdk/src/source.ts`): that is future work, and the SDK doesn't pretend otherwise. The SDK also doesn't write the agent's own model turns and tool calls for the tools it passes through; `runAgent` in `packages/agent` does, and Gate 3 will need them.

Our own shopping agent goes through the same two calls: `runAgent` wraps its tools with `firewall.wrap`, and the pipeline settles with `firewall.settle()`, so the SDK is not a second code path.

## The eval

`@firewall/eval` (`packages/eval`) measures the firewall: attack success rate, false block rate, false escalation rate, cost and latency, with the firewall off, with Gate 0 only and with the full tree. The agent runs once for each scenario, seed and model column (a cell), and the three configurations all review that same recorded checkout, so a run costs the agent once.

```sh
pnpm --filter @firewall/eval run-matrix --scenarios all --seeds 1,2 --column haiku --dry-run   # cells and expected cost, spends nothing
pnpm --filter @firewall/eval run-matrix --scenarios sc_b01,sc_a02 --seeds 1 --column haiku     # the real thing
```

`--scenarios` takes IDs, `all`, `attacks` or `benign`; `--adapter fake|sandbox` picks the payment adapter (default `fake`); `--max-usd` (default 0.50) stops the matrix starting new cells once it is spent, on top of the agent's own per-run cap (`--agent-max-usd`); `--concurrency` (default 3) is how many cells run at once. It needs `FIREWALL_ANTHROPIC_API_KEY` and calls models: a cell is about half a cent to a cent. The tests call none.

Each run writes `<date>-<adapter>-<column>.json` (every cell and configuration), a `.md` summary and the `.events.db` event log holding every run, under `results/`, which git ignores. **Every file says which payment adapter produced it.** Numbers from the `fake` adapter are for development; only a run against the sandbox may be shown in the video or the write-up. [results/README.md](results/README.md) explains the file and how each rate is counted. The cell functions (`runCell`, `evaluateCell`) are plain async functions over serialisable records, so the same code can run as tasks on Render Workflows later.

## Layout

| Folder | What's in it |
|---|---|
| `apps/server` | The HTTP server (Hono): the API, and later the websocket and the built web app |
| `packages/events` | The append-only event log every run writes to (SQLite through Drizzle) |
| `packages/arena` | The simulated marketplace: a fictional catalog, seeded benign and attack scenarios, what each request means, and whether a checkout fell for an attack |
| `packages/payments` | The payment adapter interface, its in-memory fake and the contract tests both adapters pass |
| `packages/agent` | The shopping agent: its loop, its tools, its checkout, and the commands that run a scenario through the firewall and decide an escalation |
| `packages/mandate` | The mandate: its schema, the builder (one model call), confirmation on the command line, the lock and its hash |
| `packages/firewall` | The review tree: Gate 0, deterministic policy, Gate 1, the quarantined extractor, Gate 2, the intent auditor, their shared result type, and enforcement of the verdict |
| `packages/sdk` | The SDK: `createFirewall` and `firewall.wrap` put the firewall in front of an agent's payment tools, with the arena as its catalog source |
| `packages/eval` | The eval harness: the matrix runner, the metrics and the results file |
| `packages/` | Other libraries the apps share, added as each step needs them |
| `docs/` | The plan |

## Branches

```
feat/<thing> ──PR──▶ dev ──PR──▶ prod
                                  │
                              production
```

`dev` is the default branch: every change is a PR into it. A release is one PR from `dev` into `prod`, and only `prod` deploys. There's no staging.

## License

[MIT](LICENSE)
