import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  Amount,
  Button,
  buttonClass,
  Disclosure,
  EmptyState,
  PageRoute,
  Pill,
  Seal,
  Station,
} from "../design";
import { formatCost, formatTime } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { paymentsLabel } from "../runs/state";
import { useNarrow } from "../shell/useNarrow";
import { firewallLabel, isFirewallSetting } from "../start/copy";
import { DecisionPanel } from "./DecisionPanel";
import { ReplayBar } from "./ReplayBar";
import { RunTimeline } from "./RunTimeline";
import { buildRun, type RunModel } from "./timeline";
import { prefersReducedMotion, useReplay } from "./useReplay";
import { useRun } from "./useRun";

// Where the money is, in the words a bank statement would use. Said once, beside the headline.
function moneyLabel(model: RunModel): string {
  const { money } = model;
  if (money.paidToAttackerCents > 0) return "Paid to an attacker's store";
  if (money.state === "held") return "On hold, not charged";
  if (money.state === "voided") return "Hold released, nobody was paid";
  if (money.state === "captured") {
    const sellers = [...new Set(money.payouts.map((payout) => payout.sellerName))];
    return sellers.length === 1 ? `Paid to ${sellers[0]}` : "Paid to the sellers";
  }
  return "No money has moved";
}

// Why Chaperone stopped a purchase: the first check that blocked it, in that check's own words. The
// headline says it was stopped; this is the one line under it that says why.
function blockedBecause(model: RunModel): string | null {
  if (model.headline.outcome !== "blocked") return null;
  for (const item of model.items) {
    if (
      (item.kind === "gate0_card" || item.kind === "gate2_card" || item.kind === "gate1_card") &&
      item.verdict === "block"
    ) {
      return `${item.title}.`;
    }
  }
  return null;
}

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

// The money's state, said once beside the headline: how much, and where it is, inside the clasp. The
// bracket is the mark's, grown: open while the money is held, its right arm drawn down when the hold
// is voided (the amount struck through with it), and empty with the amount out past it once it was
// captured. The motion is plain CSS (run.css) driven by the money's state, so the replay plays it as
// the playhead reaches it, and `prefers-reduced-motion` gets the end state.
function MoneyBlock({ model }: { model: RunModel }) {
  const { money } = model;
  if (money.state === "none" || money.amountCents === null) return null;
  const attacker = money.paidToAttackerCents > 0;
  const state = attacker ? "attacker" : money.state;
  return (
    // Keyed by the state, so a replay that crosses into a new state plays that state's motion.
    <div key={state} className={`run-money run-money-${state}`}>
      <span className="run-arm run-arm-left" aria-hidden="true" />
      {money.state === "voided" && <span className="run-arm run-arm-right" aria-hidden="true" />}
      <div className="run-money-text">
        <span className="run-money-label">{moneyLabel(model)}</span>
        <span className="run-money-figure">
          <Amount cents={money.amountCents} size="hero" tone={attacker ? "attacker" : "plain"} />
          {money.state === "voided" && <span className="run-strike" aria-hidden="true" />}
        </span>
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
  // On a phone the three columns stack, so the page can't point left, middle and right.
  const narrow = useNarrow();

  // Replay is offered once the run is done; a run in progress is followed live.
  const replay = useReplay(events, status === "ready" && !whole.live && events.length > 1);
  // The run as it was at the playhead: the same mapping as the live view, over a prefix of the log,
  // so what a replay draws can't drift from what the run view draws.
  const model = useMemo(
    () => (replay.open ? buildRun(events.slice(0, replay.position), payees) : whole),
    [replay.open, replay.position, events, payees, whole],
  );
  const replaying = replay.open && replay.position < events.length;

  // Keeps the newest row in view as a replay moves or a live run grows, the way a log tails. It only
  // follows someone who was already at the newest row, so scrolling up to read stays where it is.
  const following = replay.open || model.live;
  const rowCount = model.items.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the position and row count are what make it run.
  useEffect(() => {
    if (!following) return;
    const rows = document.querySelectorAll(".tl-rows > li");
    const last = rows[rows.length - 1];
    const before = rows[rows.length - 2];
    if (!last) return;
    if (before && before.getBoundingClientRect().top > window.innerHeight) return;
    last.scrollIntoView?.({
      block: "end",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [following, replay.position, rowCount]);

  if (status === "loading") {
    return (
      <p className="t-meta run-loading" role="status">
        Loading the run…
      </p>
    );
  }
  if (status === "error" && model.items.length === 0) {
    return (
      <PageRoute title="Run">
        <EmptyState
          title="The run didn't load."
          action={
            <Button variant="secondary" small onClick={reload}>
              Try again
            </Button>
          }
        >
          Chaperone's server didn't answer. Check your connection, then try again.
        </EmptyState>
      </PageRoute>
    );
  }
  if (status === "missing") {
    return (
      <PageRoute title="Run">
        <EmptyState
          title="We can't find this run."
          action={
            <Link to="/runs" className={buttonClass("secondary", true)}>
              Back to runs
            </Link>
          }
        >
          The link may be mistyped, or the run was made on another copy of Chaperone. Its ID is{" "}
          <span className="t-data">{runId}</span>.
        </EmptyState>
      </PageRoute>
    );
  }

  const { headline } = model;
  const scenarioTitle = model.scenarioId ? runs.scenarioTitles[model.scenarioId] : undefined;
  // What a person wants to know about the run at a glance: which task, when, and whether the money
  // was real. The identifiers a developer wants are in "Run details" at the foot.
  const meta = [model.startedAt ? formatTime(model.startedAt) : null, paymentsLabel(model.payments)]
    .filter(Boolean)
    .join(" · ");
  const settings = [...model.earlierReviews, "full"].map((config) =>
    isFirewallSetting(config) ? firewallLabel(config) : config,
  );
  const why = blockedBecause(model);

  return (
    <PageRoute
      className="run"
      headerClassName="run-top"
      titleSize="headline"
      above={
        <nav className="run-crumbs t-meta" aria-label="Breadcrumb">
          <Link to="/runs">Runs</Link>
          <span aria-hidden="true">/</span>
          <span className="run-crumb-here" aria-current="page">
            {scenarioTitle ?? "A run"}
          </span>
          {meta && <span className="run-crumb-meta">{meta}</span>}
          {replaying && (
            <span className="badge run-replaying">
              Replay, step {replay.position} of {events.length}
            </span>
          )}
        </nav>
      }
      eyebrow={
        headline.pill ? (
          <Pill state={headline.pill.state} label={headline.pill.label} />
        ) : (
          headline.badge && <span className="badge run-badge">{headline.badge}</span>
        )
      }
      title={headline.title}
      lede={headline.lede ?? why}
      aside={<MoneyBlock model={model} />}
    >
      {model.request && (
        <Station
          heading="What you asked for, and the rules you locked"
          className="run-brief-station"
        >
          <div className="run-brief">
            <div className="run-brief-words">
              <q className="run-request t-voice">{model.request}</q>
              {model.terms.length > 0 && (
                <dl className="run-terms" aria-label="The locked rules">
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
            {model.mandateHash && (
              <Seal
                hash={model.mandateHash}
                lockedAt={model.mandateLockedAt ? formatTime(model.mandateLockedAt) : null}
              />
            )}
          </div>
        </Station>
      )}

      {model.awaitingPerson && !replaying && (
        <DecisionPanel
          runId={runId}
          cart={model.cart}
          reasons={model.heldReasons}
          amountCents={model.money.amountCents}
          unfinished={model.unfinished}
          onDecided={() => {
            reload();
            runs.reload();
          }}
        />
      )}

      <Station heading="What happened, step by step" className="run-timeline-station">
        <p className="run-how">
          {narrow
            ? "Read down. Each step is marked with whose it is, as the key below shows: you, the agent and the checks; the money; or text sellers wrote, which Chaperone never trusts."
            : "Read down. On the left is what you and the agent did and what each check found. In the middle is the money, and the checks it had to pass. On the right is text sellers wrote, which Chaperone never trusts."}
        </p>
        {model.earlierReviews.length > 0 && (
          <p className="t-meta run-earlier">
            This is a benchmark run: the same checkout was checked {settings.length} times, with
            Chaperone set to {settings.join(", then ")}. This page shows the last.
          </p>
        )}

        {!replay.open && !whole.live && events.length > 1 && (
          <div className="run-replay-entry">
            <Button variant="secondary" small onClick={replay.start}>
              Replay this run
            </Button>
            <span className="t-meta">Watch it happen again, one step at a time.</span>
          </div>
        )}

        <RunTimeline model={model} />

        {model.live && !replay.open && (
          <p className="t-meta run-live" role="status">
            Following this run as it happens.
          </p>
        )}
      </Station>

      <div className="run-details">
        <Disclosure title="Run details" summary="for developers">
          <dl className="run-details-list">
            <div>
              <dt>Run ID</dt>
              <dd>
                <span className="t-data">{runId}</span>
                <CopyId id={runId} />
              </dd>
            </div>
            {model.scenarioId && (
              <div>
                <dt>Task</dt>
                <dd className="t-data">
                  {model.scenarioId}
                  {model.seed ? `, seed ${model.seed}` : ""}
                </dd>
              </div>
            )}
            {model.agentModel && (
              <div>
                <dt>Agent's AI model</dt>
                <dd className="t-data">{model.agentModel}</dd>
              </div>
            )}
            <div>
              <dt>Cost of the AI calls</dt>
              <dd className="t-data">{model.costUsd > 0 ? formatCost(model.costUsd) : "None"}</dd>
            </div>
            {model.mandateHash && (
              <div>
                <dt>Fingerprint of the locked rules (the mandate's hash)</dt>
                <dd className="t-data run-details-hash">{model.mandateHash}</dd>
              </div>
            )}
            <div>
              <dt>Steps recorded</dt>
              <dd className="t-data">{events.length}</dd>
            </div>
          </dl>
        </Disclosure>
      </div>

      {replay.open && <ReplayBar events={events} replay={replay} />}
    </PageRoute>
  );
}
