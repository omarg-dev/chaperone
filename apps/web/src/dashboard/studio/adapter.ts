import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

// AG Studio's assistant talks to a model through an adapter. This one sends each turn to the
// server (`POST /studio/ai`), which answers it on the app's own Anthropic key and counts it against
// the day's cap: the browser holds no key, and picks neither the model nor the token cap. The
// request is Studio's own, trimmed to what a turn needs; the answer is Studio's output items, which
// this replays as the stream of events Studio draws from.

// What the server is sent: the conversation without Studio's bookkeeping (ids, statuses,
// annotations), so a turn is no bigger than it has to be.
export type WireItem =
  | { type: "message"; role: "user" | "system"; content: { type: "text"; text: string }[] }
  | {
      type: "message";
      role: "assistant";
      content: ({ type: "text"; text: string } | { type: "refusal"; refusal: string })[];
    }
  | { type: "function_call"; callId: string; name: string; arguments: string }
  | { type: "function_call_output"; callId: string; output: string };

export interface WireTurn {
  instructions?: string;
  input: WireItem[];
  tools?: { name: string; description?: string; parameters: unknown }[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?:
    | { type: "text" }
    | { type: "json"; name: string; description?: string; schema: unknown };
}

function wireItem(item: AgAiConversationItem): WireItem | null {
  if (item.type === "message" && item.kind === "input") {
    const content = item.content.flatMap((c) =>
      c.type === "text" ? [{ type: "text" as const, text: c.text }] : [],
    );
    return content.length > 0 ? { type: "message", role: item.role, content } : null;
  }
  if (item.type === "message") {
    return {
      type: "message",
      role: "assistant",
      content: item.content.map((c) =>
        c.type === "text"
          ? { type: "text" as const, text: c.text }
          : { type: "refusal" as const, refusal: c.refusal },
      ),
    };
  }
  if (item.type === "function_call") {
    return {
      type: "function_call",
      callId: item.callId,
      name: item.name,
      arguments: item.arguments,
    };
  }
  if (item.type === "function_call_output") {
    return { type: "function_call_output", callId: item.callId, output: item.output };
  }
  // Reasoning: turns run with thinking off, so there is none worth sending back.
  return null;
}

export function wireTurn(request: AgLlmRequest): WireTurn {
  return {
    ...(request.instructions ? { instructions: request.instructions } : {}),
    input: request.input.flatMap((item) => {
      const wired = wireItem(item);
      return wired ? [wired] : [];
    }),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools
            // A provider-hosted tool has no meaning on the server's model.
            .filter((tool) => tool.kind !== "provided")
            .map((tool) => ({
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              parameters: tool.parameters,
            })),
        }
      : {}),
    ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
    responseFormat:
      request.responseFormat.type === "json"
        ? {
            type: "json",
            name: request.responseFormat.name,
            ...(request.responseFormat.description
              ? { description: request.responseFormat.description }
              : {}),
            schema: request.responseFormat.schema,
          }
        : { type: "text" },
  };
}

// The events Studio draws a finished answer from: each message's text, then each tool call.
export function eventsOf(output: readonly AgAiOutputItem[]): AgAiEvent[] {
  return output.flatMap((item): AgAiEvent[] => {
    if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n\n");
      return [
        { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text },
        { type: "TEXT_MESSAGE_END", messageId: item.id },
      ] as AgAiEvent[];
    }
    if (item.type === "function_call") {
      return [
        { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name },
        { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments },
        { type: "TOOL_CALL_END", toolCallId: item.callId },
      ] as AgAiEvent[];
    }
    return [];
  });
}

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AssistantError";
  }
}

async function post(
  endpoint: string,
  turn: WireTurn,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
): Promise<AgLlmResponse> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turn),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AssistantError("The server didn't answer.", "unreachable");
  }
  const body = (await response.json().catch(() => null)) as {
    response?: AgLlmResponse;
    error?: string;
    message?: string;
  } | null;
  if (!response.ok || !body?.response) {
    throw new AssistantError(
      body?.message ?? `The assistant couldn't answer (${response.status}).`,
      body?.error ?? "failed",
    );
  }
  return body.response;
}

// `onAnswered` hears each turn the server answered or refused, so the page can say when the day's
// budget runs out without asking the server again.
export function serverAdapter(options: {
  endpoint?: string;
  fetch?: typeof fetch;
  onRefused?: (error: AssistantError) => void;
}): AgLlmAdapter {
  const endpoint = options.endpoint ?? "/studio/ai";
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    executeTurn(request, turnOptions): AgLlmResponseHandler {
      const complete = post(endpoint, wireTurn(request), turnOptions?.signal, fetcher);
      complete.catch((error) => {
        if (error instanceof AssistantError) options.onRefused?.(error);
      });
      async function* stream(): AsyncIterableIterator<AgAiEvent> {
        let response: AgLlmResponse;
        try {
          response = await complete;
        } catch {
          // A failed turn is reported once, through `complete`.
          return;
        }
        yield* eventsOf(response.output);
      }
      const iterator = stream();
      return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
    },
  };
}
