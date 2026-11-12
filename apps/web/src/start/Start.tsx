import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
import { Button, buttonClass, Disclosure, EmptyState, Page, Section } from "../design";
import { formatTime } from "../format";
import { useRuns } from "../runs/RunsProvider";
import { AgentTab } from "./AgentTab";
import { ChooseTask } from "./ChooseTask";
import { dollars, isFirewallSetting } from "./copy";
import { LaunchPanel } from "./LaunchPanel";
import { MandatePanel } from "./MandatePanel";
import { useLiveStatus } from "./useLiveStatus";

type Tab = "run" | "agent";

const STEPS = ["Pick a task", "Check the rules", "Start the run"] as const;

// How the three steps stand, from where the person is.
export function stepState(index: number, current: number): "done" | "current" | "next" {
  return index < current ? "done" : index === current ? "current" : "next";
}

// The steps' progress for assistive technology: the numbered sections say where the person is to the eye, and
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
    : "The server didn't answer. Nothing was started. Try again.";

// A step that has just opened is brought into view and given focus, so on a phone the person isn't
// left looking at the step that closed, and a screen reader says where they are.
const bringIn = (element: HTMLElement | null) => {
  if (!element) return;
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  // The top bar stays at the top of the screen (and is tall on a phone): stop below it.
  const bar = document.querySelector<HTMLElement>(".topbar");
  element.style.scrollMarginTop = `${(bar?.offsetHeight ?? 0) + 16}px`;
  element.scrollIntoView?.({ block: "start", behavior: "smooth" });
  element.focus({ preventScroll: true });
};

// What to do instead when a live run can't start: watch a recorded one, or see the benchmark.
function Elsewhere() {
  return (
    <div className="start-elsewhere">
      <Link to="/runs" className={buttonClass("primary")}>
        Watch a recorded run
      </Link>
      <Link to="/dashboard" className={buttonClass("secondary")}>
        See the benchmark results
      </Link>
    </div>
  );
}

export function Start() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "agent" ? "agent" : "run";
  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params);
    if (next === "agent") copy.set("tab", "agent");
    else copy.delete("tab");
    setParams(copy, { replace: true });
  };
  // The tabs follow the tab pattern: one Tab stop, the arrow keys move between them.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home"
        ? "run"
        : event.key === "End"
          ? "agent"
          : tab === "run"
            ? "agent"
            : "run";
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <Page
      title="Start a run"
      lede="Give a shopping agent a task, say what it may buy, and watch Chaperone check the purchase before any money moves."
      aside={
        <div className="tabs" role="tablist" aria-label="What to do" onKeyDown={onTabKey}>
          <button
            type="button"
            role="tab"
            id="tab-run"
            aria-selected={tab === "run"}
            aria-controls="panel-run"
            tabIndex={tab === "run" ? 0 : -1}
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
            tabIndex={tab === "agent" ? 0 : -1}
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
    </Page>
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
  const launchHeading = useRef<HTMLHeadingElement>(null);
  // Which step the person just moved to with a click, so it can be brought into view once drawn.
  const [arrived, setArrived] = useState<"rules" | "launch" | null>(null);

  useEffect(() => {
    if (arrived === "rules") bringIn(document.getElementById("start-rules"));
    if (arrived === "launch") bringIn(launchHeading.current);
    if (arrived) setArrived(null);
  }, [arrived]);

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
      setArrived("rules");
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
      <EmptyState
        label="Live runs"
        title="Can't reach the server."
        action={
          <div className="start-elsewhere">
            <Button onClick={reload}>Try again</Button>
          </div>
        }
      >
        Nothing was started. Check your connection, then try again in a moment.
      </EmptyState>
    );
  }
  if (!live.available) {
    return (
      <EmptyState
        label="Live runs"
        title="Live runs are off right now."
        action={
          <>
            <Elsewhere />
            {live.reason && (
              <div className="start-why">
                <Disclosure title="Details for whoever runs this server">
                  <p>{live.reason}</p>
                </Disclosure>
              </div>
            )}
          </>
        }
      >
        This copy of Chaperone can't start a new shopper. Every recorded run still plays back step
        by step, the same way a live one does, and the benchmark shows how often Chaperone stopped a
        seller's trick.
      </EmptyState>
    );
  }
  if (live.budget.exhausted && !mandate) {
    return (
      <EmptyState label="Live runs" title="Today's live runs are used up." action={<Elsewhere />}>
        Live runs share a small daily budget of {dollars(live.budget.capUsd)}, and today's is spent.
        It starts again at midnight UTC ({formatTime(live.budget.resetsAt)}). Until then, every
        recorded run still plays back step by step.
      </EmptyState>
    );
  }

  const current = mandate === null ? 0 : mandate.state === "locked" ? 2 : 1;
  const chosen = scenarios.find((s) => s.scenarioId === (mandate?.scenarioId ?? scenarioId));

  return (
    <div className="start">
      <Steps current={current} />

      <Section heading="Pick a task" step={1} className="start-step">
        {current === 0 ? (
          <ChooseTask
            scenarios={scenarios}
            scenarioId={scenarioId}
            drafting={drafting}
            disabled={live.budget.exhausted}
            problem={problem}
            onScenario={setScenarioId}
            onDraft={draft}
          />
        ) : (
          <p className="start-summary">
            <span className="start-done" aria-hidden="true">
              ✓
            </span>
            <strong>{chosen?.title ?? "The task you picked"}</strong>
            {mandate?.state === "locked" && (
              <Button variant="secondary" small onClick={forget}>
                Pick a different task
              </Button>
            )}
          </p>
        )}
      </Section>

      <Section
        heading={mandate?.state === "locked" ? "Rules locked" : "Check the rules"}
        id="start-rules"
        step={2}
        className="start-step"
      >
        {mandate ? (
          <MandatePanel
            mandate={mandate}
            onChange={(next) => {
              setMandate(next);
              if (next.state === "locked") setArrived("launch");
            }}
            onRejected={forget}
          />
        ) : (
          <p className="start-later">
            Once you pick a task, Chaperone turns it into rules: what to buy, the most to pay, which
            sellers are allowed. You check them and lock them before anything is bought.
          </p>
        )}
      </Section>

      <LaunchPanel
        ref={launchHeading}
        live={live}
        firewall={firewall}
        starting={starting}
        // What went wrong before the lock is said where it happened, not in the held-back step.
        problem={mandate?.state === "locked" ? problem : null}
        ready={mandate?.state === "locked"}
        onFirewall={setFirewall}
        onStart={start}
      />
    </div>
  );
}
