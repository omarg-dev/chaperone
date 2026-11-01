import type { ResultsView } from "@firewall/eval/view";
import { provenanceOf } from "./results";

// What produced a result, stated on every view of it (CLAUDE.md, "Say which eval numbers used the
// fake payment adapter"): the adapter above all, then the agent's model column, the gates' model, the
// seeds and the date. A fake result carries a banner in the escalate amber, not red, since nothing
// reached an attacker by being fake: it only means these numbers aren't from the sandbox.
export function Provenance({ results }: { results: ResultsView }) {
  const p = provenanceOf(results);
  return (
    <div className="provenance">
      {p.adapter === "fake" ? (
        <div className="fake-banner" role="note">
          <strong>Development numbers, not a sandbox result.</strong> This run used the fake payment
          adapter, so no sandbox money moved. Don't quote these numbers in the video or the
          write-up.
        </div>
      ) : (
        <div className="sandbox-note t-meta" role="note">
          Sandbox result: the checkouts were held on the payment platform's sandbox.
        </div>
      )}
      <dl className="facts">
        {p.facts.map((fact) => (
          <div key={fact.label} className="fact">
            <dt className="t-meta">{fact.label}</dt>
            <dd className="t-data">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="t-meta">{p.coverage}</p>
      {p.stoppedEarly && (
        <p className="stopped" role="note">
          {p.stoppedEarly}
        </p>
      )}
    </div>
  );
}
