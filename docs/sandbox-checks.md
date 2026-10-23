# Sandbox checks

What the payment platform's sandbox answered to the plan's first technical checks (MVP step 6), and what each answer changes. Run on Oct 22, 2026 with `pnpm --filter @firewall/payments sandbox-checks`, which re-asks checks 1 to 3 and prints the answers; re-run it after any change in the sandbox app's settings.

## Answers

| # | Question | Answer | What it changes |
|---|---|---|---|
| 1 | Can each order pay a different merchant? | Yes, for all six arena merchants | Attack A2 stands |
| 1 | Can one authorize order pay several sellers? | No: an authorize order holds one purchase unit | One order per seller (step 7) |
| 2 | Authorize, then capture | Yes, including to another merchant | None |
| 2 | Authorize, then void | Not for another merchant's hold: refused as a permission error. Yes for the app's own hold | The platform is the payee and pays sellers out; see below |
| 2 | Refund a capture paid to another merchant | Refused the same way | Same fix as void: the platform refunds its own captures |
| 2 | Pay a seller after capture | Yes: a payout to a seller's merchant ID completes in under a minute | Payouts join step 7 |
| 2 | Hold lengths | Expires 29 days after it's made; reauthorize refused before day 4 | Matches the fake |
| 3 | Save the buyer's wallet once, then order with no redirect | Not tested yet: blocked twice, see below | Waits on two settings |
| 4 | Which agent toolkit tools can we use? | Read, refund and dispute tools; not its order tools | The held checkout is a direct API call |
| 5 | Can Render Workflows run TypeScript? | Yes, with `@renderinc/sdk` (public beta) | None |

## 1. Per-order payee

An order created with intent authorize and a `payee.merchant_id` comes back naming that merchant, for each of the four honest sellers and both attackers, and a capture on it credits that merchant (fees come off at capture: a $1.00 capture nets the merchant $0.48).

An authorize order with two purchase units is refused with `UNSUPPORTED_INTENT`, even when both name the same merchant; only capture orders take several. The adapter interface (`CreateOrderInput.purchaseUnits`) and the fake (`MAX_PURCHASE_UNITS = 10`) assume one order per cart with a unit per seller. Step 7 changes that to one order per seller and adds a contract test that an authorize order holds one purchase unit, so the fake refuses what the sandbox refuses.

## 2. Authorize, capture, void

A card as the payment source authorizes with no buyer approval step: create the order, then authorize it with the card in the request body. Putting the payment source on the create call instead requires an idempotency header on every such call, so the two-call form is the one to use, and it's the shape the adapter already has.

Capture works on a hold for any of the six merchants. **Void and refund don't**: the app the credentials belong to isn't the payee, and the platform answers `PERMISSION_DENIED`. Acting for another merchant needs that merchant's consent through partner onboarding, which this app isn't allowed (`NOT_AUTHORIZED`), and the per-request assertion header is refused for the same reason.

Without void, a blocked checkout would sit held for 29 days before it expires. The money never moves, but the Observatory and the eval would show "held" where the plan says "voided", and the hold counts against the buyer meanwhile. The way out the sandbox allows:

1. **Void with the payee's own credentials.** Each arena merchant account gets its own sandbox app, and the adapter voids and refunds a merchant's holds with that merchant's credentials. Orders are still created and authorized by the main app, so the buyer's saved wallet stays in one place. Not yet confirmed: the script tries it as soon as `SANDBOX_MERCHANT_SELLER_1_CLIENT_ID` and `SANDBOX_MERCHANT_SELLER_1_CLIENT_SECRET` are set.
2. **If that's refused too**, each merchant's orders are created, authorized, captured and voided entirely with its own credentials. That works by construction, but a saved wallet belongs to the merchant that saved it, so the buyer's wallet would be saved once per merchant (six scripted approvals at setup instead of one).

The app's own sandbox account (the one the credentials belong to, which is none of the seven arena accounts) isn't set up for card payments, which doesn't matter: it never takes a payment.

### What we did instead: the platform is the payee

Both ways out above depend on the sellers: their own keys, or their own orders. That fails against the attack the arena is about, since the attacker is a seller and won't hand over keys, and no honest seller would either. So the firewall platform became the payee (decision in `docs/PLAN.md`, *Who holds the money*): an eighth sandbox business account owns the app, every order pays it, and the sellers are paid with payouts after capture. The default business account the first app belonged to couldn't take cards (`PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`); a bulk-uploaded business account can, like the sellers.

Checked on Oct 22 with the new app's credentials:

| Call | Answer |
|---|---|
| Create an authorize order with no payee, then authorize with a card | Held (`CREATED`) |
| Void that hold | Voided (204) |
| Capture a second hold | Captured (`COMPLETED`) |
| Pay $1.00 to seller_1 by its merchant ID | Accepted as `PENDING`, `SUCCESS` within 45 seconds |

With one payee, the one-purchase-unit limit stops mattering: a whole cart is one order and one hold, and the split between sellers happens at payout. The first checks' script still asks the old per-merchant questions; step 7 changes it to these.

## 3. Saved wallet

Two things stop this check, both settings outside the code:

- **Saving payment methods is off for the app.** Saving a card is refused with `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. It's a checkbox in the app's settings on the developer dashboard.
- **The buyer's one approval can't load here.** Saving the wallet needs the buyer to approve once in the checkout page. A scripted sandbox login gets through (the page greets the buyer by name), but the page loads its scripts and styles from the platform's static asset host, which the cloud environment's network policy refuses, so it never gets past "Getting your wallet". The same is true of the per-order approval link, the plan's fallback.

Once both are fixed, the check is: save the wallet with one scripted approval, then create and authorize an order against the saved wallet and see that no approval link comes back. Until then the card path proves everything else in the flow, and a saved card is a second fallback for the demo if the wallet can't be saved.

## 4. The agent toolkit

Version 1.11.0, last updated on npm on Sep 29, 2026. It has exports for the AI SDK, MCP, OpenAI, LangChain and Bedrock.

- Its AI SDK export is built against AI SDK 4 (its types are `Tool` and `LanguageModelV1`), and the current AI SDK is 7.0. Its tools won't plug into an AI SDK 7 agent as they are: step 8 either wraps the toolkit's functions in AI SDK 7 tools or connects to the toolkit's MCP server.
- `create_order` always makes a capture order with one purchase unit, and takes no payee, custom ID or saved payment method. `pay_order` captures an order. Neither can hold money for review, so the agent's checkout tool is ours: create and authorize through the adapter.
- What fits as-is: `get_order`, `create_refund` and `get_refund`, `list_disputes`, `get_dispute` and `accept_dispute_claim`, `list_transactions`, `get_merchant_insights`. Those cover the dispute evidence pack and transaction insights in v1.2.
- It brings in the OpenAI SDK, LangChain core, mathjs and the platform's server SDK as dependencies. The server bundle takes only what's imported, but `pnpm install` gets all of it.

## 5. Render Workflows

The TypeScript SDK is `@renderinc/sdk`: `task(options, fn)` defines a task, the `Render` client starts runs (`startTask`, or `runTask` to wait for the result), and a task can start other tasks by calling them. Workflows are in public beta. The answer comes from Render's documentation; the cloud environment still refuses `api.render.com`, which matters only once there's something to deploy.

## Latency

From the runs on Oct 22, one call at a time from the cloud environment:

| Call | Time |
|---|---|
| Create an order | 0.4 to 1.1 s |
| Authorize with a card | 1.3 to 3.2 s |
| Capture | 1.7 s |
| A refused call (void, refund, wrong intent) | about 0.3 s |
