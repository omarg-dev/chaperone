# Agent checkout firewall

An intent firewall and adversarial test arena for AI shopping agents, built solo for the hackathon (submission deadline Nov 12, 2026; judging runs until Dec 15). A shopping agent's checkout becomes a sandbox payment authorization; a review tree of gates (deterministic policy, a quarantined extractor, an intent auditor and a trace auditor) compares the cart against the mandate the person confirmed, then captures, escalates to the person, or voids. The arena is a seeded marketplace with honest and attacker sellers, and an eval harness measures attack success rate, false block rate, cost and latency with the firewall off and on. The stack is TypeScript throughout: a pnpm workspace monorepo with a Hono server, a React + Vite web app, and SQLite through Drizzle. The plan, the decisions behind it and the milestones live in `docs/PLAN.md`.

Follow `omarg-dev/code-repo-rulebook` for branches, commits, PRs, CI, versions and deploys. This file only adds what's specific to this repo.

## Workflow

- No pre-push checks yet: they're added with the stack.
- Staging is off. Deploys follow the rulebook's plain pull-and-restart once there's something to deploy.

## Differs from the rulebook

- **No "Apps people use" defaults for language, layout or sign-in.** The UI is English only, desktop first, and has no sign-in: judges need free, unrestricted access to the hosted demo. Design tokens, light and dark, and short sentence-case copy still apply.
- **One minor version per milestone.** Omar approved going past the patch for milestones: MVP is 0.1.x, v1.1 is 0.2.0, v1.2 is 0.3.0, v1.3 is 0.4.0. Releases between milestones bump the patch as usual.

## Rules that are easy to break

- **Don't name the company running the hackathon, or its payment platform, in commits or files for now.** Say "the hackathon" or "the payment platform". The sponsor tools (AG Grid, Bryntum, Render, APIMatic, Postman) can be named. The repository and product get renamed later, and the final name must not use or imply the host company's brand.
- **Sandbox only.** No live payment credentials, and no real secrets in the repo or its history.
- **All arena brands, products, sellers and reviews are fictional.** No real product brands anywhere in the arena or the demo.
- **Say which eval numbers used the fake payment adapter.** During development the eval matrix can run against an in-memory fake of the payment platform instead of its sandbox. Whenever Omar asks whether the project is fully done, remind him which result sets are still faked, and that any number shown in the video or the write-up has to come from a run against the real sandbox.
- **One model per eval column, and the gates never change model.** The shopping agent's eval columns (Claude Haiku 5.5, OpenAI, Gemini) each run on exactly one model, with no provider fallback, or one column's numbers would mix models. The gates run on Claude Haiku 5.5 in every column.
