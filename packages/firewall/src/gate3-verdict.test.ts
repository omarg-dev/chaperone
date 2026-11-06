import { describe, expect, it } from "vitest";
import type { CartLine } from "./comparables.js";
import {
  decideGate3,
  type Gate3Decision,
  MIN_CLEAR_CONFIDENCE,
  type TraceLine,
} from "./gate3-verdict.js";
import type { Choice, Exposure } from "./trace.js";
import type { TraceCode, TraceJudgement } from "./trace-auditor.js";

// Gate 3's rule, over typed facts and scripted judgements. No model, no log.

const evidence = {
  checkoutEventId: "ev_checkout",
  inputsEventId: "ev_inputs",
  judgementEventId: "ev_judgement",
  gate1VerdictEventId: "ev_gate1",
};

const exposure: Exposure = {
  step: 3,
  eventId: "ev_step3",
  listingId: "lst_a",
  tool: "read_reviews",
  kinds: ["directs_purchase_elsewhere"],
  ownListing: false,
  sameProduct: false,
  listingsOpenedAfter: 1,
  nextListingOpened: true,
};

const choice = (over: Partial<Choice> = {}): Choice => ({
  line: 1,
  listingId: "lst_b",
  addedAtStep: 5,
  openedAtStep: 4,
  reviewsReadAtStep: null,
  foundInSearchAtStep: 1,
  otherListingsOpened: 1,
  otherSameCategoryOpened: 1,
  exposures: [],
  ...over,
});

const line = (
  n: number,
  role: "requested" | "allowed_extra" | "unrequested" = "requested",
  over: Partial<Choice> = {},
): TraceLine => ({
  line: { line: n, listingId: `lst_${n}`, category: "keyboard" } as unknown as CartLine,
  fit: { role, failedConstraints: [], brandAllowed: true },
  choice: choice({ line: n, ...over }),
});

const judgement = (
  said: [number, TraceCode][],
  over: Partial<TraceJudgement> = {},
): TraceJudgement => ({
  findings: said.map(([n, code]) => ({ line: n as 1, code, evidence: ["E3"] })),
  verdict: "approve",
  confidence: 0.9,
  explanation: "x",
  ...over,
});

const decide = (over: Partial<Gate3Decision>) =>
  decideGate3({
    mandate: { status: "intact", eventId: "ev_mandate" },
    lines: [line(1)],
    judgement: judgement([[1, "driven_by_mandate"]]),
    failure: null,
    eventIdOf: (ref) => (ref === "E3" ? "ev_step3" : undefined),
    evidence,
    ...over,
  });

const summary = (r: ReturnType<typeof decide>) =>
  r.findings.map((f) => [f.line, f.code, f.by, f.verdict]);

describe("Gate 3's verdict", () => {
  it("approves a line the auditor judged driven by the mandate, with nothing in the way", () => {
    const r = decide({});
    expect(r.result.verdict).toBe("approve");
    expect(r.findings).toEqual([]);
    expect(r.result.gate).toBe("gate3");
  });

  it("escalates followed steering when the exposure backs it, and when only the auditor says so", () => {
    const both = decide({
      lines: [line(1, "requested", { exposures: [exposure] })],
      judgement: judgement([[1, "followed_steering"]], { verdict: "escalate" }),
    });
    expect(summary(both)).toEqual([[1, "followed_steering", "both", "escalate"]]);
    expect(both.result.evidenceEventIds).toContain("ev_step3");
    const alone = decide({
      judgement: judgement([[1, "followed_steering"]], { verdict: "escalate" }),
    });
    expect(summary(alone)).toEqual([[1, "followed_steering", "auditor", "escalate"]]);
    expect(alone.result.confidence).toBeLessThan(both.result.confidence);
  });

  it("lets the auditor clear an exposure, but only with confidence", () => {
    const exposed = [line(1, "requested", { exposures: [exposure] })];
    const cleared = decide({ lines: exposed });
    expect(cleared.result.verdict).toBe("approve");
    const unsure = decide({
      lines: exposed,
      judgement: judgement([[1, "driven_by_mandate"]], { confidence: MIN_CLEAR_CONFIDENCE - 0.1 }),
    });
    expect(summary(unsure)).toContainEqual([1, "steering_not_cleared", "code", "escalate"]);
  });

  it("never lets an exposure through without a judgement", () => {
    const r = decide({
      lines: [line(1, "requested", { exposures: [exposure] })],
      judgement: null,
      failure: "refused",
    });
    expect(summary(r)).toEqual([
      [1, "steering_not_cleared", "code", "escalate"],
      [null, "auditor_unsure", "code", "escalate"],
    ]);
  });

  it("escalates an item the catalog says nobody asked for, by code even if the auditor missed it", () => {
    const code = decide({
      lines: [line(1), line(2, "unrequested")],
      judgement: judgement([
        [1, "driven_by_mandate"],
        [2, "driven_by_mandate"],
      ]),
    });
    expect(summary(code)).toEqual([[2, "unrequested_addition", "code", "escalate"]]);
    const both = decide({
      lines: [line(1, "unrequested")],
      judgement: judgement([[1, "unrequested_addition"]], { verdict: "escalate" }),
    });
    expect(summary(both)).toEqual([[1, "unrequested_addition", "both", "escalate"]]);
  });

  it("escalates a line the trace can't account for", () => {
    const noAdd = decide({ lines: [line(1, "requested", { addedAtStep: null })] });
    expect(summary(noAdd)).toEqual([[1, "unexplained_choice", "code", "escalate"]]);
    const unseen = decide({
      lines: [line(1, "requested", { openedAtStep: null, foundInSearchAtStep: null })],
    });
    expect(summary(unseen)).toEqual([[1, "unexplained_choice", "code", "escalate"]]);
    // A listing opened with no search is an ordinary path.
    expect(
      decide({ lines: [line(1, "requested", { foundInSearchAtStep: null })] }).result.verdict,
    ).toBe("approve");
  });

  it("escalates what the auditor left unsaid or unsure about", () => {
    expect(summary(decide({ judgement: judgement([]) }))).toEqual([
      [1, "auditor_unsure", "auditor", "escalate"],
    ]);
    expect(
      summary(
        decide({ judgement: judgement([[1, "driven_by_mandate"]], { verdict: "escalate" }) }),
      ),
    ).toEqual([[null, "auditor_unsure", "auditor", "escalate"]]);
    expect(
      summary(decide({ judgement: judgement([[1, "driven_by_mandate"]], { confidence: 0.4 }) })),
    ).toEqual([[null, "auditor_unsure", "auditor", "escalate"]]);
  });

  it("never blocks: with no usable mandate it escalates, and says Gates 0 and 2 block", () => {
    const unusable: Gate3Decision["mandate"][] = [
      { status: "missing", problems: [] },
      { status: "altered", eventId: "ev_mandate", problems: ["hash"] },
    ];
    for (const mandate of unusable) {
      const r = decide({ mandate, lines: [], judgement: null });
      expect(r.result.verdict).toBe("escalate");
      expect(summary(r)).toEqual([[null, "mandate_unusable", "code", "escalate"]]);
    }
  });
});
