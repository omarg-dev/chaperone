# Agent checkout firewall

An intent firewall and adversarial test arena for AI shopping agents, built solo for the hackathon (submission deadline Nov 12, 2026; judging runs until Dec 15). A shopping agent's checkout becomes a sandbox payment authorization; a review tree of gates (deterministic policy, a quarantined extractor, an intent auditor and a trace auditor) compares the cart against the mandate the person confirmed, then captures, escalates to the person, or voids. The arena is a seeded marketplace with honest and attacker sellers, and an eval harness measures attack success rate, false block rate, cost and latency with the firewall off and on. The stack is TypeScript throughout: a pnpm workspace monorepo with a Hono server, a React + Vite web app, and SQLite through Drizzle. The plan, the decisions behind it and the milestones live in `docs/PLAN.md`.

Follow `omarg-dev/code-repo-rulebook` for branches, commits, PRs, CI, versions and deploys. This file only adds what's specific to this repo.

## Workflow

- Before pushing: `pnpm lint && pnpm check && pnpm test && pnpm build`. After changing dependencies, run them from a fresh `pnpm install --frozen-lockfile`.
- Work goes step by step through the Progress tables in `docs/PLAN.md`: one step per PR, and the PR that finishes a step updates its status and the "Now" line.
- Hand mundane tasks (fictional content, boilerplate, version lookups) to Claude Haiku subagents.
- UI work starts with a design pass using the design skills, and every UI PR carries screenshots in light and dark.
- Staging is off. Deploys follow the rulebook's plain pull-and-restart once there's something to deploy.

## Conventions

- `apps/` holds what runs (the server, later the web app); `packages/` holds libraries named `@firewall/<name>`. Workspace packages export their TypeScript source, and the server's build bundles them with esbuild into one file, so the Docker image needs no `node_modules`.
- Imports use `.js` extensions (`./app.js` for `app.ts`), as NodeNext module resolution requires.
- The version lives only in the root `package.json`; the server reads it from there, and a test checks the changelog's latest entry names the same version.
- Biome lints and formats code and JSON only. It would also reformat Markdown and pad every table, so Markdown is left out of its `files.includes`.
- Tests sit next to the code they test (`app.ts`, `app.test.ts`) and run with `pnpm test` from the root.

## Differs from the rulebook

- **No "Apps people use" defaults for language, layout or sign-in.** The UI is English only, desktop first, and has no sign-in: judges need free, unrestricted access to the hosted demo. Design tokens, light and dark, and short sentence-case copy still apply.
- **One minor version per milestone.** Omar approved going past the patch for milestones: MVP is 0.1.x, v1.1 is 0.2.0, v1.2 is 0.3.0, v1.3 is 0.4.0. Releases between milestones bump the patch as usual.

## Rules that are easy to break

- **Don't name the company running the hackathon, or its payment platform, in commits or files for now.** Say "the hackathon" or "the payment platform". The sponsor tools (AG Grid, Bryntum, Render, APIMatic, Postman) can be named. The repository and product get renamed later, and the final name must not use or imply the host company's brand.
- **Sandbox only.** No live payment credentials, and no real secrets in the repo or its history.
- **All arena brands, products, sellers and reviews are fictional.** No real product brands anywhere in the arena or the demo.
- **Say which eval numbers used the fake payment adapter.** During development the eval matrix can run against an in-memory fake of the payment platform instead of its sandbox. Whenever Omar asks whether the project is fully done, remind him which result sets are still faked, and that any number shown in the video or the write-up has to come from a run against the real sandbox.
- **One model per eval column, and the gates never change model.** The shopping agent's eval columns (Claude Haiku 5.5, OpenAI, Gemini) each run on exactly one model, with no provider fallback, or one column's numbers would mix models. The gates run on Claude Haiku 5.5 in every column.
