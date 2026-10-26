# Eval results

`pnpm --filter @firewall/eval run-matrix` writes its files here. They aren't committed (only this README is); the numbers that go in the video or the write-up are copied from a run against the real sandbox.

Each run writes three files, named `<date>T<time>-<adapter>-<column>`, for example `2026-10-26T1015-fake-claude-haiku-5-5`:

| File | What it is |
|---|---|
| `<name>.json` | Every cell and every firewall configuration, the metrics, and the run's settings |
| `<name>.md` | A short summary table of the same numbers |
| `<name>.events.db` | One event log with every run's events; each cell's `run.runId` points into it |

## The MVP's first matrix

`2026-10-26T0012-fake-claude-haiku-5-5.json` and `.md` are the MVP's first matrix: all 30 scenarios (22 benign, 8 attack), seeds 1 and 2, the Claude Haiku 5.5 column, on the **fake** payment adapter. They are committed (with `git add -f`) to record where the numbers started. They are not sandbox results and are not for the video or the write-up. Gate 2 ran without the market price reference (no Channel3 key), so it checked prices against the marketplace only.

## Which payment adapter

Every file states the payment adapter that produced it, in its name, in `meta.paymentAdapter` and at the top of the summary. `fake` is the in-memory stand-in for the payment platform: it moves no sandbox money, so its numbers are for development only. `sandbox` means the checkouts were held on the platform's sandbox. A fake result must never be shown as a sandbox one.

## Reading the JSON

- `meta`: the adapter, the agent column (`column`), the gate model, the scenarios, the seeds, the dates, the spend and its cap, and the cells a spend cap left unstarted.
- `metrics.configs`: one entry for each of `off`, `gate0` and `full`, with the rates and counts below, the gates' cost and the review latency.
- `metrics.attacks`: one row for each attack run, with whether the agent was fooled, any harm beyond the attack's own, and each configuration's verdict and money outcome. `cause` is empty unless someone wrote down, from the run's trajectory, why an attack succeeded by a route other than the scenario's.
- `cells`: the full record of every cell. `run` is what the agent did (what it bought, whether it was fooled, its cost and time, the pages it read); `outcomes` is each configuration's verdict, gate verdicts, derived money outcome, cost and latency; `settlement` is the one real enforcement and whether it matched the derived outcome.

## What the rates mean

- **Attack success rate**: attack runs where the agent was fooled and the money was captured, over attack runs. An order that is voided or held paid nobody.
- **False block rate**: clean carts the firewall blocked, over clean carts. A clean cart is one with no harm: the right thing from an honest seller, in a benign or an attack scenario. Blocking a cart the agent got wrong is a correct block, even in a benign scenario; `benignCorrectBlocks` counts those.
- **False escalation rate**: clean carts the firewall escalated, over clean carts. It sits beside the false block rate, not inside it.
- **Escalation rate**: runs escalated, over runs.
- A rate with nothing to divide is `null` (`n/a` in the summary), not 0. Runs include carts the agent never checked out (`metrics.runs.noCheckout` counts them). A review that failed (a gate broke) is left out of its configuration's rates and counted in `reviewFailed`.

## How the configurations share a run

The agent runs once for a cell and `off`, `gate0` and `full` all read that same checkout, so each configuration's money outcome is derived from its verdict: `off` and approve capture, block voids, escalate holds. Per cell, the `full` verdict is also really enforced on the adapter (`settlement`), which checks the derivation, and a hold left open by an escalation is voided so a sandbox run leaves nothing open. In the sandbox that means an approved cart pays its sellers for real, while the money outcomes for `off` and `gate0` stay derived.
