import { baseCatalog } from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { catalogRecord } from "./crosscheck.js";
import {
  CHANNEL3_BASE_URL,
  channel3ConfigFromEnv,
  createChannel3Market,
  type MarketQuote,
  marketCheck,
  marketQueryFor,
  marketQueryText,
} from "./market.js";

// The Channel3 client against a stubbed fetch. Its host isn't reachable from here and there is no
// key yet, so nothing in these tests is real market data: the one successful answer below is a
// made-up shape with made-up prices, there only to check the parsing.

const record = (listingId: string) => {
  const r = catalogRecord(baseCatalog, listingId);
  if (!r) throw new Error(listingId);
  return r;
};
const halvard = marketQueryFor(record("lst_keyboard_02_1"));

function stubFetch(answer: (init: RequestInit) => Response | Promise<Response>) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return answer(init ?? {});
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const madeUp = (
  prices: { price: number; currency?: string; availability?: string; condition?: string }[][],
) => ({
  products: prices.map((offers, i) => ({
    id: `test_${i}`,
    title: `Made-up test product ${i}`,
    offers: offers.map((o) => ({
      url: "https://shop.example.test/item",
      domain: "shop.example.test",
      price: { price: o.price, currency: o.currency ?? "USD" },
      availability: o.availability ?? "InStock",
      condition: o.condition ?? "new",
    })),
  })),
  next_page_token: null,
});

describe("market queries", () => {
  it("describe the kind of product by category and attributes", () => {
    expect(halvard.text).toBe("wireless tenkeyless mechanical keyboard, tactile switches");
    expect(marketQueryFor(record("lst_keyboard_01_1")).text).toBe(
      "wired 60% mechanical keyboard, linear switches",
    );
    expect(marketQueryFor(record("lst_headphones_09_1")).text).toBe(
      "wireless over-ear noise cancelling headphones",
    );
    expect(marketQueryText("mouse", { wireless: true, dpi: 26000, weight_g: 60 })).toBe(
      "wireless mouse, 60 g",
    );
  });

  it("never name an arena brand, product or store", () => {
    // Every word of a brand or store name, and every product name whole (some product names hold
    // a plain word too, like "Full").
    const brandWords = [...baseCatalog.brands, ...baseCatalog.sellers]
      .flatMap((b) => b.name.toLowerCase().split(/[^a-z]+/))
      .filter((w) => w.length > 2);
    const productNames = baseCatalog.products.map((p) => p.name.toLowerCase());
    for (const listing of baseCatalog.listings) {
      const text = marketQueryFor(record(listing.listingId)).text.toLowerCase();
      const words = text.split(/[^a-z0-9%]+/);
      for (const word of brandWords) expect(words, listing.listingId).not.toContain(word);
      for (const name of productNames) expect(text, listing.listingId).not.toContain(name);
    }
  });
});

describe("the Channel3 reference", () => {
  it("is unavailable without a key, and sends nothing", async () => {
    const { fetch, sent } = stubFetch(() => Response.json({}));
    const quote = await createChannel3Market({ apiKey: null, fetch }).lookup(halvard);
    expect(quote).toMatchObject({ status: "unavailable", reason: "not_configured" });
    expect(sent).toEqual([]);
  });

  it("posts the query to /v1/search with the key in x-api-key", async () => {
    const { fetch, sent } = stubFetch(() => Response.json(madeUp([[{ price: 1 }]])));
    await createChannel3Market({ apiKey: "the-apps-channel3-key", fetch }).lookup(halvard);
    const [call] = sent;
    expect(call?.url).toBe(`${CHANNEL3_BASE_URL}/v1/search`);
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("x-api-key")).toBe("the-apps-channel3-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      query: "wireless tenkeyless mechanical keyboard, tactile switches",
      limit: 20,
      config: { country: "US", currency: "USD" },
    });
  });

  it("is unavailable, not an error, when the connection is refused", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const quote = await createChannel3Market({ apiKey: "k", fetch }).lookup(halvard);
    expect(quote).toMatchObject({ status: "unavailable", reason: "unreachable" });
    expect(quote.status === "unavailable" && quote.detail).toContain("fetch failed");
  });

  it("gives up after its timeout", async () => {
    const fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof globalThis.fetch;
    const quote = await createChannel3Market({ apiKey: "k", fetch, timeoutMs: 5 }).lookup(halvard);
    expect(quote).toMatchObject({ status: "unavailable", reason: "unreachable" });
  });

  it("is unavailable on an error status, such as a proxy refusing the host", async () => {
    const { fetch } = stubFetch(() => new Response("Forbidden", { status: 403 }));
    const quote = await createChannel3Market({ apiKey: "k", fetch }).lookup(halvard);
    expect(quote).toMatchObject({ status: "unavailable", reason: "http_error" });
    expect(quote.status === "unavailable" && quote.detail).toBe("Channel3 answered 403");
  });

  it("is unavailable when the answer isn't a search response", async () => {
    for (const body of ["not json", JSON.stringify({ items: [] })]) {
      const { fetch } = stubFetch(() => new Response(body, { status: 200 }));
      const quote = await createChannel3Market({ apiKey: "k", fetch }).lookup(halvard);
      expect(quote).toMatchObject({ status: "unavailable", reason: "invalid_response" });
    }
  });

  it("counts only new, in-stock USD offers, and wants three priced products", async () => {
    const { fetch } = stubFetch(() =>
      Response.json(
        madeUp([
          [{ price: 10 }],
          [{ price: 20, currency: "EUR" }],
          [{ price: 30, availability: "OutOfStock" }],
          [{ price: 40, condition: "used" }],
          [{ price: 50 }],
        ]),
      ),
    );
    const quote = await createChannel3Market({ apiKey: "k", fetch }).lookup(halvard);
    expect(quote).toMatchObject({ status: "unavailable", reason: "too_few_prices" });
  });

  it("reports the low, median and high of each product's best offer, and nothing else", async () => {
    const { fetch } = stubFetch(() =>
      Response.json(madeUp([[{ price: 100 }, { price: 90.5 }], [{ price: 120 }], [{ price: 80 }]])),
    );
    const quote = await createChannel3Market({ apiKey: "k", fetch }).lookup(halvard);
    expect(quote).toEqual({
      status: "available",
      source: "channel3",
      query: halvard.text,
      products: 3,
      pricedProducts: 3,
      lowCents: 8000,
      medianCents: 9050,
      highCents: 12000,
      latencyMs: expect.any(Number),
    });
    expect(JSON.stringify(quote)).not.toContain("Made-up");
  });
});

describe("the Channel3 key", () => {
  it("comes only from FIREWALL_CHANNEL3_API_KEY, never the SDK's CHANNEL3_API_KEY", () => {
    expect(channel3ConfigFromEnv({ CHANNEL3_API_KEY: "the-sdks-default" })).toEqual({
      apiKey: null,
    });
    expect(
      channel3ConfigFromEnv({
        CHANNEL3_API_KEY: "the-sdks-default",
        FIREWALL_CHANNEL3_API_KEY: " the-apps-own ",
      }),
    ).toEqual({ apiKey: "the-apps-own" });
    expect(channel3ConfigFromEnv({ FIREWALL_CHANNEL3_API_KEY: "  " })).toEqual({ apiKey: null });
  });
});

describe("the market check", () => {
  const available = (medianCents: number): MarketQuote => ({
    status: "available",
    source: "stand-in",
    query: "q",
    products: 5,
    pricedProducts: 5,
    lowCents: medianCents / 2,
    medianCents,
    highCents: medianCents * 2,
    latencyMs: 0,
  });
  it("records how far the paid price is from the median, and judges nothing", () => {
    expect(marketCheck(11600, available(10000))).toEqual({
      quote: available(10000),
      pctAboveMedian: 16,
    });
    expect(marketCheck(8000, available(10000))).toMatchObject({ pctAboveMedian: -20 });
  });
  it("finds nothing when the reference was unavailable", () => {
    const quote: MarketQuote = {
      status: "unavailable",
      source: "channel3",
      query: "q",
      reason: "not_configured",
      detail: "",
      latencyMs: 0,
    };
    expect(marketCheck(99999, quote)).toEqual({ quote, pctAboveMedian: null });
  });
});
