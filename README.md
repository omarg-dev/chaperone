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

## Layout

| Folder | What's in it |
|---|---|
| `apps/server` | The HTTP server (Hono): the API, and later the websocket and the built web app |
| `packages/events` | The append-only event log every run writes to (SQLite through Drizzle) |
| `packages/arena` | The simulated marketplace: a fictional catalog, seeded benign and attack scenarios, what each request means, and whether a checkout fell for an attack |
| `packages/payments` | The payment adapter interface, its in-memory fake and the contract tests both adapters pass |
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
