// Gemini 3 models return a `thought_signature` with each tool call and want it sent back on the
// next turn, or they answer 400 "Function call is missing a thought_signature". Google's native API
// carries it in the AI SDK's Google provider; the OpenAI-compatible endpoint carries it in a
// non-standard `extra_content.google` field, which the OpenAI provider drops. So the Gemini column
// wraps its fetch: it remembers the `extra_content` of each tool call it reads, by the call's ID,
// and puts it back on the same call when the conversation is sent again. Nothing else about the
// request or the response changes.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function withThoughtSignatures(base: typeof globalThis.fetch): typeof globalThis.fetch {
  const extras = new Map<string, unknown>();

  return (async (input: string | URL | Request, init?: RequestInit) => {
    let nextInit = init;
    if (typeof init?.body === "string" && extras.size > 0) {
      try {
        const body: unknown = JSON.parse(init.body);
        if (isObject(body) && Array.isArray(body.messages)) {
          for (const message of body.messages) {
            if (!isObject(message) || !Array.isArray(message.tool_calls)) continue;
            for (const call of message.tool_calls) {
              if (!isObject(call) || typeof call.id !== "string") continue;
              if (call.extra_content === undefined && extras.has(call.id)) {
                call.extra_content = extras.get(call.id);
              }
            }
          }
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Not JSON we know: send it as it is.
      }
    }

    const response = await base(input, nextInit);
    if (response.ok && response.headers.get("content-type")?.includes("json")) {
      try {
        const body: unknown = await response.clone().json();
        const choices = isObject(body) && Array.isArray(body.choices) ? body.choices : [];
        for (const choice of choices) {
          const message = isObject(choice) ? choice.message : undefined;
          if (!isObject(message) || !Array.isArray(message.tool_calls)) continue;
          for (const call of message.tool_calls) {
            if (isObject(call) && typeof call.id === "string" && call.extra_content !== undefined) {
              extras.set(call.id, call.extra_content);
            }
          }
        }
      } catch {
        // A body that isn't JSON has no signatures to keep.
      }
    }
    return response;
  }) as typeof globalThis.fetch;
}
