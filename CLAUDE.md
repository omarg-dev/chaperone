# Agent checkout firewall

An intent firewall and adversarial test arena for AI shopping agents, built solo for the hackathon (submission deadline Nov 12, 2026; judging runs until Dec 15). A shopping agent's checkout becomes a sandbox payment authorization; a review tree of gates (deterministic policy, a quarantined extractor, an intent auditor and a trace auditor) compares the cart against the mandate the person confirmed, then captures, escalates to the person, or voids. The arena is a seeded marketplace with honest and attacker sellers, and an eval harness measures attack success rate, false block rate, cost and latency with the firewall off and on. The stack is TypeScript throughout: a pnpm workspace monorepo with a Hono server, a React + Vite web app, and SQLite through Drizzle. The plan, the decisions behind it and the milestones live in `docs/PLAN.md`.

Follow `omarg-dev/code-repo-rulebook` for branches, commits, PRs, CI, versions and deploys. This file only adds what's specific to this repo.

## Workflow

- Before pushing: `pnpm lint && pnpm check && pnpm test && pnpm build`. After changing dependencies, run them from a fresh `pnpm install --frozen-lockfile`.
- Work goes step by step through the Progress tables in `docs/PLAN.md`: one step per PR, and the PR that finishes a step updates its status and the "Now" line.
- Hand mundane tasks (fictional content, boilerplate, version lookups) to Claude Haiku subagents.
- The rulebook (`omarg-dev/code-repo-rulebook`) has to be in the session. If it isn't, add it before the first branch or commit. The rules a session without it breaks: branches are `feat/`, `fix/`, `cleanup/` or `change/` (never `claude/…`), commits carry no trailers (no `Co-Authored-By:` or `Claude-Session:`), PRs are drafts into `dev` with plain imperative titles, an open PR isn't watched (no subscribing to its activity, no polling CI, no scheduled check-ins), and pushed history is never rewritten.
- Omar keeps one conversation for discussion and another for building. A decision made in discussion lands in `docs/PLAN.md` or this file the same day, so read both before starting work rather than relying on chat history.
- APIMatic's Context Plugin for the payment platform is installed by the cloud environment's setup script. Use its skill and MCP server for payment integration work: using it is what qualifies for APIMatic's prize.
- The payment platform's own official plugin is installed by the setup script too, for looking at the sandbox, explaining errors and reading docs. Integration code still comes from APIMatic's plugin, even when both offer to help. The official plugin's MCP server needs a sandbox access token that expires within hours, so it's usually not connected, and that's expected.
- UI work starts with a design pass using the design skills, and every UI PR carries screenshots in light and dark.
- Staging is off. Deploys follow the rulebook's plain pull-and-restart once there's something to deploy.

## Conventions

- `apps/` holds what runs (the server, later the web app); `packages/` holds libraries named `@firewall/<name>`. Workspace packages export their TypeScript source, and the server's build bundles them with esbuild into one file, so the Docker image needs no `node_modules`.
- Imports use `.js` extensions (`./app.js` for `app.ts`), as NodeNext module resolution requires.
- The version lives only in the root `package.json`; the server reads it from there, and a test checks the changelog's latest entry names the same version.
- Biome lints and formats code and JSON only. It would also reformat Markdown and pad every table, so Markdown is left out of its `files.includes`.
- Schema changes: edit a package's `src/schema.ts`, then `pnpm --filter <package> exec drizzle-kit generate --name <what_changed>` writes the migration into its `drizzle/` folder. SQL drizzle-kit can't express (triggers) goes in a `--custom` migration. Migrations run when the database is opened, so there's no separate migrate step.
- Database tests use a real SQLite file in a temp folder, never a mock and never the dev database.
- The arena has three layers: pure shop functions (`packages/arena/src/shop.ts`) over one arena and one cart; the service (`service.ts`), which calls them and writes each call to the event log; and the HTTP routes (`apps/server/src/routes/arena.ts`), which validate input with zod and call the service. New marketplace behaviour goes in the shop first, with its tests.
- Arena events record what was served, with page content marked `seller_content` and cart and checkout steps marked `catalog`. A failed call is recorded as `<type>_failed` with its reason.
- better-sqlite3 runs from the prebuilt binaries it ships with. Its build script is ignored in `package.json` (`pnpm.ignoredBuiltDependencies`), so nothing compiles; it stays outside the server bundle, and the Dockerfile copies its JavaScript and Linux binaries into the image.
- Payments go through the `PaymentAdapter` interface (`packages/payments/src/types.ts`). The in-memory fake implements it for development and the eval; the sandbox adapter will too. Both must pass the shared contract suite in `contract.ts`. A behaviour the firewall relies on gets a contract test first, so the fake can't drift from the platform. A capability one adapter lacks (moving time) is declared, and its tests are left unregistered rather than skipped.
- Every payment call in a run goes through `recordPayments`, which writes it to the payments lane with its input, result or error, and latency.
- Tests sit next to the code they test (`app.ts`, `app.test.ts`) and run with `pnpm test` from the root.

## Differs from the rulebook

- **No "Apps people use" defaults for language, layout or sign-in.** The UI is English only, desktop first, and has no sign-in: judges need free, unrestricted access to the hosted demo. Design tokens, light and dark, and short sentence-case copy still apply.
- **One minor version per milestone.** Omar approved going past the patch for milestones: MVP is 0.1.x, v1.1 is 0.2.0, v1.2 is 0.3.0, v1.3 is 0.4.0. Releases between milestones bump the patch as usual.

## Rules that are easy to break

- **Don't name the company running the hackathon, or its payment platform, in commits or files for now.** Say "the hackathon" or "the payment platform". The sponsor tools (AG Grid, Bryntum, Render, APIMatic, Postman) can be named. The repository and product get renamed later, and the final name must not use or imply the host company's brand.
- **The event log is append-only.** Replay, the eval numbers and dispute evidence all assume a written event never changes, so `@firewall/events` has no update or delete, and SQLite triggers refuse them. Pinned by `test_events_cannot_be_updated_or_deleted`. A correction is a new event that points at the old one.
- **Sandbox only.** No live payment credentials, and no real secrets in the repo or its history.
- **Model clients are configured explicitly.** Cloud sessions set variables for Claude Code itself (`ANTHROPIC_BASE_URL` points at the session's proxy), and those must never reach the product. So every model client the code creates takes its key and base URL from the app's own config, never from an SDK's environment defaults.
- **Where credentials live.** Never in the repo or in chat. Plain cloud environment variables are readable by every session in the environment, so a key the agent proxy can attach to its host goes in as a network secret instead, and the code sends a placeholder. On the server, its `.env` holds its own keys.
- **All arena brands, products, sellers and reviews are fictional.** No real product brands anywhere in the arena or the demo. Pinned by `test_arena_uses_no_real_brands`, which also refuses names one letter away from a real brand; add to its list (`packages/arena/src/catalog/real-brands.ts`) when a new category comes in.
- **Reviews and other page content in the base catalog stay honest.** Attack content belongs to the attack scenario that injects it, never the base catalog, or benign scenarios stop being benign.
- **Say which eval numbers used the fake payment adapter.** During development the eval matrix can run against an in-memory fake of the payment platform instead of its sandbox. Whenever Omar asks whether the project is fully done, remind him which result sets are still faked, and that any number shown in the video or the write-up has to come from a run against the real sandbox.
- **One model per eval column, and the gates never change model.** The shopping agent's eval columns (Claude Haiku 5.5, OpenAI, Gemini) each run on exactly one model, with no provider fallback, or one column's numbers would mix models. The gates run on Claude Haiku 5.5 in every column.
