// A real sandbox result (results/2026-11-07T1647-sandbox-claude-haiku-5-5.json, our own 30
// scenarios, seeds 1 to 4, the Claude Haiku 5.5 column), as the server serves it: read through
// `parseResults` in @firewall/eval/view, so only the fields the dashboard draws are here. The
// numbers are the harness's own: 71.9% attack success with the firewall off, 25.0% with Rules
// only, 3.1% with the full check, over 32 attack runs.
import type { ResultsView } from "@firewall/eval/view";
import sandboxHaiku from "./sandbox-haiku.json";

export const sandboxResults = sandboxHaiku as unknown as ResultsView;

// The same file labelled as a fake-adapter result, which is what the page's banner is tested on.
export const fakeResults: ResultsView = {
  ...sandboxResults,
  meta: { ...sandboxResults.meta, paymentAdapter: "fake" },
};
