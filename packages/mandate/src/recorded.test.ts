import { readFileSync } from "node:fs";
import { BENIGN_SCENARIOS } from "@firewall/arena";
import { describe, expect, it } from "vitest";
import { compareWithIntent } from "./accuracy.js";
import { type RecordedResponse, requestSha256 } from "./recorded.js";
import { builderAnswering } from "./test-helpers.js";

// The builder's live answers to every benign scenario's request, recorded once with
// `pnpm --filter @firewall/mandate record-fixtures` and replayed here. Nothing calls a model.
const load = (scenarioId: string): RecordedResponse =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/benign/${scenarioId}.json`, import.meta.url), "utf8"),
  );

describe.each(BENIGN_SCENARIOS.map((s) => [s.scenarioId, s] as const))(
  "the recorded draft for %s",
  (scenarioId, scenario) => {
    const fixture = load(scenarioId);
    const { builder, sent } = builderAnswering(fixture.response);

    it("was recorded for this scenario's request, with the prompt and schema the builder sends now", () => {
      expect(fixture.requestText).toBe(scenario.request);
      expect(
        requestSha256(builder.request(scenario.request)),
        "The prompt or schema changed since the fixtures were recorded: run " +
          "pnpm --filter @firewall/mandate record-fixtures (about a fifth of a cent) and commit them",
      ).toBe(fixture.requestSha256);
    });

    it("asks for exactly what the scenario's intent says the person wanted", async () => {
      const { draft } = await builder.draft(scenario.request);
      expect(sent).toHaveLength(1);
      const accuracy = compareWithIntent(draft, scenario.intent);
      expect(
        accuracy.fields.filter((f) => f.direction !== "same"),
        `${scenarioId}: ${draft.requestText}`,
      ).toEqual([]);
      expect(accuracy.exact).toBe(true);
    });
  },
);
