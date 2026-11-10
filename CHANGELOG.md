# Changelog

What each release brought, for the people who use it. Adding a version at the top and merging it
into main is the release: it's tagged, published and deployed from there. Each release bumps the
patch version, except the one minor version per milestone the repo's `CLAUDE.md` allows.

## 0.3.0

v1.2: Chaperone's numbers, measured against the real payment sandbox, and a site that explains itself.

- A new home page says what Chaperone is in one screen, walks through one real attack, and shows the results: with the firewall on, attacks that worked 72% to 84% of the time got through 3.1% (Claude Haiku 5.5) and 0% (OpenAI GPT-6 Luna) of the time, and no honest cart was blocked.
- The firewall was also tested against 17 attacks taken from published benchmarks that it was never tuned on: 1.5% and 4.4% got through. When an attacker plants instructions on the very product you asked for, it asks you rather than guess, so about half of those honest carts come to you to approve.
- Explore every benchmark result on the dashboard in AG Studio: slice it, chart it, or ask it questions in plain English.
- The gates now judge an agent on any model: the benchmark ran the same four gates in front of Claude and OpenAI shopping agents.
- Each review notes what the real market charges for that kind of product, for reference only.
- SDK docs at /docs, and a Postman collection to try the whole flow without writing code.
- Pages are simpler to read: the money's route line now appears only on a run's own page.

## 0.2.0

v1.1: Chaperone gets its web app, at chaperone.omarg.dev, showing every purchase an agent tried and what happened to the money.

- Watch a run on one timeline: what the person asked for, what the agent did, what each gate found and where the money went, with seller text kept behind a hatch. Replay any finished run step by step, and share a link to a moment in it.
- Start a run yourself: pick a shopping task, read and lock the mandate, and watch a real agent shop while the gates review its cart. Live runs are capped at $0.25 of model spend a day.
- Approve or reject held purchases from an inbox, oldest first, with each gate's reason. A decision the payment platform refused stays there until it's finished.
- Browse every run in a grid you can filter, sort, group and export to Excel, with totals for what's held, paid to sellers, paid to attackers and voided.
- See how the firewall does on the eval: off, rules only and the full review side by side, grouped by attack and charted, with each result saying which payment adapter produced it.
- A fourth gate, the trace auditor, checks whether the agent's choice came from the mandate or from a seller steering it, and sends steered purchases to a person.
- Put Chaperone in front of your own agent with the SDK, from the example on the Start a run page.

## 0.1.1

The MVP: a shopping agent's checkout is held, reviewed against what the person asked for, and only then paid.

- Say what you want in plain words, and the request becomes a locked mandate you can read, edit and confirm before anything is bought.
- A shopping agent (Claude Haiku 5.5) shops the arena and checks out, but its checkout only holds the money, in the payment platform's sandbox or an in-memory stand-in.
- Three gates review every held checkout: rules over the trusted catalog, a quarantined reader of seller pages that turns them into plain facts, and an AI auditor that never sees seller text. A good cart is captured and each seller paid its share after fees; a bad one is voided; an unsure one waits for the person to approve or reject.
- The arena now has seven kinds of attack (poisoned reviews, a copied listing, a "required" add-on, a fake coupon, an overpriced twin, a lookalike brand and fake urgency) and 22 honest shopping requests.
- `@firewall/sdk` wraps any agent's payment tools in the firewall with a few lines of code (agents shopping the arena, for now).
- One command runs a scenario end to end, and the eval runs every scenario with the firewall off, Gate 0 only and the full tree, then writes attack success, false blocks, false escalations, cost and latency to a results file that says which payment adapter it used.

## 0.1.0

- First release.
