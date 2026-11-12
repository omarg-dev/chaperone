# Deploying

Chaperone runs on the VPS at `https://chaperone.omarg.dev`, deployed the rulebook's way. Releasing and deploying are the rulebook's shared workflows: a merged PR that adds a new version to the top of `CHANGELOG.md` is a release, and `.github/workflows/release.yml` builds the arm64 image, pushes it to `ghcr.io/omarg-dev/chaperone` as `:<version>` and `:prod`, tags the commit `v<version>`, publishes a GitHub Release, writes `compose.yml` into `~/stacks/chaperone/` over SSH, runs `docker compose pull && up -d` there, and waits for `/health`. The server never has a checkout of this repo. Staging is off.

## 1. "setup"

The rulebook's "Set up a repo" workflow (run with `repo: chaperone`) gives `main` its ruleset, copies the deploy secrets kept in the rulebook, sets `DEPLOY_ENABLED`, and adds the site block from [deploy/Caddyfile.example](../deploy/Caddyfile.example) to the gateway (skipping it when the site is already there). Nothing is set by hand in this repo's settings. DNS needs nothing: the `*.omarg.dev` wildcard covers `chaperone.omarg.dev`.

The site block proxies to the container `chaperone` on port 3000, and rate limits live runs (12 a minute per address), decisions (10) and other writes more tightly than reads.

## 2. The server's `.env`

The first release creates `~/stacks/chaperone/` with `data/` and a `.env` copied from [deploy/.env.example](../deploy/.env.example). It runs as it is: replays, the dashboard and the arena work, and live runs are off. Fill in the real values once (the table at the end of this section says which turn what on), then apply them:

```sh
nano ~/stacks/chaperone/.env
cd ~/stacks/chaperone && docker compose up -d
```

The container runs as uid 1000. If the deploy user isn't uid 1000, the deploy log says so; then `sudo chown -R 1000:1000 ~/stacks/chaperone/data`.

## 3. Releases and going back

Ask for a release ("release"): the release PR bumps the version in `package.json` and adds its entry to `CHANGELOG.md`, and merging it deploys. To put an earlier release back ("rollback"), run the Release workflow by hand with that version: it points `:prod` at that version's image and deploys it with that release's `compose.yml`.

## 4. The nightly backup

The app's `backup` command takes SQLite's online backup of the event log into `data/backups/events-<UTC time>.db`, checks it, and keeps the newest 14. After the first release:

```sh
crontab -e
# add:
17 3 * * * cd ~/stacks/chaperone && docker compose exec -T app node dist/cli.js backup --keep 14 >> ~/stacks/chaperone/backup.log 2>&1
```

Run the command once by hand to see it work. To restore a backup:

```sh
cd ~/stacks/chaperone
docker compose stop app
sudo cp data/events.db data/events.db.before-restore     # optional: keep what is there
sudo cp data/backups/events-<time>.db data/events.db
sudo rm -f data/events.db-wal data/events.db-shm
sudo chown 1000:1000 data/events.db
docker compose up -d
```

## 5. The demo runs

The hosted app should open on real recorded runs, so import them once. The event log is append-only, and import only adds: events keep their IDs, times and parents, an event already there is skipped, and importing the same file twice does nothing.

On a machine that has the real runs (this repo, with its `.env`), export the ones that held their money on the sandbox. From the server's own log (runs started on the web app, `apps/server/data/events.db`):

```sh
pnpm --filter @firewall/server export-runs --sandbox --out "$PWD/demo-runs.json"
```

or from an eval matrix run, whose events are in their own file under `results/`:

```sh
pnpm --filter @firewall/server export-runs --sandbox --db "$PWD/results/<date>-sandbox-<column>.events.db" --out "$PWD/demo-runs.json"
```

`--run <runId>` (repeatable) picks single runs instead. Look at what is in the file before sending it: the runs and the seller text in them become public. Then import on the server:

```sh
scp demo-runs.json <user>@<server>:/tmp/
ssh <user>@<server> 'cd ~/stacks/chaperone && docker compose exec -T app node dist/cli.js import-runs - < /tmp/demo-runs.json && rm /tmp/demo-runs.json'
```

Runs imported with a time from today count toward that UTC day's live-run spend, so import runs the app made on the web earlier than today, or accept the small overlap. To show an eval's results on the dashboard, copy its `.json` file into `~/stacks/chaperone/data/results/`; no restart is needed.

## What turns live runs and sandbox money on

| In the server's `.env` | Effect |
|---|---|
| nothing | replays, the dashboard, the escalation inbox and the arena work; the Start a run page says live runs are off |
| `FIREWALL_ANTHROPIC_API_KEY` | live runs on, with one fake payment adapter ("Practice money", not a sandbox result) |
| `FIREWALL_LIVE_DAILY_USD` | the most live runs may spend in a UTC day (default `0.25`; `0` turns live runs off). Counted from the event log, so a restart can't reset it |
| `FIREWALL_STUDIO_DAILY_USD` | the most the dashboard's AG Studio assistant may spend in a UTC day (default `0.10`; `0` turns it off). It needs `FIREWALL_ANTHROPIC_API_KEY`, and is counted in the event log's database |
| `AG_STUDIO_LICENSE_KEY` | AG Studio's licence key, served to the dashboard at runtime. Unset, Studio shows its watermark |
| `SANDBOX_CLIENT_ID`, `SANDBOX_CLIENT_SECRET` and the six `SANDBOX_MERCHANT_*` | decisions on held purchases use the real sandbox |
| the above and `SANDBOX_BUYER_VAULT_ID` | live runs use the real sandbox as well. Without the vault ID they are off and the page says what is missing |
| `FIREWALL_CHANNEL3_API_KEY` | Gate 2 checks prices against the real market |

Sandbox credentials only, never live ones. After editing `.env`, run `docker compose up -d` in `~/stacks/chaperone` to apply it.

