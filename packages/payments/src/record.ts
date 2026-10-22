import type { EventLog } from "@firewall/events";
import { type PaymentAdapter, PaymentError } from "./types.js";

export interface PaymentEventContext {
  runId: string;
  scenarioId?: string | null;
  // The event that led to this payment call: the checkout, or the verdict that captured or voided.
  parentId?: string | null;
}

// Wraps an adapter so every call is written to the event log on the payments lane, with its
// input, its result or error, and how long it took. `context` is read on each call, so the caller
// can point each payment call at the event that caused it.
export function recordPayments(
  adapter: PaymentAdapter,
  log: EventLog,
  context: () => PaymentEventContext,
): PaymentAdapter {
  const wrap =
    <A extends unknown[], R>(operation: string, call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const { runId, scenarioId = null, parentId = null } = context();
      const started = performance.now();
      const append = (outcome: Record<string, unknown>) =>
        log.append({
          runId,
          scenarioId,
          parentId,
          lane: "payments",
          type: "payment_call",
          provenance: "system",
          latencyMs: Math.round(performance.now() - started),
          payload: { operation, input: args, ...outcome },
        });
      try {
        const result = await call(...args);
        append({ result });
        return result;
      } catch (error) {
        const failure =
          error instanceof PaymentError
            ? { code: error.code, message: error.message }
            : { code: "unexpected", message: String(error) };
        append({ error: failure });
        throw error;
      }
    };

  return {
    createOrder: wrap("create_order", (input) => adapter.createOrder(input)),
    getOrder: wrap("get_order", (id) => adapter.getOrder(id)),
    authorizeOrder: wrap("authorize_order", (id) => adapter.authorizeOrder(id)),
    getAuthorization: wrap("get_authorization", (id) => adapter.getAuthorization(id)),
    captureAuthorization: wrap("capture", (id) => adapter.captureAuthorization(id)),
    voidAuthorization: wrap("void", (id) => adapter.voidAuthorization(id)),
    reauthorize: wrap("reauthorize", (id) => adapter.reauthorize(id)),
    refundCapture: wrap("refund", (id: string, amount?: number) =>
      adapter.refundCapture(id, amount),
    ),
  };
}
