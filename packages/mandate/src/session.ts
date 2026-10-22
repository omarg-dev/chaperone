import type { Event, EventLog } from "@firewall/events";
import { type DraftResult, MandateBuildError, type MandateBuilder } from "./builder.js";
import {
  applyEdit,
  type LockedMandate,
  lockMandate,
  type MandateDraft,
  type MandateEdit,
  MandateError,
  verifyMandate,
} from "./mandate.js";
import type { Vocabulary } from "./vocabulary.js";

// Building a mandate as the event log sees it. What the person did (the request, each edit, the
// confirmation or rejection) goes on the human lane with provenance user; what the firewall
// produced (the draft and the locked mandate) goes on the mandate lane with provenance system.
// Nothing is ever changed in place: each edit is a new event whose parent is the version it
// changed, so the chain from the request to the locked mandate is the whole history.

export interface SessionContext {
  log: EventLog;
  // The run the mandate is for, so its events sit on the same timeline as the agent's.
  runId: string;
  scenarioId?: string | null;
  vocabulary: Vocabulary;
  clock?: () => Date;
}

export interface Drafted {
  draft: MandateDraft;
  result: DraftResult;
  requestEvent: Event;
  draftEvent: Event;
}

// Writes the person's request, asks the builder for a draft and writes it. When the builder
// fails, writes mandate_draft_failed with the reason (and what the failed call cost) and throws.
export async function draftMandate(
  context: SessionContext,
  builder: MandateBuilder,
  requestText: string,
): Promise<Drafted> {
  const { log, runId, scenarioId = null } = context;
  const requestEvent = log.append({
    runId,
    scenarioId,
    lane: "human",
    type: "mandate_requested",
    provenance: "user",
    payload: { requestText },
  });
  try {
    const result = await builder.draft(requestText);
    const draftEvent = log.append({
      runId,
      scenarioId,
      parentId: requestEvent.eventId,
      lane: "mandate",
      type: "mandate_drafted",
      provenance: "system",
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      payload: {
        draft: result.draft,
        model: result.model,
        tokens: result.tokens,
        thinkingTokens: result.thinkingTokens,
      },
    });
    return { draft: result.draft, result, requestEvent, draftEvent };
  } catch (error) {
    const failure =
      error instanceof MandateBuildError
        ? { code: error.code, message: error.message, ...error.details }
        : { code: "unexpected", message: String(error) };
    log.append({
      runId,
      scenarioId,
      parentId: requestEvent.eventId,
      lane: "mandate",
      type: "mandate_draft_failed",
      provenance: "system",
      costUsd: error instanceof MandateBuildError ? (error.details.costUsd ?? 0) : 0,
      latencyMs: error instanceof MandateBuildError ? (error.details.latencyMs ?? 0) : 0,
      payload: failure,
    });
    throw error;
  }
}

export type Decision =
  | { kind: "accept" }
  | { kind: "edit"; edit: MandateEdit }
  | { kind: "reject"; reason?: string };

// Whoever confirms the mandate: the person at a terminal, or a simulated one in the eval.
// `problems` explains why the last decision didn't go through (an edit that didn't fit the
// catalog, or accepting a draft that can't be locked yet), and is empty otherwise.
export interface Person {
  review(draft: MandateDraft, problems: string[]): Promise<Decision>;
}

// The eval's person: accepts every draft exactly as the builder wrote it. If the draft can't be
// locked (no price ceiling), it can't fix that, so it rejects with the reason instead.
export const acceptsDraftAsIs: Person = {
  async review(_draft, problems) {
    if (problems.length === 0) return { kind: "accept" };
    return { kind: "reject", reason: `Couldn't accept the draft as it is: ${problems.join("; ")}` };
  },
};

// A person who makes these decisions in order. For tests, and for eval scenarios that model a
// person correcting the draft.
export function scriptedPerson(decisions: Decision[]): Person {
  let next = 0;
  return {
    async review() {
      const decision = decisions[next++];
      if (!decision) throw new Error("The scripted person has no decisions left");
      return decision;
    },
  };
}

export type Confirmation =
  | { outcome: "locked"; mandate: LockedMandate; event: Event }
  | { outcome: "rejected"; reason: string | null; event: Event };

export interface ConfirmOptions {
  draft: MandateDraft;
  // The event that holds the draft (mandate_drafted). Edits and the confirmation point back at it.
  draftEventId: string;
  person: Person;
  // Stops a person who keeps making decisions that don't go through.
  maxDecisions?: number;
}

// Shows the draft to the person until they accept or reject it. Accepting locks it.
export async function confirmMandate(
  context: SessionContext,
  options: ConfirmOptions,
): Promise<Confirmation> {
  const { log, runId, scenarioId = null, vocabulary } = context;
  const clock = context.clock ?? (() => new Date());
  const maxDecisions = options.maxDecisions ?? 50;
  let draft = options.draft;
  // The event holding the current version of the draft.
  let versionId = options.draftEventId;
  let problems: string[] = [];

  const human = (type: string, payload: unknown, parentId = versionId) =>
    log.append({ runId, scenarioId, parentId, lane: "human", type, provenance: "user", payload });

  for (let round = 0; round < maxDecisions; round++) {
    const decision = await options.person.review(draft, problems);
    problems = [];

    if (decision.kind === "edit") {
      const { field, value } = decision.edit;
      try {
        const applied = applyEdit(draft, decision.edit, vocabulary);
        const event = human("mandate_edited", {
          mandateId: draft.mandateId,
          field,
          from: applied.from,
          to: applied.to,
          dropped: applied.dropped,
          draft: applied.draft,
        });
        draft = applied.draft;
        versionId = event.eventId;
      } catch (error) {
        if (!(error instanceof MandateError)) throw error;
        human("mandate_edit_failed", {
          mandateId: draft.mandateId,
          field,
          value,
          ...reasons(error),
        });
        problems = error.problems.length > 0 ? error.problems : [error.message];
      }
      continue;
    }

    if (decision.kind === "reject") {
      const reason = decision.reason?.trim() || null;
      const event = human("mandate_rejected", { mandateId: draft.mandateId, reason });
      return { outcome: "rejected", reason, event };
    }

    let mandate: LockedMandate;
    try {
      mandate = lockMandate(draft, { vocabulary, confirmedAt: clock().toISOString() });
    } catch (error) {
      if (!(error instanceof MandateError)) throw error;
      human("mandate_confirm_failed", { mandateId: draft.mandateId, ...reasons(error) });
      problems = error.problems.length > 0 ? error.problems : [error.message];
      continue;
    }
    const confirmed = human("mandate_confirmed", { mandateId: draft.mandateId, draft });
    const event = log.append({
      runId,
      scenarioId,
      parentId: confirmed.eventId,
      lane: "mandate",
      type: "mandate_locked",
      provenance: "system",
      payload: { mandate },
    });
    return { outcome: "locked", mandate, event };
  }
  throw new Error(`No decision on mandate ${draft.mandateId} after ${maxDecisions} tries`);
}

const reasons = (error: MandateError) => ({ reason: error.message, problems: error.problems });

export type BuildOutcome = Confirmation & { drafted: Drafted };

// The whole flow: request, draft, confirmation, lock.
export async function buildMandate(
  context: SessionContext,
  options: { builder: MandateBuilder; requestText: string; person: Person; maxDecisions?: number },
): Promise<BuildOutcome> {
  const drafted = await draftMandate(context, options.builder, options.requestText);
  const confirmation = await confirmMandate(context, {
    draft: drafted.draft,
    draftEventId: drafted.draftEvent.eventId,
    person: options.person,
    maxDecisions: options.maxDecisions,
  });
  return { ...confirmation, drafted };
}

// The run's locked mandate, for a gate to check against: the last mandate_locked event, verified.
// Throws when the run has none, or when the one it has was altered after locking.
export function lockedMandateOf(events: readonly Event[]): LockedMandate {
  const locked = events.filter((e) => e.type === "mandate_locked").at(-1);
  if (!locked) throw new MandateError("The run has no locked mandate", []);
  const verification = verifyMandate((locked.payload as { mandate?: unknown })?.mandate);
  if (!verification.intact) {
    throw new MandateError(
      `The locked mandate in ${locked.eventId} was altered`,
      verification.problems,
    );
  }
  return verification.mandate;
}
