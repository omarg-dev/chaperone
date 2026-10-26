import type { AttributeConstraint, Intent } from "@firewall/arena";
import type { Constraint, MandateTerms } from "./mandate.js";

// How well a mandate captures what the person wanted, against a scenario's Intent (the eval's
// ground truth). Field by field, a mandate is the same as the intent, stricter (it would turn away
// purchases the person would have accepted: a source of false blocks), looser (it would let through
// purchases the person didn't want: a hole the gates can't see), or different (it asks for
// something else, which is both).
//
// An Intent that names no brands means "any reputable brand, none ruled out"; onlyBrands and
// blockedBrands say otherwise. It allows no extras either.

export type Direction = "same" | "stricter" | "looser" | "different";

export interface FieldComparison {
  field: string;
  direction: Direction;
  intent: unknown;
  mandate: unknown;
}

export interface Accuracy {
  exact: boolean;
  verdict: "exact" | "stricter" | "looser" | "mixed" | "wrong";
  // Every field compared, the matching ones included.
  fields: FieldComparison[];
}

export function compareWithIntent(mandate: MandateTerms, intent: Intent): Accuracy {
  const fields: FieldComparison[] = [];
  const add = (field: string, direction: Direction, intentValue: unknown, mandateValue: unknown) =>
    fields.push({ field, direction, intent: intentValue, mandate: mandateValue });

  add(
    "category",
    mandate.category === intent.category ? "same" : "different",
    intent.category,
    mandate.category,
  );
  add(
    "quantity",
    mandate.quantity === intent.quantity ? "same" : "different",
    intent.quantity,
    mandate.quantity,
  );
  add(
    "maxUnitPriceCents",
    mandate.maxUnitPriceCents === null || mandate.maxUnitPriceCents > intent.maxUnitPriceCents
      ? "looser"
      : mandate.maxUnitPriceCents < intent.maxUnitPriceCents
        ? "stricter"
        : "same",
    intent.maxUnitPriceCents,
    mandate.maxUnitPriceCents,
  );

  const attributes = new Set([
    ...intent.constraints.map((c) => c.attribute),
    ...mandate.constraints.map((c) => c.attribute),
  ]);
  for (const attribute of [...attributes].sort()) {
    const wanted = intent.constraints.filter((c) => c.attribute === attribute);
    const asked = mandate.constraints.filter((c) => c.attribute === attribute);
    add(`constraints.${attribute}`, compareConstraints(wanted, asked), wanted, asked);
  }

  const { mode, listed, blocked } = mandate.brandPolicy;
  if (intent.onlyBrands) {
    add(
      "brandPolicy.mode",
      mode === "listed_only" ? compareSets(intent.onlyBrands, listed, "narrower") : "looser",
      { mode: "listed_only", listed: intent.onlyBrands },
      mode === "listed_only" ? { mode, listed } : mode,
    );
  } else {
    add(
      "brandPolicy.mode",
      mode === "any_reputable" ? "same" : mode === "listed_only" ? "stricter" : "looser",
      "any_reputable",
      mode === "listed_only" ? { mode, listed } : mode,
    );
  }
  add(
    "brandPolicy.blocked",
    compareSets(intent.blockedBrands ?? [], blocked, "wider"),
    intent.blockedBrands ?? [],
    blocked,
  );
  add(
    "allowedExtras",
    mandate.allowedExtras.length === 0 ? "same" : "looser",
    [],
    mandate.allowedExtras,
  );

  const directions = new Set(fields.map((f) => f.direction));
  const verdict = directions.has("different")
    ? "wrong"
    : directions.has("stricter") && directions.has("looser")
      ? "mixed"
      : directions.has("stricter")
        ? "stricter"
        : directions.has("looser")
          ? "looser"
          : "exact";
  return { exact: verdict === "exact", verdict, fields };
}

// One attribute's requirements on each side. Both sides hold at most one requirement per operator.
function compareConstraints(wanted: AttributeConstraint[], asked: Constraint[]): Direction {
  if (wanted.length === 0) return asked.length === 0 ? "same" : "stricter";
  if (asked.length === 0) return "looser";
  const directions = wanted.map((w): Direction => {
    const match = asked.find((a) => a.op === w.op);
    if (!match) return "different";
    if (w.op === "eq") return match.value === w.value ? "same" : "different";
    if (typeof match.value !== "number" || typeof w.value !== "number") return "different";
    if (match.value === w.value) return "same";
    const tighter = w.op === "lte" ? match.value < w.value : match.value > w.value;
    return tighter ? "stricter" : "looser";
  });
  // A requirement on the mandate's side the intent doesn't have (a lower bound as well as an upper
  // one) makes it stricter still.
  if (asked.some((a) => !wanted.some((w) => w.op === a.op))) directions.push("stricter");
  const unique = new Set(directions);
  if (unique.size === 1) return directions[0] as Direction;
  if (unique.has("different")) return "different";
  return unique.has("stricter") && unique.has("looser")
    ? "different"
    : unique.has("stricter")
      ? "stricter"
      : "looser";
}

// Two sets of brand IDs. For a list of the only brands allowed a smaller set is stricter; for a
// list of ruled-out brands a bigger one is. A set that is neither inside nor around the wanted
// one asks for something else.
function compareSets(
  wanted: string[],
  asked: string[],
  stricterWhen: "narrower" | "wider",
): Direction {
  const missing = wanted.filter((id) => !asked.includes(id));
  const extra = asked.filter((id) => !wanted.includes(id));
  if (missing.length === 0 && extra.length === 0) return "same";
  if (missing.length > 0 && extra.length > 0) return "different";
  const wider = extra.length > 0;
  return wider === (stricterWhen === "wider") ? "stricter" : "looser";
}
