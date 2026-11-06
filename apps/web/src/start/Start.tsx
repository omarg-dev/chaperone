import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ApiError,
  type FirewallSetting,
  fetchMandate,
  fetchScenarios,
  type MandateView,
  postDraft,
  postStart,
  type ScenarioInfo,
} from "../api";
import { buttonClass, EmptyState, PageRoute, Station } from "../design";
import { formatTime } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { AgentTab } from "./AgentTab";
import { ChooseTask } from "./ChooseTask";
import { dollars, isFirewallSetting } from "./copy";
import { LaunchPanel } from "./LaunchPanel";
import { MandatePanel } from "./MandatePanel";
import { useLiveStatus } from "./useLiveStatus";

type Tab = "run" | "agent";

const STEPS = ["Choose a task", "Set the mandate", "Run"] as const;

// How the three steps stand, from where the person is.
export function stepState(index: number, current: number): "done" | "current" | "next" {
  return index < current ? "done" : index === current ? "current" : "next";
}

// The steps' progress for assistive technology: the stations say where the person is to the eye, and
// this list says it to everything else (the current step, and which are done).
function Steps({ current }: { current: number }) {
  return (
    <ol className="visually-hidden" aria-label="Steps">
      {STEPS.map((label, index) => {
        const state = stepState(index, current);
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined}>
            <span aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
            <span>{label}</span>
            {state === "done" && <span className="visually-hidden">, done</span>}
          </li>
        );
      })}
    </ol>
  );
}

// The page's own message for a refusal, in the server's words.
const problemOf = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "The server didn't answer. Nothing was started; try again.";

export function Start() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "agent" ? "agent" : "run";
  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params);
    if (next === "agent") copy.set("tab", "agent");
    else copy.delete("tab");
    setParams(copy, { replace: true });
  };

  return (
    <PageRoute
      title="Start a run"
      lede="Give a shopping agent a task, say what it may buy, and watch Chaperone check the purchase before any money moves."
      aside={
        <div className="tabs" role="tablist" aria-label="What to do">
          <button
            type="button"
            role="tab"
            id="tab-run"
            aria-selected={tab === "run"}
            aria-controls="panel-run"
            className="tab"
            onClick={() => setTab("run")}
          >
            Run a shopper here
          </button>
          <button
            type="button"
            role="tab"
            id="tab-agent"
            aria-selected={tab === "agent"}
            aria-controls="panel-agent"
            className="tab"
            onClick={() => setTab("agent")}
          >
            Connect your own agent
          </button>
        </div>
      }
    >
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "run" ? <RunTab /> : <AgentTab />}
      </div>
    </PageRoute>
  );
}

function RunTab() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const runs = useRuns();
  const { status, live, reload } = useLiveStatus();

  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const urlFirewall = params.get("firewall");
  const [firewall, setFirewallState] = useState<FirewallSetting>(
    isFirewallSetting(urlFirewall) ? urlFirewall : "full",
  );
  const [mandate, setMandate] = useState<MandateView | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios().then(setScenarios, () => setScenarios([]));
  }, []);

  // The draft's run is kept in the address, so a reload picks the person up where they were.
  const runParam = params.get("run");
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, when the page opens.
  useEffect(() => {
    if (!runParam) return;
    fetchMandate(runParam).then(
      (found) => {
        if (found.state === "drafted" || found.state === "locked") {
          setMandate(found);
          setScenarioId(found.scenarioId);
        } else forget();
      },
      () => forget(),
    );
  }, []);

  const keep = (next: { run?: string | null; firewall?: FirewallSetting }) => {
    const copy = new URLSearchParams(params);
    if (next.run !== undefined) {
      if (next.run) copy.set("run", next.run);
      else copy.delete("run");
    }
    if (next.firewall) copy.set("firewall", next.firewall);
    setParams(copy, { replace: true });
  };
  const forget = () => {
    setMandate(null);
    keep({ run: null });
  };
  const setFirewall = (value: FirewallSetting) => {
    setFirewallState(value);
    keep({ firewall: value });
  };

  async function draft() {
    if (!scenarioId) return;
    setDrafting(true);
    setProblem(null);
    try {
      const drafted = await postDraft(scenarioId);
      setMandate(drafted);
      keep({ run: drafted.runId });
      runs.refresh();
    } catch (error) {
      setProblem(problemOf(error));
      reload();
    } finally {
      setDrafting(false);
    }
  }

  async function start() {
    if (!mandate) return;
    setStarting(true);
    setProblem(null);
    try {
      await postStart(mandate.runId, firewall);
      runs.refresh();
      navigate(`/runs/${mandate.runId}`);
    } catch (error) {
      setProblem(problemOf(error));
      reload();
      setStarting(false);
    }
  }

  if (status === "loading") {
    return (
      <p className="t-meta" role="status">
        Checking whether live runs are on…
      </p>
    );
  }
  if (status === "error" || !live) {
    return (
      <EmptyState title="The server didn't answer.">
        Check that it's running, then reload this page.
      </EmptyState>
    );
  }
  if (!live.available) {
    return (
      <EmptyState
        title="Live runs are off on this server."
        action={
          <Link to="/runs" className={buttonClass("primary")}>
            Replay a recorded run
          </Link>
        }
      >
        {live.reason} Recorded runs still replay, and everything else works.
      </EmptyState>
    );
  }
  if (live.budget.exhausted && !mandate) {
    return (
      <EmptyState
        title="Today's live runs are used up."
        action={
          <Link to="/runs" className={buttonClass("primary")}>
            Replay a recorded run
          </Link>
        }
      >
        The daily budget of {dollars(live.budget.capUsd)} is spent. It starts again at midnight UTC
        ({formatTime(live.budget.resetsAt)}). Recorded runs still replay.
      </EmptyState>
    );
  }

  const current = mandate === null ? 0 : mandate.state === "locked" ? 2 : 1;
  const chosen = scenarios.find((s) => s.scenarioId === (mandate?.scenarioId ?? scenarioId));

  return (
    <div className="start">
      <Steps current={current} />

      <Station heading="Choose a task" step={1} className="start-step">
        {current === 0 ? (
          <ChooseTask
            scenarios={scenarios}
            scenarioId={scenarioId}
            firewall={firewall}
            drafting={drafting}
            disabled={live.budget.exhausted}
            problem={problem}
            onScenario={setScenarioId}
            onFirewall={setFirewall}
            onDraft={draft}
          />
        ) : (
          <p className="start-summary">
            <strong>{chosen?.title ?? mandate?.scenarioId}</strong>
            <span className="t-meta"> To choose a different task, reject the mandate.</span>
          </p>
        )}
      </Station>

      {mandate && (
        <Station
          heading={
            mandate.state === "locked" ? "The mandate, locked" : "Review and lock the mandate"
          }
          step={2}
          note={`${mandate.runId} \u00b7 ${mandate.state === "locked" ? "locked" : "draft"}`}
          className="start-step"
        >
          <MandatePanel mandate={mandate} onChange={setMandate} onRejected={forget} />
        </Station>
      )}

      <LaunchPanel
        live={live}
        firewall={firewall}
        starting={starting}
        // What went wrong before the lock is said where it happened, not in the held-back step.
        problem={mandate?.state === "locked" ? problem : null}
        ready={mandate?.state === "locked"}
        onStart={start}
      />
    </div>
  );
}
