import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, buttonClass, EmptyState, formatMoney, Pill, StateGlyph, Zone } from "../design";
import { formatCost, formatTime } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { DecisionPanel } from "./DecisionPanel";
import { RunTimeline } from "./RunTimeline";
import type { RunModel } from "./timeline";
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
  const { status, model, reload } = useRun(runId);
  const runs = useRuns();

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
      </nav>

      <header className="run-top">
        <div className="run-headline">
          {headline.pill ? (
            <Pill state={headline.pill.state} label={headline.pill.label} />
          ) : (
            headline.badge && <span className="badge run-badge">{headline.badge}</span>
          )}
          <h1 className="t-page-title">{headline.title}</h1>
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

      {model.awaitingPerson && (
        <DecisionPanel
          runId={runId}
          cart={model.cart}
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

      <RunTimeline model={model} />

      {model.live && (
        <p className="t-meta run-live" role="status">
          Following this run as it happens.
        </p>
      )}
    </div>
  );
}
