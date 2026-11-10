import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// One turn of AG Studio's assistant, as the page's adapter sends it to `POST /studio/ai`, and the
// two pure translations the route makes: that turn into a Messages API request, and Claude's answer
// back into the output items Studio reads (`AgLlmResponse` in the `ag-studio` package).
//
// The page sends the turn in Studio's own vocabulary, trimmed to what a turn needs: the
// conversation, the agent's instructions, the tools it may call, and how it wants the answer. The
// model, the token cap and the sampling are the server's, never the page's, so a request can't pick
// a dearer model or ask for a longer answer than the cap.

// The model every turn runs on: the app's one Anthropic model, as the gates' and the builder's.
export const STUDIO_MODEL = "claude-haiku-5-5";

// The most a turn may write. Studio's agents answer in short messages and tool calls, and a turn
// that needs more is cut off and marked incomplete rather than paid for.
export const MAX_OUTPUT_TOKENS = 2048;

// The most a turn may read, counted by the API before the call. Below Haiku 5.5's long-context
// threshold (100K tokens), where the rate card is five times dearer, and far above what Studio's
// agents send (its instructions, its tool schemas and a conversation).
export const MAX_INPUT_TOKENS = 80_000;

const text = z.string().max(200_000);

const inputMessage = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "system"]),
  content: z.array(z.object({ type: z.literal("text"), text })).max(50),
});

const outputMessage = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z
    .array(
      z.union([
        z.object({ type: z.literal("text"), text }),
        z.object({ type: z.literal("refusal"), refusal: text }),
      ]),
    )
    .max(50),
});

const toolCall = z.object({
  type: z.literal("function_call"),
  callId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  arguments: text,
});

const toolResult = z.object({
  type: z.literal("function_call_output"),
  callId: z.string().min(1).max(200),
  output: text,
});

// Reasoning items are Studio's record of a model's thinking. Turns run with thinking off, so any
// that come back are dropped rather than sent: the API couldn't verify them anyway.
const reasoning = z.object({ type: z.literal("reasoning") });

const item = z.union([inputMessage, outputMessage, toolCall, toolResult, reasoning]);

// A JSON schema as Studio writes it for a tool's parameters or an answer's format. It is passed
// through to the model, so its shape is the API's to judge; here it is only bounded.
const jsonSchema = z.record(z.string(), z.unknown());

export const studioTurnSchema = z.object({
  instructions: text.optional(),
  input: z.array(item).min(1).max(400),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().max(20_000).optional(),
        parameters: jsonSchema,
      }),
    )
    .max(64)
    .optional(),
  toolChoice: z
    .union([z.enum(["auto", "none", "required"]), z.object({ name: z.string().min(1).max(64) })])
    .optional(),
  responseFormat: z
    .union([
      z.object({ type: z.literal("text") }),
      z.object({
        type: z.literal("json"),
        name: z.string().max(200),
        description: z.string().max(5_000).optional(),
        schema: jsonSchema,
      }),
    ])
    .optional(),
});

export type StudioTurn = z.infer<typeof studioTurnSchema>;

// A tool call's ID becomes a `tool_use` block's ID, which the API allows only these characters in.
// Claude's own IDs already fit; one Studio made up is made to.
const toolUseId = (callId: string) => callId.replace(/[^a-zA-Z0-9_-]/g, "_");

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type Block = Anthropic.ContentBlockParam;

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// What strict tool use can't take. Studio's schema library writes "may be left out" as a union with
// `{ not: {} }`, which is dropped below; anything else here leaves the tool non-strict.
const NOT_STRICT = [
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "dependentSchemas",
];

// A tool's parameters made fit for strict tool use, or null when they can't be: every object closed
// to keys it doesn't name, and the "left out" branch of a union removed (the property stays
// optional by not being required).
export function strictSchema(input: Schema): Schema | null {
  if (hasRecursiveDefs(input)) return null;
  const walk = (node: Schema): Schema | null => {
    let schema = node;
    if (Array.isArray(schema.anyOf)) {
      const branches = (schema.anyOf as unknown[]).filter(
        (b) => !(isSchema(b) && isSchema(b.not) && Object.keys(b).length === 1),
      );
      const { anyOf: _, ...rest } = schema;
      schema =
        branches.length === 1 && isSchema(branches[0])
          ? { ...branches[0], ...rest }
          : { ...rest, anyOf: branches };
    }
    if (NOT_STRICT.some((k) => k in schema)) return null;
    const out: Schema = { ...schema };
    if (Array.isArray(out.anyOf)) {
      const walked = (out.anyOf as unknown[]).map((b) => (isSchema(b) ? walk(b) : b));
      if (walked.includes(null)) return null;
      out.anyOf = walked;
    }
    if (isSchema(out.items)) {
      const items = walk(out.items);
      if (!items) return null;
      out.items = items;
    }
    if (isSchema(out.$defs)) {
      const defs: Schema = {};
      for (const [k, v] of Object.entries(out.$defs)) {
        const walked = isSchema(v) ? walk(v) : v;
        if (walked === null) return null;
        defs[k] = walked;
      }
      out.$defs = defs;
    }
    if (out.type === "object" || isSchema(out.properties)) {
      if ("additionalProperties" in out && out.additionalProperties !== false) return null;
      const properties: Schema = {};
      for (const [k, v] of Object.entries(isSchema(out.properties) ? out.properties : {})) {
        const walked = isSchema(v) ? walk(v) : v;
        if (walked === null) return null;
        properties[k] = walked;
      }
      out.properties = properties;
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(input);
}

// Strict tool use refuses definitions that refer to themselves, directly or through another (Studio's
// expression type does), so a tool with one stays non-strict.
function hasRecursiveDefs(schema: Schema): boolean {
  const defs = isSchema(schema.$defs) ? schema.$defs : {};
  const refsOf = (name: string) =>
    [...JSON.stringify(defs[name] ?? {}).matchAll(/"#\/\$defs\/([^"]+)"/g)].map((m) => m[1] ?? "");
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cyclic = (name: string): boolean => {
    if (done.has(name)) return false;
    if (visiting.has(name)) return true;
    visiting.add(name);
    const found = refsOf(name).some((next) => next in defs && cyclic(next));
    visiting.delete(name);
    done.add(name);
    return found;
  };
  return Object.keys(defs).some(cyclic);
}

// The turn as a Messages API request. Studio's conversation is a flat list of items; the API wants
// alternating user and assistant messages, so neighbouring items of one side are put in one
// message, a tool call becomes a `tool_use` block on the assistant's side and its output a
// `tool_result` block on the user's. A call whose output never came (a run that was cancelled) is
// answered as failed, since the API refuses a `tool_use` with no result after it.
export function toAnthropicRequest(turn: StudioTurn): Anthropic.MessageCreateParamsNonStreaming {
  const system: string[] = [];
  if (turn.instructions?.trim()) system.push(turn.instructions);

  const messages: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", block: Block) => {
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };

  for (const entry of turn.input) {
    if (entry.type === "message" && entry.role === "system") {
      for (const part of entry.content) if (part.text.trim()) system.push(part.text);
    } else if (entry.type === "message" && entry.role === "user") {
      for (const part of entry.content) {
        if (part.text.trim()) push("user", { type: "text", text: part.text });
      }
    } else if (entry.type === "message") {
      for (const part of entry.content) {
        const said = part.type === "text" ? part.text : part.refusal;
        if (said.trim()) push("assistant", { type: "text", text: said });
      }
    } else if (entry.type === "function_call") {
      push("assistant", {
        type: "tool_use",
        id: toolUseId(entry.callId),
        name: entry.name,
        input: parseArguments(entry.arguments),
      });
    } else if (entry.type === "function_call_output") {
      push("user", {
        type: "tool_result",
        tool_use_id: toolUseId(entry.callId),
        content: entry.output || "(no output)",
      });
    }
  }

  // Every tool call is answered in the message after it.
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const calls = message.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    if (calls.length === 0) continue;
    let next = messages[i + 1];
    if (next?.role !== "user") {
      next = { role: "user", content: [] };
      messages.splice(i + 1, 0, next);
    }
    const answered = new Set(
      next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])),
    );
    const missing = calls.filter((id) => !answered.has(id));
    // Tool results lead the message, as the API requires.
    next.content.unshift(
      ...missing.map(
        (id): Block => ({
          type: "tool_result",
          tool_use_id: id,
          content: "The call did not complete.",
          is_error: true,
        }),
      ),
    );
  }

  // The API wants the conversation to open with the person.
  if (messages[0]?.role !== "user") {
    messages.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  }

  if (turn.responseFormat?.type === "json") {
    system.push(
      `Answer with one JSON value only, no prose and no code fence, matching this JSON schema (${turn.responseFormat.name}${turn.responseFormat.description ? `: ${turn.responseFormat.description}` : ""}):\n${JSON.stringify(turn.responseFormat.schema)}`,
    );
  }

  const tools: Anthropic.Tool[] | undefined = turn.tools?.map((tool) => {
    const schema = strictSchema({ ...tool.parameters, type: "object" });
    return {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      input_schema: (schema ?? {
        ...tool.parameters,
        type: "object",
      }) as Anthropic.Tool.InputSchema,
      // Studio's tools take nested unions (which agent to delegate to, which widget to configure),
      // and without strict mode a small model can answer one with a string where an object goes.
      ...(schema ? { strict: true } : {}),
    };
  });
  const hasTools = tools !== undefined && tools.length > 0;
  const choice = turn.toolChoice;
  const tool_choice: Anthropic.ToolChoice | undefined = !hasTools
    ? undefined
    : choice === undefined || choice === "auto"
      ? { type: "auto" }
      : choice === "none"
        ? { type: "none" }
        : choice === "required"
          ? { type: "any" }
          : { type: "tool", name: choice.name };

  return {
    model: STUDIO_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    // Off: Studio keeps no thinking blocks to send back, and a turn is a tool call or a short
    // message, which thinking would only make slower and dearer.
    thinking: { type: "disabled" },
    ...(system.length > 0 ? { system: system.join("\n\n") } : {}),
    messages,
    ...(hasTools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };
}

// What the route answers: Studio's response for the turn (`AgLlmResponse`), in its own field names.
export interface StudioOutputText {
  type: "text";
  text: string;
  annotations: [];
}
export type StudioOutputItem =
  | {
      id: string;
      kind: "output";
      type: "message";
      role: "assistant";
      status: "completed" | "incomplete";
      content: (StudioOutputText | { type: "refusal"; refusal: string })[];
    }
  | {
      id: string;
      kind: "output";
      type: "function_call";
      callId: string;
      name: string;
      arguments: string;
      status: "completed";
    };

export interface StudioResponse {
  id: string;
  createdAt: number;
  model: string;
  status: "completed" | "incomplete";
  incompleteDetails?: { reason: "max_output_tokens" | "content_filter" };
  output: StudioOutputItem[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// Claude's answer as Studio's output items: the text as one assistant message, then each tool call.
// An answer cut off by the token cap is incomplete; a refusal is said as one, in Studio's terms.
export function fromAnthropicMessage(message: Anthropic.Message, now: number): StudioResponse {
  const said = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : []));
  const refused = message.stop_reason === "refusal";
  const incomplete = message.stop_reason === "max_tokens";
  const output: StudioOutputItem[] = [];
  if (said.length > 0 || refused) {
    output.push({
      id: `${message.id}_text`,
      kind: "output",
      type: "message",
      role: "assistant",
      status: incomplete ? "incomplete" : "completed",
      content: refused
        ? [{ type: "refusal", refusal: said.join("\n\n") || "The model declined to answer." }]
        : [{ type: "text", text: said.join("\n\n"), annotations: [] }],
    });
  }
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    output.push({
      id: block.id,
      kind: "output",
      type: "function_call",
      callId: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
      status: "completed",
    });
  }
  const inputTokens =
    message.usage.input_tokens +
    (message.usage.cache_read_input_tokens ?? 0) +
    (message.usage.cache_creation_input_tokens ?? 0);
  return {
    id: message.id,
    createdAt: now,
    model: message.model,
    status: incomplete || refused ? "incomplete" : "completed",
    ...(incomplete ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
    ...(refused ? { incompleteDetails: { reason: "content_filter" as const } } : {}),
    output,
    usage: {
      inputTokens,
      outputTokens: message.usage.output_tokens,
      totalTokens: inputTokens + message.usage.output_tokens,
    },
  };
}
