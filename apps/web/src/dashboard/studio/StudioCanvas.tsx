import {
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgDataSourcesDefinition,
  AgStudioAiModule,
  type AgStudioMode,
  createAiHarness,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { StudioConfig } from "../../api";
import { useTheme } from "../../theme/ThemeProvider";
import { serverAdapter } from "./adapter";
import type { BenchmarkRow } from "./benchmark";
import { benchmarkSource, INITIAL_REPORT, PAGES } from "./report";
import { benchmarkTheme } from "./theme";

// AG Studio over the benchmark. This file is the lazy chunk: everything that imports Studio's code
// is here or below it, so the dashboard's other view never loads it.
//
// Visitors explore: view mode keeps the report as it opens, cross-filtering and the filters panel
// still work. Edit mode lets anyone rearrange it or build their own widgets; it is the page's own
// state, kept in this tab only, and nothing of it reaches the server. The assistant, when the server
// has a model key and budget left, answers through the server's `POST /studio/ai`.

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: "Which model is fooled more?",
    prompt:
      "Compare how often each model's agent was fooled before any firewall, on our scenarios and on the held-out set.",
  },
  {
    label: "The held-out result",
    prompt:
      "On the held-out set, how many attacks got through with the firewall off and with the full tree, for each model?",
  },
  {
    label: "False escalations",
    prompt:
      "Which clean carts did the full tree send to a person, and in which scenarios? Count them per model.",
  },
];

export default function StudioCanvas({
  rows,
  config,
}: {
  rows: BenchmarkRow[];
  config: StudioConfig;
}) {
  const { resolved } = useTheme();
  const studio = useRef<AgStudio>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [page, setPage] = useState<string>(INITIAL_REPORT.selectedPageId);
  // The assistant is on when the server says so at load, and stays on until a turn is refused for
  // the day's budget, when the page says so instead.
  const [assistantOff, setAssistantOff] = useState<string | null>(
    config.ai.available ? null : config.ai.reason,
  );
  const aiOn = config.ai.available;

  const data = useMemo<AgDataSourcesDefinition>(
    () => ({ sources: [benchmarkSource(rows)] }),
    [rows],
  );
  // Studio's AI module is registered only when the server can answer it.
  const modules = useMemo(() => (aiOn ? [AgStudioAiModule] : []), [aiOn]);
  const ai = useMemo<AgAiHarnessSetup | undefined>(
    () =>
      aiOn
        ? ({ api }) =>
            createAiHarness(api, {
              adapter: serverAdapter({
                onRefused: (error) => {
                  if (error.code === "budget_spent" || error.code === "assistant_off") {
                    setAssistantOff(error.message);
                  }
                },
              }),
              promptStarters: PROMPT_STARTERS,
            })
        : undefined,
    [aiOn],
  );

  const showPage = useCallback((id: string) => {
    const api = studio.current?.api;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id });
    setPage(id);
  }, []);

  return (
    <div className="benchmark-studio">
      <div className="benchmark-bar">
        <div className="tabs" role="tablist" aria-label="Report pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={page === p.id}
              onClick={() => showPage(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <fieldset className="benchmark-mode" aria-label="Studio mode">
          <button
            type="button"
            className="tab"
            aria-pressed={mode === "view"}
            onClick={() => setMode("view")}
          >
            Explore
          </button>
          <button
            type="button"
            className="tab"
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            Build your own
          </button>
        </fieldset>
      </div>
      <p className="t-meta benchmark-assistant" role="status">
        {assistantOff ??
          `The assistant runs on Claude Haiku 5.5 through this server, up to $${config.ai.budget.capUsd.toFixed(2)} a day. Open "Build your own" to ask it about the benchmark.`}
      </p>
      <div className="ag-theme-mode benchmark-canvas" data-ag-theme-mode={resolved}>
        <AgStudioProvider
          modules={modules}
          {...(config.licenseKey && { licenseKey: config.licenseKey })}
        >
          <AgStudio
            ref={studio}
            data={data}
            initialState={INITIAL_REPORT}
            mode={mode}
            theme={benchmarkTheme}
            loadThemeGoogleFonts={false}
            {...(ai && { ai })}
            style={{ height: "100%", width: "100%" }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
