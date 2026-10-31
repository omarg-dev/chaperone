import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DecisionResult, RunSummary } from "../api";
import { Button, buttonClass, EmptyState, formatMoney, Pill, StateGlyph } from "../design";
import { formatAgo, formatHoldEnds, formatSpan, formatTime } from "../format";
import {
  confirmationText,
  decidedLabel,
  oldestFirst,
  recentlyDecided,
  waitingRuns,
} from "../inbox/inbox";
import { useFreshness } from "../inbox/useFreshness";
import { type Detail, useHeldDetails } from "../inbox/useHeldDetails";
import { DecisionButtons, HeldCart, useDecision } from "../run/DecisionPanel";
import type { RunModel } from "../run/timeline";
import { useRuns } from "../runs/RunsProvider";
import { PageHeader } from "./Page";

interface Confirmation {
  runId: string;
  title: string;
  text: string;
  outcome: "approve" | "block" | null;
}

interface HeldProps {
  run: RunSummary;
  title: string;
  now: number;
  // A decision went through (null: someone else had decided it first).
  onDecided: (run: RunSummary, model: RunModel, result: DecisionResult | null) => void;
  // A decision didn't go through. It may have been written before the platform refused, so the list
  // is read again: the run then says its decision is unfinished and offers to finish it.
  onFailed: () => void;
}

function HeldHead({
  run,
  title,
  children,
}: {
  run: RunSummary;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="held-head">
      <div className="held-title">
        <Pill
          state="escalate"
          label={run.escalation === "unfinished" ? "Decision not finished" : "Needs your decision"}
        />
        <h3 className="t-item">{title}</h3>
      </div>
      <div className="held-meta">
        {children}
        <span className="t-data">{run.runId}</span>
      </div>
    </header>
  );
}

// A held purchase that is fully read: the request, the reasons, the cart and the two ways out.
function HeldDecision({
  run,
  title,
  now,
  model,
  onDecided,
  onFailed,
}: HeldProps & { model: RunModel }) {
  const decision = useDecision(run.runId, (result) => onDecided(run, model, result), onFailed);
  const heldFor = model.escalatedAt ? Date.parse(model.escalatedAt) : null;
  const total = model.money.amountCents;
  return (
    <>
      <HeldHead run={run} title={title}>
        {heldFor !== null && (
          <span title={formatTime(model.escalatedAt as string)}>
            Held for {formatSpan(now - heldFor)}
          </span>
        )}
        {model.holdExpiresAt && (
          <span title={formatTime(model.holdExpiresAt)}>
            {formatHoldEnds(model.holdExpiresAt, now)}
          </span>
        )}
      </HeldHead>
      <div className="held-body">
        <div className="held-why">
          {model.request && (
            <section aria-label="What you asked">
              <h4 className="held-label">You asked</h4>
              <q className="run-request">{model.request}</q>
            </section>
          )}
          <section aria-label="Why it was held">
            <h4 className="held-label">Why it was held</h4>
            <ul className="held-reasons">
              {model.heldReasons.length === 0 && (
                <li>The review couldn't be sure the cart matches your request.</li>
              )}
              {model.heldReasons.map((reason) => (
                <li key={reason.gate}>
                  <span className="held-gate">{reason.label}</span>
                  <span>{reason.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="held-decide">
          <section className="decision-cart" aria-label="The held cart">
            <HeldCart cart={model.cart} />
            {model.cart.length > 1 && total !== null && (
              <div className="held-total">
                <span className="t-meta">Held, not charged</span>
                <span className="money money-sm">{formatMoney(total)}</span>
              </div>
            )}
          </section>
          <DecisionButtons {...decision} unfinished={model.unfinished} />
        </div>
      </div>
      <footer className="held-foot">
        <Link to={`/runs/${run.runId}`} className={buttonClass("secondary", true)}>
          View the full run
        </Link>
      </footer>
    </>
  );
}

function HeldItem(props: HeldProps & { detail: Detail }) {
  const { run, title, detail } = props;
  return (
    <li className="held" aria-label={title}>
      {detail.status === "ready" ? (
        <HeldDecision {...props} model={detail.model} />
      ) : (
        <>
          <HeldHead run={run} title={title} />
          <p className="t-meta held-note" role={detail.status === "error" ? "alert" : "status"}>
            {detail.status === "error"
              ? "This run couldn't be read, so it can't be decided here yet. It will be tried again."
              : "Reading the run…"}
          </p>
          <footer className="held-foot">
            <Link to={`/runs/${run.runId}`} className={buttonClass("secondary", true)}>
              View the full run
            </Link>
          </footer>
        </>
      )}
    </li>
  );
}

export function Escalations() {
  const { status, runs, scenarioTitles, reload, refresh } = useRuns();
  const now = useFreshness(refresh);
  // What was decided on this visit, newest first: each leaves the list with a confirmation.
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const decidedHere = useMemo(() => new Set(confirmations.map((c) => c.runId)), [confirmations]);
  // A decision that was written but not carried out (the platform refused) is still in the list:
  // its hold is open, so the run says it is unfinished until the money has moved.
  const waiting = useMemo(
    () => waitingRuns(runs).filter((run) => !decidedHere.has(run.runId)),
    [runs, decidedHere],
  );
  const details = useHeldDetails(waiting);

  const items = oldestFirst(
    waiting
      .map((run) => ({ run, detail: details[run.runId] ?? ({ status: "loading" } as Detail) }))
      // The review has escalated and the hold is open: until the log says so, there is nothing to
      // decide yet (a run the review is still finishing).
      .filter(({ detail }) => detail.status !== "ready" || detail.model.awaitingPerson)
      .map(({ run, detail }) => ({
        run,
        detail,
        heldSince: detail.status === "ready" ? detail.model.escalatedAt : null,
      })),
  );

  // The list is drawn once every held run has been read, so a run's place doesn't shift as the
  // rest arrive; a run that comes in later is added in its place as it is read.
  const [drawn, setDrawn] = useState(false);
  const settled = status !== "loading" && items.every((item) => item.detail.status !== "loading");
  if (settled && !drawn) setDrawn(true);

  const titleOf = (run: RunSummary) =>
    (run.scenarioId ? scenarioTitles[run.scenarioId] : undefined) ?? run.scenarioId ?? "A purchase";

  const decided = (run: RunSummary, model: RunModel, result: DecisionResult | null) => {
    const outcome = result
      ? result.money === "captured"
        ? "approve"
        : result.money === "voided"
          ? "block"
          : null
      : null;
    setConfirmations((now) => [
      {
        runId: run.runId,
        title: titleOf(run),
        text: confirmationText(result, model.money.amountCents),
        outcome,
      },
      ...now.filter((c) => c.runId !== run.runId),
    ]);
    refresh();
  };

  const recent = recentlyDecided(runs, decidedHere);

  const reloadButton = (
    <Button variant="secondary" small onClick={reload}>
      Try again
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Escalations"
        lede="Purchases Chaperone paused because the decision is yours."
      />

      {status === "error" && runs.length === 0 && (
        <EmptyState title="Escalations didn't load." action={reloadButton}>
          The server didn't answer. Check that it's running, then try again.
        </EmptyState>
      )}

      {status === "loading" && runs.length === 0 && (
        <p className="t-meta" role="status">
          Loading escalations…
        </p>
      )}

      <div className="inbox-confirmations" role="status" aria-live="polite">
        {confirmations.map((c) => (
          <p className="confirm" key={c.runId}>
            <StateGlyph state={c.outcome === "approve" ? "approve" : "block"} size={20} />
            <span className="confirm-text">
              <span className="confirm-what">{c.text}</span>
              <span className="t-meta">{c.title}</span>
            </span>
            <Link to={`/runs/${c.runId}`} className="confirm-link">
              View the run
            </Link>
            <button
              type="button"
              className="icon-button"
              aria-label={`Dismiss the note about ${c.title}`}
              onClick={() => setConfirmations((now) => now.filter((x) => x.runId !== c.runId))}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path
                  d="M2 2l8 8M10 2l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </p>
        ))}
      </div>

      {drawn && items.length > 0 && (
        <section aria-labelledby="waiting-title">
          <h2 className="t-section inbox-section" id="waiting-title">
            Waiting for you
            <span className="t-meta">oldest first</span>
          </h2>
          <ul className="held-list">
            {items.map(({ run, detail }) => (
              <HeldItem
                key={run.runId}
                run={run}
                title={titleOf(run)}
                now={now}
                detail={detail}
                onDecided={decided}
                onFailed={refresh}
              />
            ))}
          </ul>
        </section>
      )}

      {drawn && items.length === 0 && status !== "error" && (
        <EmptyState title="Nothing is waiting on you">
          When a gate can't be sure a cart matches what you asked for, the purchase is held here
          with the cart and the reason. You approve it or reject it.
        </EmptyState>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="decided-title" className="inbox-recent">
          <h2 className="t-section inbox-section" id="decided-title">
            Recently decided
          </h2>
          <ul className="decided-list">
            {recent.map((run) => {
              const approved = run.verdict === "approve";
              return (
                <li key={run.runId} className="decided-row">
                  <Pill state={approved ? "approve" : "block"} label={decidedLabel(run)} />
                  <Link to={`/runs/${run.runId}`} className="run-link t-item">
                    {titleOf(run)}
                  </Link>
                  <span className="t-data">{run.runId}</span>
                  <span className="t-meta decided-when" title={formatTime(run.lastEventAt)}>
                    {formatAgo(run.lastEventAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
