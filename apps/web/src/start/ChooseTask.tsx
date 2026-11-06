import type { FirewallSetting, ScenarioInfo } from "../api";
import { Button } from "../design";
import { FIREWALL_OPTIONS } from "./copy";

// Step one: a task and a firewall setting. A task is a scenario's title and the person's request;
// nothing here says which scenarios carry an attack.
export function ChooseTask({
  scenarios,
  scenarioId,
  firewall,
  drafting,
  disabled,
  problem,
  onScenario,
  onFirewall,
  onDraft,
}: {
  scenarios: ScenarioInfo[];
  scenarioId: string | null;
  firewall: FirewallSetting;
  drafting: boolean;
  // Live runs can't start (off, or today's budget is spent).
  disabled: boolean;
  problem: string | null;
  onScenario: (id: string) => void;
  onFirewall: (value: FirewallSetting) => void;
  onDraft: () => void;
}) {
  return (
    <div className="start-body">
      <fieldset className="choice-group">
        <legend className="t-meta">Pick a shopping task</legend>
        <p className="choice-help">
          An agent will try to buy it. Chaperone then checks the purchase against what you confirm
          next.
        </p>
        <div className="choices" role="radiogroup" aria-label="Shopping task">
          {scenarios.map((scenario) => (
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
      </fieldset>

      <fieldset className="choice-group">
        <legend className="t-meta">Chaperone setting</legend>
        <div className="firewall-options">
          {FIREWALL_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`choice choice-compact${option.value === firewall ? " choice-on" : ""}`}
            >
              <input
                type="radio"
                name="firewall"
                value={option.value}
                checked={option.value === firewall}
                onChange={() => onFirewall(option.value)}
              />
              <span className="choice-text">
                <span className="choice-title">{option.label}</span>
                <span className="t-meta">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {problem && (
        <p className="start-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="start-actions">
        <Button onClick={onDraft} disabled={disabled || drafting || scenarioId === null}>
          {drafting ? "Drafting…" : "Draft the mandate"}
        </Button>
        <span className="t-meta">One model call, about a twentieth of a cent.</span>
      </div>
    </div>
  );
}
