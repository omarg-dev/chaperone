import { DEFAULT_LIMITS, HAIKU_COLUMN, type LiveModels, runWithFirewall } from "@firewall/agent";
import { type ArenaService, findScenario, ShopError } from "@firewall/arena";
import type { Event, EventLog } from "@firewall/events";
import type { FirewallConfig } from "@firewall/firewall";
import {
  arenaVocabulary,
  type Decision,
  draftMandate,
  draftRows,
  EDIT_PROMPTS,
  type EditableField,
  editText,
  type LockedMandate,
  MandateBuildError,
  type MandateDraft,
  MandateError,
  mandateProgressOf,
  parseEdit,
  stepMandate,
  type Vocabulary,
} from "@firewall/mandate";
import type { PaymentSetup } from "../payments.js";
import { type Budget, budgetAt, isSpent } from "./budget.js";

// Live runs started from the web app: a person picks a scenario, confirms a mandate and starts the
// agent, which runs in this process while the run view follows it. Three requests, one run:
//
//   draft    starts the arena run (marked `origin: "web"` in its `run_started`) and has the builder
//            draft a mandate from the scenario's request, through the same `draftMandate` the
//            command line uses;
//   decide   the person's edits, confirmation or rejection, one request each, through the same
//            `stepMandate` the command line's confirmMandate loops over;
//   start    hands the run and its locked mandate to `runWithFirewall`, the function the command
//            line's run-scenario calls, in the background.
//
// Nothing between the requests is kept in memory but the arena run itself (which the arena service
// holds) and which run is in progress: where a mandate stands is read from the event log each time.
//
// What a live run may cost is a hard rule, so every request that could spend checks it first. A
// day's spend is counted from the log (see budget.ts), a run that would take it past the cap is
// refused with a 429, only one live run goes at a time (a 409 otherwise), and the agent's own spend
// cap is lowered to what is left of the day.

export class LiveError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 410 | 422 | 429 | 502 | 503,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LiveError";
  }
}

export interface LiveOptions {
  log: EventLog;
  arena: ArenaService;
  // The live models, or null when the server has no model key: live runs are then off, and the
  // rest of the server works as it does.
  models: LiveModels | null;
  // The server's payment adapter. Null: nothing to hold money on, so live runs are off.
  payments: PaymentSetup | null;
  // FIREWALL_LIVE_DAILY_USD.
  capUsd: number;
  // The clock the day's budget and the mandate's confirmation time read.
  now?: () => Date;
  vocabulary?: Vocabulary;
}

export interface LiveStatus {
  // Whether a live run can start now, setting aside the day's budget and a run in progress.
  available: boolean;
  // When it can't, why, in a sentence a person can act on. Null when it can.
  reason: string | null;
  // What holds the money of a live run, or null when nothing does.
  payments: "fake" | "sandbox" | null;
  budget: Budget;
  // A live run is in progress.
  busy: boolean;
  agentModel: string;
  gateModel: string;
}

export interface MandateRowView {
  label: string;
  value: string;
  // The editable field a row is, or null for a row that is only said.
  field: EditableField | null;
  // What an edit box starts from, and what to type: only on an editable row.
  editText: string | null;
  hint: string | null;
}

export interface MandateView {
  runId: string;
  scenarioId: string;
  // The person's request, in their own words.
  request: string;
  // drafted: waiting on the person; locked: confirmed; rejected: the person said no; failed: the
  // builder couldn't draft one.
  state: "drafted" | "locked" | "rejected" | "failed";
  rows: MandateRowView[];
  // Why the last decision didn't go through, when it didn't.
  problems: string[];
  // The draft has everything a lock needs (a price ceiling).
  canConfirm: boolean;
  // Set once locked.
  lock: { hash: string; confirmedAt: string } | null;
  // The reason a rejection gave, or why the draft failed.
  note: string | null;
  // What drafting it cost, in US dollars.
  costUsd: number;
}

export type MandateAction =
  | { action: "edit"; field: EditableField; input: string }
  | { action: "confirm" }
  | { action: "reject"; reason?: string | undefined };

export interface LiveService {
  status(): LiveStatus;
  draft(scenarioId: string, seed: string): Promise<MandateView>;
  mandate(runId: string): MandateView;
  decide(runId: string, action: MandateAction): MandateView;
  start(runId: string, firewall: FirewallConfig): { runId: string; firewall: FirewallConfig };
  // Resolves when the live run in progress, if any, has finished.
  idle(): Promise<void>;
}

export const AGENT_LABEL = HAIKU_COLUMN.label;

const NO_KEY =
  "This server has no model key, so it can't run a shopper live. Set FIREWALL_ANTHROPIC_API_KEY to turn live runs on.";
const NO_PAYMENTS = "This server has no payment adapter to hold a purchase on.";
const NO_WALLET =
  "This server is connected to the payment sandbox, but not to the buyer's saved wallet, so a purchase has nothing to be held against. Set SANDBOX_BUYER_VAULT_ID to turn live runs on.";

export function createLiveService(options: LiveOptions): LiveService {
  const { log, arena, models, payments, capUsd } = options;
  const now = options.now ?? (() => new Date());
  const vocabulary = options.vocabulary ?? arenaVocabulary();

  // The run in progress, set before the first await so two starts can't both get through.
  let active: { runId: string; finished: Promise<void> } | null = null;

  const unavailable = (): string | null =>
    !models ? NO_KEY : !payments ? NO_PAYMENTS : payments.vaultId === null ? NO_WALLET : null;

  const budget = () => budgetAt(capUsd, log.listRuns(), now());

  const requireAvailable = () => {
    const reason = unavailable();
    if (reason) throw new LiveError(503, "live_off", reason);
  };

  const requireBudget = () => {
    const today = budget();
    if (isSpent(today)) {
      throw new LiveError(
        429,
        "daily_cap",
        `Today's live runs have used up their $${capUsd.toFixed(2)} budget. It starts again at midnight UTC. You can still replay recorded runs.`,
        { budget: today },
      );
    }
    return today;
  };

  // The events of a run this app started. Every other run is somebody else's: the eval's, or one
  // from the command line, and nothing here may change or start it.
  function webRun(runId: string): Event[] {
    const events = log.listRun(runId);
    const started = events[0];
    const origin = (started?.payload as { origin?: unknown } | null)?.origin;
    if (started?.type !== "run_started" || origin !== "web") {
      throw new LiveError(404, "not_found", `There is no live run "${runId}" on this server.`);
    }
    return events;
  }

  const requestOf = (events: readonly Event[]): string =>
    String(
      (events.find((e) => e.type === "mandate_requested")?.payload as { requestText?: unknown })
        ?.requestText ?? "",
    );

  function view(runId: string, problems: string[] = []): MandateView {
    const events = webRun(runId);
    const progress = mandateProgressOf(events);
    const costUsd = events.filter((e) => e.lane === "mandate").reduce((n, e) => n + e.costUsd, 0);
    const base = {
      runId,
      scenarioId: events[0]?.scenarioId ?? "",
      request: requestOf(events),
      problems,
      costUsd,
    };
    if (progress.status === "none") {
      const failure = events.findLast((e) => e.type === "mandate_draft_failed");
      return {
        ...base,
        state: "failed",
        rows: [],
        canConfirm: false,
        lock: null,
        note: (failure?.payload as { message?: string } | undefined)?.message ?? null,
      };
    }
    const terms: MandateDraft | LockedMandate =
      progress.status === "locked"
        ? progress.mandate
        : progress.status === "drafted"
          ? progress.draft
          : (rejectedDraft(events) as MandateDraft);
    const editable = progress.status === "drafted";
    const rows = draftRows(terms, vocabulary).map((row): MandateRowView => {
      const field = row.field;
      return {
        ...row,
        editText: editable && field ? editText(field, terms, vocabulary) : null,
        hint: editable && field ? EDIT_PROMPTS[field].hint : null,
      };
    });
    return {
      ...base,
      state: progress.status,
      rows,
      canConfirm: terms.maxUnitPriceCents !== null,
      lock:
        progress.status === "locked"
          ? { hash: progress.mandate.hash, confirmedAt: progress.mandate.confirmedAt }
          : null,
      note: progress.status === "rejected" ? progress.reason : null,
    };
  }

  // A rejected mandate's draft as it stood: the last one written before the rejection.
  function rejectedDraft(events: readonly Event[]): unknown {
    const last = events
      .filter((e) => e.type === "mandate_drafted" || e.type === "mandate_edited")
      .at(-1);
    return (last?.payload as { draft?: unknown } | undefined)?.draft;
  }

  async function runInBackground(
    runId: string,
    scenarioId: string,
    seed: string,
    mandate: LockedMandate,
    firewall: FirewallConfig,
    maxUsd: number,
  ) {
    if (!models || !payments || payments.vaultId === null) return;
    try {
      await runWithFirewall({
        arena,
        log,
        payments: payments.adapter,
        vaultId: payments.vaultId,
        column: models.column,
        model: models.model,
        scenarioId,
        seed,
        runId,
        lockedMandate: mandate,
        limits: { maxUsd },
        firewall,
        gates: models.gates,
      });
    } catch (error) {
      console.error(`Live run ${runId} failed:`, error);
      // A run that broke before the agent could finish says so on its own timeline, so the run
      // view stops following it. One that did finish (the review broke after) already says so.
      const events = log.listRun(runId);
      if (!events.some((e) => e.lane === "agent" && e.type === "run_finished")) {
        log.append({
          runId,
          scenarioId,
          lane: "agent",
          type: "run_finished",
          provenance: "system",
          parentId: events[0]?.eventId ?? null,
          payload: {
            runId,
            scenarioId,
            seed,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  return {
    status() {
      const reason = unavailable();
      return {
        available: reason === null,
        reason,
        payments: payments?.name ?? null,
        budget: budget(),
        busy: active !== null,
        agentModel: AGENT_LABEL,
        gateModel: models?.gateModel ?? HAIKU_COLUMN.modelId,
      };
    },

    async draft(scenarioId, seed) {
      requireAvailable();
      const scenario = findScenario(scenarioId);
      if (!scenario) throw new LiveError(404, "not_found", `There is no scenario "${scenarioId}".`);
      requireBudget();
      if (!models || !payments) throw new LiveError(503, "live_off", NO_KEY);
      const run = arena.start(scenarioId, seed, { origin: "web", payments: payments.name });
      try {
        await draftMandate(
          { log, runId: run.runId, scenarioId, vocabulary },
          models.builder,
          scenario.request,
        );
      } catch (error) {
        if (error instanceof MandateBuildError) {
          throw new LiveError(
            502,
            "draft_failed",
            "The mandate couldn't be drafted just now, so nothing was started. Try again in a moment.",
            { runId: run.runId },
          );
        }
        throw error;
      }
      return view(run.runId);
    },

    mandate: (runId) => view(runId),

    decide(runId, action) {
      const events = webRun(runId);
      const progress = mandateProgressOf(events);
      if (progress.status !== "drafted") {
        throw new LiveError(
          409,
          "mandate_closed",
          progress.status === "locked"
            ? "This mandate is already locked. The terms can't change now."
            : progress.status === "rejected"
              ? "This mandate was rejected, so there is nothing to change."
              : "There is no mandate on this run to decide.",
        );
      }
      const scenarioId = events[0]?.scenarioId ?? null;
      const context = { log, runId, scenarioId, vocabulary, clock: now };

      let decision: Decision;
      if (action.action === "edit") {
        try {
          decision = {
            kind: "edit",
            edit: parseEdit(action.field, action.input, progress.draft, vocabulary),
          };
        } catch (error) {
          // A typo is asked again and never reaches the log, as at the command line.
          if (!(error instanceof MandateError)) throw error;
          throw new LiveError(422, "unreadable_edit", error.problems[0] ?? error.message, {
            problems: error.problems,
            mandate: view(runId, error.problems),
          });
        }
      } else if (action.action === "reject") {
        decision = { kind: "reject", ...(action.reason && { reason: action.reason }) };
      } else {
        decision = { kind: "accept" };
      }

      // Reading the draft's version and stepping it are one synchronous run, so two decisions on
      // the same draft can't interleave.
      const step = stepMandate(context, progress, decision);
      if (step.outcome === "open" && step.problems.length > 0) {
        throw new LiveError(
          422,
          action.action === "edit" ? "edit_refused" : "cannot_lock",
          step.problems.join("; "),
          { problems: step.problems, mandate: view(runId, step.problems) },
        );
      }
      return view(runId);
    },

    start(runId, firewall) {
      const events = webRun(runId);
      if (active?.runId === runId || events.some((e) => e.type === "agent_started")) {
        throw new LiveError(409, "already_started", "This run has already started.");
      }
      const progress = mandateProgressOf(events);
      if (progress.status !== "locked") {
        throw new LiveError(
          409,
          "mandate_not_locked",
          progress.status === "rejected"
            ? "This mandate was rejected, so the agent can't start. Choose a task again."
            : "Confirm the mandate first: the agent only shops against terms you locked.",
        );
      }
      requireAvailable();
      const today = requireBudget();
      if (active) {
        throw new LiveError(
          409,
          "run_in_progress",
          "Another live run is in progress. Wait for it to finish, then start this one.",
        );
      }
      let run: ReturnType<ArenaService["get"]>;
      try {
        run = arena.get(runId);
      } catch (error) {
        if (error instanceof ShopError) {
          throw new LiveError(
            410,
            "run_lost",
            "This run was lost when the server restarted. Choose a task again.",
          );
        }
        throw error;
      }
      // The agent may spend what it always may, and no more than the day has left once the
      // review's allowance is set aside.
      const maxUsd = Math.min(DEFAULT_LIMITS.maxUsd, today.agentRoomUsd);
      const finished = runInBackground(
        runId,
        run.scenario.scenarioId,
        run.seed,
        progress.mandate,
        firewall,
        maxUsd,
      ).finally(() => {
        active = null;
      });
      active = { runId, finished };
      return { runId, firewall };
    },

    async idle() {
      await active?.finished;
    },
  };
}
