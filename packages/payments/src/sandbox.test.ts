import { ApiError } from "@paypal/paypal-server-sdk";
import { describe, expect, it } from "vitest";
import { sandboxConfigFromEnv, toPaymentError } from "./sandbox.js";

// The sandbox adapter's offline parts. Its calls are checked by the contract run against the real
// sandbox (sandbox/contract.sandbox.ts), which can't run here.

const refusal = (statusCode: number, body: unknown) =>
  new ApiError(
    {
      request: { method: "POST", url: "https://sandbox.test/v2/checkout/orders" },
      response: { statusCode, headers: {}, body: JSON.stringify(body) },
    },
    "refused",
  );

describe("sandbox adapter", () => {
  it("names every missing variable instead of starting half-configured", () => {
    expect(() => sandboxConfigFromEnv({ SANDBOX_CLIENT_ID: "id" })).toThrow(
      /SANDBOX_CLIENT_SECRET, SANDBOX_MERCHANT_SELLER_1, .*SANDBOX_MERCHANT_ATTACKER_2/,
    );
  });

  it("maps the payee keys to the merchant IDs it's given", () => {
    const env = Object.fromEntries(
      [
        "CLIENT_ID",
        "CLIENT_SECRET",
        ...["SELLER_1", "SELLER_2", "SELLER_3", "SELLER_4", "ATTACKER_1", "ATTACKER_2"].map(
          (k) => `MERCHANT_${k}`,
        ),
      ].map((name) => [`SANDBOX_${name}`, `value-${name}`]),
    );
    expect(sandboxConfigFromEnv(env).merchants).toMatchObject({
      seller_1: "value-MERCHANT_SELLER_1",
      attacker_2: "value-MERCHANT_ATTACKER_2",
    });
  });

  it.each([
    [422, "UNSUPPORTED_INTENT", "unsupported_intent"],
    [422, "ORDER_NOT_APPROVED", "payer_action_required"],
    [422, "ORDER_ALREADY_AUTHORIZED", "invalid_state"],
    [422, "PREVIOUSLY_VOIDED", "invalid_state"],
    [422, "REAUTHORIZATION_TOO_SOON", "too_early"],
    [422, "CAPTURE_FULLY_REFUNDED", "over_refund"],
    [404, "INVALID_RESOURCE_ID", "not_found"],
    [422, "SOMETHING_NEW", "invalid_request"],
    [500, "INTERNAL_SERVER_ERROR", "platform_error"],
  ] as const)("reads a %i %s as %s", (status, issue, code) => {
    const error = toPaymentError(
      "call",
      refusal(status, { name: "X", details: [{ issue }], debug_id: "d1" }),
    );
    expect(error).toMatchObject({ code });
    expect(error.message).toContain("debug ID d1");
  });

  it("reads a repeated payout batch ID as a duplicate payout", () => {
    const error = toPaymentError(
      "payout",
      refusal(400, {
        name: "USER_BUSINESS_ERROR",
        details: [
          { field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists" },
        ],
      }),
    );
    expect(error.code).toBe("duplicate");
  });

  it("reads a network failure as the platform's error, not the caller's", () => {
    expect(toPaymentError("call", new Error("socket hang up")).code).toBe("platform_error");
  });
});
