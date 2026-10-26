import { createArenaService } from "@firewall/arena";
import { openEventLog } from "@firewall/events";
import { createFakePaymentAdapter } from "@firewall/payments";
import { arenaSource, createFirewall } from "@firewall/sdk";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { attackerListing, buyingModel, confirmedMandate } from "./demo.js";

const log = openEventLog({ path: "firewall-demo.db" });
const arena = createArenaService({ log });
const run = arena.start("sc_a01", "1"); // the marketplace your agent shops in

const firewall = createFirewall({
  log,
  source: arenaSource({ arena, log, runId: run.runId }),
  payments: createFakePaymentAdapter(),
  vaultId: "FAKE-WALLET",
  mandate: confirmedMandate("sc_a01"), // what the person confirmed before the agent started
  config: "gate0", // the policy rules only; "full" adds the model gates
});

// Your agent's tools, as you already have them. `checkout` is the one that pays.
const tools = firewall.wrap({
  add_to_cart: tool({
    description: "Add a listing to the cart.",
    inputSchema: z.object({ listingId: z.string(), quantity: z.number().int().positive() }),
    execute: ({ listingId, quantity }) => arena.addToCart(run.runId, listingId, quantity),
  }),
  checkout: tool({
    description: "Check out and pay with the saved wallet.",
    inputSchema: z.object({}),
    execute: () => ({ status: "paid" }), // your pay-now code; the firewall never calls it
  }),
});

// Your agent loop, as before. This model buys from an attacker's store, as a steered one would.
await generateText({
  model: buyingModel(attackerListing("sc_a01", "1")),
  tools,
  prompt: run.scenario.request,
  stopWhen: [isStepCount(10), () => firewall.held !== null],
});

// Review the held cart and capture it, void it, or leave it for the person.
const settled = await firewall.settle();
console.log(`verdict: ${settled?.review.verdict}, money: ${settled?.enforcement.money}`);
log.close();
