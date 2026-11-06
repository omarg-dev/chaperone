// The MVP's first matrix (results/2026-10-26T0012-fake-claude-haiku-5-5.json), as the server serves it:
// read through `parseResults` in @firewall/eval/view, so only the fields the dashboard draws are
// here. It is a fake-adapter result, which is what the page's banner is tested on. The numbers are
// the harness's own: 68.8% attack success with the firewall off, 25.0% with Gate 0 only, 0.0% with
// the full tree, over 16 attack runs.
import type { ResultsView } from "@firewall/eval/view";
import firstMatrix from "./first-matrix.json";

export const fakeResults = firstMatrix as unknown as ResultsView;

// The same file as a sandbox result, to tell the two apart.
export const sandboxResults: ResultsView = {
  ...fakeResults,
  meta: { ...fakeResults.meta, paymentAdapter: "sandbox" },
};
