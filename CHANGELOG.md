# Changelog

What each release brought, for the people who use it. A release is a `dev → prod` merge and
bumps the patch version.

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
