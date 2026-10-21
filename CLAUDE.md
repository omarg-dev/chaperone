# Agent checkout firewall

An intent firewall and adversarial test arena for AI shopping agents, built solo for the hackathon (submission deadline Nov 12, 2026; judging runs until Dec 15). A shopping agent's checkout becomes a sandbox payment authorization; a review tree of gates (deterministic policy, a quarantined extractor, an intent auditor and a trace auditor) compares the cart against the mandate the person confirmed, then captures, escalates to the person, or voids. The arena is a seeded marketplace with honest and attacker sellers, and an eval harness measures attack success rate, false block rate, cost and latency with the firewall off and on. The stack isn't decided yet.

Follow `omarg-dev/code-repo-rulebook` for branches, commits, PRs, CI, versions and deploys. This file only adds what's specific to this repo.

## Workflow

- No pre-push checks yet: they're added with the stack.
- Staging is off. Deploys follow the rulebook's plain pull-and-restart once there's something to deploy.

## Differs from the rulebook

- **No "Apps people use" defaults for language, layout or sign-in.** The UI is English only, desktop first, and has no sign-in: judges need free, unrestricted access to the hosted demo. Design tokens, light and dark, and short sentence-case copy still apply.

## Rules that are easy to break

- **Don't name the hackathon's sponsor or its payment platform in commits or files for now.** Say "the hackathon" or describe the thing generically. The repository and product get renamed later, and the final name must not use or imply the sponsor's brand.
- **Sandbox only.** No live payment credentials, and no real secrets in the repo or its history.
- **All arena brands, products, sellers and reviews are fictional.** No real product brands anywhere in the arena or the demo.
