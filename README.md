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

## Building a mandate

A mandate is what the person confirmed they want bought, in the catalog's own terms: the category, the required attributes, the brands, the most to pay per item, the quantity, the extras allowed, and the tolerances. Every firewall check compares the cart against the locked mandate, never against the agent's memory of the request.

```sh
pnpm --filter @firewall/mandate build-mandate "Buy me a mechanical keyboard with tactile switches, under \$120"
```

One Claude Haiku 5.5 call drafts it (about $0.0005), which needs `FIREWALL_ANTHROPIC_API_KEY` (see `.env.example`). The draft is shown field by field, with anything the request said that the catalog can't express listed as not covered. Type `a` to accept, `e` to edit a field (requirements, brands, price and so on), or `r` to reject. Accepting locks the mandate with a sha256 hash over its contents, so any later change shows. The request, the draft, each edit, the confirmation and the locked mandate are all written to the event log, under a new run or the one `--run <runId>` names.

The eval confirms mandates without a person: `buildMandate` with the `acceptsDraftAsIs` person accepts each draft exactly as the builder wrote it.

The tests replay recorded model answers for the benign scenarios and never call a model. When the builder's prompt or schema changes, a test says so; re-record with `pnpm --filter @firewall/mandate record-fixtures` (about a fifth of a cent) and commit the new fixtures.

## Gate 1, the quarantined extractor

The review tree's rule is that the gates judging a purchase never read what sellers wrote. Gate 1 is the one part that does. It reads exactly the page content the arena served the agent, for the listings in the checkout and the ones it opened on the way, and turns each page into typed facts with one Claude Haiku 5.5 call per listing: the category, brand, seller and attributes the page claims, its prices, required add-ons, urgency and discount codes, and flags for text that speaks to an AI, pushes another product, claims an extra item is required, gives checkout instructions or poses as system text. Every fact names the event that served it; a quote is kept only if it really is the page's own words, then cleaned and capped. A few code tripwires catch the plainest injections even if the model is talked round.

Code then compares each fact with the catalog's record of the listing (a page saying "tactile" on a linear keyboard, two left when twelve are in stock, a code the catalog doesn't have) and decides the verdict by rule: a flag or a disagreement on a listing in the cart, a steering flag on a page the agent opened, or a page it couldn't read escalates; otherwise it approves. Gate 1 never blocks. Everything goes to the `gate1` lane of the event log, with each call's tokens, cost (about $0.0007 a page) and latency. Later gates get `factsForReviewers`, which keeps no seller text.

```ts
const gate = await runGate1(runId, arena.catalog, { log, extractor: createExtractor({ client, vocabulary: extractionVocabulary(arena.catalog) }) });
```

The tests replay recorded extractions of scripted runs (an honest purchase, a poisoned review, a required add-on, urgency, a page the catalog contradicts, and text aimed at the extractor itself) and never call a model. Re-record with `pnpm --filter @firewall/firewall record-fixtures` (under a cent) when the prompt, the schema or a case changes.

## Layout

| Folder | What's in it |
|---|---|
| `apps/server` | The HTTP server (Hono): the API, and later the websocket and the built web app |
| `packages/events` | The append-only event log every run writes to (SQLite through Drizzle) |
| `packages/arena` | The simulated marketplace: a fictional catalog, seeded scenarios, and what each request means |
| `packages/payments` | The payment adapter interface, its in-memory fake and the contract tests both adapters pass |
| `packages/mandate` | The mandate: its schema, the builder (one model call), confirmation on the command line, the lock and its hash |
| `packages/firewall` | The review tree's gates and their shared result type; so far Gate 1, the quarantined extractor |
| `packages/` | Other libraries the apps share (the firewall, the SDK and so on), added as each step needs them |
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
