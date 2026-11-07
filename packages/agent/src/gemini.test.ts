import { describe, expect, it } from "vitest";
import { withThoughtSignatures } from "./gemini.js";

const signature = { google: { thought_signature: "sig-1" } };

const toolCallAnswer = () =>
  Response.json({
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search", arguments: "{}" },
              extra_content: signature,
            },
            { id: "call_2", type: "function", function: { name: "search", arguments: "{}" } },
          ],
        },
      },
    ],
  });

describe("withThoughtSignatures", () => {
  it("sends a tool call's signature back on the next turn, and only on that call", async () => {
    const bodies: Record<string, unknown>[] = [];
    const wrapped = withThoughtSignatures((async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? toolCallAnswer() : Response.json({ choices: [] });
    }) as typeof fetch);

    const first = await wrapped("https://x.test", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });
    // The caller still gets the whole body.
    expect(await first.json()).toMatchObject({ choices: [{ finish_reason: "tool_calls" }] });

    await wrapped("https://x.test", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "search", arguments: "{}" } },
              { id: "call_2", type: "function", function: { name: "search", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "[]" },
        ],
      }),
    });

    const sent = bodies[1]?.messages as {
      tool_calls?: { id: string; extra_content?: unknown }[];
    }[];
    expect(sent[1]?.tool_calls?.[0]?.extra_content).toEqual(signature);
    expect(sent[1]?.tool_calls?.[1]?.extra_content).toBeUndefined();
  });

  it("leaves requests and error answers alone when there is nothing to carry", async () => {
    const seen: string[] = [];
    const wrapped = withThoughtSignatures((async (_url: unknown, init?: RequestInit) => {
      seen.push(String(init?.body));
      return new Response("nope", { status: 500 });
    }) as typeof fetch);
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
    const response = await wrapped("https://x.test", { method: "POST", body });
    expect(response.status).toBe(500);
    expect(seen).toEqual([body]);
  });
});
