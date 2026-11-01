import {
  type BrandPolicy,
  type Constraint,
  EDITABLE_FIELDS,
  type EditableField,
  type MandateDraft,
  type MandateEdit,
  MandateError,
} from "./mandate.js";
import { attributesByName, findCategory, type Vocabulary } from "./vocabulary.js";

// The draft as the person reads it on the command line, and the person's typed edits turned back
// into mandate fields. Pure, so the terminal and the tests share it.

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const brandName = (vocabulary: Vocabulary, brandId: string) =>
  vocabulary.brands.find((b) => b.brandId === brandId)?.name ?? brandId;

const OP_SYMBOLS = { eq: "=", lte: "<=", gte: ">=" } as const;

export function describeConstraint(c: Constraint, vocabulary: Vocabulary): string {
  const spec = attributesByName(vocabulary).get(c.attribute);
  const unit = spec?.kind === "number" ? ` ${spec.unit}` : "";
  const value = typeof c.value === "boolean" ? (c.value ? "yes" : "no") : String(c.value);
  return `${c.attribute} ${OP_SYMBOLS[c.op]} ${value}${unit}`;
}

export function describeBrands(policy: BrandPolicy, vocabulary: Vocabulary): string {
  const names = (ids: string[]) => ids.map((id) => brandName(vocabulary, id)).join(", ");
  const base =
    policy.mode === "listed_only"
      ? `only ${names(policy.listed)}`
      : policy.mode === "any_reputable"
        ? "any reputable brand"
        : "any brand, reputable or not";
  return policy.blocked.length > 0 ? `${base}, except ${names(policy.blocked)}` : base;
}

// One row per term, labelled for a person rather than by field name. `field` is the editable field
// a row is, or null for a row that is only said (the sellers rule, what the request left out).
export interface DraftRow {
  label: string;
  value: string;
  field: EditableField | null;
}

export function draftRows(draft: MandateDraft, vocabulary: Vocabulary): DraftRow[] {
  const rows: DraftRow[] = [
    { label: "Category", value: draft.category, field: "category" },
    {
      label: "Requirements",
      value:
        draft.constraints.length > 0
          ? draft.constraints.map((c) => describeConstraint(c, vocabulary)).join("; ")
          : "none",
      field: "constraints",
    },
    { label: "Brands", value: describeBrands(draft.brandPolicy, vocabulary), field: "brandPolicy" },
    {
      label: "Price ceiling",
      value:
        draft.maxUnitPriceCents === null
          ? "not set (needed before you can accept)"
          : `${dollars(draft.maxUnitPriceCents)} each`,
      field: "maxUnitPriceCents",
    },
    { label: "Quantity", value: String(draft.quantity), field: "quantity" },
    {
      label: "Extras allowed",
      value: draft.allowedExtras.length > 0 ? draft.allowedExtras.join(", ") : "none",
      field: "allowedExtras",
    },
    { label: "Sellers", value: "verified sellers only", field: null },
    {
      label: "Price tolerance",
      value: `up to ${draft.tolerances.priceVsBestOfferPct}% over the best offer`,
      field: "tolerances",
    },
  ];
  if (draft.unmapped.length > 0) {
    rows.push({
      label: "Not covered",
      value: draft.unmapped.map((u) => `"${u}"`).join(", "),
      field: null,
    });
  }
  return rows;
}

// The draft as the person reads it on the command line.
export function describeDraft(draft: MandateDraft, vocabulary: Vocabulary): string {
  const rows = draftRows(draft, vocabulary);
  const width = Math.max(...rows.map(({ label }) => label.length));
  return [
    `Request: "${draft.requestText}"`,
    ...rows.map(({ label, value }) => `  ${label.padEnd(width)}  ${value}`),
  ].join("\n");
}

// The names a person types for each editable field, and what to type.
export const EDIT_PROMPTS: Record<EditableField, { name: string; hint: string }> = {
  category: { name: "category", hint: "keyboard, headphones or mouse" },
  constraints: {
    name: "requirements",
    hint: 'like "switch_feel=tactile, wireless=yes, weight_g<=70", or "none"',
  },
  brandPolicy: {
    name: "brands",
    hint: '"any reputable", "any", or "only Brightfern, Tidewell", each optionally with "except Yarrowind"',
  },
  maxUnitPriceCents: { name: "price", hint: "the most for one item, like 120 or $119.99" },
  quantity: { name: "quantity", hint: "a whole number" },
  allowedExtras: { name: "extras", hint: 'categories allowed alongside, like "mouse", or "none"' },
  tolerances: { name: "tolerance", hint: "percent over the best offer, like 15" },
};

export function fieldNamed(name: string): EditableField | undefined {
  const typed = name.trim().toLowerCase();
  return EDITABLE_FIELDS.find((f) => EDIT_PROMPTS[f].name === typed || f.toLowerCase() === typed);
}

const fail = (message: string): never => {
  throw new MandateError("Couldn't read that", [message]);
};

const list = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const isNone = (text: string) => ["", "none", "-"].includes(text.trim().toLowerCase());

// Reads what the person typed for a field into an edit. Throws a MandateError saying what it
// couldn't read; whether the edit fits the catalog is checked when it's applied.
export function parseEdit(
  field: EditableField,
  input: string,
  draft: MandateDraft,
  vocabulary: Vocabulary,
): MandateEdit {
  const text = input.trim();
  switch (field) {
    case "category": {
      const entry = findCategory(vocabulary, text.toLowerCase());
      if (!entry) fail(`"${text}" isn't a category`);
      return { field, value: (entry as NonNullable<typeof entry>).category };
    }
    case "constraints":
      return {
        field,
        value: isNone(text) ? [] : list(text).map((c) => parseConstraint(c, vocabulary)),
      };
    case "brandPolicy":
      return { field, value: parseBrands(text, vocabulary) };
    case "maxUnitPriceCents": {
      const amount = Number(text.replace(/^\$/, ""));
      if (!Number.isFinite(amount) || amount <= 0) fail(`"${text}" isn't a price`);
      return { field, value: Math.round(amount * 100) };
    }
    case "quantity": {
      const quantity = Number(text);
      if (!Number.isInteger(quantity) || quantity < 1) fail(`"${text}" isn't a whole number`);
      return { field, value: quantity };
    }
    case "allowedExtras":
      return {
        field,
        value: isNone(text) ? [] : (list(text.toLowerCase()) as MandateDraft["allowedExtras"]),
      };
    case "tolerances": {
      const pct = Number(text.replace(/%$/, ""));
      if (!Number.isFinite(pct)) fail(`"${text}" isn't a percentage`);
      return { field, value: { ...draft.tolerances, priceVsBestOfferPct: pct } };
    }
  }
}

// Reads "attribute op value" using the attribute's kind, so "75" stays a layout name while "70"
// is a weight. Unknown attributes are kept as typed, for applyEdit to name the problem.
function parseConstraint(text: string, vocabulary: Vocabulary): Constraint {
  const match = /^([a-z_0-9]+)\s*(<=|>=|=)\s*(.+)$/i.exec(text);
  if (!match) return fail(`"${text}" isn't a requirement like switch_feel=tactile`);
  const [, name = "", symbol, raw = ""] = match;
  const attribute = name.toLowerCase();
  const op = symbol === "<=" ? "lte" : symbol === ">=" ? "gte" : "eq";
  const word = raw.trim().toLowerCase();
  const spec = attributesByName(vocabulary).get(attribute);
  if (spec?.kind === "boolean") {
    if (["yes", "true"].includes(word)) return { attribute, op, value: true };
    if (["no", "false"].includes(word)) return { attribute, op, value: false };
    return fail(`${attribute} is yes or no, got "${raw.trim()}"`);
  }
  if (spec?.kind === "number") {
    const value = Number(word);
    return Number.isFinite(value) ? { attribute, op, value } : fail(`${attribute} needs a number`);
  }
  return { attribute, op, value: word };
}

function parseBrands(text: string, vocabulary: Vocabulary): BrandPolicy {
  const [main = "", except] = text.split(/\bexcept\b/i);
  const idsOf = (names: string) =>
    list(names).map((name) => {
      const brand = vocabulary.brands.find(
        (b) => b.name.toLowerCase() === name.toLowerCase() || b.brandId === name.toLowerCase(),
      );
      return brand ? brand.brandId : fail(`No brand "${name}" in the catalog`);
    });
  const blocked = except ? idsOf(except) : [];
  const head = main.trim().toLowerCase().replace(/,$/, "").trim();
  if (head === "any reputable" || head === "any reputable brand") {
    return { mode: "any_reputable", listed: [], blocked };
  }
  if (head === "any" || head === "any brand") return { mode: "any", listed: [], blocked };
  if (head.startsWith("only ")) {
    return { mode: "listed_only", listed: idsOf(main.trim().slice(5)), blocked };
  }
  return fail(`"${text}" isn't a brand policy: try "any reputable" or "only Brightfern"`);
}

// What a field's value looks like typed the way `parseEdit` reads it, so an edit form can start from
// the current value. Reading it back gives the same value.
export function editText(
  field: EditableField,
  draft: MandateDraft,
  vocabulary: Vocabulary,
): string {
  const names = (ids: string[]) => ids.map((id) => brandName(vocabulary, id)).join(", ");
  switch (field) {
    case "category":
      return draft.category;
    case "constraints":
      return draft.constraints.length > 0
        ? draft.constraints
            .map((c) => {
              const value =
                typeof c.value === "boolean" ? (c.value ? "yes" : "no") : String(c.value);
              return `${c.attribute}${OP_SYMBOLS[c.op]}${value}`;
            })
            .join(", ")
        : "none";
    case "brandPolicy": {
      const { mode, listed, blocked } = draft.brandPolicy;
      const base =
        mode === "listed_only" ? `only ${names(listed)}` : mode === "any" ? "any" : "any reputable";
      return blocked.length > 0 ? `${base} except ${names(blocked)}` : base;
    }
    case "maxUnitPriceCents":
      return draft.maxUnitPriceCents === null ? "" : (draft.maxUnitPriceCents / 100).toFixed(2);
    case "quantity":
      return String(draft.quantity);
    case "allowedExtras":
      return draft.allowedExtras.length > 0 ? draft.allowedExtras.join(", ") : "none";
    case "tolerances":
      return String(draft.tolerances.priceVsBestOfferPct);
  }
}
