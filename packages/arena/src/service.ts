import { randomBytes } from "node:crypto";
import type { Event, EventLog, Provenance } from "@firewall/events";
import { baseCatalog } from "./catalog/index.js";
import { type Arena, buildArena, type ScenarioDefinition } from "./scenario.js";
import { findScenario } from "./scenarios/index.js";
import {
  addToCart,
  applyCoupon,
  type Cart,
  checkout,
  emptyCart,
  type OrderDraft,
  removeFromCart,
  reviews,
  type SearchQuery,
  ShopError,
  search,
  viewListing,
} from "./shop.js";
import type { Catalog } from "./types.js";

// One agent's visit to one scenario's arena.
export interface ArenaRun {
  runId: string;
  scenario: ScenarioDefinition;
  seed: string;
  arena: Arena;
  cart: Cart;
  order: OrderDraft | null;
}

// Each call can name the event that caused it (the agent's tool call), so the arena's event
// joins the causal chain the timeline draws.
export interface CallOptions {
  parentId?: string;
}

// What a caller says about who started a run, written into its `run_started` event. The web app's
// live runs say `origin: "web"` (the daily spend cap counts those) and which payment adapter holds
// their money.
export interface StartOptions {
  origin?: "web";
  payments?: "fake" | "sandbox";
}

export interface ArenaServiceOptions {
  log: EventLog;
  catalog?: Catalog;
  newRunId?: () => string;
}

const defaultRunId = () => `run_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

// The marketplace as the agent uses it: every call is served from the pure shop functions and
// written to the event log, with page content marked as seller content and the rest as catalog.
export function createArenaService(options: ArenaServiceOptions) {
  const { log } = options;
  const catalog = options.catalog ?? baseCatalog;
  const newRunId = options.newRunId ?? defaultRunId;
  const runs = new Map<string, ArenaRun>();

  const record = (
    run: ArenaRun,
    type: string,
    provenance: Provenance,
    payload: unknown,
    call: CallOptions,
  ): Event =>
    log.append({
      runId: run.runId,
      scenarioId: run.scenario.scenarioId,
      lane: "arena",
      type,
      provenance,
      payload,
      parentId: call.parentId ?? null,
    });

  const getRun = (runId: string): ArenaRun => {
    const run = runs.get(runId);
    if (!run) throw new ShopError("not_found", `No run "${runId}"`);
    return run;
  };

  // Runs one shop call, recording what was served, or that it failed and why.
  function serve<T>(
    runId: string,
    type: string,
    provenance: Provenance,
    request: unknown,
    call: CallOptions,
    action: (run: ArenaRun) => T,
  ): T {
    const run = getRun(runId);
    try {
      const result = action(run);
      record(run, type, provenance, { request, result }, call);
      return result;
    } catch (error) {
      if (error instanceof ShopError) {
        record(run, `${type}_failed`, "system", { request, error: error.message }, call);
      }
      throw error;
    }
  }

  return {
    start(scenarioId: string, seed: string, options: StartOptions = {}): ArenaRun {
      const scenario = findScenario(scenarioId);
      if (!scenario) throw new ShopError("not_found", `No scenario "${scenarioId}"`);
      const run: ArenaRun = {
        runId: newRunId(),
        scenario,
        seed,
        arena: buildArena(scenario, seed, catalog),
        cart: emptyCart(),
        order: null,
      };
      runs.set(run.runId, run);
      // The request is what the person said, so its provenance is the user.
      record(
        run,
        "run_started",
        "user",
        {
          seed,
          request: scenario.request,
          ...(options.origin && { origin: options.origin }),
          ...(options.payments && { payments: options.payments }),
        },
        {},
      );
      return run;
    },

    get: getRun,

    search(runId: string, query: SearchQuery, call: CallOptions = {}) {
      return serve(runId, "search", "seller_content", query, call, (run) =>
        search(run.arena, query),
      );
    },

    listing(runId: string, listingId: string, call: CallOptions = {}) {
      return serve(runId, "listing_viewed", "seller_content", { listingId }, call, (run) =>
        viewListing(run.arena, listingId),
      );
    },

    reviews(runId: string, listingId: string, call: CallOptions = {}) {
      return serve(runId, "reviews_viewed", "seller_content", { listingId }, call, (run) =>
        reviews(run.arena, listingId),
      );
    },

    addToCart(runId: string, listingId: string, quantity: number, call: CallOptions = {}) {
      return serve(runId, "cart_updated", "catalog", { listingId, quantity }, call, (run) => {
        run.cart = addToCart(run.arena, run.cart, listingId, quantity);
        return run.cart;
      });
    },

    removeFromCart(runId: string, listingId: string, call: CallOptions = {}) {
      return serve(runId, "cart_updated", "catalog", { remove: listingId }, call, (run) => {
        run.cart = removeFromCart(run.cart, listingId);
        return run.cart;
      });
    },

    applyCoupon(runId: string, code: string, call: CallOptions = {}) {
      return serve(runId, "coupon_applied", "catalog", { code }, call, (run) => {
        const { cart, coupon } = applyCoupon(run.arena, run.cart, code);
        run.cart = cart;
        return { cart, coupon };
      });
    },

    cart(runId: string): Cart {
      return getRun(runId).cart;
    },

    checkout(runId: string, call: CallOptions = {}) {
      return serve(runId, "checkout", "catalog", {}, call, (run) => {
        run.order = checkout(run.arena, run.cart);
        return run.order;
      });
    },
  };
}

export type ArenaService = ReturnType<typeof createArenaService>;
