import {
  ApiError,
  type Authorization as AuthorizationResult,
  CheckoutPaymentIntent,
  Client,
  Environment,
  type LinkDescription,
  type Order as OrderResult,
  OrdersController,
  type PaymentsCapture,
  PaymentsController,
  type Refund as RefundResult,
  VaultController,
  VaultTokenRequestType,
  PaypalPaymentTokenCustomerType as WalletCustomerType,
  PaypalPaymentTokenUsageType as WalletUsageType,
} from "@paypal/paypal-server-sdk";
import { checkPayable } from "./rules.js";
import {
  type Authorization,
  type AuthorizationStatus,
  type Capture,
  type CreateOrderInput,
  type LineItem,
  type Order,
  type OrderStatus,
  type PaymentAdapter,
  PaymentError,
  type PaymentErrorCode,
  type PayoutStatus,
  type Refund,
} from "./types.js";

// The payment adapter against the platform's sandbox, through its TypeScript server SDK. The SDK
// is pinned to its sandbox environment and nothing here can point it anywhere else, which is the
// code's half of "sandbox only".
//
// Every order pays the platform's own account, the one the app's credentials belong to, so no
// order names a payee. Each line item's SKU carries `<payee key>:<line ID>`, which is how the
// seller of a line survives the round trip through the platform. Sellers are paid with payouts
// after capture.

export interface SandboxConfig {
  clientId: string;
  clientSecret: string;
  // Payee key to the sandbox merchant ID a payout to it goes to.
  merchants: Record<string, string>;
  // Where the buyer lands after approving an order or the wallet setup. Nothing has to answer
  // there for the scripted approval, which stops at the redirect.
  returnUrl?: string;
  cancelUrl?: string;
  timeoutMs?: number;
}

const MERCHANT_KEYS = ["seller_1", "seller_2", "seller_3", "seller_4", "attacker_1", "attacker_2"];
const DEFAULT_RETURN_URL = "https://checkout-firewall.invalid/payments/approved";
const DEFAULT_CANCEL_URL = "https://checkout-firewall.invalid/payments/cancelled";
const HONOR_MS = 3 * 24 * 60 * 60 * 1000;

// Reads the sandbox settings from the environment, failing with every missing variable named.
export function sandboxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const names = [
    "SANDBOX_CLIENT_ID",
    "SANDBOX_CLIENT_SECRET",
    ...MERCHANT_KEYS.map((key) => `SANDBOX_MERCHANT_${key.toUpperCase()}`),
  ];
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`The sandbox adapter needs ${missing.join(", ")}. See .env.example.`);
  }
  return {
    clientId: env.SANDBOX_CLIENT_ID as string,
    clientSecret: env.SANDBOX_CLIENT_SECRET as string,
    merchants: Object.fromEntries(
      MERCHANT_KEYS.map((key) => [key, env[`SANDBOX_MERCHANT_${key.toUpperCase()}`] as string]),
    ),
  };
}

export interface WalletSetup {
  setupTokenId: string;
  // Where the buyer approves saving the wallet, once.
  approveUrl: string;
}

export interface SandboxPaymentAdapter extends PaymentAdapter {
  // Saving the buyer's wallet: start gives the link the buyer approves once; finish turns the
  // approved setup into the vault ID that later orders authorize against with no approval step.
  // Setup isn't part of a run, so these two aren't on the payment adapter interface.
  startWalletSetup(): Promise<WalletSetup>;
  finishWalletSetup(setupTokenId: string): Promise<string>;
}

// The SDK names the wallet payment source, and the payouts API its merchant-ID recipient type,
// after the platform. The calls can't be made without that field name, so, like the package name
// in the import lines, it appears here, once.
const WALLET = "paypal";
const MERCHANT_ID_RECIPIENT = `${WALLET.toUpperCase()}_ID`;

export function createSandboxPaymentAdapter(config: SandboxConfig): SandboxPaymentAdapter {
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
    },
    environment: Environment.Sandbox,
    timeout: config.timeoutMs ?? 30_000,
  });
  const orders = new OrdersController(client);
  const payments = new PaymentsController(client);
  const vault = new VaultController(client);
  const returnUrl = config.returnUrl ?? DEFAULT_RETURN_URL;
  const cancelUrl = config.cancelUrl ?? DEFAULT_CANCEL_URL;
  const payeeOf = new Map(Object.entries(config.merchants).map(([key, id]) => [id, key]));

  const merchantFor = (payeeKey: string): string => {
    const merchantId = config.merchants[payeeKey];
    if (!merchantId) throw new PaymentError("invalid_request", `Unknown payee "${payeeKey}"`);
    return merchantId;
  };

  // The SDK has no payouts controller, so payouts are a direct REST call: POST
  // /v1/payments/payouts with merchant-ID recipients, and GET /v1/payments/payouts/{id} to read
  // one back. It goes through the SDK client's own request builder, so it shares the SDK's sandbox
  // host, OAuth token, HTTP client and error type with every other call.
  const rest = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const request = client.getRequestBuilderFactory()(method, path);
    // The same OAuth client-credentials token the SDK's own controllers send.
    request.authenticate([{ oauth2: true }]);
    if (body !== undefined) {
      request.header("Content-Type", "application/json");
      request.json(body);
    }
    const response = await request.callAsText();
    // biome-ignore lint/suspicious/noExplicitAny: an untyped REST response, read field by field.
    return JSON.parse(response.result) as any;
  };

  const call = async <T>(what: string, run: () => Promise<{ result: T }>): Promise<T> => {
    try {
      return (await run()).result;
    } catch (error) {
      throw toPaymentError(what, error);
    }
  };

  const toOrder = (result: OrderResult): Order => {
    const units = (result.purchaseUnits ?? []).map((unit) => ({
      referenceId: unit.referenceId ?? "",
      description: unit.description ?? "",
      amountCents: cents(unit.amount?.value),
      items: (unit.items ?? []).map(
        (item): LineItem => ({
          ...fromSku(item.sku),
          name: item.name,
          quantity: Number(item.quantity),
          unitAmountCents: cents(item.unitAmount.value),
        }),
      ),
    }));
    const status = orderStatus(result.status);
    return {
      orderId: result.id ?? "",
      status,
      currency: "USD",
      purchaseUnits: units,
      customId: result.purchaseUnits?.[0]?.customId ?? "",
      invoiceId: result.purchaseUnits?.[0]?.invoiceId ?? "",
      approveUrl: status === "PAYER_ACTION_REQUIRED" ? link(result.links, "approve") : null,
      createdAt: result.createTime ?? "",
    };
  };

  const toAuthorization = (result: AuthorizationResult, orderId?: string): Authorization => {
    const created = result.createTime ?? new Date().toISOString();
    const related = "supplementaryData" in result ? result.supplementaryData : undefined;
    return {
      authorizationId: result.id ?? "",
      orderId:
        orderId ?? (related as { relatedIds?: { orderId?: string } })?.relatedIds?.orderId ?? "",
      amountCents: cents(result.amount?.value),
      status: authorizationStatus(result.status),
      createdAt: created,
      // The platform reports when the hold expires but not when its honour period ends; that is
      // three days after it was made.
      honorUntil: new Date(Date.parse(created) + HONOR_MS).toISOString(),
      expiresAt: result.expirationTime ?? "",
    };
  };

  const toCapture = (result: PaymentsCapture, authorizationId?: string): Capture => ({
    captureId: result.id ?? "",
    authorizationId:
      authorizationId ??
      (result as { supplementaryData?: { relatedIds?: { authorizationId?: string } } })
        .supplementaryData?.relatedIds?.authorizationId ??
      "",
    amountCents: cents(result.amount?.value),
    netAmountCents: result.sellerReceivableBreakdown?.netAmount
      ? cents(result.sellerReceivableBreakdown.netAmount.value)
      : null,
    status: (result.status ?? "PENDING") as Capture["status"],
    createdAt: result.createTime ?? "",
  });

  const toRefund = (result: RefundResult, captureId: string): Refund => ({
    refundId: result.id ?? "",
    captureId,
    amountCents: cents(result.amount?.value),
    status: (result.status ?? "PENDING") as Refund["status"],
    createdAt: result.createTime ?? "",
  });

  const adapter: SandboxPaymentAdapter = {
    async createOrder(input: CreateOrderInput) {
      for (const unit of input.purchaseUnits) {
        for (const item of unit.items) merchantFor(item.payeeKey);
      }
      // Every unit goes to the platform as given, so a refusal (two units: unsupported_intent)
      // is the platform's own.
      const result = await call("create order", () =>
        orders.createOrder({
          body: {
            intent: CheckoutPaymentIntent.Authorize,
            purchaseUnits: input.purchaseUnits.map((unit) => {
              const total = money(
                unit.items.reduce((sum, item) => sum + item.quantity * item.unitAmountCents, 0),
              );
              return {
                referenceId: unit.referenceId,
                description: unit.description,
                customId: input.customId,
                invoiceId: input.invoiceId,
                amount: {
                  currencyCode: input.currency,
                  value: total,
                  breakdown: { itemTotal: { currencyCode: input.currency, value: total } },
                },
                items: unit.items.map((item) => ({
                  name: item.name,
                  quantity: String(item.quantity),
                  unitAmount: { currencyCode: input.currency, value: money(item.unitAmountCents) },
                  sku: `${item.payeeKey}:${item.lineId}`,
                })),
              };
            }),
            // Only used when the buyer approves through the link. It isn't a payment source, so
            // the order can still be authorized against a saved wallet instead.
            applicationContext: { returnUrl, cancelUrl },
          },
          prefer: "return=representation",
        }),
      );
      return toOrder(result);
    },

    async getOrder(orderId) {
      return toOrder(await call("get order", () => orders.getOrder({ id: orderId })));
    },

    async authorizeOrder(orderId, options = {}) {
      const result = await call("authorize order", () =>
        orders.authorizeOrder({
          id: orderId,
          body: options.vaultId
            ? { paymentSource: { [WALLET]: { vaultId: options.vaultId } } }
            : {},
          prefer: "return=representation",
        }),
      );
      const authorization = result.purchaseUnits?.[0]?.payments?.authorizations?.[0];
      if (!authorization) {
        throw new PaymentError(
          "platform_error",
          `Order ${orderId} authorized with no authorization`,
        );
      }
      return toAuthorization(authorization, orderId);
    },

    async getAuthorization(authorizationId) {
      return toAuthorization(
        await call("get authorization", () => payments.getAuthorizedPayment({ authorizationId })),
      );
    },

    async captureAuthorization(authorizationId) {
      const result = await call("capture", () =>
        payments.captureAuthorizedPayment({
          authorizationId,
          body: { finalCapture: true },
          prefer: "return=representation",
        }),
      );
      return toCapture(result, authorizationId);
    },

    async voidAuthorization(authorizationId) {
      const result = await call("void", () =>
        payments.voidPayment({ authorizationId, prefer: "return=representation" }),
      );
      return result ? toAuthorization(result) : adapter.getAuthorization(authorizationId);
    },

    // The time tests can't run against the sandbox, so whether the platform reads the old hold
    // as voided afterwards is pinned only for the fake.
    async reauthorize(authorizationId) {
      const old = await adapter.getAuthorization(authorizationId);
      const result = await call("reauthorize", () =>
        payments.reauthorizePayment({ authorizationId, prefer: "return=representation" }),
      );
      return toAuthorization(result, old.orderId);
    },

    async refundCapture(captureId, amountCents) {
      const result = await call("refund", () =>
        payments.refundCapturedPayment({
          captureId,
          body:
            amountCents === undefined
              ? {}
              : { amount: { currencyCode: "USD", value: money(amountCents) } },
          prefer: "return=representation",
        }),
      );
      return toRefund(result, captureId);
    },

    async createPayout(input) {
      const merchantId = merchantFor(input.payeeKey);
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw new PaymentError("invalid_request", `A payout must be positive cents`);
      }
      const capture = toCapture(
        await call("get capture", () =>
          payments.getCapturedPayment({ captureId: input.captureId }),
        ),
      );
      checkPayable(capture, input.amountCents);
      // The batch ID names the capture and the seller, and the platform refuses a batch ID it has
      // seen, which is what stops a retry paying a seller twice.
      const reference = `${input.captureId}:${input.payeeKey}`;
      const body = await call("payout", async () => ({
        result: await rest("POST", "/v1/payments/payouts", {
          sender_batch_header: {
            sender_batch_id: reference,
            recipient_type: MERCHANT_ID_RECIPIENT,
            email_subject: "Your share of an arena order",
          },
          items: [
            {
              recipient_type: MERCHANT_ID_RECIPIENT,
              receiver: merchantId,
              amount: { currency: "USD", value: money(input.amountCents) },
              sender_item_id: reference,
              note: `Capture ${input.captureId}`,
            },
          ],
        }),
      }));
      return {
        payoutId: body.batch_header.payout_batch_id,
        captureId: input.captureId,
        payeeKey: input.payeeKey,
        merchantId,
        amountCents: input.amountCents,
        status: payoutStatus(body.batch_header.batch_status),
        createdAt: new Date().toISOString(),
      };
    },

    // Read back from the platform: who it paid comes from the receiver it recorded, not from what
    // this adapter asked for.
    async getPayout(payoutId) {
      // The platform's payout IDs are letters and digits, and it answers any other ID with a
      // malformed-request error rather than "no such payout".
      if (!/^[A-Za-z0-9]+$/.test(payoutId)) {
        throw new PaymentError("not_found", `No payout "${payoutId}"`);
      }
      const body = await call("get payout", async () => ({
        result: await rest("GET", `/v1/payments/payouts/${encodeURIComponent(payoutId)}`),
      }));
      const item = body.items?.[0];
      const merchantId: string = item?.payout_item?.receiver ?? "";
      const reference: string = item?.payout_item?.sender_item_id ?? "";
      return {
        payoutId,
        captureId: reference.slice(0, reference.lastIndexOf(":")),
        payeeKey: payeeOf.get(merchantId) ?? "",
        merchantId,
        amountCents: cents(item?.payout_item?.amount?.value),
        status: payoutStatus(item?.transaction_status ?? body.batch_header?.batch_status),
        createdAt: body.batch_header?.time_created ?? "",
      };
    },

    async startWalletSetup() {
      const result = await call("start wallet setup", () =>
        vault.createSetupToken({
          body: {
            paymentSource: {
              [WALLET]: {
                usageType: WalletUsageType.Merchant,
                customerType: WalletCustomerType.Consumer,
                experienceContext: { returnUrl, cancelUrl },
              },
            },
          },
        }),
      );
      const approveUrl = link(result.links, "approve");
      if (!result.id || !approveUrl) {
        throw new PaymentError("platform_error", "Wallet setup came back with no approval link");
      }
      return { setupTokenId: result.id, approveUrl };
    },

    async finishWalletSetup(setupTokenId) {
      const result = await call("finish wallet setup", () =>
        vault.createPaymentToken({
          body: {
            paymentSource: { token: { id: setupTokenId, type: VaultTokenRequestType.SetupToken } },
          },
        }),
      );
      if (!result.id) throw new PaymentError("platform_error", "Wallet setup saved no vault ID");
      return result.id;
    },
  };
  return adapter;
}

// The platform's refusals, by the issue it names, as the codes the firewall acts on.
const ISSUES: Record<string, PaymentErrorCode> = {
  UNSUPPORTED_INTENT: "unsupported_intent",
  ORDER_NOT_APPROVED: "payer_action_required",
  ORDER_ALREADY_AUTHORIZED: "invalid_state",
  ORDER_ALREADY_CAPTURED: "invalid_state",
  AUTHORIZATION_ALREADY_CAPTURED: "invalid_state",
  AUTHORIZATION_VOIDED: "invalid_state",
  PREVIOUSLY_CAPTURED: "invalid_state",
  PREVIOUSLY_VOIDED: "invalid_state",
  AUTHORIZATION_EXPIRED: "expired",
  REAUTHORIZATION_TOO_SOON: "too_early",
  REFUND_AMOUNT_EXCEEDED: "over_refund",
  CAPTURE_FULLY_REFUNDED: "over_refund",
};

export function toPaymentError(what: string, error: unknown): PaymentError {
  if (error instanceof PaymentError) return error;
  if (!(error instanceof ApiError)) {
    return new PaymentError("platform_error", `${what}: ${String(error)}`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: the platform's error body, read field by field.
  let body: any = {};
  try {
    body = typeof error.body === "string" ? JSON.parse(error.body) : {};
  } catch {
    // Not JSON: the status code alone decides.
  }
  const details: { issue?: string; field?: string }[] = body.details ?? [];
  const issue = details[0]?.issue ?? body.name ?? `HTTP ${error.statusCode}`;
  const message = `${what}: ${issue}${body.debug_id ? ` (debug ID ${body.debug_id})` : ""}`;
  const known = details.map((d) => ISSUES[d.issue ?? ""]).find(Boolean);
  if (known) return new PaymentError(known, message);
  // A payout batch ID the platform has seen: the seller was already paid from that capture.
  if (details.some((d) => d.field === "SENDER_BATCH_ID" && /already exists/i.test(d.issue ?? ""))) {
    return new PaymentError("duplicate", message);
  }
  if (error.statusCode === 404) return new PaymentError("not_found", message);
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return new PaymentError("invalid_request", message);
  }
  return new PaymentError("platform_error", message);
}

function orderStatus(status: string | undefined): OrderStatus {
  switch (status) {
    case "APPROVED":
    case "SAVED":
      return "APPROVED";
    case "COMPLETED":
      return "COMPLETED";
    case "VOIDED":
      return "VOIDED";
    default:
      // CREATED and PAYER_ACTION_REQUIRED both mean the buyer hasn't approved it yet.
      return "PAYER_ACTION_REQUIRED";
  }
}

function authorizationStatus(status: string | undefined): AuthorizationStatus {
  // A final capture is the only kind this adapter makes, so a partial one reads as captured.
  if (status === "PARTIALLY_CAPTURED") return "CAPTURED";
  const known: AuthorizationStatus[] = [
    "CREATED",
    "PENDING",
    "CAPTURED",
    "DENIED",
    "VOIDED",
    "EXPIRED",
  ];
  return known.find((s) => s === status) ?? "PENDING";
}

function payoutStatus(status: string | undefined): PayoutStatus {
  switch (status) {
    case "SUCCESS":
      return "SUCCESS";
    case "PENDING":
    case "PROCESSING":
    case "ONHOLD":
    case undefined:
      return "PENDING";
    default:
      // FAILED, UNCLAIMED, RETURNED, BLOCKED, REFUNDED, REVERSED, DENIED, CANCELED.
      return "FAILED";
  }
}

function fromSku(sku: string | undefined): { payeeKey: string; lineId: string } {
  const at = sku?.indexOf(":") ?? -1;
  if (!sku || at < 1) {
    throw new PaymentError("platform_error", `A line item has no payee key in its SKU ("${sku}")`);
  }
  return { payeeKey: sku.slice(0, at), lineId: sku.slice(at + 1) };
}

function link(links: LinkDescription[] | undefined, rel: string): string | null {
  return links?.find((l) => l.rel === rel)?.href ?? null;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function cents(value: string | undefined): number {
  return value === undefined ? 0 : Math.round(Number(value) * 100);
}
