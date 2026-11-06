import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLiveStatus, type LiveStatus } from "../api";

// How often the status is read again while a live run is in progress, so the page can offer the
// next start when it ends.
export const BUSY_POLL_MS = 3000;

export interface LiveState {
  status: "loading" | "ready" | "error";
  live: LiveStatus | null;
  reload: () => void;
}

export function useLiveStatus(): LiveState {
  const [status, setStatus] = useState<LiveState["status"]>("loading");
  const [live, setLive] = useState<LiveStatus | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    return fetchLiveStatus().then(
      (next) => {
        if (generation.current !== mine) return null;
        setLive(next);
        setStatus("ready");
        return next;
      },
      () => {
        if (generation.current === mine) setStatus((now) => (now === "ready" ? now : "error"));
        return null;
      },
    );
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      const next = await load();
      if (!stopped && next?.busy) timer = setTimeout(tick, BUSY_POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      generation.current++;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  return { status, live, reload: () => void load() };
}
