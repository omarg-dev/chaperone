import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DecisionResult, RunSummary } from "../api";
import { Amount, Button, EmptyState, Page, Pill, Section, StateGlyph, Vault } from "../design";
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
import {
  DecisionButtons,
  HeldCart,
  HeldReasons,
  useDecision,
  whatHappens,
} from "../run/DecisionPanel";
import type { RunModel } from "../run/timeline";
import { useRuns } from "../runs/RunsProvider";
import { MONEY_NOTES } from "../start/copy";

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

// How long a hold has waited, as the board sets it: a number in Besley and its unit at half size.
// Assistive technology gets the words, "7 hours".
function HeldFor({ span, since }: { span: string; since: string }) {
  // "7 hours" is a number and its unit; "less than a minute" has no number, and is "<1 minute".
  const [value, ...unit] = /^\d/.test(span) ? span.split(" ") : ["<1", "minute"];
  return (
    <span className="held-for" title={since}>
      <span className="visually-hidden">{`On hold for ${span}`}</span>
      <span className="t-meta held-for-label" aria-hidden="true">
        On hold for
      </span>
      <span className="amt held-for-span" aria-hidden="true">
        {value} <span className="held-for-unit">{unit.join(" ")}</span>
      </span>
    </span>
  );
}

// The ground the held cart sits on: the page's vault for the oldest hold, its own ground for the rest.
function CartSurface({ vaulted, children }: { vaulted: boolean; children: React.ReactNode }) {
  return vaulted ? (
    <Vault label="The held cart" className="held-cart">
      {children}
    </Vault>
  ) : (
    <section aria-label="The held cart" className="held-cart held-cart-plain">
      {children}
    </section>
  );
}

// A held purchase: a section of the page, with what it is, how long it has waited, what was asked
// and why it was held on one side, and below them the held cart and the two ways out. The oldest hold's
// cart sits in the page's vault; the rest are on the page's own ground, since a screen has one.
function HeldDecision({
  run,
  title,
  now,
  model,
  vaulted,
  onDecided,
  onFailed,
}: HeldProps & { model: RunModel; vaulted: boolean }) {
  const decision = useDecision(run.runId, (result) => onDecided(run, model, result), onFailed);
  const heldFor = model.escalatedAt ? Date.parse(model.escalatedAt) : null;
  const total = model.money.amountCents;
  const sellers = new Set(model.cart.map((line) => line.payeeKey)).size;
  return (
    <>
      <div className="held-top">
        <div className="held-left">
          <h2 className="t-section">{title}</h2>
          {run.escalation === "unfinished" && (
            <Pill state="escalate" label="Decision not finished" />
          )}
          {heldFor !== null && (
            <HeldFor
              span={formatSpan(now - heldFor)}
              since={formatTime(model.escalatedAt as string)}
            />
          )}
        </div>
        <div className="held-right">
          {model.request && (
            <section aria-label="What you asked">
              <h3 className="visually-hidden">You asked</h3>
              <q className="t-voice held-ask">{model.request}</q>
            </section>
          )}
          <section aria-label="Why Chaperone paused it">
            <h3 className="t-meta held-label">Why Chaperone paused it</h3>
            <HeldReasons reasons={model.heldReasons} />
          </section>
          <Link to={`/runs/${run.runId}`} className="held-run-link">
            See everything the agent did
          </Link>
        </div>
      </div>
      <CartSurface vaulted={vaulted}>
        <div className="held-cart-lines">
          <p className="t-meta held-cart-label">
            <span>On hold, not charged</span>
            {model.holdExpiresAt && (
              <span title={formatTime(model.holdExpiresAt)}>
                {formatHoldEnds(model.holdExpiresAt, now)}
              </span>
            )}
          </p>
          <HeldCart cart={model.cart} size={model.cart.length === 1 ? "lg" : "sm"} />
          {model.cart.length > 1 && total !== null && (
            <div className="held-total">
              <span className="held-total-label">Total</span>
              <Amount cents={total} size="lg" />
            </div>
          )}
        </div>
        <div className="held-decide">
          {!model.unfinished && (
            <p className="decision-what">
              {whatHappens(model.cart, total)}
              {run.payments === "fake"
                ? ` ${MONEY_NOTES.fake.label}: no real payment is made.`
                : ""}
            </p>
          )}
          <DecisionButtons {...decision} unfinished={model.unfinished} sellers={sellers} />
        </div>
      </CartSurface>
    </>
  );
}

function HeldItem(props: HeldProps & { detail: Detail; vaulted: boolean }) {
  const { run, title, detail, vaulted } = props;
  return (
    <li className="held page-section" aria-label={title} data-state="escalate">
      {detail.status === "ready" ? (
        <HeldDecision {...props} model={detail.model} vaulted={vaulted} />
      ) : (
        <div className="held-top">
          <div className="held-left">
            <h2 className="t-section">{title}</h2>
          </div>
          <div className="held-right">
            <p className="t-meta held-note" role={detail.status === "error" ? "alert" : "status"}>
              {detail.status === "error"
                ? "This purchase didn't load, so it can't be decided here yet. We'll keep trying."
                : "Loading this purchase…"}
            </p>
            <Link to={`/runs/${run.runId}`} className="held-run-link">
              See everything the agent did
            </Link>
          </div>
        </div>
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
    <Page
      className="inbox"
      title="Escalations"
      lede="Purchases Chaperone put on hold because it wasn't sure they are what you asked for. Nothing is charged until you approve. Oldest first."
    >
      {status === "error" && runs.length === 0 && (
        <EmptyState title="Escalations didn't load." action={reloadButton}>
          Chaperone's server didn't answer. Check your connection, then try again.
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
            <StateGlyph state={c.outcome === "approve" ? "approve" : "block"} size={22} />
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
        <ul className="held-list">
          {items.map(({ run, detail }, at) => (
            <HeldItem
              key={run.runId}
              run={run}
              title={titleOf(run)}
              now={now}
              detail={detail}
              vaulted={at === 0}
              onDecided={decided}
              onFailed={refresh}
            />
          ))}
        </ul>
      )}

      {drawn && items.length === 0 && status !== "error" && (
        <EmptyState
          title="Nothing is waiting on you."
          label="Held for you right now"
          action={
            <span className="empty-actions">
              <Link to="/start">Start a run</Link>
              <Link to="/runs">See every run</Link>
            </span>
          }
        >
          When Chaperone isn't sure a purchase is what you asked for, it puts the money on hold and
          the purchase waits here for you to approve or reject.
        </EmptyState>
      )}

      {recent.length > 0 && (
        <Section heading="Recently decided" className="inbox-recent">
          <ul className="decided-list">
            {recent.map((run) => {
              const approved = run.verdict === "approve";
              return (
                <li key={run.runId} className="decided-row">
                  <Pill state={approved ? "approve" : "block"} label={decidedLabel(run)} />
                  <Link to={`/runs/${run.runId}`} className="run-link t-item">
                    {titleOf(run)}
                  </Link>
                  <span className="t-meta decided-when" title={formatTime(run.lastEventAt)}>
                    {formatAgo(run.lastEventAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </Page>
  );
}
