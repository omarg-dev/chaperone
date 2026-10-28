import { baseCatalog, buildArena, findScenario } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import { decideEscalation, EnforcementError } from "@firewall/firewall";
import { type PaymentAdapter, PaymentError } from "@firewall/payments";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const decision = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().min(1).max(500).optional(),
});

// Who a run's sellers are and what they are paid into, for the run view: it turns a payout's
// payee key into a store's name, and says whether the money reached an attacker. The log doesn't
// hold sellers' roles (the gates mustn't see them), so this rebuilds the run's catalog from its
// scenario and seed, as Gate 0 does. An operator's view: the arena's agent-facing routes don't
// offer it.
function payeesOf(events: readonly Event[]) {
  const started = events.find((e) => e.lane === "arena" && e.type === "run_started");
  const seed = (started?.payload as { seed?: unknown } | undefined)?.seed;
  const scenario = started?.scenarioId ? findScenario(started.scenarioId) : undefined;
  if (!scenario || typeof seed !== "string") return [];
  return buildArena(scenario, seed, baseCatalog).catalog.sellers.map((s) => ({
    payeeKey: s.payeeKey,
    sellerName: s.name,
    role: s.role,
  }));
}

export interface EventRoutesOptions {
  // What a person's decision is carried out through. Unset, the server can't decide a run, and
  // says so: the in-memory fake lives in the process that made it, so only the sandbox adapter can
  // act on a hold the server didn't create.
  payments?: PaymentAdapter;
  // What to tell a person when `payments` is unset (which variables are missing).
  paymentsUnavailable?: string;
}

// The event log over HTTP: the run list, one run's events in replay order, who a run's payees
// are, and a person's decision on an escalated run (written to the log, then carried out by the
// same enforcement code as `decide-run`, so a second call changes nothing).
export function eventRoutes(log: EventLog, options: EventRoutesOptions = {}) {
  return new Hono()
    .get("/runs", (c) => c.json(log.listRuns()))
    .get("/runs/:runId", (c) => c.json(log.listRun(c.req.param("runId"))))
    .get("/runs/:runId/payees", (c) => c.json(payeesOf(log.listRun(c.req.param("runId")))))
    .post("/runs/:runId/decision", zValidator("json", decision), async (c) => {
      const runId = c.req.param("runId");
      const { decision: answer, note } = c.req.valid("json");
      if (log.listRun(runId).length === 0) {
        return c.json({ error: "not_found", message: `No run "${runId}"` }, 404);
      }
      if (!options.payments) {
        return c.json(
          {
            error: "decisions_unavailable",
            message:
              options.paymentsUnavailable ??
              "This server can't carry out a decision: it has no payment platform connected.",
          },
          503,
        );
      }
      try {
        const done = await decideEscalation(runId, answer, {
          log,
          payments: options.payments,
          ...(note && { note }),
        });
        return c.json({
          status: done.status,
          money: done.money,
          decidedBy: done.decidedBy,
          capture: done.capture,
          payouts: done.payouts,
        });
      } catch (error) {
        if (error instanceof EnforcementError) {
          return c.json({ error: "cannot_decide", message: error.message }, 409);
        }
        // The platform refused: a hold it no longer has, or an outage. Nothing was half done that
        // a second call couldn't finish, since enforcement works from the log.
        if (error instanceof PaymentError) {
          return c.json({ error: "payment_failed", message: error.message }, 502);
        }
        throw error;
      }
    });
}
