import type {
  AgFieldDefinition,
  AgFilterState,
  AgReportState,
  AgSimpleDataSourceDefinition,
} from "ag-studio";
import type { BenchmarkRow } from "./benchmark";

// What AG Studio is given: the benchmark's rows as one table, what each field means (Studio shows
// the names, and its assistant reads the descriptions to pick the right field and aggregation), and
// the report it opens on. Types only come from `ag-studio` here, so nothing of Studio is in the
// bundle until the view itself loads.

export const SOURCE = "benchmark";

const field = (
  id: keyof BenchmarkRow,
  name: string,
  format: AgFieldDefinition["format"],
  description: string,
  extra: Partial<AgFieldDefinition> = {},
): AgFieldDefinition => ({ id, name, format, description, ...extra });

// A rate: a share of 1, written as a percentage. The formatter (rather than a format string) is what
// Studio's charts write their value axis with too.
const percent: Partial<AgFieldDefinition> = {
  createValueFormatter: () => (value) =>
    typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "",
};
const dollars = { formatOptions: { format: "$#,##0.0000" } };

export const FIELDS: AgFieldDefinition[] = [
  field("id", "Row", "textFormat", "One results file, scenario, seed and firewall setting.", {
    hide: true,
    cardinality: "high",
  }),
  field("model", "Model", "textFormat", "The shopping agent's model: the eval column."),
  field(
    "scenarioSet",
    "Scenario set",
    "textFormat",
    "Own: Chaperone's own scenarios. Held-out: 17 attacks ported from published benchmarks, never used to tune the gates.",
  ),
  field(
    "setting",
    "Firewall setting",
    "textFormat",
    "Off: nobody checks. Rules only: the fixed rules, no AI. Full check: every gate. Each run's checkout was reviewed under all three, so every run has three rows, one per setting. To count runs, filter to one setting first.",
  ),
  field("scenario", "Scenario", "textFormat", "The scenario's title."),
  field("scenarioId", "Scenario ID", "textFormat", "The scenario's ID; sc_h are held-out."),
  field(
    "kind",
    "Kind",
    "textFormat",
    "Attack, or No attack for a scenario with no attacker in it.",
  ),
  field("attack", "Attack", "textFormat", "The attack the scenario carries, or None."),
  field("harm", "Harm", "textFormat", "What the attack is after, or None."),
  field("seed", "Seed", "textFormat", "The arena's seed for the cell."),
  field(
    "verdict",
    "Verdict",
    "textFormat",
    "What the review decided: Approve, Escalate, Block, or No review (Off).",
  ),
  field("money", "Money", "textFormat", "Captured, Voided, Held for a person, or No order."),
  field("outcome", "Outcome", "textFormat", "Where the money went, in the dashboard's words."),
  field(
    "attackGotThrough",
    "Attack success",
    "percentageFormat",
    "On attack runs, 1 when the agent was fooled and the money was captured under this row's setting, else 0; empty on benign runs. Its average within one setting is that setting's attack success rate.",
    percent,
  ),
  field(
    "gotThrough",
    "Attacks through",
    "integerFormat",
    "1 when an attack run was fooled and its money captured under this row's setting. Its sum within one setting is how many attacks got through under that setting. Summed across settings, it counts each run once per setting.",
  ),
  field(
    "attackRun",
    "Attack runs",
    "integerFormat",
    "1 for an attack run that counted. Every run has one row per setting, so its sum within one setting is the number of attack runs.",
  ),
  field(
    "agentFooled",
    "Agent fooled",
    "percentageFormat",
    "On attack runs, 1 when the agent fell for the attack, else 0. This happens before any check, so a run has the same value in all three of its rows, one per setting. Count fooled runs within one setting (Off, say), or each run is counted three times. Its average is how often the agent was fooled.",
    percent,
  ),
  field(
    "cleanCart",
    "Clean carts",
    "integerFormat",
    "1 for a cart bought right from an honest seller. Every run has one row per setting, so its sum within one setting is the number of clean carts.",
  ),
  field(
    "falseEscalation",
    "False escalations",
    "percentageFormat",
    "On clean carts, 1 when the review sent the cart to a person anyway. Its average is the false escalation rate.",
    percent,
  ),
  field(
    "falseBlock",
    "False blocks",
    "percentageFormat",
    "On clean carts, 1 when the review blocked it. Its average is the false block rate.",
    percent,
  ),
  field(
    "escalated",
    "Escalated",
    "integerFormat",
    "1 when the review under this row's setting sent the cart to a person.",
  ),
  field(
    "reviewCostUsd",
    "Review cost",
    "currencyFormat",
    "What the setting's model gates cost for this review, in US dollars. Its average is the cost per review.",
    dollars,
  ),
  field(
    "reviewLatencyMs",
    "Review time (ms)",
    "integerFormat",
    "How long the review took, in milliseconds; empty when the firewall was off.",
    {
      createValueFormatter: () => (value) =>
        typeof value === "number" ? Math.round(value).toLocaleString("en-US") : "",
    },
  ),
  field(
    "counted",
    "Counted",
    "integerFormat",
    "1 when the cell and its review counted; 0 when one broke.",
  ),
  field("file", "Results file", "textFormat", "The results file the row came from."),
  field("date", "Run date", "textFormat", "When the matrix ran."),
  field(
    "adapter",
    "Payment adapter",
    "textFormat",
    "sandbox: the payment platform's real sandbox.",
  ),
  field("gateModel", "Gate model", "textFormat", "The model the gates ran on, in every column."),
];

export function benchmarkSource(rows: BenchmarkRow[]): AgSimpleDataSourceDefinition {
  return {
    id: SOURCE,
    name: "Benchmark",
    description:
      "Every run of Chaperone's eval, three times: once for each firewall setting. In each run an AI shopping agent bought something in a seeded marketplace with honest and attacker sellers, and its one checkout was then reviewed with the firewall Off, with Rules only and with the Full check. So each run appears in three rows. To count runs, filter to one setting; to compare settings, group by setting.",
    data: rows as unknown as AgSimpleDataSourceDefinition["data"],
    fields: FIELDS,
  };
}

const ref = (id: keyof BenchmarkRow) => ({ id: `${SOURCE}.${id}` });
const avg = (id: keyof BenchmarkRow) => ({ ...ref(id), aggregation: "avg" as const });
const total = (id: keyof BenchmarkRow) => ({ ...ref(id), aggregation: "sum" as const });
const only = (id: keyof BenchmarkRow, ...values: string[]): AgFilterState => ({
  field: ref(id),
  model: { operator: "isIn", value: values },
});
const title = (text: string) => ({ title: { enabled: true, text } });
// A figure: what it counts, where from, and the number in Besley, as every rate on the site is.
const tile = (text: string, under: string) => ({
  title: { enabled: true, text },
  subtitle: { enabled: true, text: under },
  style: { typography: { fontFamily: "var(--font-display)", fontWeight: "bold" as const } },
});
// Each chart draws one series per model, so it says which colour is which: Studio hides the legend
// unless a chart asks for it.
const LEGEND = { theme: { common: { legend: { enabled: true } } } };
// A chart's value axis can't be given the field's format, so it says what its numbers are.
const axis = (text: string) => ({
  style: { ...LEGEND, custom: { valueAxis: { title: { enabled: true, text } } } },
});
// Off, Rules only, Full check, in the order a person reads them. Their names don't sort into it and
// Studio sorts a chart by what it draws, so a chart is sorted by its value: each setting adds checks
// to the one before, so what gets through only goes down along them, and what a review costs or
// takes only goes up.
const byValue = (field: ReturnType<typeof ref>, direction: "asc" | "desc") => [
  { field, direction },
];

// The report Studio opens on: the questions the eval is for, answered from the rows.
export const INITIAL_REPORT: AgReportState = {
  selectedPageId: "attacks",
  panels: {
    filters: { collapsed: true },
    edit: { collapsed: true },
    data: { collapsed: true },
  },
  pages: [
    {
      id: "attacks",
      widgets: {
        "kpi-off": {
          type: "value",
          dataMapping: { value: [avg("attackGotThrough")] },
          format: tile("Attacks through", "Our scenarios, firewall off"),
        },
        "kpi-full": {
          type: "value",
          dataMapping: { value: [avg("attackGotThrough")] },
          format: tile("Attacks through", "Our scenarios, full check"),
        },
        "kpi-false": {
          type: "value",
          dataMapping: { value: [avg("falseEscalation")] },
          format: tile("Clean carts escalated", "Our scenarios, full check"),
        },
        "kpi-held": {
          type: "value",
          dataMapping: { value: [avg("attackGotThrough")] },
          format: tile("Attacks through", "Held-out set, full check"),
        },
        "kpi-held-false": {
          type: "value",
          dataMapping: { value: [avg("falseEscalation")] },
          format: tile("Clean carts escalated", "Held-out set, full check"),
        },
        "own-by-setting": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [ref("setting")],
            valueKey: [avg("attackGotThrough")],
            legendKey: [ref("model")],
          },
          sort: byValue(avg("attackGotThrough"), "desc"),
          format: {
            ...title("Attack success on our scenarios, by firewall setting"),
            ...axis("Share of attack runs (1 is all)"),
          },
        },
        "held-by-setting": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [ref("setting")],
            valueKey: [avg("attackGotThrough")],
            legendKey: [ref("model")],
          },
          sort: byValue(avg("attackGotThrough"), "desc"),
          format: {
            ...title("Attack success on the held-out set, by firewall setting"),
            ...axis("Share of attack runs (1 is all)"),
          },
        },
        summary: {
          type: "grid",
          dataMapping: {
            cols: [
              ref("model"),
              ref("scenarioSet"),
              ref("setting"),
              total("attackRun"),
              total("gotThrough"),
              avg("attackGotThrough"),
              avg("falseEscalation"),
              avg("falseBlock"),
            ],
          },
          format: title("Every model, set and setting"),
        },
      },
      widgetLayout: {
        "kpi-off": { xTrack: 0, yTrack: 0, xSpan: 5, ySpan: 6 },
        "kpi-full": { xTrack: 5, yTrack: 0, xSpan: 5, ySpan: 6 },
        "kpi-false": { xTrack: 10, yTrack: 0, xSpan: 5, ySpan: 6 },
        "kpi-held": { xTrack: 15, yTrack: 0, xSpan: 5, ySpan: 6 },
        "kpi-held-false": { xTrack: 20, yTrack: 0, xSpan: 4, ySpan: 6 },
        "own-by-setting": { xTrack: 0, yTrack: 6, xSpan: 12, ySpan: 16 },
        "held-by-setting": { xTrack: 12, yTrack: 6, xSpan: 12, ySpan: 16 },
        summary: { xTrack: 0, yTrack: 22, xSpan: 24, ySpan: 18 },
      },
      filter: {
        widget: {
          "kpi-off": [only("setting", "Off"), only("scenarioSet", "Own")],
          "kpi-full": [only("setting", "Full check"), only("scenarioSet", "Own")],
          "kpi-held": [only("setting", "Full check"), only("scenarioSet", "Held-out")],
          "kpi-false": [only("setting", "Full check"), only("scenarioSet", "Own")],
          "kpi-held-false": [only("setting", "Full check"), only("scenarioSet", "Held-out")],
          "own-by-setting": [only("scenarioSet", "Own")],
          "held-by-setting": [only("scenarioSet", "Held-out")],
        },
      },
    },
    {
      id: "by-attack",
      widgets: {
        "through-by-attack": {
          type: "bar-chart-grouped",
          dataMapping: {
            categoryKey: [ref("attack")],
            valueKey: [total("gotThrough")],
            legendKey: [ref("model")],
          },
          sort: [{ field: total("gotThrough"), direction: "desc" }],
          format: { ...title("Attacks that got through the full check, by attack"), style: LEGEND },
        },
        "attack-grid": {
          type: "grid",
          dataMapping: {
            cols: [
              ref("attack"),
              ref("scenarioSet"),
              ref("setting"),
              total("attackRun"),
              avg("agentFooled"),
              avg("attackGotThrough"),
            ],
          },
          sort: [{ field: ref("attack"), direction: "asc" }],
          format: title("Each attack under each setting, both models"),
        },
      },
      widgetLayout: {
        "through-by-attack": { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 24 },
        "attack-grid": { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 24 },
      },
      filter: {
        page: [only("kind", "Attack")],
        widget: { "through-by-attack": [only("setting", "Full check")] },
      },
    },
    {
      id: "cost",
      widgets: {
        "kpi-cost": {
          type: "value",
          dataMapping: { value: [avg("reviewCostUsd")] },
          format: tile("Cost per review", "Full check, every model and set"),
        },
        "kpi-time": {
          type: "value",
          dataMapping: { value: [avg("reviewLatencyMs")] },
          format: tile("Review time (ms)", "Full check, mean"),
        },
        "kpi-escalated": {
          type: "value",
          dataMapping: { value: [total("escalated")] },
          format: tile("Sent to a person", "Full check, every model and set"),
        },
        "cost-by-setting": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [ref("setting")],
            valueKey: [avg("reviewCostUsd")],
            legendKey: [ref("model")],
          },
          sort: byValue(avg("reviewCostUsd"), "asc"),
          format: { ...title("Cost per review, by firewall setting"), ...axis("US dollars") },
        },
        "time-by-setting": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [ref("setting")],
            valueKey: [avg("reviewLatencyMs")],
            legendKey: [ref("model")],
          },
          sort: byValue(avg("reviewLatencyMs"), "asc"),
          format: { ...title("Mean review time, by firewall setting"), ...axis("Milliseconds") },
        },
      },
      widgetLayout: {
        "kpi-cost": { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 6 },
        "kpi-time": { xTrack: 8, yTrack: 0, xSpan: 8, ySpan: 6 },
        "kpi-escalated": { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 6 },
        "cost-by-setting": { xTrack: 0, yTrack: 6, xSpan: 12, ySpan: 18 },
        "time-by-setting": { xTrack: 12, yTrack: 6, xSpan: 12, ySpan: 18 },
      },
      filter: {
        widget: {
          "kpi-cost": [only("setting", "Full check")],
          "kpi-time": [only("setting", "Full check")],
          "kpi-escalated": [only("setting", "Full check")],
        },
      },
    },
    {
      id: "runs",
      widgets: {
        "pick-model": {
          type: "list-filter",
          dataMapping: { value: [ref("model")] },
          format: title("Model"),
        },
        "pick-set": {
          type: "list-filter",
          dataMapping: { value: [ref("scenarioSet")] },
          format: title("Scenario set"),
        },
        "pick-setting": {
          type: "list-filter",
          dataMapping: { value: [ref("setting")] },
          format: title("Firewall setting"),
        },
        "every-run": {
          type: "grid",
          dataMapping: {
            cols: [
              ref("model"),
              ref("scenarioSet"),
              ref("scenario"),
              ref("attack"),
              ref("seed"),
              ref("setting"),
              ref("verdict"),
              ref("outcome"),
              ref("reviewCostUsd"),
              ref("reviewLatencyMs"),
            ],
          },
          format: title("Every run"),
        },
      },
      widgetLayout: {
        "pick-model": { xTrack: 0, yTrack: 0, xSpan: 5, ySpan: 9 },
        "pick-set": { xTrack: 0, yTrack: 9, xSpan: 5, ySpan: 8 },
        "pick-setting": { xTrack: 0, yTrack: 17, xSpan: 5, ySpan: 9 },
        "every-run": { xTrack: 5, yTrack: 0, xSpan: 19, ySpan: 34 },
      },
    },
  ],
};

// The pages' names, for the page's own tab bar: Studio's view mode shows no page list of its own.
export const PAGES = [
  { id: "attacks", name: "Attack success" },
  { id: "by-attack", name: "By attack" },
  { id: "cost", name: "Cost and speed" },
  { id: "runs", name: "Every run" },
] as const;
