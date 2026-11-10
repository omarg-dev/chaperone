import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { StudioAiService } from "../studio/service.js";
import { studioTurnSchema } from "../studio/translate.js";

// The largest turn the assistant takes, before it is even parsed: well above what Studio's agents
// send, and small enough that a request can't make the server read megabytes.
export const MAX_TURN_BYTES = 1_000_000;

// AG Studio on the dashboard, at `/studio`. `GET /config` is what the page needs before it draws
// Studio: the licence key, read at runtime from the server's own settings (a front-end licence key
// is in every page that uses it, so serving it is no leak, and it keeps the key out of the repo and
// out of the image's build), and whether the assistant is on. `POST /ai` answers one turn of the
// assistant on the server's model client (see studio/service.ts); nothing else in Studio reaches the
// server, and nothing it does is stored here.
export function studioRoutes(ai: StudioAiService, licenseKey: string | null) {
  return new Hono()
    .get("/config", (c) => c.json({ licenseKey, ai: ai.status() }))
    .post(
      "/ai",
      bodyLimit({
        maxSize: MAX_TURN_BYTES,
        onError: (c) =>
          c.json({ error: "too_long", message: "That turn is too large for the assistant." }, 413),
      }),
      zValidator("json", studioTurnSchema, (result, c) => {
        if (!result.success) {
          return c.json(
            { error: "invalid_turn", message: "That isn't a turn the assistant can answer." },
            400,
          );
        }
      }),
      async (c) => {
        const result = await ai.turn(c.req.valid("json"), c.req.raw.signal);
        if (result.ok) {
          return c.json({
            response: result.response,
            costUsd: result.costUsd,
            budget: result.budget,
          });
        }
        return c.json(
          { error: result.error, message: result.message, budget: result.budget },
          result.status,
        );
      },
    );
}
