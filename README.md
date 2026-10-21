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

## Layout

| Folder | What's in it |
|---|---|
| `apps/server` | The HTTP server (Hono): the API, and later the websocket and the built web app |
| `packages/events` | The append-only event log every run writes to (SQLite through Drizzle) |
| `packages/` | Other libraries the apps share (arena, firewall and so on), added as each step needs them |
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
