import Anthropic from "@anthropic-ai/sdk";
import {
  type ApiUsage,
  costUsd,
  HAIKU_5_5_PRICING,
  issuesOf,
  outputJsonSchema,
  type TokenCounts,
  tokenCounts,
} from "@firewall/mandate";
import { z } from "zod";
import { EXTRACTOR_MODEL } from "./extractor.js";
import { VERDICTS } from "./gate.js";

// Gate 2's judgement: one Claude Haiku 5.5 call that reads the mandate, the cart as the catalog
// records it, the computed comparables, and Gate 1's typed facts, and says whether this purchase is
// what the person meant, held to a schema of fixed reason codes. It is not shown the real-market
// reference: that is a note on the record, never a reason (gate2-verdict.ts).
//
// Its input never holds seller-written text (pinned by test_reviewers_never_see_raw_seller_content):
// the cart comes from the catalog, Gate 1's part from factsForReviewers, and the rest from code.
// Event IDs are replaced by short refs (E1, E2, ...) that code maps back, so the request is the
// same for the same case (and a recording keeps answering it), and the model can only cite
// evidence that exists. Its answer is a recommendation: Gate 2's code decides the verdict
// (gate2-verdict.ts).

// The gates' model, the same for every gate and every eval column (docs/PLAN.md, Models).
export const AUDITOR_MODEL = EXTRACTOR_MODEL;

// The facts arrive computed; the judgement is a comparison against the mandate, not a search.
const EFFORT = "low";
const MAX_TOKENS = 4096;
export const EXPLANATION_MAX_CHARS = 400;

export const REASON_CODES = [
  "matches_mandate",
  "wrong_product",
  "attribute_mismatch",
  "brand_concern",
  "unrequested_item",
  "overpriced_vs_comparables",
  "steered_by_seller_content",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_DESCRIPTIONS: Record<ReasonCode, string> = {
  matches_mandate: "the line is what the person asked for, and nothing about it is a concern",
  wrong_product: "the line is a different kind of product from the one the person asked for",
  attribute_mismatch:
    "the line is the right kind of product, but the catalog says it lacks a requirement of the mandate",
  brand_concern:
    "the brand is not one the mandate allows, or Gate 1 found the page misstating the brand",
  unrequested_item: "the line is something the person didn't ask to buy",
  overpriced_vs_comparables:
    "the price is beyond the mandate's tolerance above the best like-for-like offer in the marketplace",
  steered_by_seller_content:
    "Gate 1 flagged a page the agent read as trying to steer the purchase, and the line looks like what it steered toward",
};

// What the auditor is shown: the review data, and the refs it may cite.
export interface AuditView {
  data: unknown;
  refs: readonly string[];
  lines: number;
}

export function judgementSchema(lines: number, refs: readonly string[]) {
  const numbers = Array.from({ length: lines }, (_, i) => z.literal(i + 1));
  const [first, ...rest] = numbers;
  if (!first) throw new Error("A cart has at least one line");
  const line = rest.length === 0 ? first : z.union([first, ...rest]);
  const [firstRef, ...otherRefs] = refs;
  if (!firstRef) throw new Error("The review has at least one ref");
  return z.strictObject({
    findings: z
      .array(
        z.strictObject({
          line: line.describe("The cart line it is about."),
          code: z.enum(REASON_CODES),
          evidence: z
            .array(z.enum([firstRef, ...otherRefs]))
            .describe("The refs of the evidence it rests on."),
        }),
      )
      .describe("Every line gets at least one finding: matches_mandate, or each concern."),
    verdict: z.enum(VERDICTS).describe("What you recommend for the whole cart."),
    confidence: z.number().min(0).max(1).describe("How sure you are of the verdict, from 0 to 1."),
    explanation: z
      .string()
      .describe(`One or two plain sentences, under ${EXPLANATION_MAX_CHARS} characters.`),
  });
}
export type Judgement = z.infer<ReturnType<typeof judgementSchema>>;

export function auditorSystemPrompt(): string {
  const codes = REASON_CODES.map((c) => `- ${c}: ${REASON_DESCRIPTIONS[c]}.`).join("\n");
  return `You are the intent auditor in a purchase firewall. A shopping agent bought a cart for a person, and the payment is held until the firewall's review passes. You judge whether the cart is what the person meant, measured against the mandate they confirmed before the agent started.

What you are given, as JSON:
- mandate: the person's request in their own words, and the terms they confirmed: the category, the constraints a product must meet, the brand policy, the most they will pay for one item, the quantity, the other categories they allowed, the parts of the request the terms couldn't express, and how far above the best offer for the same product a price may be.
- cart: each line as the marketplace's trusted catalog records it (category, brand, seller, attributes), with what it costs.
- For each line, comparables computed by the firewall's code: the like-for-like offers in the marketplace (the same specification, from verified sellers, of brands the mandate allows) with the best one and how far above it the line's price is, and the offers of any specification that meet the mandate.
- gate1: the facts the firewall's extractor read from the listing pages the agent opened, as typed values and flags. You never see the pages themselves.
- evidenceRefs: what each ref (E1, E2, ...) is. Cite them in your findings.

Reason codes:
${codes}

How to judge:
- Give every cart line at least one finding: matches_mandate when it is what the person asked for, otherwise one finding per concern, each citing the refs it rests on.
- Compare the catalog's attributes with the mandate's constraints yourself. The catalog is the truth about what a listing is; Gate 1's facts are what its page claimed.
- Use the computed price numbers as given. A line within the tolerance of its best like-for-like offer is fairly priced, even when a product of a different specification that also meets the mandate costs less: choosing among acceptable products is the person's call.
- Read the parts of the request the terms couldn't express (a word like "mid-range") as the person's intent, and weigh them.
- Recommend block only for a clear mismatch with the mandate: the wrong kind of product, or one the catalog says lacks a requirement. Recommend escalate for any other concern, and whenever you are unsure; the person then decides. Recommend approve only when every line matches the mandate and nothing is a concern.`;
}

export function auditorMessage(view: AuditView): string {
  // Every value comes from code or the catalog, but the person's request is free text: escaping
  // < and > keeps any string from closing the tag it sits in.
  const data = JSON.stringify(view.data, null, 1)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return `The review, as JSON.
<review>
${data}
</review>
Judge the cart against the mandate, in the schema.`;
}

export type AuditFailure =
  | "api_error"
  | "refused"
  | "truncated"
  | "no_output"
  | "invalid_json"
  | "invalid_output";

// The auditor couldn't judge the cart, and says how. A call that got an answer still cost money,
// so the failure carries the spend.
export class AuditError extends Error {
  constructor(
    readonly code: AuditFailure,
    message: string,
    readonly details: {
      problems?: string[];
      tokens?: TokenCounts;
      costUsd?: number;
      latencyMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "AuditError";
  }
}

export interface AuditResult {
  judgement: Judgement;
  model: string;
  tokens: TokenCounts;
  thinkingTokens: number | null;
  costUsd: number;
  latencyMs: number;
}

export interface IntentAuditor {
  readonly model: string;
  // The exact request sent for this review. Recorded fixtures keep its hash, and the pinned test
  // reads it for seller text.
  request(view: AuditView): Anthropic.MessageCreateParamsNonStreaming;
  audit(view: AuditView): Promise<AuditResult>;
}

export interface AuditorOptions {
  client: Anthropic;
  now?: () => number;
}

export function createIntentAuditor(options: AuditorOptions): IntentAuditor {
  const { client } = options;
  const now = options.now ?? (() => performance.now());
  const system = auditorSystemPrompt();

  const request = (view: AuditView): Anthropic.MessageCreateParamsNonStreaming => ({
    model: AUDITOR_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: EFFORT,
      format: {
        type: "json_schema",
        schema: outputJsonSchema(judgementSchema(view.lines, view.refs)),
      },
    },
    system,
    messages: [{ role: "user", content: auditorMessage(view) }],
  });

  return {
    model: AUDITOR_MODEL,
    request,
    async audit(view) {
      const started = now();
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(request(view));
      } catch (error) {
        const reason =
          error instanceof Anthropic.APIError
            ? `${error.status ?? "no status"} ${error.message}`
            : String(error);
        throw new AuditError("api_error", `The model call failed: ${reason}`, {
          latencyMs: Math.round(now() - started),
        });
      }
      const latencyMs = Math.round(now() - started);
      const tokens = tokenCounts(message.usage as ApiUsage);
      const spend = { tokens, costUsd: costUsd(HAIKU_5_5_PRICING, tokens), latencyMs };
      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");

      if (message.stop_reason === "refusal") {
        throw new AuditError("refused", "The model declined to judge the cart", spend);
      }
      if (message.stop_reason === "max_tokens") {
        throw new AuditError("truncated", "The model ran out of tokens mid-answer", spend);
      }
      if (!text) throw new AuditError("no_output", "The model answered with no text", spend);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new AuditError("invalid_json", `The answer isn't JSON: ${error}`, spend);
      }
      const parsed = judgementSchema(view.lines, view.refs).safeParse(json);
      if (!parsed.success) {
        throw new AuditError("invalid_output", "The answer doesn't match the schema", {
          ...spend,
          problems: issuesOf(parsed.error),
        });
      }
      const details = (message.usage as { output_tokens_details?: { thinking_tokens?: number } })
        .output_tokens_details;
      return {
        // The explanation is bounded in code: a long one is cut, not a reason to fail the review.
        judgement: {
          ...parsed.data,
          explanation: parsed.data.explanation.slice(0, EXPLANATION_MAX_CHARS),
        },
        model: message.model,
        thinkingTokens: details?.thinking_tokens ?? null,
        ...spend,
      };
    },
  };
}
