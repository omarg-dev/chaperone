import type { AuditFailure, Judgement, ReasonCode } from "./auditor.js";
import type { CartLine, Comparables, ConstraintFailure, MandateFit } from "./comparables.js";
import type { FlagKind } from "./facts.js";
import type { GateResult, Verdict } from "./gate.js";
import type { MarketCheck } from "./market.js";

// Gate 2's verdict, worked out by code. The auditor's answer is one input; the catalog, the price
// numbers and Gate 1's flags are the others. The model never picks the verdict.
//
// The rule:
//  - No locked mandate, or one altered since the person confirmed it: block. There is nothing the
//    cart can be checked against, and nothing the person agreed to.
//  - Block only when the auditor judged a line the wrong product (or missing a requirement) AND
//    the catalog agrees: a requested-category line fails one of the mandate's constraints, or the
//    cart holds nothing of the requested category at all. Two independent checks agreeing on a
//    plain mismatch is the one case that needs no person.
//  - Everything else that is a concern escalates:
//    - a price beyond the mandate's tolerance above the best like-for-like offer: the same
//      specification from a verified seller of an allowed brand. Code computes it, so it escalates
//      whatever the auditor said, and price alone never blocks: a dear purchase can still be the
//      one wanted;
//    - a cart line whose page Gate 1 flagged as steering the purchase, even when the line matches
//      the mandate on paper: that is exactly what a successful steer looks like;
//    - a concern only the auditor raised (a brand, an unrequested item, a mismatch the catalog
//      doesn't confirm, a recommendation to block or escalate), since a model's reading can be
//      wrong either way and the person can tell;
//    - the auditor and the catalog disagreeing: the auditor called a line fine that the catalog
//      says fails a constraint, is unrequested, or is of a brand the mandate doesn't allow. These
//      are Gate 0's rules, and Gate 0 acts on them; here they only show the judgement is unsound;
//    - a line the auditor gave no finding for, an approval it was unsure of, or no judgement at
//      all (the call failed).
//  - Otherwise approve.
//
// The real-market reference is a note, never a finding (decided Nov 7): a category search's median
// isn't like-for-like, so it can't say a price is wrong. Each line's quote is noted on the result,
// and a line it couldn't price is noted too.

// Confidence, from 0 to 1, by what a finding rests on: a comparison code made (alone or agreeing
// with the auditor), the auditor's judgement alone, or less than that.
export const GATE2_CONFIDENCE = {
  checkedByCode: 1,
  auditorOnly: 0.7,
  unsure: 0.5,
  approved: 0.8,
} as const;

// Below this, the auditor's approval counts as unsure.
export const MIN_APPROVE_CONFIDENCE = 0.6;

export type MandateStatus =
  | { status: "intact"; eventId: string }
  | { status: "missing"; problems: string[] }
  | { status: "altered"; eventId: string; problems: string[] };

export interface SteeringFlag {
  kind: FlagKind;
  sourceEventId: string | null;
}

export interface LineReview {
  line: CartLine;
  fit: MandateFit;
  comparables: Comparables | null;
  market: MarketCheck | null;
  // Gate 1's steering flags on this line's own listing.
  steering: SteeringFlag[];
}

export type FindingCode = ReasonCode | "mandate_unusable" | "not_in_catalog" | "auditor_unsure";

export interface Gate2Finding {
  // Null for the cart as a whole.
  line: number | null;
  code: FindingCode;
  // Who found it: the firewall's code, the auditor, or both agreeing.
  by: "code" | "auditor" | "both";
  verdict: Exclude<Verdict, "approve">;
  confidence: number;
  reason: string;
  eventIds: string[];
}

export interface Gate2Evidence {
  checkoutEventId: string;
  // What Gate 2 computed (comparables, price checks), its market lookups and the auditor's answer.
  inputsEventId: string;
  marketEventId: string | null;
  judgementEventId: string | null;
  gate1VerdictEventId: string | null;
}

export interface Gate2Decision {
  mandate: MandateStatus;
  lines: readonly LineReview[];
  judgement: Judgement | null;
  // Why there is no judgement, when there isn't one.
  failure: AuditFailure | null;
  // Maps a ref the auditor cited back to its event. Unknown refs are dropped.
  eventIdOf: (ref: string) => string | undefined;
  evidence: Gate2Evidence;
}

const MISMATCH_CODES: ReasonCode[] = ["wrong_product", "attribute_mismatch"];

const describeFailure = (f: ConstraintFailure) =>
  f.actual === null
    ? `it has no ${f.attribute}, which the mandate requires`
    : `its ${f.attribute} is ${f.actual}, where the mandate requires ${f.op === "eq" ? "" : `${f.op} `}${f.value}`;

const cents = (n: number) => `${n} cents`;
const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => typeof id === "string")),
];

export function decideGate2(input: Gate2Decision): {
  result: GateResult;
  findings: Gate2Finding[];
} {
  const { mandate, lines, judgement, evidence } = input;
  const base = unique([
    evidence.checkoutEventId,
    mandate.status === "missing" ? null : mandate.eventId,
    evidence.inputsEventId,
  ]);

  if (mandate.status !== "intact") {
    const what =
      mandate.status === "missing"
        ? "The run has no locked mandate"
        : "The run's mandate was altered after the person confirmed it";
    const finding: Gate2Finding = {
      line: null,
      code: "mandate_unusable",
      by: "code",
      verdict: "block",
      confidence: GATE2_CONFIDENCE.checkedByCode,
      reason: `${what}${mandate.problems.length > 0 ? ` (${mandate.problems.join("; ")})` : ""}, so there is nothing the person agreed to that the cart could match [mandate_unusable]`,
      eventIds: base,
    };
    return { result: resultOf("block", [finding], [], base), findings: [finding] };
  }

  const said = judgement?.findings ?? [];
  const cited = (line: number, codes: readonly ReasonCode[]) =>
    unique(
      said
        .filter((f) => f.line === line && codes.includes(f.code))
        .flatMap((f) => f.evidence.map(input.eventIdOf)),
    );
  const saidOf = (line: number, code: ReasonCode) =>
    said.some((f) => f.line === line && f.code === code);
  const hasRequestedLine = lines.some((l) => l.fit.role === "requested");
  const judged = judgement !== null;

  const findings: Gate2Finding[] = [];
  const add = (f: Omit<Gate2Finding, "verdict"> & { verdict?: Gate2Finding["verdict"] }) =>
    findings.push({ verdict: "escalate", ...f, eventIds: unique(f.eventIds) });

  for (const review of lines) {
    const { line, fit, comparables } = review;
    const n = line.line;
    const where = `line ${n} (${line.listingId})`;
    const lineIds = [evidence.checkoutEventId, evidence.inputsEventId];

    if (fit.role === "unknown") {
      add({
        line: n,
        code: "not_in_catalog",
        by: "code",
        confidence: GATE2_CONFIDENCE.checkedByCode,
        reason: `${where}: the catalog has no such listing, so nothing about it can be checked [not_in_catalog]`,
        eventIds: lineIds,
      });
    }

    // Is it what the mandate asks for?
    const failures = fit.failedConstraints;
    const catalogMismatch =
      (fit.role === "requested" && failures.length > 0) ||
      (fit.role === "unrequested" && !hasRequestedLine);
    const auditorMismatch = MISMATCH_CODES.filter((c) => saidOf(n, c));
    const mismatchText =
      failures.length > 0
        ? failures.map(describeFailure).join("; ")
        : `it is ${line.record?.category ?? "something else"}, and the cart holds nothing of the category the mandate asks for`;
    const catalogCode: ReasonCode = failures.length > 0 ? "attribute_mismatch" : "wrong_product";
    if (catalogMismatch && auditorMismatch.length > 0) {
      add({
        line: n,
        code: auditorMismatch[0] as ReasonCode,
        by: "both",
        verdict: "block",
        confidence: GATE2_CONFIDENCE.checkedByCode,
        reason: `${where}: not what the mandate asks for. The catalog says ${mismatchText}, and the auditor judged it ${auditorMismatch.join(" and ")} [${auditorMismatch[0]}]`,
        eventIds: [...lineIds, ...cited(n, MISMATCH_CODES)],
      });
    } else if (catalogMismatch) {
      add({
        line: n,
        code: catalogCode,
        by: "code",
        confidence: GATE2_CONFIDENCE.checkedByCode,
        reason: judged
          ? `${where}: the catalog says ${mismatchText}, but the auditor didn't judge it a mismatch, so its judgement can't be relied on [${catalogCode}]`
          : `${where}: the catalog says ${mismatchText}; with no judgement from the auditor, Gate 2 doesn't block on that alone [${catalogCode}]`,
        eventIds: lineIds,
      });
    } else if (auditorMismatch.length > 0) {
      add({
        line: n,
        code: auditorMismatch[0] as ReasonCode,
        by: "auditor",
        confidence: GATE2_CONFIDENCE.auditorOnly,
        reason: `${where}: the auditor judged it ${auditorMismatch.join(" and ")}; the catalog doesn't confirm that [${auditorMismatch[0]}]`,
        eventIds: [...lineIds, ...cited(n, MISMATCH_CODES)],
      });
    }

    // Something nobody asked for, alongside what was asked for.
    const unrequested = fit.role === "unrequested" && hasRequestedLine;
    if (unrequested || saidOf(n, "unrequested_item")) {
      const both = unrequested && saidOf(n, "unrequested_item");
      add({
        line: n,
        code: "unrequested_item",
        by: both ? "both" : unrequested ? "code" : "auditor",
        confidence: unrequested ? GATE2_CONFIDENCE.checkedByCode : GATE2_CONFIDENCE.auditorOnly,
        reason: unrequested
          ? `${where}: a ${line.record?.category}, which the mandate doesn't ask for or allow alongside${both ? "" : "; the auditor didn't flag it"} [unrequested_item]`
          : `${where}: the auditor judged it something the person didn't ask for [unrequested_item]`,
        eventIds: [...lineIds, ...cited(n, ["unrequested_item"])],
      });
    }

    // The brand.
    const brandRuledOut = fit.brandAllowed === false;
    if (brandRuledOut || saidOf(n, "brand_concern")) {
      const both = brandRuledOut && saidOf(n, "brand_concern");
      add({
        line: n,
        code: "brand_concern",
        by: both ? "both" : brandRuledOut ? "code" : "auditor",
        confidence: brandRuledOut ? GATE2_CONFIDENCE.checkedByCode : GATE2_CONFIDENCE.auditorOnly,
        reason: brandRuledOut
          ? `${where}: its brand (${line.record?.brandId}) is not one the mandate's brand policy allows${both ? "" : "; the auditor didn't flag it"} [brand_concern]`
          : `${where}: the auditor raised a concern about the brand [brand_concern]`,
        eventIds: [...lineIds, ...cited(n, ["brand_concern"])],
      });
    }

    // The price against like-for-like offers in the marketplace.
    if (comparables?.beyondTolerance && comparables.best) {
      add({
        line: n,
        code: "overpriced_vs_comparables",
        by: saidOf(n, "overpriced_vs_comparables") ? "both" : "code",
        confidence: GATE2_CONFIDENCE.checkedByCode,
        reason: `${where}: ${cents(line.paidUnitCents)} a unit is ${comparables.pctAboveBest}% above the best like-for-like offer (${cents(comparables.best.priceCents)}, ${comparables.best.listingId}); the mandate allows ${comparables.tolerancePct}% [overpriced_vs_comparables]`,
        eventIds: [...lineIds, ...cited(n, ["overpriced_vs_comparables"])],
      });
    } else if (saidOf(n, "overpriced_vs_comparables")) {
      add({
        line: n,
        code: "overpriced_vs_comparables",
        by: "auditor",
        confidence: GATE2_CONFIDENCE.auditorOnly,
        reason: `${where}: the auditor judged it overpriced against comparable offers, though it is within the mandate's tolerance of the best like-for-like one [overpriced_vs_comparables]`,
        eventIds: [...lineIds, ...cited(n, ["overpriced_vs_comparables"])],
      });
    }

    // Steered by what a seller wrote.
    if (review.steering.length > 0 || saidOf(n, "steered_by_seller_content")) {
      const flagged = review.steering.length > 0;
      const kinds = [...new Set(review.steering.map((f) => f.kind))].join(", ");
      add({
        line: n,
        code: "steered_by_seller_content",
        by: flagged ? (saidOf(n, "steered_by_seller_content") ? "both" : "code") : "auditor",
        confidence: flagged ? GATE2_CONFIDENCE.checkedByCode : GATE2_CONFIDENCE.auditorOnly,
        reason: flagged
          ? `${where}: Gate 1 flagged its page as trying to steer the purchase (${kinds}), so matching the mandate on paper isn't enough [steered_by_seller_content]`
          : `${where}: the auditor judged it steered toward by content on a page the agent read [steered_by_seller_content]`,
        eventIds: unique([
          ...lineIds,
          evidence.gate1VerdictEventId,
          ...review.steering.map((f) => f.sourceEventId),
          ...cited(n, ["steered_by_seller_content"]),
        ]),
      });
    }

    if (judged && !said.some((f) => f.line === n)) {
      add({
        line: n,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE2_CONFIDENCE.unsure,
        reason: `${where}: the auditor gave no finding for it [auditor_unsure]`,
        eventIds: lineIds,
      });
    }
  }

  // The cart as a whole.
  const judgementIds = unique([evidence.judgementEventId, ...base]);
  if (!judgement) {
    add({
      line: null,
      code: "auditor_unsure",
      by: "code",
      confidence: GATE2_CONFIDENCE.unsure,
      reason: `The auditor couldn't judge the cart (${input.failure ?? "no answer"}), so only code's checks ran [auditor_unsure]`,
      eventIds: judgementIds,
    });
  } else {
    const blocks = findings.some((f) => f.verdict === "block");
    if (judgement.verdict === "block" && !blocks) {
      add({
        line: null,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE2_CONFIDENCE.auditorOnly,
        reason:
          "The auditor recommended blocking, but the catalog doesn't confirm a clear mismatch with the mandate, so the person decides [auditor_unsure]",
        eventIds: judgementIds,
      });
    } else if (judgement.verdict === "escalate" && findings.length === 0) {
      add({
        line: null,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE2_CONFIDENCE.auditorOnly,
        reason:
          "The auditor recommended asking the person, though it named no concern [auditor_unsure]",
        eventIds: judgementIds,
      });
    } else if (
      judgement.verdict === "approve" &&
      judgement.confidence < MIN_APPROVE_CONFIDENCE &&
      findings.length === 0
    ) {
      add({
        line: null,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE2_CONFIDENCE.unsure,
        reason: `The auditor approved with confidence ${judgement.confidence}, below ${MIN_APPROVE_CONFIDENCE} [auditor_unsure]`,
        eventIds: judgementIds,
      });
    }
  }

  // The market reference, as notes: each line's quote, and one note per reason it couldn't answer.
  const priced = lines.flatMap((l) => {
    const quote = l.market?.quote;
    if (quote?.status !== "available") return [];
    const above = l.market?.pctAboveMedian;
    const where =
      above === null || above === undefined
        ? ""
        : `; this line is ${above < 0 ? `${-above}% below` : `${above}% above`} the median`;
    return [
      `Noted, not escalated: line ${l.line.line} (${l.line.listingId}): the real market sells this kind of product for ${cents(quote.lowCents)} to ${cents(quote.highCents)}, median ${cents(quote.medianCents)} over ${quote.pricedProducts} products (${quote.source})${where}`,
    ];
  });
  const missing = new Map<string, number[]>();
  for (const l of lines) {
    const quote = l.market?.quote;
    if (quote?.status !== "unavailable") continue;
    const key = `${quote.source}: ${quote.reason}`;
    missing.set(key, [...(missing.get(key) ?? []), l.line.line]);
  }
  const notes = [
    ...priced,
    ...[...missing].map(([why, numbers]) => {
      const which = numbers.length === 1 ? `line ${numbers[0]}` : `lines ${numbers.join(", ")}`;
      return `Noted: no real-market price for ${which} (${why})`;
    }),
  ];
  const verdict: Verdict = findings.some((f) => f.verdict === "block")
    ? "block"
    : findings.length > 0
      ? "escalate"
      : "approve";
  const noteIds = unique([...judgementIds, priced.length > 0 ? evidence.marketEventId : null]);
  return { result: resultOf(verdict, findings, notes, noteIds), findings };
}

function resultOf(
  verdict: Verdict,
  findings: readonly Gate2Finding[],
  notes: readonly string[],
  base: readonly string[],
): GateResult {
  if (verdict === "approve") {
    return {
      gate: "gate2",
      verdict,
      confidence: GATE2_CONFIDENCE.approved,
      reasons: [
        "Every line is what the mandate asks for, by the catalog and the auditor, and fairly priced against like-for-like offers",
        ...notes,
      ],
      evidenceEventIds: [...base],
    };
  }
  const acting = findings.filter((f) => f.verdict === verdict);
  const others = findings.filter((f) => f.verdict !== verdict);
  return {
    gate: "gate2",
    verdict,
    confidence: Math.max(...acting.map((f) => f.confidence)),
    reasons: [...acting, ...others].map((f) => f.reason).concat(notes),
    evidenceEventIds: unique([...base, ...findings.flatMap((f) => f.eventIds)]),
  };
}
