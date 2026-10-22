# Build plan

What we're building, the decisions made so far, and the order it gets built in. The full proposal and the hackathon rule book live outside the repo for now (they name the host company throughout); this file carries everything from them that the code depends on, plus what was decided since.

Deadline: submission Nov 12, 2026, 12:00 PM PT. Our own target is to submit on Nov 11, with feature freeze on Nov 9. Judging runs until Dec 15, and the hosted demo has to keep working until then.

## The product in one paragraph

A shopping agent's checkout is held as a sandbox payment authorization instead of being captured. A review tree checks the cart against the mandate the person confirmed before the agent started (Gate 0, deterministic policy; Gate 1, a quarantined extractor that turns untrusted seller content into typed facts; Gate 2, an intent auditor; Gate 3, a trace auditor). Approve captures the payment, escalate asks the person, block voids it. The arena is a seeded marketplace with honest and attacker sellers, each a separate sandbox merchant account, so a successful attack visibly pays the attacker. The eval harness runs attack and benign scenarios with the firewall off and on and reports attack success rate, false block rate, cost and latency.

## Decisions

| Topic | Decision |
|---|---|
| Stack | TypeScript throughout: pnpm workspace monorepo, Hono server, React + Vite web app, SQLite through Drizzle. |
| Model calls | The shopping agent uses the Vercel AI SDK, so one loop runs on any provider and the firewall wraps the same tool objects the payment platform's agent toolkit provides (to confirm in the first checks). The gates use the official Anthropic SDK, for structured outputs, prompt caching and batch pricing. |
| Models | Gates: Claude Haiku 5.5, fixed for every eval run. Shopping agent: three separate eval columns, Claude Haiku 5.5, an OpenAI model and a Gemini model (free tier). Exact OpenAI and Gemini model IDs get picked when we wire them up. |
| No fallback inside the eval | Each eval column runs on exactly one model. A provider fallback chain would mix models inside one column's numbers, so it only exists for the hosted demo's agent. |
| Model budget | $5 of API credit until Dec 15. See *Cost* below. |
| Escalation | Decided in the Observatory. The authorization stays held while the person reads the review tree and approves (capture) or rejects (void). No second order. |
| Payments in the eval | During development the matrix may run against an in-memory fake of the payment platform. Every number shown in the video or the write-up comes from a run against the real sandbox, and the README says which results came from where. |
| Held-out attack set | Ported from published benchmarks (StakeBench and others), with attribution. Once we see how many fit a shopping arena, we decide whether custom ones are needed and how to write them without seeing the gate prompts. |
| Sponsor tools | AG Grid (AG Studio) for the monitoring and eval dashboard; Bryntum Scheduler for the run timeline; APIMatic Context Plugin while building the payment integration; a public Postman collection for the API. |
| Render | Render Workflows runs the eval matrix: one task per matrix cell, fanned out in parallel, results reported back to the app. The same task functions also run in a local runner, so the numbers never depend on Render. The hosted demo stays on the VPS. |
| Channel3 | Undecided; we discuss it when the fair-price check comes up. |
| Hosting | The VPS at omarg.dev, deployed the rulebook's way. The subdomain waits for the final name. |
| Versions | One minor version per milestone, approved as an exception to the rulebook: MVP is 0.1.x, v1.1 is 0.2.0, v1.2 is 0.3.0, v1.3 is 0.4.0, with patch releases in between. |
| Sandbox accounts | One buyer (personal), four honest sellers (business), two attackers (business). |
| Credentials | Sandbox and model API keys are environment variables in the cloud environment's settings, never in chat or the repo. |

## Progress

**Now: MVP step 4, the arena API.**

Each step is one PR into `dev`, in the order below. A step's status changes in the PR that finishes it, so this table is always current on `dev`.

Status: ✅ merged · 🔨 in progress · 👀 PR open, waiting on review · ⏸ blocked (says on what) · ⬜ not started

### MVP (0.1.x), target Oct 29: "the heist works, and the firewall stops it"

| # | Step | Status |
|---|---|---|
| 0 | Repo setup and this plan | 👀 PRs 1 and 2 |
| 1 | Monorepo scaffold: workspace, lint, typecheck, tests, CI, a server with `/health`, Docker image | ✅ |
| 2 | Event log: the append-only event schema, SQLite through Drizzle, append and query | ✅ |
| 3 | Arena catalog: fictional sellers, products and reviews, seeded scenarios, the first benign ones | ✅ |
| 4 | Arena API: search, listing, reviews, coupon, cart, checkout | 🔨 |
| 5 | Payment adapter interface and the in-memory fake | ⬜ |
| 6 | First technical checks against the sandbox (see below) | ⏸ sandbox accounts, credentials, network access |
| 7 | Sandbox payment adapter: authorize, capture, void, reauthorize, per-order payee, saved wallet | ⏸ step 6 |
| 8 | Shopping agent on the AI SDK, using the agent toolkit's payment tools | ⏸ step 6 for the toolkit; Anthropic API key for live runs |
| 9 | Attacks A1, A2 and A4. Checkpoint: with no firewall, a run pays an attacker in the sandbox | ⬜ |
| 10 | Mandate builder with confirmation (command line) | ⬜ |
| 11 | Gate 0, deterministic policy | ⬜ |
| 12 | Gate 1, quarantined extractor | ⬜ |
| 13 | Gate 2, intent auditor | ⬜ |
| 14 | Review tree and enforcement: approve captures, block voids, escalate holds | ⬜ |
| 15 | Attacks A3, A5, A6 and A7 | ⬜ |
| 16 | SDK wrapper v1 | ⬜ |
| 17 | Eval harness v1 with the local runner and a results file | ⬜ |
| 18 | 20+ benign scenarios, the first off-vs-on numbers, release 0.1.0 | ⬜ |

Done when: with the firewall off a run sends sandbox money to an attacker account, with it on the same run is voided, and the off-vs-on attack success rate and false block rate exist.

### v1.1 (0.2.0), target Nov 3: "make it visible"

| # | Step | Status |
|---|---|---|
| 1 | Design pass with the design skills: tokens, layout and mockups of every screen, reviewed by Omar before any UI code | ⬜ |
| 2 | Web app shell: theme tokens, light and dark, navigation, empty states | ⬜ |
| 3 | Live run view on Bryntum Scheduler, with causal arrows | ⬜ |
| 4 | Review tree per checkout | ⬜ |
| 5 | History and replay | ⬜ |
| 6 | Escalation inbox | ⬜ |
| 7 | AG Studio dashboard with custom widgets and theming | ⬜ |
| 8 | Onboarding flow: connect agent, set mandate, run | ⬜ |
| 9 | Hosted deploy on the VPS, with a hard spend cap and recorded real runs as the default demo | ⬜ |

Done when: a judge can open the hosted URL, replay a real attack run, and start a capped live run.

### v1.2 (0.3.0), target Nov 7: "make the numbers credible"

| # | Step | Status |
|---|---|---|
| 1 | Gate 3, trace auditor | ⬜ |
| 2 | Refunds after capture | ⬜ |
| 3 | OpenAI and Gemini agent columns | ⬜ |
| 4 | Eval matrix on Render Workflows | ⬜ |
| 5 | **Gate freeze, Nov 5**: gate prompts and logic stop changing | ⬜ |
| 6 | Held-out set ported from published benchmarks and run against the frozen gates | ⬜ |
| 7 | Headline matrix against the real sandbox | ⬜ |

Done when: the dashboard shows real-sandbox numbers for all three models, with the ablation, the held-out results and at least one attack that still gets through.

### v1.3 (0.4.0), target Nov 9 (feature freeze): "polish"

| # | Step | Status |
|---|---|---|
| 1 | Arena animation driven by replayed events, starting with its own design pass | ⬜ |
| 2 | Disputes evidence pack and transaction insights, if time allows | ⬜ |

### Ship, Nov 10 to 11

| # | Step | Status |
|---|---|---|
| 1 | Rename the repo and product, make the repo public, check the MIT license shows in About | ⬜ |
| 2 | README with one-command setup and the five-minute SDK quickstart; Postman collection | ⬜ |
| 3 | Devpost write-up and the video (under 3 minutes, numbers from real sandbox runs only) | ⬜ |
| 4 | Submit on Nov 11 | ⬜ |

## How the work is done

- One step, one PR, opened as a draft into `dev`. A PR stacked on an unmerged one says so at the top.
- Mundane work (fictional catalog content, boilerplate, version lookups) goes to Claude Haiku subagents; design, gates, eval methodology and payments stay with the main session.
- Any UI step starts from the design pass, and its PR carries screenshots in light and dark.

## If we fall behind, cut in this order

1. The OpenAI and Gemini columns.
2. Disputes evidence pack and transaction insights.
3. Gate 3.
4. Arena animation polish (keep a simple version).

Never cut: the eval numbers, the false block rate, the held-out set, and the core payment surfaces (authorize, capture, void, reauthorize, per-order payee, saved wallet, agent toolkit, webhooks).

## First technical checks

These decide whether the plan holds, so they come before anything else is built:

1. An order can pay a different sandbox merchant per order (the payee field). If it can't, attack A2 is redesigned first.
2. Authorize then capture, and authorize then void.
3. The buyer's wallet can be saved once and orders created against it with no redirect. Fallback: an approval link per order, completed by a scripted sandbox approval in demo mode.
4. Which agent toolkit tools we can wrap, which fields (such as the order's custom ID) force a direct API call, and whether the toolkit's tools come in AI SDK form.
5. Render Workflows has a TypeScript SDK, or a way to run TypeScript tasks.

## Cost

Estimates to replace with measured numbers once the agent runs. Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens.

- One agent run (about 40k input and 2k output tokens): about half a cent.
- One full review (four gate calls): about a fifth of a cent.
- A full Haiku matrix (27 scenarios, 3 seeds, the firewall configurations replayed on each recorded checkout): about $1.

How the $5 stretches:

- The agent runs once per scenario, seed and model. Firewall off, Gate 0 only, Gates 0 to 2 and the full tree are all evaluated on the same recorded checkout, because the firewall doesn't act until the agent has already checked out.
- Eval gate calls go through batch pricing (half price).
- Tests replay recorded model responses and never call a model.
- The server keeps a spend meter and refuses new runs once a hard cap is reached.
- The hosted demo replays recorded real runs by default, with a small daily cap on live runs.
- Gemini runs on its free tier, which only exists on a Google Cloud project with billing turned off.

## To do outside the code (Omar)

- [ ] Make `dev` the default branch and delete `main`; branch protection on `dev` and `prod` with Prod guard required on `prod`.
- [ ] Create the sandbox accounts: one buyer, four sellers, two attackers.
- [ ] Add the sandbox app's client ID and secret as environment variables in the cloud environment's settings.
- [ ] Allow the payment sandbox API host and `api.render.com` in the cloud environment's network settings, plus `api.openai.com` when the OpenAI column is added.
- [ ] Get a Gemini API key from a Google Cloud project with billing turned off.
- [ ] Add OpenAI API credit (the ChatGPT subscription doesn't cover the API), or drop that column.
- [ ] Claim the $50 Render credits.
- [ ] Install the APIMatic Context Plugin in Claude Code.
- [ ] Ask AG Grid and Bryntum on the hackathon Discord for licenses that last until Dec 15, and don't start either 45-day trial before Oct 25.
- [ ] Ask on the Discord whether any sponsor offers model API credits.
