import {
  type ArenaService,
  CATEGORIES,
  type CallOptions,
  isHeldOut,
  SCENARIOS,
} from "@firewall/arena";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";

export const startRunBody = z.object({
  scenarioId: z.string().min(1),
  seed: z.string().min(1).default("1"),
});
export const searchQuery = z.object({
  q: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  maxPriceCents: z.coerce.number().int().positive().optional(),
});
export const addLineBody = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().positive().default(1),
});
export const couponBody = z.object({ code: z.string().min(1) });

// An agent can name the event that made this call (its own tool call), so the arena's event
// joins the causal chain. Optional: a plain HTTP client just leaves it out.
const callOptions = (c: Context): CallOptions => {
  const parentId = c.req.header("x-parent-event-id");
  return parentId ? { parentId } : {};
};

// The marketplace an agent shops in. Every call is written to the event log by the service.
export function arenaRoutes(arena: ArenaService) {
  return (
    new Hono()
      // The scenario list leaves out each scenario's intent and, for an attack, what the attack
      // is and that there is one: that's the eval's answer key, and an agent must not see it.
      // The held-out set isn't listed: each reuses a benign scenario's request, so the task list
      // would show it twice, and it is the eval's (a run can still start one by ID).
      .get("/scenarios", (c) =>
        c.json(
          SCENARIOS.filter((s) => !isHeldOut(s)).map(({ scenarioId, title, request }) => ({
            scenarioId,
            title,
            request,
          })),
        ),
      )
      .post("/runs", zValidator("json", startRunBody), (c) => {
        const { scenarioId, seed } = c.req.valid("json");
        const run = arena.start(scenarioId, seed);
        return c.json({ runId: run.runId, scenarioId, seed, request: run.scenario.request }, 201);
      })
      .get("/runs/:runId/search", zValidator("query", searchQuery), (c) => {
        const { q, category, maxPriceCents } = c.req.valid("query");
        const query = {
          ...(q !== undefined && { text: q }),
          ...(category !== undefined && { category }),
          ...(maxPriceCents !== undefined && { maxPriceCents }),
        };
        return c.json(arena.search(c.req.param("runId"), query, callOptions(c)));
      })
      .get("/runs/:runId/listings/:listingId", (c) =>
        c.json(arena.listing(c.req.param("runId"), c.req.param("listingId"), callOptions(c))),
      )
      .get("/runs/:runId/listings/:listingId/reviews", (c) =>
        c.json(arena.reviews(c.req.param("runId"), c.req.param("listingId"), callOptions(c))),
      )
      .get("/runs/:runId/cart", (c) => c.json(arena.cart(c.req.param("runId"))))
      .post("/runs/:runId/cart", zValidator("json", addLineBody), (c) => {
        const { listingId, quantity } = c.req.valid("json");
        return c.json(arena.addToCart(c.req.param("runId"), listingId, quantity, callOptions(c)));
      })
      .delete("/runs/:runId/cart/:listingId", (c) =>
        c.json(
          arena.removeFromCart(c.req.param("runId"), c.req.param("listingId"), callOptions(c)),
        ),
      )
      .post("/runs/:runId/coupons", zValidator("json", couponBody), (c) =>
        c.json(arena.applyCoupon(c.req.param("runId"), c.req.valid("json").code, callOptions(c))),
      )
      .post("/runs/:runId/checkout", (c) =>
        c.json(arena.checkout(c.req.param("runId"), callOptions(c))),
      )
  );
}
