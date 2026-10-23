import { randomBytes } from "node:crypto";
import type { Category } from "@firewall/arena";
import { z } from "zod";
import { canonicalJson, sha256 } from "./canonical.js";
import {
  ATTRIBUTES,
  type AttributeSpec,
  findAttribute,
  findCategory,
  type Vocabulary,
} from "./vocabulary.js";

// A mandate is what the person confirmed they want bought, in the catalog's own terms. Every
// firewall check compares a cart against the locked mandate, never against the agent's memory of
// the request.
//
// How this differs from the shape in the proposal, and why:
//  - camelCase field names, like the arena's Intent, which a mandate is scored against field by
//    field (maxUnitPriceCents there, maxUnitPriceCents here).
//  - Money is in whole cents (maxUnitPriceCents), as everywhere in the arena, never dollars.
//  - required_attributes became `constraints`, a list in the Intent's own shape (attribute, op,
//    value). A plain object could say "switch_feel is tactile" but not "weight_g at most 70".
//  - brand_policy names brands by the catalog's brandId, and has three modes: any_reputable (the
//    catalog's list of established brands), listed_only (just the brands in `listed`) and any.
//  - `unmapped` is new: the parts of the request the vocabulary can't express ("mid-range"),
//    quoted, so the person sees what the mandate leaves out before confirming it.
//  - The draft carries no confirmation fields; confirmedByUser, confirmedAt and hash only exist on
//    a locked mandate, so a draft can't be mistaken for a confirmed one.

export const OPS = ["eq", "lte", "gte"] as const;
export type Op = (typeof OPS)[number];

const CATEGORIES = Object.keys(ATTRIBUTES) as [Category, ...Category[]];
export const categorySchema = z.enum(CATEGORIES);

export const constraintSchema = z.strictObject({
  attribute: z.string().min(1),
  op: z.enum(OPS),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Constraint = z.infer<typeof constraintSchema>;

export const BRAND_MODES = ["any_reputable", "listed_only", "any"] as const;
export const brandPolicySchema = z.strictObject({
  mode: z.enum(BRAND_MODES),
  // The only brands allowed, for listed_only. Empty for the other modes.
  listed: z.array(z.string()),
  // Brands the person ruled out, whatever the mode.
  blocked: z.array(z.string()),
});
export type BrandPolicy = z.infer<typeof brandPolicySchema>;

// What the request asks for: the part the builder writes and the person can edit.
export const termsSchema = z.strictObject({
  category: categorySchema,
  constraints: z.array(constraintSchema),
  brandPolicy: brandPolicySchema,
  // Per item. Null when the request names no budget; a mandate can't be locked without one.
  maxUnitPriceCents: z.number().int().positive().nullable(),
  quantity: z.number().int().positive(),
  // Other categories the person said may be bought alongside. Anything else in the cart escalates.
  allowedExtras: z.array(categorySchema),
  unmapped: z.array(z.string()),
});
export type MandateTerms = z.infer<typeof termsSchema>;

export const DEFAULT_TOLERANCES = { priceVsBestOfferPct: 15 };

export const draftSchema = z.strictObject({
  mandateId: z.string().regex(/^md_[0-9a-z]+$/),
  requestText: z.string().min(1),
  ...termsSchema.shape,
  currency: z.literal("USD"),
  // Only one policy for now: the payee must be on the marketplace's verified-seller list.
  payeePolicy: z.literal("verified_sellers_only"),
  // Slack for vague requests, so a reasonable purchase isn't blocked over a detail: how far above
  // the best offer for the same product a listing's price may be.
  tolerances: z.strictObject({ priceVsBestOfferPct: z.number().min(0).max(100) }),
});
export type MandateDraft = z.infer<typeof draftSchema>;

export const lockedMandateSchema = z.strictObject({
  ...draftSchema.shape,
  maxUnitPriceCents: z.number().int().positive(),
  confirmedByUser: z.literal(true),
  confirmedAt: z.iso.datetime(),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type LockedMandate = z.infer<typeof lockedMandateSchema>;

export function newMandateId(now: Date = new Date()): string {
  return `md_${now.getTime().toString(36)}${randomBytes(4).toString("hex")}`;
}

// What's wrong with a draft's terms against the vocabulary, as sentences a person can act on.
// Empty when it's fine. The zod schemas check the shape; this checks the meaning.
export function termsProblems(terms: MandateTerms, vocabulary: Vocabulary): string[] {
  const problems: string[] = [];
  const category = findCategory(vocabulary, terms.category);
  if (!category) return [`"${terms.category}" isn't a category the arena sells`];

  const seen = new Set<string>();
  for (const c of terms.constraints) {
    const spec = findAttribute(category, c.attribute);
    if (!spec) {
      const names = category.attributes.map((a) => a.name).join(", ");
      problems.push(`${terms.category} has no attribute "${c.attribute}" (it has ${names})`);
      continue;
    }
    const problem = constraintProblem(c, spec);
    if (problem) problems.push(problem);
    const key = `${c.attribute} ${c.op}`;
    if (seen.has(key)) problems.push(`${c.attribute} ${c.op} is required twice`);
    seen.add(key);
  }

  const brandIds = new Set(vocabulary.brands.map((b) => b.brandId));
  const { mode, listed, blocked } = terms.brandPolicy;
  for (const id of [...listed, ...blocked]) {
    if (!brandIds.has(id)) problems.push(`No brand "${id}" in the catalog`);
  }
  if (mode === "listed_only" && listed.length === 0) {
    problems.push("listed_only needs at least one brand in listed");
  }
  if (mode !== "listed_only" && listed.length > 0) {
    problems.push(`listed brands only apply to listed_only, not ${mode}`);
  }
  for (const id of listed) {
    if (blocked.includes(id)) problems.push(`${id} is both listed and blocked`);
  }

  for (const extra of terms.allowedExtras) {
    if (!findCategory(vocabulary, extra)) problems.push(`"${extra}" isn't a category`);
    if (extra === terms.category) problems.push(`${extra} is the main category, not an extra`);
  }
  if (new Set(terms.allowedExtras).size !== terms.allowedExtras.length) {
    problems.push("allowedExtras names a category twice");
  }
  return problems;
}

function constraintProblem(c: Constraint, spec: AttributeSpec): string | null {
  if (spec.kind === "number") {
    if (typeof c.value !== "number" || !Number.isFinite(c.value) || c.value < 0) {
      return `${c.attribute} needs a number of 0 or more, got ${JSON.stringify(c.value)}`;
    }
    return null;
  }
  if (c.op !== "eq") return `${c.attribute} can only be required equal, not ${c.op}`;
  if (spec.kind === "boolean") {
    return typeof c.value === "boolean" ? null : `${c.attribute} is yes or no (true or false)`;
  }
  return typeof c.value === "string" && spec.values.includes(c.value)
    ? null
    : `${c.attribute} is one of ${spec.values.join(", ")}, got ${JSON.stringify(c.value)}`;
}

export class MandateError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(problems.length > 0 ? `${message}: ${problems.join("; ")}` : message);
    this.name = "MandateError";
  }
}

// Parses a draft and checks it against the vocabulary, or throws naming every problem.
export function checkDraft(value: unknown, vocabulary: Vocabulary): MandateDraft {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) {
    throw new MandateError("Not a valid mandate draft", issuesOf(parsed.error));
  }
  const problems = termsProblems(parsed.data, vocabulary);
  if (problems.length > 0) throw new MandateError("The draft doesn't fit the catalog", problems);
  return parsed.data;
}

export const issuesOf = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

// The fields a person can change before confirming. The request text, the ID and the policies the
// firewall sets are not among them.
export const EDITABLE_FIELDS = [
  "category",
  "constraints",
  "brandPolicy",
  "maxUnitPriceCents",
  "quantity",
  "allowedExtras",
  "tolerances",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type MandateEdit = {
  [K in EditableField]: { field: K; value: MandateDraft[K] };
}[EditableField];

export interface AppliedEdit {
  draft: MandateDraft;
  from: unknown;
  to: unknown;
  // Requirements the new category doesn't have, dropped along with a category change.
  dropped: Constraint[];
}

// Applies one edit, returning a new draft. Pure: the old draft is untouched. Throws a MandateError
// naming the problems when the edited draft wouldn't fit the catalog.
export function applyEdit(
  draft: MandateDraft,
  edit: MandateEdit,
  vocabulary: Vocabulary,
): AppliedEdit {
  const next: MandateDraft = { ...draft, [edit.field]: edit.value };
  let dropped: Constraint[] = [];
  if (edit.field === "category" && edit.value !== draft.category) {
    const category = findCategory(vocabulary, edit.value);
    if (category) {
      dropped = draft.constraints.filter((c) => !findAttribute(category, c.attribute));
      next.constraints = draft.constraints.filter((c) => findAttribute(category, c.attribute));
      next.allowedExtras = draft.allowedExtras.filter((e) => e !== edit.value);
    }
  }
  return { draft: checkDraft(next, vocabulary), from: draft[edit.field], to: edit.value, dropped };
}

// Sorted, with duplicates gone, so two mandates that ask for the same thing in a different order
// are the same mandate and hash the same.
function normalized(draft: MandateDraft): MandateDraft {
  const sortedUnique = <T>(values: T[]) => [...new Set(values)].sort();
  return {
    ...draft,
    constraints: [...draft.constraints].sort((a, b) =>
      a.attribute === b.attribute ? a.op.localeCompare(b.op) : a.attribute < b.attribute ? -1 : 1,
    ),
    brandPolicy: {
      mode: draft.brandPolicy.mode,
      listed: sortedUnique(draft.brandPolicy.listed),
      blocked: sortedUnique(draft.brandPolicy.blocked),
    },
    allowedExtras: sortedUnique(draft.allowedExtras),
  };
}

export function hashMandate(mandate: Omit<LockedMandate, "hash">): string {
  const { hash: _ignored, ...rest } = mandate as LockedMandate;
  return `sha256:${sha256(canonicalJson(rest))}`;
}

// Stamps the person's confirmation on a draft and seals it with a hash over its canonical form.
// Pure: the confirmation time is passed in. Throws when the draft can't be locked, most often
// because it has no price ceiling yet.
export function lockMandate(
  draft: MandateDraft,
  options: { vocabulary: Vocabulary; confirmedAt: string },
): LockedMandate {
  const checked = normalized(checkDraft(draft, options.vocabulary));
  if (checked.maxUnitPriceCents === null) {
    throw new MandateError("Can't lock the mandate", [
      "It has no price ceiling yet: set the most to pay for one item first",
    ]);
  }
  const unsealed = {
    ...checked,
    maxUnitPriceCents: checked.maxUnitPriceCents,
    confirmedByUser: true as const,
    confirmedAt: options.confirmedAt,
  };
  return lockedMandateSchema.parse({ ...unsealed, hash: hashMandate(unsealed) });
}

export type Verification =
  | { intact: true; mandate: LockedMandate }
  | { intact: false; problems: string[] };

// Whether a locked mandate is still exactly what the person confirmed: a valid locked mandate
// whose hash matches its contents. Gates call this before trusting one.
export function verifyMandate(value: unknown): Verification {
  const parsed = lockedMandateSchema.safeParse(value);
  if (!parsed.success) return { intact: false, problems: issuesOf(parsed.error) };
  const expected = hashMandate(parsed.data);
  if (expected !== parsed.data.hash) {
    return {
      intact: false,
      problems: [
        `hash mismatch: the mandate says ${parsed.data.hash}, its contents give ${expected}`,
      ],
    };
  }
  return { intact: true, mandate: parsed.data };
}
