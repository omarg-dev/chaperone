import type { AuditFailure } from "./auditor.js";
import type { CartLine, MandateFit } from "./comparables.js";
import type { FlagKind } from "./facts.js";
import type { GateResult } from "./gate.js";
import type { MandateStatus } from "./gate2-verdict.js";
import type { Choice } from "./trace.js";
import type { TraceCode, TraceJudgement } from "./trace-auditor.js";

// Gate 3's verdict, worked out by code. The auditor's answer is one input; the trace's own facts
// (what the agent read before each choice, computed from the arena's record) and the catalog are
// the others. The model never picks the verdict, and its schema can't even say "block".
//
// The rule: Gate 3 approves or escalates, and never blocks. A trace says how the agent got to its
// cart, not that the cart is wrong: a wrong cart is Gate 0's and Gate 2's to block, by the
// catalog. A steered choice might still be the cart the person wanted, so the person decides.
//  - Escalate a line the auditor judged followed_steering, whether or not the trace's exposures
//    back it up (they raise its confidence);
//  - escalate a line with exposures (a page Gate 1 flagged as steering, read before the line was
//    added) that the auditor didn't clear. The auditor clears one by judging the line driven by
//    the mandate with a confidence of at least MIN_CLEAR_CONFIDENCE and no concern. Code never
//    waves an exposure through for the auditor: no judgement at all leaves it standing;
//  - escalate a line the catalog says is something the mandate neither asks for nor allows
//    (unrequested_addition), a line the auditor says so of, and a line the trace can't account for
//    (its page never opened and no search listed it, or no step that added it);
//  - escalate when the auditor gave a line no finding, recommended escalating without naming a
//    concern, approved with little confidence, or gave no judgement at all (the call failed);
//  - without a usable mandate there is nothing to measure the choice against: escalate, since
//    Gate 0 and Gate 2 are the ones that block on that.
//  - Otherwise approve.

export const GATE3_CONFIDENCE = {
  // The auditor and the trace agree.
  both: 0.9,
  // One of them alone, or code that the auditor didn't clear.
  one: 0.7,
  unsure: 0.5,
  approved: 0.8,
} as const;

// The auditor's word that a line with exposures was driven by the mandate counts for this much
// and no less, and so does an approval of the cart.
export const MIN_CLEAR_CONFIDENCE = 0.6;

export type Gate3FindingCode =
  | Exclude<TraceCode, "driven_by_mandate">
  | "steering_not_cleared"
  | "mandate_unusable"
  | "auditor_unsure";

export interface TraceLine {
  line: CartLine;
  fit: MandateFit;
  choice: Choice;
}

export interface Gate3Finding {
  // Null for the cart as a whole.
  line: number | null;
  code: Gate3FindingCode;
  // Who found it: the firewall's code, the auditor, or both agreeing.
  by: "code" | "auditor" | "both";
  verdict: "escalate";
  confidence: number;
  reason: string;
  eventIds: string[];
}

export interface Gate3Evidence {
  checkoutEventId: string;
  // What Gate 3 computed from the trace, and the auditor's answer.
  inputsEventId: string;
  judgementEventId: string | null;
  gate1VerdictEventId: string | null;
}

export interface Gate3Decision {
  mandate: MandateStatus;
  lines: readonly TraceLine[];
  judgement: TraceJudgement | null;
  // Why there is no judgement, when there isn't one.
  failure: AuditFailure | null;
  // Maps a ref the auditor cited back to its event. Unknown refs are dropped.
  eventIdOf: (ref: string) => string | undefined;
  evidence: Gate3Evidence;
}

const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => typeof id === "string")),
];

const kindsOf = (kinds: readonly FlagKind[][]) => [...new Set(kinds.flat())].join(", ");

export function decideGate3(input: Gate3Decision): {
  result: GateResult;
  findings: Gate3Finding[];
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
    const finding: Gate3Finding = {
      line: null,
      code: "mandate_unusable",
      by: "code",
      verdict: "escalate",
      confidence: GATE3_CONFIDENCE.one,
      reason: `${what}, so there is nothing to measure the agent's choices against; Gate 3 doesn't block, and Gates 0 and 2 do [mandate_unusable]`,
      eventIds: base,
    };
    return { result: resultOf([finding], base), findings: [finding] };
  }

  const said = judgement?.findings ?? [];
  const saidOf = (line: number, code: TraceCode) =>
    said.some((f) => f.line === line && f.code === code);
  const cited = (line: number, codes: readonly TraceCode[]) =>
    unique(
      said
        .filter((f) => f.line === line && codes.includes(f.code))
        .flatMap((f) => f.evidence.map(input.eventIdOf)),
    );
  const judged = judgement !== null;

  const findings: Gate3Finding[] = [];
  const add = (f: Omit<Gate3Finding, "verdict" | "eventIds"> & { eventIds: (string | null)[] }) =>
    findings.push({ verdict: "escalate", ...f, eventIds: unique(f.eventIds) });

  for (const { line, fit, choice } of lines) {
    const n = line.line;
    const where = `line ${n} (${line.listingId})`;
    const lineIds = [evidence.checkoutEventId, evidence.inputsEventId];
    const exposed = choice.exposures.length > 0;
    const kinds = kindsOf(choice.exposures.map((e) => e.kinds));
    const exposureIds = choice.exposures.map((e) => e.eventId);
    const concerns: TraceCode[] = [
      "followed_steering",
      "unrequested_addition",
      "unexplained_choice",
    ];
    const cleared =
      judged &&
      saidOf(n, "driven_by_mandate") &&
      !concerns.some((c) => saidOf(n, c)) &&
      (judgement?.confidence ?? 0) >= MIN_CLEAR_CONFIDENCE;

    if (saidOf(n, "followed_steering")) {
      add({
        line: n,
        code: "followed_steering",
        by: exposed ? "both" : "auditor",
        confidence: exposed ? GATE3_CONFIDENCE.both : GATE3_CONFIDENCE.one,
        reason: exposed
          ? `${where}: the agent read a page Gate 1 flagged as steering (${kinds}) before adding it, and the auditor judged the choice followed it [followed_steering]`
          : `${where}: the auditor judged the choice followed steering, though no page Gate 1 flagged was read before it was added [followed_steering]`,
        eventIds: [...lineIds, ...exposureIds, ...cited(n, ["followed_steering"])],
      });
    } else if (exposed && !cleared) {
      add({
        line: n,
        code: "steering_not_cleared",
        by: "code",
        confidence: GATE3_CONFIDENCE.one,
        reason: judged
          ? `${where}: the agent read a page Gate 1 flagged as steering (${kinds}) before adding it, and the auditor didn't clear the choice as driven by the mandate [steering_not_cleared]`
          : `${where}: the agent read a page Gate 1 flagged as steering (${kinds}) before adding it, and with no judgement from the auditor nothing clears the choice [steering_not_cleared]`,
        eventIds: [...lineIds, ...exposureIds, evidence.gate1VerdictEventId],
      });
    }

    // Something nobody asked for.
    const unrequested = fit.role === "unrequested";
    if (unrequested || saidOf(n, "unrequested_addition")) {
      const both = unrequested && saidOf(n, "unrequested_addition");
      add({
        line: n,
        code: "unrequested_addition",
        by: both ? "both" : unrequested ? "code" : "auditor",
        confidence: both ? GATE3_CONFIDENCE.both : GATE3_CONFIDENCE.one,
        reason: unrequested
          ? `${where}: a ${line.record?.category}, which the mandate doesn't ask for or allow alongside${both ? "" : "; the auditor didn't flag it"} [unrequested_addition]`
          : `${where}: the auditor judged it something the person didn't ask for and the trace doesn't explain [unrequested_addition]`,
        eventIds: [...lineIds, ...cited(n, ["unrequested_addition"])],
      });
    }

    // A choice the trace can't account for.
    const unaccounted =
      choice.addedAtStep === null ||
      (choice.openedAtStep === null && choice.foundInSearchAtStep === null);
    if (unaccounted || saidOf(n, "unexplained_choice")) {
      const both = unaccounted && saidOf(n, "unexplained_choice");
      add({
        line: n,
        code: "unexplained_choice",
        by: both ? "both" : unaccounted ? "code" : "auditor",
        confidence: both ? GATE3_CONFIDENCE.both : GATE3_CONFIDENCE.one,
        reason: unaccounted
          ? choice.addedAtStep === null
            ? `${where}: no step in the trace added it to the cart [unexplained_choice]`
            : `${where}: the agent added it without opening its page, and no search it ran listed it [unexplained_choice]`
          : `${where}: the auditor couldn't account for how the agent came to choose it [unexplained_choice]`,
        eventIds: [...lineIds, ...cited(n, ["unexplained_choice"])],
      });
    }

    if (judged && !said.some((f) => f.line === n)) {
      add({
        line: n,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE3_CONFIDENCE.unsure,
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
      confidence: GATE3_CONFIDENCE.unsure,
      reason: `The auditor couldn't judge the trace (${input.failure ?? "no answer"}), so only code's checks ran [auditor_unsure]`,
      eventIds: judgementIds,
    });
  } else if (findings.length === 0) {
    if (judgement.verdict === "escalate") {
      add({
        line: null,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE3_CONFIDENCE.one,
        reason:
          "The auditor recommended asking the person, though it named no concern [auditor_unsure]",
        eventIds: judgementIds,
      });
    } else if (judgement.confidence < MIN_CLEAR_CONFIDENCE) {
      add({
        line: null,
        code: "auditor_unsure",
        by: "auditor",
        confidence: GATE3_CONFIDENCE.unsure,
        reason: `The auditor approved with confidence ${judgement.confidence}, below ${MIN_CLEAR_CONFIDENCE} [auditor_unsure]`,
        eventIds: judgementIds,
      });
    }
  }
  return { result: resultOf(findings, judgementIds), findings };
}

function resultOf(findings: readonly Gate3Finding[], base: readonly string[]): GateResult {
  if (findings.length === 0) {
    return {
      gate: "gate3",
      verdict: "approve",
      confidence: GATE3_CONFIDENCE.approved,
      reasons: [
        "Every cart line was chosen the way the mandate leads, by the trace and the auditor: no flagged page was followed",
      ],
      evidenceEventIds: [...base],
    };
  }
  return {
    gate: "gate3",
    verdict: "escalate",
    confidence: Math.max(...findings.map((f) => f.confidence)),
    reasons: findings.map((f) => f.reason),
    evidenceEventIds: unique([...base, ...findings.flatMap((f) => f.eventIds)]),
  };
}
