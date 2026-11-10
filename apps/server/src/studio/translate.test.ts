import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  fromAnthropicMessage,
  MAX_OUTPUT_TOKENS,
  STUDIO_MODEL,
  type StudioTurn,
  strictSchema,
  studioTurnSchema,
  toAnthropicRequest,
} from "./translate.js";

const user = (text: string) =>
  ({ type: "message", role: "user", content: [{ type: "text", text }] }) as const;

const parse = (turn: unknown): StudioTurn => studioTurnSchema.parse(turn);

describe("toAnthropicRequest", () => {
  it("puts the model, the cap and thinking off on every turn, whatever the turn says", () => {
    const request = toAnthropicRequest(parse({ input: [user("Hi")] }));
    expect(request).toEqual({
      model: STUDIO_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    });
  });

  it("turns Studio's flat conversation into alternating messages, tool calls and results paired", () => {
    const request = toAnthropicRequest(
      parse({
        instructions: "Lead agent.",
        input: [
          { type: "message", role: "system", content: [{ type: "text", text: "Page: overview" }] },
          user("Chart attack success"),
          { type: "reasoning", summary: [] },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Reading the schema." }],
          },
          { type: "function_call", callId: "toolu_1", name: "view_schema", arguments: "" },
          { type: "function_call", callId: "call:2", name: "execute_query", arguments: '{"a":1}' },
          { type: "function_call_output", callId: "toolu_1", output: "fields..." },
          { type: "function_call_output", callId: "call:2", output: "" },
        ],
      }),
    );
    expect(request.system).toBe("Lead agent.\n\nPage: overview");
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Chart attack success" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the schema." },
          { type: "tool_use", id: "toolu_1", name: "view_schema", input: {} },
          { type: "tool_use", id: "call_2", name: "execute_query", input: { a: 1 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "fields..." },
          { type: "tool_result", tool_use_id: "call_2", content: "(no output)" },
        ],
      },
    ]);
  });

  it("answers a tool call whose result never came as failed, and opens with the person", () => {
    const request = toAnthropicRequest(
      parse({
        input: [
          { type: "function_call", callId: "toolu_9", name: "add_widget", arguments: "{" },
          user("Never mind"),
        ],
      }),
    );
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "(continue)" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_9", name: "add_widget", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_9",
            content: "The call did not complete.",
            is_error: true,
          },
          { type: "text", text: "Never mind" },
        ],
      },
    ]);
  });

  it("passes the tools through, as objects, and maps the tool choice", () => {
    const tools = [{ name: "view_schema", parameters: { properties: {} } }];
    const choice = (toolChoice: unknown) =>
      toAnthropicRequest(parse({ input: [user("x")], tools, toolChoice })).tool_choice;
    expect(toAnthropicRequest(parse({ input: [user("x")], tools })).tools).toEqual([
      {
        name: "view_schema",
        input_schema: { properties: {}, type: "object", additionalProperties: false },
        strict: true,
      },
    ]);
    expect(choice("auto")).toEqual({ type: "auto" });
    expect(choice("none")).toEqual({ type: "none" });
    expect(choice("required")).toEqual({ type: "any" });
    expect(choice({ name: "view_schema" })).toEqual({ type: "tool", name: "view_schema" });
    // No tools, no choice to make.
    expect(
      toAnthropicRequest(parse({ input: [user("x")], toolChoice: "required" })),
    ).not.toHaveProperty("tool_choice");
  });

  it("asks for JSON in the instructions when the turn wants a JSON answer", () => {
    const request = toAnthropicRequest(
      parse({
        input: [user("x")],
        responseFormat: { type: "json", name: "plan", schema: { type: "object" } },
      }),
    );
    expect(request.system).toMatch(
      /^Answer with one JSON value only.*\(plan\):\n\{"type":"object"\}$/s,
    );
  });

  it("refuses what it can't send: images, unknown roles, an empty conversation", () => {
    expect(studioTurnSchema.safeParse({ input: [] }).success).toBe(false);
    expect(
      studioTurnSchema.safeParse({
        input: [{ type: "message", role: "user", content: [{ type: "image", detail: "auto" }] }],
      }).success,
    ).toBe(false);
    expect(
      studioTurnSchema.safeParse({ input: [{ type: "message", role: "developer", content: [] }] })
        .success,
    ).toBe(false);
  });
});

describe("strictSchema", () => {
  it("closes every object and drops Studio's 'may be left out' branch", () => {
    expect(
      strictSchema({
        type: "object",
        properties: {
          target: {
            anyOf: [
              { type: "object", properties: { id: { type: "string", enum: ["data"] } } },
              { not: {} },
            ],
          },
          items: { type: "array", items: { type: "object", properties: {} } },
        },
        required: [],
      }),
    ).toEqual({
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: { id: { type: "string", enum: ["data"] } },
          additionalProperties: false,
        },
        items: {
          type: "array",
          items: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      required: [],
      additionalProperties: false,
    });
  });

  it("leaves a tool non-strict when strict mode can't take its schema", () => {
    // Studio's expression type refers to itself.
    expect(
      strictSchema({
        type: "object",
        properties: { e: { $ref: "#/$defs/Expr" } },
        $defs: { Expr: { anyOf: [{ type: "string" }, { $ref: "#/$defs/Expr" }] } },
      }),
    ).toBeNull();
    expect(strictSchema({ type: "object", additionalProperties: { type: "string" } })).toBeNull();
    expect(strictSchema({ type: "object", properties: { a: { oneOf: [] } } })).toBeNull();
  });
});

const message = (overrides: Partial<Anthropic.Message>): Anthropic.Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: STUDIO_MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
    ...overrides,
  }) as Anthropic.Message;

describe("fromAnthropicMessage", () => {
  it("says the text as one message, then each tool call, with the usage", () => {
    const response = fromAnthropicMessage(
      message({
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "One", citations: null },
          { type: "tool_use", id: "toolu_a", name: "add_widget", input: { type: "grid" } },
          { type: "text", text: "Two", citations: null },
        ] as Anthropic.ContentBlock[],
      }),
      1000,
    );
    expect(response).toEqual({
      id: "msg_1",
      createdAt: 1000,
      model: STUDIO_MODEL,
      status: "completed",
      output: [
        {
          id: "msg_1_text",
          kind: "output",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "text", text: "One\n\nTwo", annotations: [] }],
        },
        {
          id: "toolu_a",
          kind: "output",
          type: "function_call",
          callId: "toolu_a",
          name: "add_widget",
          arguments: '{"type":"grid"}',
          status: "completed",
        },
      ],
      usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
    });
  });

  it("marks an answer cut off at the cap incomplete, and a refusal as one", () => {
    const cut = fromAnthropicMessage(
      message({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "Half", citations: null }] as Anthropic.ContentBlock[],
      }),
      0,
    );
    expect(cut.status).toBe("incomplete");
    expect(cut.incompleteDetails).toEqual({ reason: "max_output_tokens" });
    const refused = fromAnthropicMessage(message({ stop_reason: "refusal" }), 0);
    expect(refused.output[0]).toMatchObject({
      content: [{ type: "refusal", refusal: "The model declined to answer." }],
    });
  });
});
