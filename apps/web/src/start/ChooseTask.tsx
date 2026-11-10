import { useState } from "react";
import type { ScenarioInfo } from "../api";
import { Button } from "../design";

// How many tasks are shown before "Show all": enough to choose from, few enough that the three
// steps fit a screen or two, on a phone as well.
export const FIRST_TASKS = 6;

// Step one: a task. A task is a scenario's title and the person's request; nothing here says which
// scenarios carry an attack. The first few are shown and the rest open with one button. The list
// isn't a box of its own that scrolls (on a phone that is a scroll inside a scroll): opened, it is
// as long as it is, and the button rides along at the foot of the screen until the step ends.
export function ChooseTask({
  scenarios,
  scenarioId,
  drafting,
  disabled,
  problem,
  onScenario,
  onDraft,
}: {
  scenarios: ScenarioInfo[];
  scenarioId: string | null;
  drafting: boolean;
  // Live runs can't start (off, or today's budget is spent).
  disabled: boolean;
  problem: string | null;
  onScenario: (id: string) => void;
  onDraft: () => void;
}) {
  const chosen = scenarios.find((s) => s.scenarioId === scenarioId);
  const [all, setAll] = useState(false);
  const folds = scenarios.length > FIRST_TASKS;
  const shown = all || !folds ? scenarios : scenarios.slice(0, FIRST_TASKS);
  return (
    <div className="start-body">
      <fieldset className="choice-group">
        <legend className="choice-legend">What should the agent buy?</legend>
        <p className="choice-help" id="choose-help">
          Each task is something a person might ask a shopping agent. The marketplace is made up,
          and some of its sellers try to trick agents into buying the wrong thing.
        </p>
        <div className="choices" id="choose-tasks" aria-describedby="choose-help">
          {shown.map((scenario) => (
            <label
              key={scenario.scenarioId}
              className={`choice${scenario.scenarioId === scenarioId ? " choice-on" : ""}`}
            >
              <input
                type="radio"
                name="scenario"
                value={scenario.scenarioId}
                checked={scenario.scenarioId === scenarioId}
                onChange={() => onScenario(scenario.scenarioId)}
              />
              <span className="choice-text">
                <span className="choice-title">{scenario.title}</span>
                <q className="choice-request t-voice">{scenario.request}</q>
              </span>
            </label>
          ))}
        </div>
        {folds && (
          <div className="choices-more">
            <Button
              variant="secondary"
              small
              aria-expanded={all}
              aria-controls="choose-tasks"
              onClick={() => setAll(!all)}
            >
              {all ? "Show fewer tasks" : `Show all ${scenarios.length} tasks`}
            </Button>
          </div>
        )}
      </fieldset>

      <div className="start-dock">
        {problem && (
          <p className="start-problem" role="alert">
            {problem}
          </p>
        )}
        {drafting && (
          <p className="start-progress" role="status">
            Reading the request and writing the rules. This takes a few seconds.
          </p>
        )}
        <div className="start-actions">
          <Button onClick={onDraft} disabled={disabled || drafting || scenarioId === null}>
            {drafting ? "Writing the rules…" : "Write the rules"}
          </Button>
          <span className="t-meta start-dock-says">
            {chosen ? (
              <>
                Picked: <strong>{chosen.title}</strong>
              </>
            ) : (
              "Pick a task above first. Next, Chaperone turns it into rules for you to check."
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
