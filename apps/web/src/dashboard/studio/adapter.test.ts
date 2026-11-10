import type { AgLlmRequest } from "ag-studio";
import { describe, expect, it } from "vitest";
import { AssistantError, eventsOf, serverAdapter, wireTurn } from "./adapter";

const request = {
  instructions: "Lead.",
  input: [
    {
      id: "m1",
      kind: "input",
      type: "message",
      role: "user",
      status: "completed",
      content: [{ type: "text", text: "How many got through?" }],
    },
    { id: "r1", kind: "output", type: "reasoning", summary: [] },
    {
      id: "c1",
      kind: "output",
      type: "function_call",
      callId: "toolu_1",
      name: "view_schema",
      arguments: "{}",
      status: "completed",
    },
    { type: "function_call_output", callId: "toolu_1", output: "fields", status: "completed" },
  ],
  tools: [{ name: "view_schema", description: "Schema.", parameters: { type: "object" } }],
  toolChoice: "auto",
  responseFormat: { type: "text" },
  // The page never chooses the model: whatever Studio says is dropped.
  model: { id: "claude-opus-5-5" },
} as unknown as AgLlmRequest;

describe("the assistant's adapter", () => {
  it("sends the turn without Studio's bookkeeping, its reasoning or a model", () => {
    expect(wireTurn(request)).toEqual({
      instructions: "Lead.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "How many got through?" }],
        },
        { type: "function_call", callId: "toolu_1", name: "view_schema", arguments: "{}" },
        { type: "function_call_output", callId: "toolu_1", output: "fields" },
      ],
      tools: [{ name: "view_schema", description: "Schema.", parameters: { type: "object" } }],
      toolChoice: "auto",
      responseFormat: { type: "text" },
    });
  });

  it("replays the server's answer as Studio's events", () => {
    expect(
      eventsOf([
        {
          id: "msg_text",
          kind: "output",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "text", text: "Ten.", annotations: [] }],
        },
        {
          id: "toolu_2",
          kind: "output",
          type: "function_call",
          callId: "toolu_2",
          name: "execute_query",
          arguments: '{"a":1}',
        },
      ]).map((e) => e.type),
    ).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
  });

  it("fails the turn with the server's reason, and says when the day's budget is spent", async () => {
    const refused: AssistantError[] = [];
    const adapter = serverAdapter({
      fetch: async () =>
        new Response(
          JSON.stringify({ error: "budget_spent", message: "Today's budget is spent." }),
          {
            status: 429,
          },
        ),
      onRefused: (error) => refused.push(error),
    });
    const handler = adapter.executeTurn(request);
    const failure = await handler.complete.then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(AssistantError);
    expect((failure as Error).message).toBe("Today's budget is spent.");
    const events = [];
    for await (const event of handler.stream) events.push(event);
    expect(events).toEqual([]);
    expect(refused.map((e) => e.code)).toEqual(["budget_spent"]);
  });

  it("posts to the server's route, never to a model provider", async () => {
    const sent: string[] = [];
    const adapter = serverAdapter({
      fetch: async (input) => {
        sent.push(String(input));
        return new Response(
          JSON.stringify({ response: { id: "r", createdAt: 0, status: "completed", output: [] } }),
        );
      },
    });
    await adapter.executeTurn(request).complete;
    expect(sent).toEqual(["/studio/ai"]);
  });
});
