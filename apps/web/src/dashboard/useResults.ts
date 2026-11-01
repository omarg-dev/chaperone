import type { ResultsView } from "@firewall/eval/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchResults, fetchResultsList, type ResultsList } from "../api";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : "The server didn't answer.";

// The list of the server's results files, read once and again on `reload`.
export function useResultsList() {
  const [state, setState] = useState<Loaded<ResultsList>>({ status: "loading" });
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    setState({ status: "loading" });
    fetchResultsList().then(
      (value) => generation.current === mine && setState({ status: "ready", value }),
      (error) =>
        generation.current === mine && setState({ status: "error", message: messageOf(error) }),
    );
  }, []);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return { state, reload: load };
}

// One results file, read when its name changes. No name, nothing loads.
export function useResultsFile(name: string | null) {
  const [state, setState] = useState<Loaded<ResultsView>>({ status: "loading" });
  useEffect(() => {
    if (name === null) return;
    let current = true;
    setState({ status: "loading" });
    fetchResults(name).then(
      (value) => current && setState({ status: "ready", value }),
      (error) => current && setState({ status: "error", message: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [name]);
  return state;
}
