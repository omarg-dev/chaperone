import type { FirewallSetting, LiveStatus } from "../api";
import { Button, MoneyGlyph, Vault } from "../design";
import { formatTime } from "../format";
import { dollars, firewallLabel, MONEY_NOTES } from "./copy";

// Step three: what is about to happen, said once, and the one button that starts it.
export function LaunchPanel({
  live,
  firewall,
  starting,
  problem,
  ready,
  onStart,
}: {
  live: LiveStatus;
  firewall: FirewallSetting;
  starting: boolean;
  problem: string | null;
  // The mandate is locked, so the run can start. Until then the step is drawn, held back.
  ready: boolean;
  onStart: () => void;
}) {
  const money = live.payments ? MONEY_NOTES[live.payments] : null;
  const blocked = live.budget.exhausted || live.busy || !live.available || !ready;
  return (
    <Vault label="Run" className="launch-vault">
      <div className={ready ? "launch" : "launch launch-held-back"}>
        <h2 className="page-heading t-section">
          <span className="page-step t-data" aria-hidden="true">
            3
          </span>
          <span>Run</span>
        </h2>
        <p className="launch-says">
          <MoneyGlyph state="held" size={30} />
          <span className="t-headline">
            The agent's checkout will be held here until every gate has read it.
          </span>
        </p>
        <dl className="launch-facts">
          <div>
            <dt>Agent</dt>
            <dd>{live.agentModel}</dd>
          </div>
          <div>
            <dt>Chaperone</dt>
            <dd>{firewallLabel(firewall)}</dd>
          </div>
          {money && (
            <div>
              <dt>Money</dt>
              <dd>
                {money.label}
                <span className="t-meta launch-detail">{money.detail}</span>
              </dd>
            </div>
          )}
          <div>
            <dt>Cost</dt>
            <dd>
              Half a cent to a cent
              <span className="t-meta launch-detail">
                {dollars(live.budget.remainingUsd)} of today's {dollars(live.budget.capUsd)} is
                left. It starts again at midnight UTC ({formatTime(live.budget.resetsAt)}).
              </span>
            </dd>
          </div>
        </dl>
        {live.budget.exhausted && (
          <p className="start-note" role="status">
            Today's live runs are used up, so this one can't start until the budget starts again.
          </p>
        )}
        {live.busy && (
          <p className="start-note" role="status">
            Another live run is in progress. You can start yours when it ends.
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
          <span className="t-meta">
            {ready ? "You'll follow it live on the next page." : "Lock the mandate first."}
          </span>
        </div>
      </div>
    </Vault>
  );
}
