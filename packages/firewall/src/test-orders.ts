// Test-only: places the order a run's checkout asked for and holds it, as the agent's checkout tool
// does, so the review tree's enforcement has a held order to act on. Not exported from the package.
import type { EventLog } from "@firewall/events";
import { type CreateOrderInput, type PaymentAdapter, recordPayments } from "@firewall/payments";
import { z } from "zod";

const checkoutLines = z.object({
  result: z.object({
    lines: z.array(
      z.object({
        listingId: z.string(),
        sku: z.string(),
        payeeKey: z.string(),
        quantity: z.number(),
        totalCents: z.number(),
      }),
    ),
  }),
});

export async function holdCheckout(log: EventLog, runId: string, adapter: PaymentAdapter) {
  const checkout = log.listRun(runId).findLast((e) => e.lane === "arena" && e.type === "checkout");
  if (!checkout) throw new Error("The run has no checkout to hold");
  const { lines } = checkoutLines.parse(checkout.payload).result;
  const input: CreateOrderInput = {
    currency: "USD",
    customId: runId,
    invoiceId: `inv_${checkout.eventId}`,
    purchaseUnits: [
      {
        referenceId: "cart",
        description: `Test cart for ${runId}`,
        items: lines.map((l) => ({
          lineId: l.listingId,
          payeeKey: l.payeeKey,
          name: l.sku,
          quantity: l.quantity,
          unitAmountCents: l.totalCents / l.quantity,
        })),
      },
    ],
  };
  const payments = recordPayments(adapter, log, () => ({
    runId,
    scenarioId: checkout.scenarioId,
    parentId: checkout.eventId,
  }));
  const order = await payments.createOrder(input);
  const hold = await payments.authorizeOrder(order.orderId, { vaultId: "FAKE-WALLET" });
  return { order, hold, lines };
}
