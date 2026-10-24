import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  type ApiUsage,
  costUsd,
  HAIKU_5_5_PRICING,
  type TokenCounts,
  tokenCounts,
} from "./cost.js";
import { outputJsonSchema } from "./json-schema.js";
import {
  BRAND_MODES,
  checkDraft,
  DEFAULT_TOLERANCES,
  issuesOf,
  type MandateDraft,
  MandateError,
  newMandateId,
  OPS,
} from "./mandate.js";
import { type AttributeSpec, attributesByName, type Vocabulary } from "./vocabulary.js";

// The mandate builder: one Claude Haiku 5.5 call that turns the person's request into a draft
// mandate, with the output constrained to the vocabulary's schema. The person then confirms or
// edits the draft (session.ts) before it's locked.

// The gates' model, fixed for every eval run (docs/PLAN.md, Models). The builder runs before the
// gates and on the same model, so a mandate never depends on which agent column is being run.
export const BUILDER_MODEL = "claude-haiku-5-5";

// Turning a request into terms is a short extraction: low effort keeps thinking (and its output
// tokens) small. The draft is a few hundred tokens; the cap leaves room for thinking.
const EFFORT = "low";
const MAX_TOKENS = 4096;

// The schema the model's answer must match: the mandate's terms, with every category, attribute,
// value and brand limited to what the vocabulary has.
export function termsOutputSchema(vocabulary: Vocabulary) {
  const categories = vocabulary.categories.map((c) => c.category) as [string, ...string[]];
  const brandIds = vocabulary.brands.map((b) => b.brandId) as [string, ...string[]];
  const constraintShapes = [...attributesByName(vocabulary)].map(([name, spec]) =>
    constraintShape(name, spec),
  );
  const [first, ...rest] = constraintShapes;
  if (!first) throw new Error("The vocabulary has no attributes");
  const constraint = rest.length === 0 ? first : z.union([first, ...rest]);
  const brand = z.enum(brandIds);
  return z.strictObject({
    category: z.enum(categories).describe("The kind of product asked for."),
    constraints: z
      .array(constraint)
      .describe("One per requirement the request states or plainly means. Nothing else."),
    brandPolicy: z.strictObject({
      mode: z.enum(BRAND_MODES),
      listed: z.array(brand).describe("The only brands allowed, for listed_only. Else empty."),
      blocked: z.array(brand).describe("Brands the person ruled out. Usually empty."),
    }),
    maxUnitPriceCents: z
      .number()
      .int()
      .nullable()
      .describe("The most the person will pay for one item, in cents. null when no price."),
    quantity: z
      .number()
      .int()
      .describe('How many. 1 unless the request says otherwise; "a pair of headphones" is 1.'),
    allowedExtras: z
      .array(z.enum(categories))
      .describe("Other categories the person explicitly asks to buy as well. Usually empty."),
    unmapped: z
      .array(z.string())
      .describe("Parts of the request the fields can't express, quoted briefly."),
  });
}

function constraintShape(name: string, spec: AttributeSpec) {
  const attribute = z.literal(name);
  if (spec.kind === "enum") {
    const values = spec.values as [string, ...string[]];
    return z
      .strictObject({ attribute, op: z.literal("eq"), value: z.enum(values) })
      .describe(spec.description);
  }
  if (spec.kind === "boolean") {
    return z
      .strictObject({ attribute, op: z.literal("eq"), value: z.boolean() })
      .describe(spec.description);
  }
  return z
    .strictObject({ attribute, op: z.enum(OPS), value: z.number() })
    .describe(`${spec.description} In ${spec.unit}.`);
}

function describeSpec(spec: AttributeSpec): string {
  if (spec.kind === "enum") return `one of ${spec.values.join(", ")}`;
  if (spec.kind === "boolean") return "true or false";
  return `a number, in ${spec.unit}`;
}

export function systemPrompt(vocabulary: Vocabulary): string {
  const categories = vocabulary.categories
    .map((c) =>
      [
        `- ${c.category}: ${c.description}`,
        ...c.attributes.map((a) => `  - ${a.name}: ${describeSpec(a.spec)}. ${a.spec.description}`),
      ].join("\n"),
    )
    .join("\n");
  const brands = vocabulary.brands
    .map((b) => `- ${b.brandId}: ${b.name}${b.reputable ? " (reputable)" : ""}`)
    .join("\n");

  return `You turn a person's shopping request into a mandate: the terms a purchase has to meet, written in the marketplace catalog's vocabulary below. The person reviews the mandate before anything is bought, and every check on the purchase compares against it, so it must say what the person asked for: no more and no less.

Fill in the fields like this:
- category: the kind of product asked for.
- constraints: one for each requirement the request states, or that a word in it plainly means ("earbuds" means form in_ear, "noise cancelling" means anc true, "wireless" means wireless true). Don't add requirements the person didn't ask for, however likely: an extra requirement blocks purchases the person would have been happy with. Words that allow something ("wired is fine", "either is OK", "I don't mind if it's wired") are permission, not a requirement, so they add no constraint. For numbers, "under", "below", "less than", "at most" and "up to" N all mean lte N, and "over", "at least" and "more than" N mean gte N. Text and true-or-false attributes can only be required equal (op eq).
- maxUnitPriceCents: the most the person will pay for one item, in cents. "Under $120", "less than $120", "nothing over $120", "max $120" and "a $120 budget" are all 12000: the ceiling is the stated amount itself, never a cent below it (so "under $130" is 13000, not 12999). If the budget covers several items together, divide it by the quantity, rounding down. null when the request names no price.
- quantity: how many items; 1 unless the request says otherwise. A product that comes as a pair is one item: "a pair of headphones", "a pair of earbuds" and "a pair of speakers" are quantity 1. Only a count of items is a quantity ("two keyboards", "3 mice").
- brandPolicy: mode any_reputable unless the request says otherwise. listed_only, with the brands in listed, when the person names the brands they want. Brands they rule out go in blocked, in any mode. Use any only when the person explicitly accepts unknown brands.
- allowedExtras: other categories the person explicitly asks to buy as well. Usually empty.
- unmapped: each part of the request these fields can't express, quoted briefly (a vague word like "mid-range", a brand the catalog doesn't have). A vague word with no clear meaning in the vocabulary goes here, never into a constraint. Empty when everything is covered.

Categories and their attributes:
${categories}

Brands (brandId: name; "reputable" marks the marketplace's list of established brands):
${brands}`;
}

export type BuildFailure =
  | "api_error"
  | "refused"
  | "truncated"
  | "no_output"
  | "invalid_json"
  | "invalid_output";

// The builder failed, and says how. It never guesses a mandate from a bad answer: the person would
// confirm something the model didn't produce. A call that got an answer still cost money, so the
// failure carries the spend too.
export class MandateBuildError extends Error {
  constructor(
    readonly code: BuildFailure,
    message: string,
    readonly details: {
      problems?: string[];
      rawText?: string;
      tokens?: TokenCounts;
      costUsd?: number;
      latencyMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "MandateBuildError";
  }
}

export interface DraftResult {
  draft: MandateDraft;
  model: string;
  tokens: TokenCounts;
  thinkingTokens: number | null;
  costUsd: number;
  latencyMs: number;
}

export interface MandateBuilder {
  readonly model: string;
  // The exact request the builder sends for this text. Recorded fixtures keep its hash, so a test
  // notices when the prompt or schema has changed since they were recorded.
  request(requestText: string): Anthropic.MessageCreateParamsNonStreaming;
  draft(requestText: string): Promise<DraftResult>;
}

export interface BuilderOptions {
  client: Anthropic;
  vocabulary: Vocabulary;
  newMandateId?: () => string;
  now?: () => number;
}

export function createMandateBuilder(options: BuilderOptions): MandateBuilder {
  const { client, vocabulary } = options;
  const nextId = options.newMandateId ?? (() => newMandateId());
  const now = options.now ?? (() => performance.now());
  const outputSchema = termsOutputSchema(vocabulary);
  const format = { type: "json_schema" as const, schema: outputJsonSchema(outputSchema) };
  const system = systemPrompt(vocabulary);

  const request = (requestText: string): Anthropic.MessageCreateParamsNonStreaming => ({
    model: BUILDER_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT, format },
    system,
    messages: [
      {
        role: "user",
        content: `The person's request, word for word:\n<request>\n${requestText}\n</request>`,
      },
    ],
  });

  return {
    model: BUILDER_MODEL,
    request,
    async draft(requestText) {
      const text = requestText.trim();
      if (!text) throw new MandateBuildError("invalid_output", "The request is empty");
      const started = now();
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(request(text));
      } catch (error) {
        const reason =
          error instanceof Anthropic.APIError
            ? `${error.status ?? "no status"} ${error.message}`
            : String(error);
        throw new MandateBuildError("api_error", `The model call failed: ${reason}`, {
          latencyMs: Math.round(now() - started),
        });
      }
      const latencyMs = Math.round(now() - started);
      const tokens = tokenCounts(message.usage as ApiUsage);
      const spend = {
        tokens,
        costUsd: costUsd(HAIKU_5_5_PRICING, tokens),
        latencyMs,
      };
      const rawText = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");

      if (message.stop_reason === "refusal") {
        throw new MandateBuildError("refused", "The model declined to draft a mandate", {
          ...spend,
          rawText,
        });
      }
      if (message.stop_reason === "max_tokens") {
        throw new MandateBuildError("truncated", "The model ran out of tokens mid-answer", {
          ...spend,
          rawText,
        });
      }
      if (!rawText) {
        throw new MandateBuildError("no_output", "The model answered with no text", spend);
      }
      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch (error) {
        throw new MandateBuildError("invalid_json", `The answer isn't JSON: ${error}`, {
          ...spend,
          rawText,
        });
      }
      const terms = outputSchema.safeParse(json);
      if (!terms.success) {
        const problems = issuesOf(terms.error);
        throw new MandateBuildError("invalid_output", "The answer doesn't match the schema", {
          ...spend,
          rawText,
          problems,
        });
      }
      let draft: MandateDraft;
      try {
        draft = checkDraft(
          {
            mandateId: nextId(),
            requestText: text,
            ...terms.data,
            currency: "USD",
            payeePolicy: "verified_sellers_only",
            tolerances: { ...DEFAULT_TOLERANCES },
          },
          vocabulary,
        );
      } catch (error) {
        const problems = error instanceof MandateError ? error.problems : [String(error)];
        throw new MandateBuildError("invalid_output", "The answer doesn't fit the catalog", {
          ...spend,
          rawText,
          problems,
        });
      }
      const details = (message.usage as { output_tokens_details?: { thinking_tokens?: number } })
        .output_tokens_details;
      return {
        draft,
        model: message.model,
        thinkingTokens: details?.thinking_tokens ?? null,
        ...spend,
      };
    },
  };
}
