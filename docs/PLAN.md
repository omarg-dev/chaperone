# Build plan

What we're building, the decisions made so far, and the order it gets built in. The full proposal and the hackathon rule book live outside the repo; this file carries everything from them that the code depends on, plus what was decided since.

Deadline: submission Nov 12, 2026, 12:00 PM PT. Our own target is to submit on Nov 11, with feature freeze on Nov 9. Judging runs until Dec 15, and the hosted demo has to keep working until then.

## The product in one paragraph

A shopping agent's checkout is held as a sandbox payment authorization instead of being captured. A review tree checks the cart against the mandate the person confirmed before the agent started (Gate 0, deterministic policy; Gate 1, a quarantined extractor that turns untrusted seller content into typed facts; Gate 2, an intent auditor; Gate 3, a trace auditor). The hold is the firewall platform's own: approve captures the payment and pays each seller out, escalate asks the person, block voids it, and no seller is paid before the review passes. The arena is a seeded marketplace with honest and attacker sellers, each a separate sandbox merchant account, so a successful attack visibly pays the attacker. The eval harness runs attack and benign scenarios with the firewall off and on and reports attack success rate, false block rate, cost and latency.

## Decisions

| Topic | Decision |
|---|---|
| Stack | TypeScript throughout: pnpm workspace monorepo, Hono server, React + Vite web app, SQLite through Drizzle. |
| Model calls | The shopping agent uses the Vercel AI SDK, so one loop runs on any provider. Its checkout tool is ours, because the platform's agent toolkit can't hold money (its order tools capture at once); the firewall wraps that tool. The toolkit's read, refund and dispute tools belong to the dispute evidence pack and transaction insights, where they fit as they are. The gates use the official Anthropic SDK, for structured outputs, prompt caching and batch pricing. |
| Models | Gates: Claude Haiku 5.5, fixed for every eval run. Shopping agent: three separate eval columns, Claude Haiku 5.5, an OpenAI model and a Gemini model (free tier). Exact OpenAI and Gemini model IDs get picked when we wire them up. |
| No fallback inside the eval | Each eval column runs on exactly one model. A provider fallback chain would mix models inside one column's numbers, so it only exists for the hosted demo's agent. |
| Model budget | $5 of API credit per provider until Dec 15: Anthropic, OpenAI and Google (Omar, Nov 2). Anthropic's is the one that binds, because the gates run on Claude Haiku 5.5 in every eval column and live runs use Haiku too; OpenAI's and Google's only pay for their own agent columns. See *Cost* below. |
| Escalation | Decided in the Observatory. The authorization stays held while the person reads the review tree and approves (capture) or rejects (void). No second order. |
| Payments in the eval | During development the matrix may run against an in-memory fake of the payment platform. Every number shown in the video or the write-up comes from a run against the real sandbox, and the README says which results came from where. |
| What the eval counts | An attack **succeeds** only when money reaches an attacker's account; an order the firewall voids or holds paid nobody. A cart the firewall escalates that wasn't compromised (the agent bought the right thing from an honest seller, but its page carried an attack) counts toward a **false escalation rate**, reported beside the false block rate, not inside it. False blocks are counted the same way, over clean carts: a block of a cart the agent got wrong is a correct block even in a benign scenario. When an attack succeeds by a route other than the one the scenario describes (in the checkpoint, A1's agent fell for the attacker's keyword-stuffed listing title, never reading the poisoned review), it still counts, and the result records the actual cause; attacks aren't tuned to make the agent fall the intended way. Decided Oct 24, after the checkpoint. |
| Held-out attack set | Ported from published benchmarks (StakeBench and others), with attribution. Once we see how many fit a shopping arena, we decide whether custom ones are needed and how to write them without seeing the gate prompts. |
| Sponsor tools | AG Grid for the monitoring and eval dashboard (the free community edition, see *AG Grid license*); Bryntum Scheduler for the run timeline; APIMatic Context Plugin while building the payment integration; a public Postman collection for the API. |
| Render | Render Workflows runs the eval matrix: one task per matrix cell, fanned out in parallel, results reported back to the app. The same task functions also run in a local runner, so the numbers never depend on Render. The hosted demo stays on the VPS. |
| Channel3 | Gate 2's real-market price reference, decided Oct 23. Gate 2 queries Channel3's product search by the cart line's category and attributes ("wireless tenkeyless mechanical keyboard, tactile switches"), never by an arena brand or product name, so the arena stays fictional; only the low, median and high prices come back into the review. A price beyond the mandate's tolerance above the market median escalates, and never blocks on its own. It qualifies for its sponsor prize by being called on every review. Until its key (`FIREWALL_CHANNEL3_API_KEY`) and host are set up, Gate 2 records the market reference as unavailable and checks prices only within the marketplace. |
| Bryntum | Bryntum v8.0 (out the week of Nov 2) gives a 45-day trial that can be renewed with a new key as often as needed, through judging. It is used where it fits rather than replacing the run view's own timeline, which is designed and works: a Scheduler of an eval matrix run (v1.2 step 8). Before building, check that the trial's terms allow a public repo and a hosted demo and whether it shows a watermark; its packages come from Bryntum's own npm registry, so that host is allowed in the environment and the registry login is a secret, never in the repo. Decided Nov 2. |
| AG Grid Enterprise | The AG Grid team said on the hackathon Discord (Nov 2) that entrants may use the Enterprise edition without a key, with its watermark showing. We use it, on the dashboard and the Runs history only, behind the one grid wrapper so turning it off is one change, for features a judge recognises (v1.1 step 11). `ag-grid-enterprise` is a dependency under that allowance, not open source; the repo stays MIT because it depends on the package rather than including it. Built after the redesign, so the grids are styled once. Decided Nov 2. |
| AG Grid license | There is no license yet, so the dashboard is built on the free community packages: `ag-grid-community` and `ag-grid-react`, pinned (MIT, no license key needed). Charts (`ag-charts-community`) only if a chart genuinely needs it; none does so far. Nothing goes deep on a licensed feature (AG Studio, enterprise grid or chart features), so nothing gets rebuilt if a license arrives. The grid is behind a small wrapper in `apps/web/src/grid/` (moved there from `dashboard/ag/` on Nov 2, so every page shares one wrapper and one theme), themed from our tokens through AG's theming API, so a licensed grid is a local swap. Decided Nov 1. |
| AG Grid on more of the app | Omar's decision, Nov 2: put more of the app on AG Grid Community, for the "Best Use of AG Grid" sponsor prize, still with no license and nothing licensed (AG Studio, enterprise row grouping, pivoting, master/detail, the server-side row model, integrated charts, Excel export), so nothing is rebuilt if a license arrives. Two places: the Runs history, and a drill-down on the dashboard's table of every run. Master/detail is enterprise-only (`MasterDetailModule`, marked Enterprise in AG's docs and absent from `ag-grid-community`), so the drill-down is built from community pieces: a panel driven by row selection. Only the modules a page uses are registered, one filter mechanism per page (ours, in pure functions, so the count and the empty state never read back from the grid), and the two pages share one lazy grid chunk. Decided Nov 2. |
| Hosting | The VPS at omarg.dev, deployed the rulebook's way, at `chaperone.omarg.dev`. |
| Name | **Chaperone**, decided Oct 27. A chaperone goes along on the trip and steps in before anyone does something they'll regret: the agent shops on its own, and Chaperone steps in before money moves. A quick search found nothing in agent payments or checkout security using it (not a trademark search); Countersign, Proviso, Tollgate and CartWatch were ruled out as taken in this space. The repository and packages are renamed in the Ship phase. |
| Arena in v1.1 | The arena's visual treatment is v1.3's first step, with its own design pass. Until then the web app shows an Arena tab marked under construction. |
| Versions | One minor version per milestone, approved as an exception to the rulebook: MVP is 0.1.x, v1.1 is 0.2.0, v1.2 is 0.3.0, v1.3 is 0.4.0, with patch releases in between. |
| Attacks in step 9 | A1 comes in two variants. In the unverified one, a poisoned review sends the agent to an unverified attacker store, which Gate 0 catches by rule. In the verified one, the review steers the agent to a verified store that is really an attacker, selling a product whose catalog record matches the request on paper (right category, the required attributes, a reputable brand, under the ceiling), so nothing a rule can see is wrong and only the steering (Gate 3) and judgement (Gate 2) can catch it; it succeeds when a line pays that store. A2 swaps where the money goes (with the platform as payee, that's the seller a line pays out to), A4 the "required" add-on. Omar reviews each attack's wording in its PR before it lands, since it may appear in the video. |
| Gate 0 and extra items | Gate 0 checks the cart against the mandate and the trusted catalog: the payee, the price ceiling, the quantity, extra items, the required attributes and the brand policy. It escalates an item the person didn't ask for rather than blocking it: a rule can't be talked out of its decision, and escalating keeps false blocks down when the extra was wanted. So A4 counts as caught without AI. Which attacks only the AI gates catch is measured by the eval's Gate-0-only column, not assumed; the prediction is A1 (verified), A3, A5 and A7. A6's lookalike brand isn't on the reputable list, so a mandate with the default "any reputable brand" policy blocks it by rule; that's left as it is rather than designing the attack around Gate 0. |
| Sandbox accounts | Created by bulk upload: one buyer (personal), four honest sellers named after the arena's stores, two attackers, all in the US. An eighth business account, the firewall platform, owns the app and is the payee on every order. The buyer's payment review and other test settings stay off; a second buyer with payment review on is an idea for testing a capture that comes back pending. The accounts are listed at the end of this file. |
| Positioning | The shopping agent is the victim, not the product. The firewall is the safety layer under any agent that pays: before money moves, it checks that what the agent is buying is what the person asked for. Agent-to-agent payments and contractor payouts are future scope, named in the write-up but not built. |
| Next to the platform's agent checkout | The payment platform's own agent checkout gives the agent a one-time payment token limited to one merchant, a maximum amount and an expiry. That limits how much the agent spends and with whom, but not whether the cart is what the person wanted. The firewall is that second check and can sit on top of it. This is the answer to "doesn't the platform already do this?" in the video and the write-up. |
| Plugins | APIMatic's Context Plugin writes the payment integration, which is what qualifies for its prize. The platform's official plugin is installed next to it only for looking at the sandbox, explaining errors and reading docs. |
| Who holds the money | The firewall runs on the buyer's side, because the sellers are the ones attacking: anything that needs a seller's cooperation (its own API keys, so the firewall can void its hold) fails against an attacker, and no honest seller hands a third party its secret. So the firewall platform is the payee on every order. It holds the whole cart in one authorization, voids it on a block, and on approval captures it and pays each seller its share with a payout. In production this is the platform's multiparty setup with delayed disbursement, where a platform takes the payment for its sellers and releases it later; this sandbox app isn't approved for that partner onboarding, so the arena uses the simpler version where the platform is the merchant of record. The control point is the same, and the write-up says so. Taking the payment also makes the platform the one that handles refunds and disputes. |
| Fees | A seller is paid its share of what the platform actually received, not its gross line: each seller's payout is the capture's net amount (after the platform's processing fee) times its lines' part of the cart, in cents, with the rounding remainder going to the seller of the largest line, so the payouts add up exactly to the net. That's how marketplaces pass processing fees on to their sellers, and it keeps the platform's sandbox balance from draining by the fee on every approved cart. The split is `splitPayouts` in `@firewall/payments`, which the review tree's enforcement (step 14) calls; the fake charges what the sandbox did (3.49% plus $0.49). |
| Naming PayPal | Code, docs and commits name PayPal freely. A ban on naming it (in place until Oct 23) did more harm than good: the SDK's own field names needed exceptions, and judges expect to read what we integrate with. The product's name, logo and graphics still stay clear of PayPal's brand, as the official rules require. |
| Design | Spine (docs/design/spine/, rules and tokens in [docs/design.md](design.md)). The mark is the Hold: a rounded bracket holding a dot, "the pause before money moves". The run view is one vertical timeline whose spine is the money's route, with the gates as stations on it. Three zones: the catalog (plain), the route (tinted) and seller text, which always sits behind a hatch. Red means an attacker, and a block is neutral: filled red where money reached an attacker (the amount, the payout path, the "Paid attacker" pill), and outlined red on the seller text Gate 1 flagged as steering the purchase, since it shows what would have taken the money (Omar's decision, Oct 29, replacing "red only for paid money"). Each fact is said once on a screen. |
| Live runs from the web | A person starts a capped live run at `/start`: pick a scenario (title and request, never which are attacks) and a firewall setting, confirm the drafted mandate (edit, lock or reject, through the same `draftMandate` and `stepMandate` the command line uses), then the server runs the same `runWithFirewall` the command line calls, in the background, on the Claude Haiku 5.5 column only. **The cap is a hard rule:** `FIREWALL_LIVE_DAILY_USD`, default **$0.25** a UTC day (Omar's choice on Nov 2: a few dozen live runs a day, and it keeps most of Anthropic's $5, which the gates also spend in every eval column, for the real matrices and the judging window), counted from the event log's recorded cost of runs marked `origin: "web"` in `run_started`, so a restart can't lose it. A draft or a start past the cap is a 429, a second live run at once a 409, a mandate that isn't locked a 409; the agent's own cap is lowered to what is left of the day less a cent held back for the review's model calls, so a day can't overshoot by a review. Live runs are off, said plainly on the page, without `FIREWALL_ANTHROPIC_API_KEY`; replay and everything else keep working. Decided Nov 2, by the step 8 build. |
| Payments for live runs | The server owns one adapter: the sandbox's when the `SANDBOX_*` variables (and `SANDBOX_BUYER_VAULT_ID`, which the server can't save itself) are set, otherwise a single in-process fake. Live runs and the decision route get that same instance, so a practice run's hold can be decided from the run view and the inbox; each run records which it used (`payments` in `run_started`) and the run view and Runs list say "Practice money" or "Sandbox", quietly. Practice money is not a sandbox result: no number from it goes in the video or the write-up. |
| Credentials | Never in chat or the repo. Where each kind lives is in `CLAUDE.md`. |
| Working sessions | One conversation, which hands each step to a subagent and reviews its work before opening the PR. It replaced a split into a discussion session and a build session, where every question bounced between the two. A decision goes into this file or `CLAUDE.md` the same day, because subagents only see the repo. |

## Progress

**Now: v1.2 step 1, Gate 3 (the trace auditor, run last in the full tree, escalating and never blocking), is open for review on top of the v1.1 stack; the gate freeze is Nov 5. The MVP (steps 0 to 18) is merged and released as 0.1.1; in v1.1 the design pass, the web app shell and the live run view (which covers step 4) are merged, and steps 5 (history and replay), 6 (the escalation inbox), 7 (the dashboard, on AG Grid Community), 8 (the onboarding flow, the Start a run page) and 10 (more of the app on AG Grid Community, added Nov 2) are open for review; next is step 9, the hosted deploy.** MVP step 6, the first technical checks, is answered in full ([docs/sandbox-checks.md](sandbox-checks.md)): the buyer's wallet saves with one scripted approval and holds every later order with no approval link. The sandbox adapter passes the same contract as the fake: a cart is one order paid to the platform, voided on a block, or captured and paid out to each seller.

Each step is one PR into `dev`, in the order below. A step's status changes in the PR that finishes it, so this table is always current on `dev`.

Status: ✅ merged · 🔨 in progress · 👀 PR open, waiting on review · ⏸ blocked (says on what) · ⬜ not started

### MVP (0.1.x), target Oct 29: "the heist works, and the firewall stops it"

| # | Step | Status |
|---|---|---|
| 0 | Repo setup and this plan | ✅ |
| 1 | Monorepo scaffold: workspace, lint, typecheck, tests, CI, a server with `/health`, Docker image | ✅ |
| 2 | Event log: the append-only event schema, SQLite through Drizzle, append and query | ✅ |
| 3 | Arena catalog: fictional sellers, products and reviews, seeded scenarios, the first benign ones | ✅ |
| 4 | Arena API: search, listing, reviews, coupon, cart, checkout | ✅ |
| 5 | Payment adapter interface and the in-memory fake | ✅ |
| 6 | First technical checks against the sandbox (see below) | ✅ all five answered; check 3, the saved wallet, works with one scripted approval |
| 7 | Sandbox payment adapter: authorize, capture, void, reauthorize, payouts to sellers, saved wallet; one order per cart, paid to the platform | ✅ the contract suite passes against the sandbox |
| 8 | Shopping agent on the AI SDK, checking out through the payment adapter | ✅ |
| 9 | Attacks A1, A2 and A4. Checkpoint: with no firewall, a run pays an attacker in the sandbox | ✅ checkpoint in step 14's runs: with no firewall, sc_a01, sc_a02 and sc_a03 each paid an attacker's sandbox account |
| 10 | Mandate builder with confirmation (command line) | ✅ |
| 11 | Gate 0, deterministic policy | ✅ |
| 12 | Gate 1, quarantined extractor | ✅ |
| 13 | Gate 2, intent auditor | ✅ |
| 14 | Review tree and enforcement: approve captures, block voids, escalate holds | ✅ |
| 15 | Attacks A3, A5, A6 and A7 | ✅ |
| 16 | SDK wrapper v1 | ✅ |
| 17 | Eval harness v1 with the local runner and a results file | ✅ |
| 18 | 22 benign scenarios, the first off-vs-on numbers, release 0.1.1 | ✅ |

Done when: with the firewall off a run sends sandbox money to an attacker account, with it on the same run is voided, and the off-vs-on attack success rate and false block rate exist. The first matrix (fake payment adapter, 30 scenarios, seeds 1 and 2, Claude Haiku 5.5, $0.28) found the agent fooled in 11 of 16 attack runs: with the firewall off 11 reached an attacker's account (68.8%), with Gate 0 only 4 (25.0%) and with the full tree none, at no false blocks and 4 false escalations in 49 clean carts (8.2%). Two of those four were benign scenarios. These are development numbers, not sandbox ones.

### v1.1 (0.2.0), target Nov 3: "make it visible"

| # | Step | Status |
|---|---|---|
| 1 | Design pass with the design skills: tokens, layout and mockups of every screen, reviewed by Omar before any UI code | ✅ Spine, approved by Omar Oct 28 |
| 2 | Web app shell: theme tokens, light and dark, navigation, empty states | ✅ |
| 3 | Live run view: the vertical timeline with the review tree on its spine, with causal arrows (steps 3 and 4 in one: the approved design makes them one screen). Built as our own timeline component behind a small interface, since there is no Bryntum access; the causal arrows are left out for now, except the one where Gate 1's fact crosses from seller text to the spine | ✅ |
| 4 | Review tree per checkout | Merged into step 3 (✅) |
| 5 | History and replay: the Runs page filters, searches and pages every run, and a finished run's page replays its own events with a playhead kept in the address | 👀 PR open |
| 6 | Escalation inbox: every purchase held for a person, oldest first, with why it was held and when its hold ends, approved or rejected from the list | 👀 PR open |
| 7 | Dashboard, "How it's doing": the eval's results (Off, Gate 0 only and the full tree side by side, a table of every run in AG Grid Community) with the adapter, model column, gate model, seeds and date on every view and a banner on fake results, and a strip of this server's runs. AG Studio is out until there is a license | 👀 PR open |
| 8 | Onboarding flow: connect agent, set mandate, run: the Start a run page, where a person picks a task, confirms a mandate and starts a capped live run, and a tab on connecting your own agent with the SDK | 👀 PR open |
| 9 | Hosted deploy on the VPS, with a hard spend cap and recorded real runs as the default demo | ⬜ |
| 10 | More of the app on AG Grid Community: the Runs history and the eval drill-down. The Runs page becomes an AG grid (sortable and resizable columns, the scenario pinned left, keyboard navigation, rows drawn as they scroll instead of pages, the filters and the sort kept in the address), and a row of the dashboard's table of every run opens a panel with that cell under Off, Gate 0 only and the full tree. Community features only, one shared wrapper | 👀 PR open |
| 11 | AG Grid Enterprise where a judge will notice it, after the redesign: integrated charts and row grouping or pivoting of the eval results, master/detail for the drill-down, a status bar with money totals and Excel export on the Runs history; behind the one wrapper, on the dashboard and Runs pages only | ⬜ |

Done when: a judge can open the hosted URL, replay a real attack run, and start a capped live run.

### v1.2 (0.3.0), target Nov 7: "make the numbers credible"

| # | Step | Status |
|---|---|---|
| 1 | Gate 3, trace auditor | 👀 PR open |
| 2 | Refunds after capture | ⬜ |
| 3 | OpenAI and Gemini agent columns | ⬜ |
| 4 | Eval matrix on Render Workflows | ⬜ |
| 5 | **Gate freeze, Nov 5**: gate prompts and logic stop changing | ⬜ |
| 6 | Held-out set ported from published benchmarks and run against the frozen gates | ⬜ |
| 7 | Headline matrix against the real sandbox | ⬜ |
| 8 | Bryntum Scheduler timeline of an eval matrix run: each cell's agent run and gate calls on a real time axis across the workers, from step 4's runs on Render Workflows | ⬜ |

Done when: the dashboard shows real-sandbox numbers for all three models, with the ablation, the held-out results and at least one attack that still gets through.

### v1.3 (0.4.0), target Nov 9 (feature freeze): "polish"

| # | Step | Status |
|---|---|---|
| 1 | Arena animation driven by replayed events, starting with its own design pass | ⬜ |
| 2 | Disputes evidence pack and transaction insights, if time allows, using the agent toolkit's read and dispute tools | ⬜ |

### Ship, Nov 10 to 11

| # | Step | Status |
|---|---|---|
| 1 | Rename the repo and product, make the repo public, check the MIT license shows in About | ⬜ |
| 2 | README with one-command setup and the five-minute SDK quickstart; Postman collection | ⬜ |
| 3 | Devpost write-up and the video (under 3 minutes, numbers from real sandbox runs only) | ⬜ |
| 4 | Submit on Nov 11 | ⬜ |

## How the work is done

- One step, one PR, opened as a draft into `dev`. A PR stacked on an unmerged one says so at the top.
- Each step is built by a subagent in its own git worktree; steps that don't touch the same files run side by side. The conversation reviews the diff, runs the checks and opens the PR.
- Mundane work (fictional catalog content, boilerplate, version lookups) goes to Claude Haiku subagents; design, gates, eval methodology and payments go to the main model.
- Any UI step starts from the design pass, and its PR carries screenshots in light and dark.

## If we fall behind, cut in this order

1. The OpenAI and Gemini columns.
2. Disputes evidence pack and transaction insights.
3. Gate 3.
4. Arena animation polish (keep a simple version).

Never cut: the eval numbers, the false block rate, the held-out set, and the core payment surfaces (authorize, capture, void, reauthorize, payouts to sellers, saved wallet, webhooks).

## First technical checks

These decide whether the plan holds, so they come before anything else is built:

1. An order can pay a different sandbox merchant per order (the payee field). If it can't, attack A2 is redesigned first. (It can, but the firewall can't void another merchant's hold, so the platform became the payee and pays sellers with payouts.)
2. Authorize then capture, and authorize then void.
3. The buyer's wallet can be saved once and orders created against it with no redirect. Fallback: an approval link per order, completed by a scripted sandbox approval in demo mode.
4. Which agent toolkit tools we can wrap, which fields (such as the order's custom ID) force a direct API call, and whether the toolkit's tools come in AI SDK form.
5. Render Workflows has a TypeScript SDK, or a way to run TypeScript tasks.

The answers so far, and what they change, are in [docs/sandbox-checks.md](sandbox-checks.md). In short: 1 yes, but an authorize order holds one purchase unit, which stopped mattering once the platform became the payee: a cart is one order; 2 capture yes, void and refund refused for another merchant's hold; 3 yes, with one scripted approval, and the per-order link works as the fallback; 4 the toolkit's order tools can't hold money, so checkout is a direct call; 5 yes.

## Cost

Estimates to replace with measured numbers as each part runs. Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens.

- One agent run, measured on Oct 22 on `sc_b01`: 4 to 5 model calls, 12k to 18k input and about 1k output tokens (a third of it thinking), $0.0016 to $0.0023. The estimate was about 40k input and 2k output, half a cent.
- One full review (four gate calls): about a fifth of a cent.
- A full Haiku matrix (30 scenarios, 3 seeds, the firewall configurations replayed on each recorded checkout): about $0.70, measured at $0.0046 a run in the first matrix.

How the $5 stretches:

- The agent runs once per scenario, seed and model. Firewall off, Gate 0 only, Gates 0 to 2 and the full tree are all evaluated on the same recorded checkout, because the firewall doesn't act until the agent has already checked out.
- Eval gate calls go through batch pricing (half price).
- Tests replay recorded model responses and never call a model.
- The server keeps a spend meter and refuses new runs once a hard cap is reached.
- The hosted demo replays recorded real runs by default, with a small daily cap on live runs.
- Gemini runs on its free tier, which only exists on a Google Cloud project with billing turned off.

## To do outside the code (Omar)

- [x] Make `dev` the default branch and delete `main`; branch protection on `dev` and `prod` with Prod guard required on `prod`.
- [x] Create the sandbox accounts: one buyer, four sellers, two attackers.
- [x] Add the sandbox app's client ID and secret as environment variables in the cloud environment's settings.
- [x] Allow the payment sandbox API host in the cloud environment's network settings.
- [x] Add `SANDBOX_API_URL`, the sandbox REST API's base URL, to the cloud environment's variables.
- [x] Allow the platform's static asset host (the checkout page's scripts and styles) in the network settings, so the buyer's one approval can load.
- [x] Turn on saving payment methods in the sandbox app's settings.
- [x] Create the firewall platform's business account and a sandbox app on it with saving payment methods and payouts on, and swap its credentials into `SANDBOX_CLIENT_ID` and `SANDBOX_CLIENT_SECRET`.
- [ ] Allow `api.render.com` in the network settings, plus `api.openai.com` when the OpenAI column is added.
- [ ] Get a Gemini API key from a Google Cloud project with billing turned off.
- [ ] Add OpenAI API credit (the ChatGPT subscription doesn't cover the API), or drop that column.
- [ ] Claim the $50 Render credits.
- [ ] Create a Channel3 developer account and apply the hackathon code; add the key as a network secret for `api.trychannel3.com` (header `x-api-key`), or as `FIREWALL_CHANNEL3_API_KEY`, and allow `api.trychannel3.com` in the network settings. Then record Gate 2's fixtures with real market prices (`pnpm --filter @firewall/firewall record-gate2-fixtures`).
- [x] Install the APIMatic Context Plugin in Claude Code.
- [ ] Ask AG Grid and Bryntum on the hackathon Discord for licenses that last until Dec 15, and don't start either 45-day trial before Oct 25.
- [ ] Ask on the Discord whether any sponsor offers model API credits.

## Sandbox accounts

Made with the sandbox's bulk upload. The passwords are only in Omar's copy of the upload file and the environment; the emails aren't secret.

| Account | Role | Arena payee | Merchant ID variable |
|---|---|---|---|
| `omarg-fw-platform@business.example.com` | The firewall platform: owns the app, payee on every order, pays sellers out | | (the app's credentials in `SANDBOX_CLIENT_ID`, `SANDBOX_CLIENT_SECRET`) |
| `omarg-fw-buyer@personal.example.com` | The buyer, $5,000 balance | | (login in `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD`) |
| `omarg-fw-seller1-northgate@business.example.com` | Northgate Supply | `seller_1` | `SANDBOX_MERCHANT_SELLER_1` |
| `omarg-fw-seller2-larkspur@business.example.com` | Larkspur Goods | `seller_2` | `SANDBOX_MERCHANT_SELLER_2` |
| `omarg-fw-seller3-quayside@business.example.com` | Quayside Gadgets | `seller_3` | `SANDBOX_MERCHANT_SELLER_3` |
| `omarg-fw-seller4-ember@business.example.com` | Ember Market | `seller_4` | `SANDBOX_MERCHANT_SELLER_4` |
| `omarg-fw-attacker1@business.example.com` | Attacker 1 | `attacker_1` | `SANDBOX_MERCHANT_ATTACKER_1` |
| `omarg-fw-attacker2@business.example.com` | Attacker 2 | `attacker_2` | `SANDBOX_MERCHANT_ATTACKER_2` |

All the seller and attacker accounts start at a $0 balance, so a payout to an attacker stands out on the sandbox dashboard.

## Hackathon credits and trials

| Offer | What | When to claim |
|---|---|---|
| Render | $50 of credits, through Render's claim portal | Now; needed for the eval on Render Workflows (v1.2) |
| APIMatic | A free subscription for participants who use its Context Plugin | Now; the plugin is in use |
| AG Grid | 45-day AG Studio trial | Not before Oct 25 (ask on Discord for a license lasting to Dec 15 first); needed from about Oct 30 |
| Bryntum | 45-day trial | Same as AG Grid |
| Channel3 | 20,000 free credits with the hackathon code on its sponsor page | Now; Gate 2's market price reference |
| KERNEL, Elastic, Zapier, Postman, Astropods | Free tiers and support; no specific credits found | Not needed |
| GitHub Student Developer Pack | GitHub Pro (branch rules and environments on a private repo) and other student offers | Now |

