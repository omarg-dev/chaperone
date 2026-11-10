import { FIREWALL_CONFIGS } from "@firewall/firewall";
import { EDITABLE_FIELDS } from "@firewall/mandate";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { LiveError, type LiveService } from "../live/service.js";

export const draftBody = z.object({
  scenarioId: z.string().min(1).max(64),
  seed: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default("1"),
});

export const mandateActionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    field: z.enum(EDITABLE_FIELDS),
    input: z.string().trim().max(500),
  }),
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().max(300).optional() }),
]);

export const startBody = z.object({ firewall: z.enum(FIREWALL_CONFIGS).default("full") });

// Live runs from the web app, at `/live`. The scenarios to choose from are the arena's own list
// (`/arena/scenarios`: a title and the request, with nothing saying which are attacks). They are under their own prefix because `/runs/:runId`
// is a page of the web app. The three steps (draft, decide, start) are in `LiveService`; this only
// validates what comes in and says what went wrong in the server's usual shape: `{ error,
// message }`, with the message written for a person.
export function liveRoutes(live: LiveService) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof LiveError) {
      return c.json({ ...error.details, error: error.code, message: error.message }, error.status);
    }
    throw error;
  });

  return (
    app
      // What a person can start, and what's left of today's budget.
      .get("/status", (c) => c.json(live.status()))
      .post("/runs", zValidator("json", draftBody), async (c) => {
        const { scenarioId, seed } = c.req.valid("json");
        return c.json(await live.draft(scenarioId, seed), 201);
      })
      .get("/runs/:runId/mandate", (c) => c.json(live.mandate(c.req.param("runId"))))
      .post("/runs/:runId/mandate", zValidator("json", mandateActionBody), (c) =>
        c.json(live.decide(c.req.param("runId"), c.req.valid("json"))),
      )
      .post("/runs/:runId/start", zValidator("json", startBody), (c) =>
        c.json(live.start(c.req.param("runId"), c.req.valid("json").firewall), 202),
      )
  );
}
