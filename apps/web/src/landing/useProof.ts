import type { ResultsView } from "@firewall/eval/view";
import { useEffect, useState } from "react";
import { fetchResults, fetchResultsList } from "../api";
import { type ColumnView, proofViews, selectResults } from "./proof";

export interface LandingData {
  status: "loading" | "ready" | "unavailable";
  // One entry per model with a sandbox file: our own attacks, and the held-out set.
  own: ColumnView[];
  heldOut: ColumnView[];
}

const idle: LandingData = { status: "loading", own: [], heldOut: [] };

// Reads the results files the page draws, once: the list, then the picked files. A file that can't
// be read is left out; when the server has none, or doesn't answer, the page says so and still
// stands.
export function useProof(): LandingData {
  const [data, setData] = useState<LandingData>(idle);
  useEffect(() => {
    let current = true;
    (async () => {
      const list = await fetchResultsList();
      const selection = selectResults(list.results);
      const names = [...selection.own, ...selection.heldOut].map((p) => p.file);
      const read = await Promise.all(
        names.map((name) =>
          fetchResults(name).then(
            (view) => [name, view] as const,
            () => null,
          ),
        ),
      );
      const files: Record<string, ResultsView> = Object.fromEntries(
        read.filter((entry) => entry !== null),
      );
      if (!current) return;
      setData({
        status: "ready",
        own: proofViews(selection.own, files),
        heldOut: proofViews(selection.heldOut, files),
      });
    })().catch(() => {
      if (current) setData({ status: "unavailable", own: [], heldOut: [] });
    });
    return () => {
      current = false;
    };
  }, []);
  return data;
}
