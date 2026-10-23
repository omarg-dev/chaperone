import { baseCatalog } from "@firewall/arena";
import { outputJsonSchema } from "@firewall/mandate";
import { describe, expect, it } from "vitest";
import { extractionVocabulary, factsOutputSchema } from "./facts.js";

const vocabulary = extractionVocabulary(baseCatalog);

// Fields whose type is a union: anyOf, or a list of types.
function unionFields(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, item) => n + unionFields(item), 0);
  if (node === null || typeof node !== "object") return 0;
  const record = node as Record<string, unknown>;
  const here = "anyOf" in record || Array.isArray(record.type) ? 1 : 0;
  return here + Object.values(record).reduce((n: number, v) => n + unionFields(v), 0);
}

describe("factsOutputSchema", () => {
  it("asks for exactly the catalog category's attributes, each one required", () => {
    for (const { category, attributes } of vocabulary.categories) {
      const schema = outputJsonSchema(factsOutputSchema(vocabulary, category)) as {
        properties: { attributes: { properties: object; required: string[] } };
      };
      const names = attributes.map((a) => a.name);
      expect(Object.keys(schema.properties.attributes.properties)).toEqual(names);
      expect(schema.properties.attributes.required).toEqual(names);
    }
  });

  // The API refuses more than 16 nullable or union-typed fields, and a grammar much larger than
  // this one (both were hit while building Gate 1). A live call is the only full check; this keeps
  // the count that is checkable well inside the limit.
  it.each([...vocabulary.categories.map((c) => c.category), null])(
    "stays inside the API's limit on union-typed fields for %s",
    (category) => {
      const schema = outputJsonSchema(factsOutputSchema(vocabulary, category));
      expect(unionFields(schema)).toBeLessThanOrEqual(10);
    },
  );
});
