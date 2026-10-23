import { z } from "zod";

// Turns a zod schema into the JSON Schema that structured outputs accept, keeping `enum` and
// `const`. The SDK's own helper (zodOutputFormat) moves both into the field's description, which
// would let the model write a category or a switch feel the catalog doesn't have and only find out
// at validation. The API supports both, so they stay as constraints here. Keywords it doesn't
// support (minimum, maximum and the like) are dropped from the schema and noted in the
// description instead, as the SDK does; the zod schema still enforces them on the way back.

const KEPT = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
  "$defs",
  "$ref",
]);

// What z.number().int() adds on its own. Saying so in a description would only be noise.
const SAFE_INTEGER_BOUNDS = new Map<string, number>([
  ["minimum", Number.MIN_SAFE_INTEGER],
  ["maximum", Number.MAX_SAFE_INTEGER],
]);

export type JsonSchema = { [key: string]: unknown };

export function outputJsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _dropped, ...root } = z.toJSONSchema(schema) as JsonSchema;
  return strict(root);
}

function strict(node: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const notes: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, strict(v)]),
      );
    } else if (key === "items") {
      out.items = strict(value as JsonSchema);
    } else if (key === "anyOf" || key === "oneOf") {
      out.anyOf = (value as JsonSchema[]).map(strict);
    } else if (key === "$defs") {
      out.$defs = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, strict(v)]),
      );
    } else if (KEPT.has(key)) {
      out[key] = value;
    } else if (key === "minItems" && (value === 0 || value === 1)) {
      out[key] = value;
    } else if (SAFE_INTEGER_BOUNDS.get(key) !== value) {
      notes.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  if (notes.length > 0) {
    const note = `{${notes.join(", ")}}`;
    out.description = out.description ? `${out.description}\n\n${note}` : note;
  }
  return out;
}
