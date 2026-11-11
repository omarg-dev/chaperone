import type { ResultsView } from "@firewall/eval/view";
import { Rate } from "../design";
import {
  type AttackTally,
  attackTally,
  CONFIG_INFO,
  configsOf,
  failedReviewsNote,
  measuresOf,
  tallyLabel,
} from "./results";

// One dot for each attack run: through to the attacker (red, outside the bracket), held or blocked,
// or the agent never fooled. The bracket is the review: a run inside it was looked at.
function Dots({ tally }: { tally: AttackTally }) {
  const inside = [
    ...Array.from({ length: tally.kept }, () => "kept"),
    ...Array.from({ length: tally.notFooled }, () => "calm"),
  ];
  const outside = Array.from({ length: tally.reached }, () => "out");
  const columns = tally.total <= 16 ? 4 : tally.total <= 64 ? 8 : 12;
  const grid = { gridTemplateColumns: `repeat(${columns}, 12px)` };
  return (
    <div className="dots" role="img" aria-label={tallyLabel(tally)}>
      {inside.length > 0 && (
        <div className={`dots-in${tally.reviewed ? " dots-bracket" : ""}`}>
          <div className="dots-grid" style={grid}>
            {inside.map((kind, i) => (
              // The dots are a picture of counts, in no order a person could reorder.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
              <span key={i} className={`dot dot-${kind}`} />
            ))}
          </div>
        </div>
      )}
      {outside.length > 0 && (
        <div className="dots-grid" style={grid}>
          {outside.map((kind, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
            <span key={i} className={`dot dot-${kind}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// Off, Rules only and the full check, side by side: the attack success the eval is for, then the
// cost of getting it. Every number is the one the harness computed and wrote into the file.
export function Comparison({ results }: { results: ResultsView }) {
  const configs = configsOf(results);
  const measures = measuresOf(configs);
  const failed = failedReviewsNote(configs);
  return (
    <section className="cmp-wrap" aria-label="Off, Rules only and the full check, compared">
      <div className="cmp">
        <span className="cmp-corner" />
        {configs.map((c) => (
          <div key={c.config} className={`cmp-cell cmp-head cmp-${c.config}`}>
            <h3 className={`cmp-name cmp-name-${c.config}`}>{CONFIG_INFO[c.config].name}</h3>
            <span className="t-meta">{CONFIG_INFO[c.config].what}</span>
          </div>
        ))}

        <div className="cmp-cell cmp-label cmp-attack-label">
          <h3 className="t-item">Attack success</h3>
          <span className="cmp-sub">The agent was fooled and the money was captured.</span>
          <ul className="dot-key t-meta">
            <li>
              <span className="dot dot-kept" aria-hidden="true" />
              Held or blocked
            </li>
            <li>
              <span className="dot dot-calm" aria-hidden="true" />
              Agent not fooled
            </li>
            <li>
              <span className="dot dot-out" aria-hidden="true" />
              Reached the attacker
            </li>
          </ul>
        </div>
        {configs.map((c) => {
          const tally = attackTally(c);
          return (
            <div key={c.config} className={`cmp-cell cmp-attack cmp-${c.config}`}>
              {c.attackSuccessRate === null ? (
                <span className="cmp-big cmp-na">n/a</span>
              ) : (
                // The picture below carries the counts, so the number alone is the headline.
                <Rate
                  percent={c.attackSuccessRate * 100}
                  size="inherit"
                  tone={c.attackSuccesses > 0 ? "attacker" : "plain"}
                  className={`cmp-big${c.attackSuccesses > 0 ? " cmp-big-attacker" : ""}`}
                />
              )}
              <span className="t-meta">
                {tally.total === 0
                  ? "No attack runs"
                  : `${c.attackSuccesses} of ${tally.total} attack runs`}
              </span>
              <Dots tally={tally} />
            </div>
          );
        })}

        {measures.map((m) => (
          <div key={m.key} className="cmp-row">
            <div className="cmp-cell cmp-label">
              <span className="cmp-measure">{m.name}</span>
              <span className="t-meta">{m.hint}</span>
            </div>
            {m.values.map((value, i) => (
              <div
                key={configs[i]?.config}
                className={`cmp-cell cmp-value cmp-${configs[i]?.config}`}
              >
                <Figure value={value} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="t-meta cmp-foot">
        A clean cart is the right thing from an honest seller. Blocked and held both keep the money,
        and a block of a cart the agent got wrong is a correct block.
        {failed && ` ${failed}`}
      </p>
    </section>
  );
}

// A measure's value in Besley, with what it is out of ("8.2% (4 of 49)") small beside it.
function Figure({ value }: { value: string }) {
  const found = /^(.+?) \((.+)\)$/.exec(value);
  return (
    <span className="cmp-figure">
      {found ? (
        <>
          <span>{found[1]}</span> <span className="cmp-of">({found[2]})</span>
        </>
      ) : (
        value
      )}
    </span>
  );
}
