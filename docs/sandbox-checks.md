# Sandbox checks

What the payment platform's sandbox answered to the plan's first technical checks (MVP step 6), and what each answer changes. First run on Oct 22, 2026, and asked again the same day for the model the firewall now runs on (the platform is the payee; see the end of section 2) with `pnpm --filter @firewall/payments sandbox-checks`. That script re-asks checks 1 to 3 through the sandbox adapter and prints the answers; re-run it after any change in the sandbox app's settings. The adapter's own contract suite runs against the sandbox too, with `pnpm --filter @firewall/payments test:sandbox` (section 6).

## Answers

| # | Question | Answer | What it changes |
|---|---|---|---|
| 1 | Can each order pay a different merchant? | Yes, for all six arena merchants | Attack A2 stands |
| 1 | Can one authorize order pay several sellers? | No: an authorize order holds one purchase unit | None now: a cart is one order paid to the platform, and the sellers are paid out (step 7) |
| 2 | Authorize, then capture | Yes, including to another merchant | None |
| 2 | Authorize, then void | Not for another merchant's hold: refused as a permission error. Yes for the app's own hold | The platform is the payee and pays sellers out; see below |
| 2 | Refund a capture paid to another merchant | Refused the same way | Same fix as void: the platform refunds its own captures |
| 2 | Pay a seller after capture | Yes: a payout to a seller's merchant ID completes in under a minute | Payouts join step 7 |
| 2 | Hold lengths | Expires 29 days after it's made; reauthorize refused before day 4 | Matches the fake |
| 3 | Save the buyer's wallet once, then order with no redirect | Yes: one scripted approval saves it, and an order then authorizes against it with no approval link | The saved wallet is the checkout path; the per-order link, also scripted, is the fallback |
| 4 | Which agent toolkit tools can we use? | Read, refund and dispute tools; not its order tools | The held checkout is a direct API call |
| 5 | Can Render Workflows run TypeScript? | Yes, with `@renderinc/sdk` (public beta) | None |
| 6 | Does the platform keep what it pays the sellers? | Not when they're paid their gross lines: a $2.00 capture nets it $1.44 after fees | The sellers are paid their share of the net instead (*Fees* in the plan) |

## 1. Per-order payee

An order created with intent authorize and a `payee.merchant_id` comes back naming that merchant, for each of the four honest sellers and both attackers, and a capture on it credits that merchant (fees come off at capture: a $1.00 capture nets the merchant $0.48).

An authorize order with two purchase units is refused with `UNSUPPORTED_INTENT`, even when both name the same merchant; only capture orders take several. The adapter interface and the fake first assumed one order per cart with a unit per seller. Since the platform became the payee (section 2), a cart is one order with one purchase unit and the sellers are paid out, and a contract test pins that an authorize order holds one purchase unit, so the fake refuses what the sandbox refuses.

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

With one payee, the one-purchase-unit limit stops mattering: a whole cart is one order and one hold, and the split between sellers happens at payout. The checks script now asks these questions instead of the per-merchant ones, and the answers held on the second run (section 6).

## 3. Saved wallet

**Answered on Oct 22: it works.** With saving payment methods on for the app and the static asset host allowed, the buyer's wallet saves with one scripted approval, and every order after that is held with no approval step:

1. Create a vault setup token for the wallet, for merchant-initiated use, with a return and cancel URL. It comes back `PAYER_ACTION_REQUIRED` with an approval link.
2. The buyer approves it once. A headless Chromium logs in with the sandbox buyer's login and presses "Save and Continue" ("One-time setup, faster checkouts"); the platform redirects to the return URL with an approval token. The script stops at that redirect, so nothing has to answer at the return URL. About 15 seconds.
3. Exchange the setup token for a payment token. Its ID is the vault ID.
4. Create the cart's order with no payment source, then authorize it with the wallet's vault ID in the request body. The hold comes back `CREATED` and the order has no approval link left. About 2.5 seconds for the authorize call.

Two things learned on the way:

- **Put the wallet in the authorize call, not the create call.** Creating the order with the vault ID as its payment source also works, but the platform then authorizes it on the spot (the order comes back `COMPLETED`, already holding) and the call needs an idempotency key. The two-call form keeps create and hold as separate steps, the same shape as the card and the approval link, and the adapter doesn't have to remember which wallet an order was meant for.
- **The per-order approval link scripts too.** The same headless buyer approves an order's own link (it presses "Continue"), after which authorize holds it. That's the plan's fallback, and it now works, at about 14 seconds an order. The order carries its return URL in its application context rather than as a payment source, so the same order can still be authorized against the wallet instead.

A vaulted card (`store_in_vault`) wasn't needed, so it wasn't tried again.

## 4. The agent toolkit

Version 1.11.0, last updated on npm on Sep 29, 2026. It has exports for the AI SDK, MCP, OpenAI, LangChain and Bedrock.

- Its AI SDK export is built against AI SDK 4 (its types are `Tool` and `LanguageModelV1`), and the current AI SDK is 7.0. Its tools won't plug into an AI SDK 7 agent as they are: step 8 either wraps the toolkit's functions in AI SDK 7 tools or connects to the toolkit's MCP server.
- `create_order` always makes a capture order with one purchase unit, and takes no payee, custom ID or saved payment method. `pay_order` captures an order. Neither can hold money for review, so the agent's checkout tool is ours: create and authorize through the adapter.
- What fits as-is: `get_order`, `create_refund` and `get_refund`, `list_disputes`, `get_dispute` and `accept_dispute_claim`, `list_transactions`, `get_merchant_insights`. Those cover the dispute evidence pack and transaction insights in v1.2.
- It brings in the OpenAI SDK, LangChain core, mathjs and the platform's server SDK as dependencies. The server bundle takes only what's imported, but `pnpm install` gets all of it.

## 5. Render Workflows

The TypeScript SDK is `@renderinc/sdk`: `task(options, fn)` defines a task, the `Render` client starts runs (`startTask`, or `runTask` to wait for the result), and a task can start other tasks by calling them. Workflows are in public beta. The answer comes from Render's documentation; the cloud environment still refuses `api.render.com`, which matters only once there's something to deploy.

## 6. The sandbox adapter (step 7)

The adapter (`packages/payments/src/sandbox.ts`) uses the platform's TypeScript server SDK for orders, payments and the vault. The SDK has no payouts controller, so a payout is a direct REST call (`POST /v1/payments/payouts` with merchant-ID recipients, read back with `GET /v1/payments/payouts/{id}`), sent through the SDK client's own request builder so it shares the SDK's host, token, HTTP client and errors. The SDK's HTTP client (axios) honours the cloud environment's proxy on its own; nothing had to be configured, and TLS verification stays on.

Its contract suite passed against the sandbox on Oct 22: 16 of 16 tests twice, then 17 of 17 once the capture reported its net amount (`pnpm --filter @firewall/payments test:sandbox`, about 110 seconds). The time-limit tests aren't registered there, since the sandbox can't move time. What the run and the checks script showed, beyond checks 1 to 3:

- **A line's seller survives the round trip.** Each line item's SKU carries `<payee key>:<line ID>`, and reading the order back gives every line its seller, quantity and price. The order's payee, read back, is the platform's own account and none of the sellers.
- **A seller can't be paid twice from one capture.** The payout's batch ID is `<capture ID>:<payee key>`, and the platform refuses a batch ID it has already seen (400, "Batch with given sender_batch_id already exists"). A payout lands in about 17 seconds (`PENDING`, then `SUCCESS`).
- **The platform keeps less than the gross it captured.** A $2.00 capture nets the platform $1.44 after fees, roughly 3.49% plus $0.49, and payouts can carry a fee of their own. Paying the sellers their full lines would cost the platform its fees on every approved cart and drain its sandbox balance, so the sellers are paid their share of the net instead (*Fees* in `docs/PLAN.md`). The capture reports its net amount, read from the platform's receivable breakdown, and the fake charges the same fee.
- **A refund comes out of the platform's balance**, also after the sellers have been paid. Getting a seller's share back is outside the platform's refund, as the plan says.
- **Refusals by issue name**, which the adapter maps to the error codes the firewall acts on: `UNSUPPORTED_INTENT` (two purchase units), `ORDER_NOT_APPROVED`, `ORDER_ALREADY_AUTHORIZED`, `AUTHORIZATION_ALREADY_CAPTURED`, `PREVIOUSLY_CAPTURED`, `AUTHORIZATION_VOIDED`, `PREVIOUSLY_VOIDED`, `REAUTHORIZATION_TOO_SOON`, `REFUND_AMOUNT_EXCEEDED` and `CAPTURE_FULLY_REFUNDED`. An unknown order, authorization or capture is a 404. The payouts API answers an ID that isn't letters and digits with a malformed-request error rather than a 404, so the adapter treats such an ID as not found.
- **Not checked: reauthorizing.** The SDK's documentation disagrees with itself: the reauthorize call says a hold can be reauthorized several times within its 29 days, and its request model says only once, from day 4 to day 29. The fake follows the stricter reading. It allows one reauthorization per hold, the new hold keeps the original's expiry, and a second reauthorize is refused with `invalid_state`. The fake also voids the old hold, which the documentation doesn't mention either way. All three are unverified until a hold at least four days old exists in the sandbox. The contract tests for them need moving time, so they run against the fake only.

## Latency

From the runs on Oct 22, one call at a time from the cloud environment:

| Call | Time |
|---|---|
| Create an order | 0.4 to 1.1 s |
| Authorize with a card | 1.3 to 3.2 s |
| Capture | 1.7 s |
| A refused call (void, refund, wrong intent) | about 0.3 s |
| Authorize against the saved wallet | 2.5 s |
| Void | 1.0 s |
| A payout, until it lands | about 17 s |
| Save the wallet, with the scripted approval | about 14 s |
| Approve one order through its link, scripted | about 14 s |
