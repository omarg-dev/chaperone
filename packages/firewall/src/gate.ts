// What every gate in the review tree returns, and how their verdicts combine.
//
// The tree runs Gate 0 (deterministic policy), Gate 1 (the quarantined extractor), Gate 2 (the
// intent auditor) and Gate 3 (the trace auditor). A hard block ends the review early; otherwise the
// final verdict is the most severe one: any block blocks, any escalation escalates, and only a
// clean sweep approves.

export const GATES = ["gate0", "gate1", "gate2", "gate3"] as const;
export type GateName = (typeof GATES)[number];

export const VERDICTS = ["approve", "escalate", "block"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface GateResult {
  gate: GateName;
  verdict: Verdict;
  // How far the verdict can be relied on, from 0 to 1. Each gate says what its numbers mean.
  confidence: number;
  // Written by the gate's own code, for a person and for the gates after it. A reason never carries
  // seller-written text: a later gate reads these, and quoting a page here would hand it the very
  // text Gate 1 exists to keep away from it.
  reasons: string[];
  // The events the verdict rests on, so the review tree can point at them.
  evidenceEventIds: string[];
}

const SEVERITY: Record<Verdict, number> = { approve: 0, escalate: 1, block: 2 };

// The review tree's verdict from the gates that ran.
export function combineVerdicts(results: readonly Pick<GateResult, "verdict">[]): Verdict {
  return results.reduce<Verdict>(
    (worst, r) => (SEVERITY[r.verdict] > SEVERITY[worst] ? r.verdict : worst),
    "approve",
  );
}

// A hard block ends the review: no later gate needs to run.
export const endsReview = (result: Pick<GateResult, "verdict">): boolean =>
  result.verdict === "block";
