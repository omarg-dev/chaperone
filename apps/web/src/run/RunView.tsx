import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, buttonClass, EmptyState, formatMoney, Pill, StateGlyph, Zone } from "../design";
import { formatCost, formatTime } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { paymentsLabel } from "../runs/state";
import { DecisionPanel } from "./DecisionPanel";
import { ReplayBar } from "./ReplayBar";
import { RunTimeline } from "./RunTimeline";
import { buildRun, type RunModel } from "./timeline";
import { prefersReducedMotion, useReplay } from "./useReplay";
import { useRun } from "./useRun";

const MONEY_LABELS = {
  none: "No money has moved",
  held: "Held, not charged",
  captured: "Captured and paid out",
  voided: "Voided, nobody paid",
} as const;

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (a plain-http page, say): the id is on screen to select.
    }
  };
  return (
    <button type="button" className="icon-button" onClick={copy} aria-label="Copy run ID">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect
          x="5"
          y="5"
          width="8.5"
          height="8.5"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M10.5 3H4.5A1.5 1.5 0 0 0 3 4.5v6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="visually-hidden" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

// The money's state, said once beside the headline: how much, and where it is.
function MoneyBlock({ model }: { model: RunModel }) {
  const { money } = model;
  if (money.state === "none" || money.amountCents === null) return null;
  const attacker = money.paidToAttackerCents > 0;
  return (
    <div className={`run-money run-money-${attacker ? "attacker" : money.state}`}>
      {money.state === "held" && (
        <span className="run-money-glyph">
          <StateGlyph state="held" size={46} />
        </span>
      )}
      <div className="run-money-text">
        <span className="money money-xl">{formatMoney(money.amountCents)}</span>
        <span className="run-money-label">{MONEY_LABELS[money.state]}</span>
      </div>
    </div>
  );
}

export function RunView() {
  const { runId = "" } = useParams();
  // One page per run: its replay starts over when another run is opened.
  return <RunPage key={runId} runId={runId} />;
}

function RunPage({ runId }: { runId: string }) {
  const { status, model: whole, events, payees, reload } = useRun(runId);
  const runs = useRuns();

  // Replay is offered once the run is done; a run in progress is followed live.
  const replay = useReplay(events, status === "ready" && !whole.live && events.length > 1);
  // The run as it was at the playhead: the same mapping as the live view, over a prefix of the log,
  // so what a replay draws can't drift from what the run view draws.
  const model = useMemo(
    () => (replay.open ? buildRun(events.slice(0, replay.position), payees) : whole),
    [replay.open, replay.position, events, payees, whole],
  );
  const replaying = replay.open && replay.position < events.length;

  // Keeps the newest row in view as the playhead moves, and scrolls without animation when asked to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the position is what makes it run.
  useEffect(() => {
    if (!replay.open) return;
    const rows = document.querySelectorAll(".tl-rows > li");
    rows[rows.length - 1]?.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [replay.open, replay.position]);

  if (status === "loading") {
    return (
      <p className="t-meta" role="status">
        Loading the run…
      </p>
    );
  }
  if (status === "error" && model.items.length === 0) {
    return (
      <EmptyState
        title="The run didn't load."
        action={
          <Button variant="secondary" small onClick={reload}>
            Try again
          </Button>
        }
      >
        The server didn't answer. Check that it's running, then try again.
      </EmptyState>
    );
  }
  if (status === "missing") {
    return (
      <EmptyState
        title="There's no run with this ID."
        action={
          <Link to="/runs" className={buttonClass("secondary", true)}>
            Back to runs
          </Link>
        }
      >
        <span className="t-data">{runId}</span> isn't in this server's log. It may have been run
        somewhere else.
      </EmptyState>
    );
  }

  const { headline } = model;
  const scenarioTitle = model.scenarioId ? runs.scenarioTitles[model.scenarioId] : undefined;
  const meta = [
    scenarioTitle ?? model.scenarioId,
    model.seed ? `Seed ${model.seed}` : null,
    model.startedAt ? formatTime(model.startedAt) : null,
    paymentsLabel(model.payments),
    model.costUsd > 0 ? `${formatCost(model.costUsd)} in model calls` : null,
  ].filter(Boolean);

  return (
    <div className="run">
      <nav className="run-crumbs t-meta" aria-label="Breadcrumb">
        <Link to="/runs">Runs</Link>
        <span aria-hidden="true">/</span>
        <span className="t-data">{runId}</span>
        <CopyId id={runId} />
        {meta.length > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{meta.join(" · ")}</span>
          </>
        )}
        {replaying && (
          <span className="badge run-replaying">
            Replay, event {replay.position} of {events.length}
          </span>
        )}
      </nav>

      <header className="run-top">
        <div className="run-headline">
          {headline.pill ? (
            <Pill state={headline.pill.state} label={headline.pill.label} />
          ) : (
            headline.badge && <span className="badge run-badge">{headline.badge}</span>
          )}
          <h1 className="t-headline">{headline.title}</h1>
          {headline.lede && <p className="run-lede">{headline.lede}</p>}
        </div>
        <MoneyBlock model={model} />
      </header>

      {model.request && (
        <Zone kind="catalog" label="What you asked, and what you locked">
          <div className="run-brief">
            <q className="run-request">{model.request}</q>
            {model.terms.length > 0 && (
              <dl className="run-terms" aria-label="The locked mandate">
                {model.terms.map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>{term.value}</dd>
                    {term.hint && <dd className="run-term-hint">{term.hint}</dd>}
                  </div>
                ))}
              </dl>
            )}
          </div>
        </Zone>
      )}

      {model.awaitingPerson && !replaying && (
        <DecisionPanel
          runId={runId}
          cart={model.cart}
          unfinished={model.unfinished}
          onDecided={() => {
            reload();
            runs.reload();
          }}
        />
      )}

      {model.earlierReviews.length > 0 && (
        <p className="t-meta">
          This checkout was reviewed {model.earlierReviews.length + 1} times, under different
          firewall settings ({[...model.earlierReviews, "the last one below"].join(", ")}). The
          timeline shows the last.
        </p>
      )}

      {!replay.open && !whole.live && events.length > 1 && (
        <div className="run-replay-entry">
          <Button variant="secondary" small onClick={replay.start}>
            Replay this run
          </Button>
          <span className="t-meta">Watch it build up, one event at a time.</span>
        </div>
      )}

      <RunTimeline model={model} />

      {model.live && !replay.open && (
        <p className="t-meta run-live" role="status">
          Following this run as it happens.
        </p>
      )}

      {replay.open && <ReplayBar events={events} replay={replay} />}
    </div>
  );
}
