// The technical checks against the payment platform's sandbox (plan step 6), asked again for the
// model the firewall runs on: the platform is the payee on every order, holds the whole cart in
// one authorization, and pays each seller out after capture. Each check asks one question the
// plan depends on and prints what the sandbox answered; docs/sandbox-checks.md records the
// answers and what they change.
//
//   pnpm --filter @firewall/payments sandbox-checks
//
// Needs SANDBOX_CLIENT_ID, SANDBOX_CLIENT_SECRET, the six SANDBOX_MERCHANT_<KEY> merchant IDs,
// and the buyer's login (SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD) for the scripted
// approvals. Every amount is a dollar or two, and payouts go to seller_1 and seller_2 only.

import { Client, Environment, OrdersController } from "@paypal/paypal-server-sdk";
import { approveAsBuyer, buyerLoginFromEnv } from "../sandbox/buyer.js";
import { splitPayouts } from "../src/rules.js";
import { createSandboxPaymentAdapter, sandboxConfigFromEnv } from "../src/sandbox.js";
import { type CreateOrderInput, type LineItemInput, PaymentError } from "../src/types.js";

const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";

let config: ReturnType<typeof sandboxConfigFromEnv>;
let login: ReturnType<typeof buyerLoginFromEnv>;
try {
  config = { ...sandboxConfigFromEnv(), returnUrl: RETURN_URL };
  login = buyerLoginFromEnv();
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const adapter = createSandboxPaymentAdapter(config);
// One read the adapter doesn't expose: who an order pays.
const sdk = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: config.clientId,
    oAuthClientSecret: config.clientSecret,
  },
  environment: Environment.Sandbox,
  timeout: 30_000,
});
const orders = new OrdersController(sdk);

const results: { check: string; answer: string; ok: boolean; ms?: number }[] = [];

function record(check: string, answer: string, ok: boolean, ms?: number) {
  results.push({ check, answer, ok, ms });
  console.log(`${ok ? "✓" : "✗"} ${check}: ${answer}${ms === undefined ? "" : ` (${ms} ms)`}`);
}

// Runs one call, timing it, and turns a refusal into its error code instead of throwing.
async function timed<T>(run: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  try {
    return { value: await run(), ms: Date.now() - started };
  } catch (error) {
    const answer =
      error instanceof PaymentError ? `${error.code} (${error.message})` : String(error);
    return { error: answer, ms: Date.now() - started };
  }
}

const cart = (items: LineItemInput[]): CreateOrderInput => ({
  currency: "USD",
  customId: "sandbox-checks",
  invoiceId: `sandbox-checks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  purchaseUnits: [{ referenceId: "cart", description: "Sandbox check", items }],
});

const lines: LineItemInput[] = [
  { lineId: "l1", payeeKey: "seller_1", name: "Keyboard", quantity: 1, unitAmountCents: 100 },
  { lineId: "l2", payeeKey: "seller_2", name: "Cable", quantity: 2, unitAmountCents: 50 },
];
const sellerMerchants = new Set(Object.values(config.merchants));

// 1. One order per cart, paid to the platform, with each line's seller on it.
{
  const created = await timed(() => adapter.createOrder(cart(lines)));
  const order = created.value;
  if (order) {
    const read = await orders.getOrder({ id: order.orderId });
    const payee = read.result.purchaseUnits?.[0]?.payee?.merchantId;
    record(
      "1. the cart's order pays the platform, not a seller",
      payee && !sellerMerchants.has(payee) ? "yes" : `payee is ${payee ?? "missing"}`,
      Boolean(payee && !sellerMerchants.has(payee)),
      created.ms,
    );
    const again = await adapter.getOrder(order.orderId);
    const sellers = again.purchaseUnits[0]?.items.map((item) => item.payeeKey).join(", ");
    record(
      "1. each line keeps its seller through the platform",
      sellers ?? "no lines",
      sellers === "seller_1, seller_2",
    );
  } else {
    record("1. create the cart's order", created.error ?? "?", false, created.ms);
  }
  const two = cart(lines);
  two.purchaseUnits.push({
    referenceId: "second",
    description: "Second",
    items: [lines[0] as LineItemInput],
  });
  const refused = await timed(() => adapter.createOrder(two));
  record(
    "1. an authorize order with two purchase units is refused",
    refused.error ?? "accepted",
    refused.error?.startsWith("unsupported_intent") ?? false,
    refused.ms,
  );
}

// 3. The buyer's wallet, saved once, then an order held against it with no approval link.
const vaultId = await (async () => {
  if (process.env.SANDBOX_BUYER_VAULT_ID) return process.env.SANDBOX_BUYER_VAULT_ID;
  const started = Date.now();
  try {
    const setup = await adapter.startWalletSetup();
    await approveAsBuyer(setup.approveUrl, login, RETURN_URL);
    const saved = await adapter.finishWalletSetup(setup.setupTokenId);
    record(
      "3. save the buyer's wallet with one scripted approval",
      "saved",
      true,
      Date.now() - started,
    );
    return saved;
  } catch (error) {
    record("3. save the buyer's wallet with one scripted approval", String(error), false);
    return undefined;
  }
})();

async function hold() {
  const order = await adapter.createOrder(cart(lines));
  return adapter.authorizeOrder(order.orderId, { vaultId: vaultId as string });
}

if (vaultId) {
  const held = await timed(hold);
  record(
    "3. authorize against the saved wallet, no link followed",
    held.value?.status ?? held.error ?? "?",
    held.value?.status === "CREATED",
    held.ms,
  );

  // 2. Void, capture, payouts, refund, and the hold's time limits.
  if (held.value) {
    const auth = held.value;
    const days = Math.round((Date.parse(auth.expiresAt) - Date.now()) / 86_400_000);
    record("2. the hold expires after", `${days} days`, days === 29);
    const early = await timed(() => adapter.reauthorize(auth.authorizationId));
    record(
      "2. reauthorize on day 0 is refused",
      early.error ?? "accepted",
      Boolean(early.error?.startsWith("too_early")),
    );
    const voided = await timed(() => adapter.voidAuthorization(auth.authorizationId));
    record(
      "2. void the platform's own hold",
      voided.value?.status ?? voided.error ?? "?",
      voided.value?.status === "VOIDED",
      voided.ms,
    );
  }

  const second = await timed(hold);
  if (second.value) {
    const capture = await timed(() =>
      adapter.captureAuthorization(second.value?.authorizationId as string),
    );
    const net = capture.value?.netAmountCents;
    record(
      "2. capture the whole cart",
      capture.value
        ? `${capture.value.status}, the platform nets ${((net ?? 0) / 100).toFixed(2)} of 2.00`
        : (capture.error ?? "?"),
      capture.value?.status === "COMPLETED" && typeof net === "number",
      capture.ms,
    );
    if (capture.value && typeof net === "number") {
      const captureId = capture.value.captureId;
      // Each seller gets its share of the net, not its gross lines (docs/PLAN.md, "Fees").
      for (const { payeeKey: seller, amountCents: share } of splitPayouts(net, lines)) {
        const started = Date.now();
        const sent = await timed(() =>
          adapter.createPayout({ captureId, payeeKey: seller, amountCents: share }),
        );
        let status = sent.value?.status ?? sent.error ?? "?";
        while (sent.value && status === "PENDING" && Date.now() - started < 120_000) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          status = (await adapter.getPayout(sent.value.payoutId)).status;
        }
        record(
          `2. pay ${seller} its share (${(share / 100).toFixed(2)})`,
          status,
          status === "SUCCESS",
          Date.now() - started,
        );
      }
      const repeat = await timed(() =>
        adapter.createPayout({ captureId, payeeKey: "seller_1", amountCents: 1 }),
      );
      record(
        "2. paying the same seller twice from one capture is refused",
        repeat.error ?? "accepted",
        Boolean(repeat.error?.startsWith("duplicate")),
        repeat.ms,
      );
      const refund = await timed(() => adapter.refundCapture(captureId, 50));
      record(
        "2. refund part of the platform's capture",
        refund.value?.status ?? refund.error ?? "?",
        refund.value?.status === "COMPLETED",
        refund.ms,
      );
    }
  }
}

// 3, fallback. An order approved through its own link, by the scripted buyer.
{
  const order = await adapter.createOrder(cart(lines));
  const started = Date.now();
  const approved = await timed(async () => {
    await approveAsBuyer(order.approveUrl as string, login, RETURN_URL);
    return adapter.authorizeOrder(order.orderId);
  });
  record(
    "3. fallback: approve one order through its link, then authorize",
    approved.value?.status ?? approved.error ?? "?",
    approved.value?.status === "CREATED",
    Date.now() - started,
  );
  if (approved.value) await adapter.voidAuthorization(approved.value.authorizationId);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} answers match the plan.`);
process.exitCode = failed.length > 0 ? 1 : 0;
