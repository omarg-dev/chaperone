import { forwardRef } from "react";
import type { FirewallSetting, LiveStatus } from "../api";
import { Button, Vault } from "../design";
import { formatTime } from "../format";
import { dollars, FIREWALL_OPTIONS, MONEY_NOTES } from "./copy";

// Step three: what happens once the run starts (said once), how much Chaperone checks, and the one
// button that starts it. The setting is chosen here, beside the button it goes with, since it only
// matters when the run starts. Until the rules are locked the step is drawn short, so the person
// can see what is coming: what will happen, and the button held back with the reason beside it.
// The setting and the facts arrive with the lock, when they are the person's to read.
export const LaunchPanel = forwardRef<
  HTMLHeadingElement,
  {
    live: LiveStatus;
    firewall: FirewallSetting;
    starting: boolean;
    problem: string | null;
    // The mandate is locked, so the run can start.
    ready: boolean;
    onFirewall: (value: FirewallSetting) => void;
    onStart: () => void;
  }
>(function LaunchPanel({ live, firewall, starting, problem, ready, onFirewall, onStart }, heading) {
  const money = live.payments ? MONEY_NOTES[live.payments] : null;
  const blocked = live.budget.exhausted || live.busy || !live.available || !ready;
  return (
    <Vault label="Start the run" className="launch-vault">
      <div className={ready ? "launch" : "launch launch-waiting"}>
        <h2 className="page-heading t-section" ref={heading} tabIndex={-1}>
          <span className="page-step t-data" aria-hidden="true">
            3
          </span>
          <span>Start the run</span>
        </h2>

        <ol className="launch-next" aria-label="What happens when it starts">
          <li>The agent shops the marketplace for the task, on its own.</li>
          <li>When it checks out, the money is held, not paid.</li>
          <li>
            {firewall === "off"
              ? "With Chaperone off, the payment goes straight through. Nobody checks it."
              : "Chaperone checks the cart against the rules, then pays the seller, stops the purchase, or asks you."}
          </li>
        </ol>

        {ready && (
          <>
            <fieldset className="choice-group">
              <legend className="choice-legend">How much should Chaperone check?</legend>
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
                      <span className="choice-detail">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <dl className="launch-facts">
              <div>
                <dt>Shopping agent</dt>
                <dd>{live.agentModel}</dd>
              </div>
              {money && (
                <div>
                  <dt>Money</dt>
                  <dd>
                    {money.label}
                    <span className="launch-detail">{money.detail}</span>
                  </dd>
                </div>
              )}
              <div>
                <dt>Cost to you</dt>
                <dd>
                  Nothing
                  <span className="launch-detail">
                    A run uses about a cent of AI calls from the demo's daily budget:{" "}
                    {dollars(live.budget.remainingUsd)} of {dollars(live.budget.capUsd)} is left
                    today. It starts again at midnight UTC ({formatTime(live.budget.resetsAt)}).
                  </span>
                </dd>
              </div>
            </dl>
          </>
        )}

        {live.budget.exhausted && (
          <p className="start-note" role="status">
            Today's live runs are used up, so this one can't start until the budget starts again.
          </p>
        )}
        {live.busy && (
          <p className="start-note" role="status">
            Someone else's live run is going right now. You can start yours as soon as it ends: this
            page checks every few seconds.
          </p>
        )}
        {problem && (
          <p className="start-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="start-actions">
          <Button onClick={onStart} disabled={starting || blocked}>
            {starting ? "Starting…" : "Start the run"}
          </Button>
          <span className="launch-says">
            {ready
              ? "Next, you'll watch it live. It takes a minute or two."
              : "Lock the rules in step 2 first."}
          </span>
        </div>
      </div>
    </Vault>
  );
});
