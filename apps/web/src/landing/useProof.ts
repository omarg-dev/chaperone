import type { ResultsView } from "@firewall/eval/view";
import { useEffect, useState } from "react";
import { fetchResults, fetchResultsList } from "../api";
import { type ColumnView, columnViews, type Proof, proofOf, selectResults } from "./proof";

export interface LandingData {
  status: "loading" | "ready" | "unavailable";
  columns: ColumnView[];
  heldOut: { file: string; proof: Proof } | null;
}

const idle: LandingData = { status: "loading", columns: [], heldOut: null };

// Reads the results files the page draws, once: the list, then the picked files. When the server
// has none, or doesn't answer, every column reads "Running" and the page still stands.
export function useProof(): LandingData {
  const [data, setData] = useState<LandingData>(idle);
  useEffect(() => {
    let current = true;
    (async () => {
      const list = await fetchResultsList();
      const selection = selectResults(list.results);
      const names = [...selection.columns.map((c) => c.file), selection.heldOut].filter(
        (name): name is string => name !== null,
      );
      // A file that can't be read is a column that is still running.
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
      const held = selection.heldOut ? files[selection.heldOut] : undefined;
      const heldProof = held ? proofOf(held) : null;
      if (!current) return;
      setData({
        status: "ready",
        columns: columnViews(selection, files),
        heldOut:
          selection.heldOut && heldProof ? { file: selection.heldOut, proof: heldProof } : null,
      });
    })().catch(() => {
      if (!current) return;
      setData({
        status: "unavailable",
        columns: columnViews(selectResults([]), {}),
        heldOut: null,
      });
    });
    return () => {
      current = false;
    };
  }, []);
  return data;
}
