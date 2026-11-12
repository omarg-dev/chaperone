# How Chaperone works, in detail

The developer's view of every part: the arena and its API, the shopping agent, the rules (the mandate), each of the four checks, the review and what it does with the money, the SDK's place in it, the live runs, the benchmark and where the code lives. The [README](../README.md) is the short version, and [sdk.md](sdk.md) is the SDK's guide. The payment platform throughout is PayPal's sandbox, through the `@paypal/paypal-server-sdk` package (`packages/payments/src/sandbox.ts`).

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
| `GET /events/runs`, `GET /events/runs/:runId` | The run list (each run with its `verdict`, `decidedBy` and `reviewFailed`, read from its review and a person's decision), and one run's events in replay order |
| `GET /events/runs/:runId/payees` | The run's sellers by payee key, with each one's role (honest or attacker), rebuilt from its scenario and seed: the run view uses it to say who was paid and whether that was an attacker. An operator's view, not part of what an agent shops with |
| `POST /events/runs/:runId/decision` | A person's decision on an escalated run, `{ "decision": "approve" \| "reject", "note"?: string }`, carried out by the same code as `decide-run` (so a repeat changes nothing). carried out on the server's own payment adapter (the sandbox's when its variables are set, otherwise one in-memory fake, so a practice run can be decided too). 409 when the run isn't waiting for a person, was decided the other way, or is on a different kind of adapter, 502 when the platform refuses |
| `GET /live/status` | Whether a live run can start now (`available`, and `reason` in a sentence when not), which payment adapter holds the money (`fake` or `sandbox`), whether one is in progress (`busy`), and today's budget: the cap, what was spent, what is left and when it starts again (midnight UTC) |
| `POST /live/runs` `{"scenarioId","seed"?}` | A live run from the web app: starts the arena run (marked `origin: "web"`, with its payment adapter) and drafts a mandate from the scenario's request. Answers the mandate: the request, each term in words, which can be edited, and whether it can be locked. 503 when live runs are off, 429 at the daily cap, 502 when the builder fails |
| `GET`, `POST /live/runs/:runId/mandate` | The mandate's state; and `{"action":"edit","field","input"}` (the command line's own edit text), `{"action":"confirm"}` (locks it) or `{"action":"reject","reason"?}`. 422 with the reason when an edit can't be read, doesn't fit the catalog, or a draft can't be locked; 409 once it is locked or rejected |
| `POST /live/runs/:runId/start` `{"firewall":"off"\|"gate0"\|"full"}` | Runs the agent in the background, through the SDK, with the locked mandate; answers 202 and the run is followed at `/runs/:runId`. 409 if the mandate isn't locked, the run has started, or another live run is in progress; 429 at the daily cap; 410 if the server restarted since the draft |
| `GET /eval/results`, `GET /eval/results/:name` | The eval's results files in `RESULTS_DIR`, read-only: the list (adapter, model column, gate model, seeds, date, newest first; `available` is false when there is no folder) and one file, validated and cut down to what the dashboard draws. A name that isn't a plain file name in the folder is a 404 |

A Postman collection of these calls, in the order a developer would use them (`docs/postman/chaperone.postman_collection.json`), and an environment for a local server (`docs/postman/local.postman_environment.json`) are in the repo. In Postman, choose Import and pick both files, then select the "Chaperone, local server" environment to use `http://localhost:3000`; the collection's own `baseUrl` is the hosted demo. `apps/server/src/postman.test.ts` fails if a route is renamed or an example body stops passing its schema. The same steps are in the docs page, `/docs#postman`.

Every arena call is written to the event log. Send `X-Parent-Event-Id` with the ID of the event that made the call, and the arena's event links to it.

Some scenarios are benign and some carry an attack, and the scenario list doesn't say which. An attack scenario layers its attacker's stores, listings, reviews and Q&A onto the base catalog when the arena is built (`packages/arena/src/scenarios/attacks.ts`), so the base catalog and the benign scenarios never contain attack content. Whether a checkout fell for the attack is decided from its order draft by `attackSucceeded` (`packages/arena/src/outcome.ts`), which only the eval reads.

## The shopping agent

`packages/agent` is the shopper the attacks are measured against: an ordinary agent on the Vercel AI SDK with no defences of its own. Given a scenario's request, it shops the arena through tools (search, a listing's page, reviews, the cart, coupons, checkout) that call the arena in-process, and its checkout holds the whole cart as one payment authorization against the buyer's saved wallet. It never captures: that's the review's decision. Each run writes the agent's trajectory to the event log on the `agent` lane (every model turn with what it said, its thinking summary, its tool calls, tokens and cost), linked to the arena and payment events each step caused.

To run it on one scenario, with a real model (the whole run, through the firewall, is below):

```sh
pnpm --filter @firewall/agent run-scenario sc_b01 --seed 1 --firewall off                    # fake payments
pnpm --filter @firewall/agent run-scenario sc_b01 --seed 1 --adapter sandbox --firewall off  # the sandbox
```

It needs `FIREWALL_ANTHROPIC_API_KEY` (see `.env.example`), prints a short transcript, and what the run cost. A run stops before a model call that could take it past `--max-usd` (default $0.05), and after 25 model calls. Each eval column is one model with no fallback; `run-scenario` runs the Claude Haiku 5.5 column (the eval's OpenAI column is below). The tests drive the loop with scripted model turns and never call a model.

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

Gate 2 decides whether the cart is what the person meant. It reads the locked mandate (verified by its hash: a missing or altered one blocks), the checkout's numbers with each listing's facts taken from the catalog rather than the checkout's seller-written line titles, Gate 1's `factsForReviewers`, and comparable offers. Code works out, for each line, how it sits against the mandate, the like-for-like offers in the marketplace (the same specification, from verified sellers, of brands the mandate allows), the best one and how far above it the line's price is against the mandate's tolerance. It also asks Channel3's product search what that kind of product sells for, by category and attributes only, and notes the low, median and high on the verdict for the person to read; that reference decides nothing and the auditor isn't shown it, since a category's median isn't a like-for-like price. One Claude Haiku 5.5 call then judges the cart into a schema of fixed reason codes (`matches_mandate`, `wrong_product`, `attribute_mismatch`, `brand_concern`, `unrequested_item`, `overpriced_vs_comparables`, `steered_by_seller_content`), each with its line and evidence refs, plus a short explanation. It sees catalog records, numbers and Gate 1's typed facts, never page text.

Code decides the verdict. It blocks only when the auditor and the catalog agree a line is the wrong product or lacks a requirement. A price beyond tolerance above the best like-for-like offer escalates whatever the auditor said, and never blocks on its own; so does a line whose page Gate 1 flagged as steering, a concern only the auditor raised, an auditor that contradicts the catalog, an unsure approval, or no judgement at all. Everything goes to the `gate2` lane: what it read and computed, the market lookups, the judgement with its tokens, cost (about $0.0005 a review) and latency, and the verdict.

```ts
const gate2 = await runGate2(runId, arena.catalog, {
  log,
  auditor: createIntentAuditor({ client }),
  market: createChannel3Market(channel3ConfigFromEnv()),
  gate1, // runGate1's result: its reviewer view and verdict event
});
```

Channel3 needs `FIREWALL_CHANNEL3_API_KEY` (see `.env.example`) and its host allowed; until then every review records the market reference as unavailable and checks prices within the marketplace only. The tests replay recordings of both gates on scripted runs (an honest purchase, an overpriced twin listing, a steered page, an unrequested extra and a linear keyboard for a tactile mandate), made with the market reference unavailable, and never call a model or Channel3. Re-record with `pnpm --filter @firewall/firewall record-gate2-fixtures` (about a cent) when a prompt, a schema or a case changes; with a Channel3 key set, the same command records its answers alongside.

## Gate 3, the trace auditor

Gate 3 asks how the agent chose its cart: whether the mandate drove the choice or a page the agent read steered it. It reads the arena's record of the agent's calls (`trace.ts`): which tools it called, which listings it opened, in what order, and what it added, each listing as the catalog records it (the product's catalog name, category, brand, seller), with Gate 1's `factsForReviewers` flags on the pages it read. It never reads page text, search words, coupon codes, error messages or anything the agent said (its turns can repeat what a seller wrote), and no durations (they would make the same case a different request every run; they are in the log). Code works out, for each cart line, the step that added it, whether it was opened or found in a search, how many other listings were opened first, and its exposures: pages Gate 1 flagged as steering that were read before it was added, with whether that page was the line's own listing, another listing of the same product, and whether the line was the next listing the agent opened. One Claude Haiku 5.5 call (about $0.0005) then judges each line into a schema of fixed codes (`driven_by_mandate`, `followed_steering`, `unrequested_addition`, `unexplained_choice`) with evidence refs; it can only recommend approve or escalate.

Code decides the verdict, and Gate 3 never blocks: a trace shows how a choice was made, not that the cart is wrong, which Gates 0 and 2 can block by the catalog. A line the auditor judged steered escalates (with the exposure behind it, at higher confidence); so does a line with an exposure the auditor didn't clear (it clears one by judging the line driven by the mandate with confidence of at least 0.6, and no judgement leaves it standing), an item the catalog says the mandate neither asks for nor allows, a line the trace can't account for, and an auditor that gave no finding, no judgement or an unsure approval. It runs after Gate 2 in the tree, so a Gate 2 block ends the review before its call is made. Everything goes to the `gate3` lane: what it read and computed, the judgement (or why there was none) with its tokens, cost and latency, and the verdict. The tests replay recordings of the scripted runs (Gate 2's five cases, Gate 1's attack on its own extractor, a choice steered by a review, and A1's verified-attacker variant) and never call a model. Re-record with `pnpm --filter @firewall/firewall record-gate3-fixtures` (about a cent) when a prompt, a schema or a case changes.

## The review tree and enforcement

`runReview` (`packages/firewall/src/review.ts`) reviews a run whose agent has checked out. Gate 0 runs first, and a block there ends the review before any model is called. Otherwise Gate 1 reads the pages, Gate 2 audits the cart with its facts, and Gate 3 audits how the agent chose it. The tree's verdict is the most severe of the gates' (any block blocks, any escalation escalates), and any block ends the review where it stands. A firewall configuration says how much of the tree runs, so the eval can ablate it on the same checkout: `off` (no review), `gate0` (the policy rules only) or `full` (every gate). The review writes `review_started` and `review_finished` to the `review` lane: the verdict, each gate's verdict and event, the gates skipped and why, and the total cost.

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

## The SDK in the pipeline

`@firewall/sdk` (`packages/sdk`) is how anything puts the firewall in front of an agent; [sdk.md](sdk.md) is its guide and the README carries its example. Our own shopping agent goes through the same two calls: `runAgent` wraps its tools with `firewall.wrap`, and the pipeline settles with `firewall.settle()`, so the SDK is not a second code path. The PayPal agent toolkit, whose `create_order` and `pay_order` tools the SDK guards by default, is not installed in this repo (it is heavy and built for AI SDK 4), so its tools are tested with stand-in tools of the same names and input shapes. v1 protects agents shopping in the arena (`arenaSource`): a real marketplace needs its own `CatalogSource` (`packages/sdk/src/source.ts`), which is future work.

## Live runs from the web

The Start a run page (`/start`) lets a person pick a scenario, confirm a mandate and start a real run in the browser, and follow it in the run view. It needs the app's own model key; without `FIREWALL_ANTHROPIC_API_KEY` the page says live runs are off and replay still works. What a day of live runs may spend is capped: `FIREWALL_LIVE_DAILY_USD` (default `0.25`, a UTC day, counted from the event log), and only one live run goes at a time. The money is the sandbox's when the `SANDBOX_*` variables and `SANDBOX_BUYER_VAULT_ID` are set, otherwise one in-memory fake the server owns ("Practice money"), which is not a sandbox result. The same page has a "Connect your own agent" tab with the SDK example below.

## The benchmark in AG Studio

The dashboard's "Every result in AG Studio" tab (`/dashboard?view=studio`) puts every sandbox results file the server has (the newest of each model on each scenario set) into [AG Studio](https://www.ag-grid.com/studio/), one row per cell and firewall setting, and opens on a report of attack success off and on, the held-out set, false escalations and cost. "Build your own" lets anyone rearrange it in their own tab, and has Studio's AI assistant, which runs on Claude Haiku 5.5 through the server (`POST /studio/ai`) so the browser holds no key, capped by `FIREWALL_STUDIO_DAILY_USD`. Studio's licence key, `AG_STUDIO_LICENSE_KEY`, is read by the server at runtime; without it Studio shows its watermark.

## The eval

`@firewall/eval` (`packages/eval`) measures the firewall: attack success rate, false block rate, false escalation rate, cost and latency, with the firewall off, with Gate 0 only and with the full tree. The agent runs once for each scenario, seed and model column (a cell), and the three configurations all review that same recorded checkout, so a run costs the agent once.

```sh
pnpm --filter @firewall/eval run-matrix --scenarios all --seeds 1,2 --column openai --dry-run  # cells and expected cost, spends nothing
pnpm --filter @firewall/eval run-matrix --scenarios sc_b01,sc_a02 --seeds 1 --column haiku     # the real thing
```

`--column` picks the shopping agent's model, each one model with no fallback: `haiku` (Claude Haiku 5.5, needs `FIREWALL_ANTHROPIC_API_KEY`) or `openai` (OpenAI GPT-6 Luna, needs `FIREWALL_OPENAI_API_KEY`). A `gemini` column (Gemini 3.5 Flash-Lite, through Google's OpenAI-compatible endpoint) is in the code, but its benchmark was cut on Nov 9: two models make the point, and the README's results have no Gemini numbers. The gates run on Claude Haiku 5.5 in every column, so every column also needs the Anthropic key, and a column without its own key refuses to run and names the variable. `--scenarios` takes IDs, `all`, `attacks`, `benign` or `held-out`; `--adapter fake|sandbox` picks the payment adapter (default `fake`); `--max-usd` (default 0.50) stops the matrix starting new cells once it is spent, on top of the agent's own per-run cap (`--agent-max-usd`); `--concurrency` (default 3) is how many cells run at once. It calls models: a cell is about half a cent to a cent (the dry run prices the column you picked). The tests call none.

`all` and `attacks` are our own scenarios. `held-out` is the held-out set: 17 attacks ported, with attribution, from published benchmarks (StakeBench, Magentic Marketplace, AgentDojo and InjecAgent), written without reading the gates and never used to tune them, so the numbers show the firewall wasn't fitted to our own attacks. It runs on its own, never mixed with ours, and its files say so and end their names in `-held-out`. [held-out.md](held-out.md) lists the sources, licences, what was ported and what was left out.

Each run writes `<date>-<adapter>-<column>.json` (every cell and configuration), a `.md` summary and the `.events.db` event log holding every run, under `results/`, which git ignores apart from the benchmark's four sandbox results. **Every file says which payment adapter produced it.** Numbers from the `fake` adapter are for development; only a run against the sandbox may be shown in the video or the write-up. [results/README.md](../results/README.md) explains the file and how each rate is counted. The cell functions (`runCell`, `evaluateCell`) are plain async functions over serialisable records.

## Layout

| Folder | What's in it |
|---|---|
| `apps/server` | The HTTP server (Hono): the API, the live runs, the AG Studio assistant's model route, and the built web app |
| `packages/events` | The append-only event log every run writes to (SQLite through Drizzle) |
| `packages/arena` | The simulated marketplace: a fictional catalog, seeded benign and attack scenarios, what each request means, and whether a checkout fell for an attack |
| `packages/payments` | The payment adapter interface, the PayPal sandbox adapter (`sandbox.ts`), the in-memory fake and the contract tests both adapters pass |
| `packages/agent` | The shopping agent: its loop, its tools, its checkout, and the commands that run a scenario through the firewall and decide an escalation |
| `packages/mandate` | The mandate: its schema, the builder (one model call), confirmation on the command line, the lock and its hash |
| `packages/firewall` | The review tree: Gate 0, deterministic policy, Gate 1, the quarantined extractor, Gate 2, the intent auditor, Gate 3, the trace auditor, their shared result type, and enforcement of the verdict |
| `packages/sdk` | The SDK: `createFirewall` and `firewall.wrap` put the firewall in front of an agent's payment tools, with the arena as its catalog source |
| `packages/eval` | The eval harness: the matrix runner, the metrics and the results file |
| `apps/web` | The web app: the landing page, the Runs history, the run view, the escalation inbox, the dashboard and `/docs`, in React and Vite |
| `deploy` | What runs on the server: the compose file, the env example and the Caddy site block |
| `docs/` | The plan, this file, the SDK guide (`sdk.md`), deploying (`deploying.md`), the held-out sources, the sandbox checks, the design notes and the Postman collection |

