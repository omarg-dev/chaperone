// The first technical checks against the payment platform's sandbox (plan step 6). Each check
// asks one question the plan depends on and prints what the sandbox answered; docs/sandbox-checks.md
// records the answers and what they change.
//
//   pnpm --filter @firewall/payments sandbox-checks
//
// Needs SANDBOX_API_URL, SANDBOX_CLIENT_ID, SANDBOX_CLIENT_SECRET and the six
// SANDBOX_MERCHANT_<KEY> merchant IDs. Holds are paid by a test card, which needs no buyer
// approval. A hold this app can't void is left to expire, and its ID is printed.
//
// When a merchant's own app credentials are set (SANDBOX_MERCHANT_<KEY>_CLIENT_ID and
// SANDBOX_MERCHANT_<KEY>_CLIENT_SECRET), the void check also tries voiding with them.

const MERCHANT_KEYS = ["SELLER_1", "SELLER_2", "SELLER_3", "SELLER_4", "ATTACKER_1", "ATTACKER_2"];

const TEST_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  name: "Arena Buyer",
  security_code: "123",
  billing_address: {
    address_line_1: "1 Test St",
    admin_area_2: "San Jose",
    admin_area_1: "CA",
    postal_code: "95131",
    country_code: "US",
  },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See the comment at the top of this file.`);
    process.exit(2);
  }
  return value;
}

const apiUrl = required("SANDBOX_API_URL").replace(/\/$/, "");
const merchants = Object.fromEntries(
  MERCHANT_KEYS.map((key) => [key, required(`SANDBOX_MERCHANT_${key}`)]),
);

// biome-ignore lint/suspicious/noExplicitAny: exploratory responses, read field by field.
type Json = any;

interface Response {
  status: number;
  ms: number;
  body: Json;
}

const tokens = new Map<string, string>();

async function token(clientId: string, secret: string): Promise<string> {
  const cached = tokens.get(clientId);
  if (cached) return cached;
  const res = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request for ${clientId} failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  tokens.set(clientId, body.access_token);
  return body.access_token;
}

const appCredentials = {
  clientId: required("SANDBOX_CLIENT_ID"),
  secret: required("SANDBOX_CLIENT_SECRET"),
};

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  credentials = appCredentials,
): Promise<Response> {
  const started = Date.now();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token(credentials.clientId, credentials.secret)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, body: text ? JSON.parse(text) : {} };
}

// "201 COMPLETED" on success, "422 UNSUPPORTED_INTENT" on a refusal.
function outcome(res: Response): string {
  const issue = res.body.details?.[0]?.issue ?? res.body.name ?? res.body.error;
  return res.status < 300 ? `${res.status} ${res.body.status ?? "ok"}` : `${res.status} ${issue}`;
}

interface Unit {
  referenceId: string;
  merchantKey?: string;
  value: string;
}

function purchaseUnit({ referenceId, merchantKey, value }: Unit) {
  return {
    reference_id: referenceId,
    custom_id: "sandbox-checks",
    invoice_id: `sandbox-checks-${referenceId}-${Date.now()}`,
    description: "Sandbox check",
    ...(merchantKey ? { payee: { merchant_id: merchants[merchantKey] } } : {}),
    amount: { currency_code: "USD", value },
  };
}

function createOrder(units: Unit[]): Promise<Response> {
  return call("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: units.map(purchaseUnit),
  });
}

// Creates the order, then authorizes it with a card, which needs no buyer approval. A payment
// source on the create call itself would also require an idempotency header.
async function hold(merchantKey: string, value: string, card: unknown = TEST_CARD) {
  const order = await createOrder([{ referenceId: "L1", merchantKey, value }]);
  const res = await call("POST", `/v2/checkout/orders/${order.body.id}/authorize`, {
    payment_source: { card },
  });
  const authorization = res.body.purchase_units?.[0]?.payments?.authorizations?.[0];
  return { res, authorization };
}

const results: { check: string; answer: string; ms?: number; ok: boolean }[] = [];

function record(check: string, answer: string, ok: boolean, ms?: number) {
  results.push({ check, answer, ok, ms });
  console.log(`${ok ? "✓" : "✗"} ${check}: ${answer}${ms === undefined ? "" : ` (${ms} ms)`}`);
}

// 1. Each order can name the merchant it pays.
for (const key of MERCHANT_KEYS) {
  const res = await createOrder([{ referenceId: "L1", merchantKey: key, value: "1.00" }]);
  const payee = res.body.purchase_units?.[0]?.payee?.merchant_id;
  record(`1. order pays ${key}`, outcome(res), payee === merchants[key], res.ms);
}
{
  const res = await createOrder([
    { referenceId: "L1", merchantKey: "SELLER_1", value: "1.00" },
    { referenceId: "L2", merchantKey: "SELLER_2", value: "1.00" },
  ]);
  // The plan's adapter puts one purchase unit per seller in one order; this asks if that holds.
  record("1. one authorize order, two sellers", outcome(res), res.status < 300, res.ms);
}

// 2. Authorize then capture, authorize then void.
{
  const { res, authorization } = await hold("ATTACKER_1", "1.00");
  record(
    "2. authorize (card, no approval step)",
    outcome(res),
    authorization?.status === "CREATED",
    res.ms,
  );
  if (authorization) {
    const got = await call("GET", `/v2/payments/authorizations/${authorization.id}`);
    record(
      "2. authorization expires after",
      `${Math.round((Date.parse(got.body.expiration_time) - Date.now()) / 86_400_000)} days`,
      got.status === 200,
    );
    const reauthorized = await call(
      "POST",
      `/v2/payments/authorizations/${authorization.id}/reauthorize`,
      {},
    );
    record(
      "2. reauthorize on day 0 is refused",
      outcome(reauthorized),
      reauthorized.status === 422,
    );
    const captured = await call("POST", `/v2/payments/authorizations/${authorization.id}/capture`, {
      final_capture: true,
    });
    const net = captured.body.seller_receivable_breakdown?.net_amount?.value;
    record(
      "2. capture to another merchant",
      `${outcome(captured)}, merchant nets ${net}`,
      captured.status === 201,
      captured.ms,
    );
    const refunded = await call("POST", `/v2/payments/captures/${captured.body.id}/refund`, {
      amount: { currency_code: "USD", value: "0.50" },
    });
    record("2. refund that capture", outcome(refunded), refunded.status === 201, refunded.ms);
  }
}
{
  const { authorization } = await hold("SELLER_1", "1.00");
  if (authorization) {
    const voided = await call("POST", `/v2/payments/authorizations/${authorization.id}/void`);
    record("2. void another merchant's hold", outcome(voided), voided.status < 300, voided.ms);
    const id = process.env.SANDBOX_MERCHANT_SELLER_1_CLIENT_ID;
    const secret = process.env.SANDBOX_MERCHANT_SELLER_1_CLIENT_SECRET;
    if (voided.status >= 300 && id && secret) {
      const asMerchant = await call(
        "POST",
        `/v2/payments/authorizations/${authorization.id}/void`,
        undefined,
        { clientId: id, secret },
      );
      record("2. void with the merchant's own app", outcome(asMerchant), asMerchant.status < 300);
    }
    if (voided.status >= 300) console.log(`  Left to expire: authorization ${authorization.id}`);
  }
}

// 3. A payment method saved once, then orders against it with no redirect.
{
  const vaultedCard = { ...TEST_CARD, attributes: { vault: { store_in_vault: "ON_SUCCESS" } } };
  const { res, authorization } = await hold("SELLER_4", "1.00", vaultedCard);
  const vaultId = res.body.payment_source?.card?.attributes?.vault?.id;
  record("3. save a card in the vault", vaultId ? "saved" : outcome(res), Boolean(vaultId), res.ms);
  if (authorization) await call("POST", `/v2/payments/authorizations/${authorization.id}/void`);
  if (vaultId) {
    const second = await hold("SELLER_4", "1.00", { vault_id: vaultId });
    record("3. authorize on the saved card", outcome(second.res), Boolean(second.authorization));
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} answers match the plan.`);
process.exitCode = failed.length > 0 ? 1 : 0;
