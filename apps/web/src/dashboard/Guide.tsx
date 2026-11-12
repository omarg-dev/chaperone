import type { ResultsSummary } from "@firewall/eval/view";
import { useMemo } from "react";
import { SETTING_WORDS } from "../words/plain";
import { selectBenchmarkFiles, sourcesSentence } from "./studio/benchmark";

// What the benchmark is and how to read it, said once above both views: what was run, where the
// numbers come from, and the four words every number on the page is in. Written for someone who
// isn't a developer, since a judge reads this page right after the home page.
export function Guide({ list }: { list: readonly ResultsSummary[] }) {
  // The same files the Studio view reads, so the sentence says where its numbers come from.
  const sources = useMemo(() => sourcesSentence(selectBenchmarkFiles(list).files), [list]);
  return (
    <div className="guide">
      <p className="guide-intro">
        AI shopping agents were given the same shopping tasks in a practice shop, several times
        over. In some tasks a seller tries to trick the agent. Each checkout was then checked three
        ways, {SETTING_WORDS.off}, {SETTING_WORDS.gate0} and {SETTING_WORDS.full}, so the only thing
        that changes between them is Chaperone.
      </p>
      {sources && (
        <p className="guide-sources" role="note" aria-label="Where these numbers come from">
          {sources}
        </p>
      )}
      <dl className="guide-terms">
        <div>
          <dt>Attack</dt>
          <dd>
            A seller plants words that steer the agent to the wrong item, or to them. The held-out
            attacks come from published research and were never used to tune Chaperone.
          </dd>
        </div>
        <div>
          <dt>Clean cart</dt>
          <dd>A purchase with nothing wrong with it: what was asked for, from an honest seller.</dd>
        </div>
        <div>
          <dt>Attack success</dt>
          <dd>How often the agent was fooled and the money was actually paid. Lower is better.</dd>
        </div>
        <div>
          <dt>False escalation</dt>
          <dd>
            How often a clean cart was sent to a person to decide anyway. Lower is better: it costs
            a click, not money.
          </dd>
        </div>
      </dl>
    </div>
  );
}
