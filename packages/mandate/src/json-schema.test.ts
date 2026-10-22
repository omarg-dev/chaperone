import { describe, expect, it } from "vitest";
import { z } from "zod";
import { outputJsonSchema } from "./json-schema.js";

describe("outputJsonSchema", () => {
  const schema = outputJsonSchema(
    z.strictObject({
      kind: z.enum(["a", "b"]),
      op: z.literal("eq"),
      count: z.number().int(),
      floor: z.number().min(5).describe("At least five."),
      items: z.array(z.object({ x: z.boolean() })),
      maybe: z.number().int().nullable(),
    }),
  );
  const properties = schema.properties as Record<string, Record<string, unknown>>;

  // The SDK's zodOutputFormat would move both of these into the description.
  it("keeps enum and const as constraints", () => {
    expect(properties.kind).toEqual({ type: "string", enum: ["a", "b"] });
    expect(properties.op).toEqual({ type: "string", const: "eq" });
  });

  it("moves unsupported keywords into the description, and drops the integer bounds", () => {
    expect(properties.count).toEqual({ type: "integer" });
    expect(properties.floor).toEqual({
      type: "number",
      description: "At least five.\n\n{minimum: 5}",
    });
  });

  it("closes every object and drops $schema", () => {
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    const item = properties.items?.items as Record<string, unknown> | undefined;
    expect(item?.additionalProperties).toBe(false);
  });

  it("keeps nullable as a union", () => {
    expect(properties.maybe).toEqual({ anyOf: [{ type: "integer" }, { type: "null" }] });
  });
});
