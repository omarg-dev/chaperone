import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { RunEvent } from "./events";
import { clampPosition, nextPosition, parseAt, type Speed, stepBy, stepDelayMs } from "./playhead";

// How long the address waits to follow the playhead once it has stopped moving. A browser limits
// how often a page may rewrite its address, so a scrubber dragged across the run mustn't write it
// at every event.
export const URL_SETTLE_MS = 200;

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Replay {
  // Replay is on: the run view draws the events up to the playhead, not the whole run.
  open: boolean;
  // How many events are shown (1 to the number in the run); the whole run when replay is off.
  position: number;
  playing: boolean;
  speed: Speed;
  start: () => void;
  exit: () => void;
  toggle: () => void;
  step: (delta: number) => void;
  seek: (position: number) => void;
  setSpeed: (speed: Speed) => void;
}

// The replay's state. The playhead's position is kept in the address (`?at=`) so a shared link
// opens at that moment, but only once the run is done: a run still in progress is followed live,
// and an `at` on its address waits until it is over. While it plays the address is left alone and
// follows when it stops.
export function useReplay(events: readonly RunEvent[], available: boolean): Replay {
  const [params, setParams] = useSearchParams();
  const total = events.length;
  const [position, setPosition] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1x");
  // The address is read once, when the run is first known to be done; after that the playhead leads.
  const [synced, setSynced] = useState(false);
  const at = params.get("at");

  useEffect(() => {
    if (!available || synced) return;
    // A replay the person has already started is theirs; the address only opens one that isn't.
    setPosition((current) => current ?? parseAt(at, events));
    setSynced(true);
  }, [available, synced, at, events]);

  // The playhead moves on by the gap before the next event.
  useEffect(() => {
    if (!playing || position === null) return;
    if (position >= total) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setPosition(nextPosition(position, total, speed)),
      stepDelayMs(events, position, speed),
    );
    return () => clearTimeout(timer);
  }, [playing, position, speed, events, total]);

  // The address follows the playhead once it is still.
  const wanted = position === null ? null : String(position);
  useEffect(() => {
    if (!available || !synced || playing || wanted === at) return;
    const timer = setTimeout(
      () =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (wanted === null) next.delete("at");
            else next.set("at", wanted);
            return next;
          },
          { replace: true },
        ),
      URL_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [available, synced, playing, wanted, at, setParams]);

  const latest = useRef({ position, total });
  latest.current = { position, total };

  const start = useCallback(() => {
    setPosition(1);
    // Asked to keep still, it opens paused on the first event and waits to be played or stepped.
    setPlaying(!prefersReducedMotion());
  }, []);
  const exit = useCallback(() => {
    setPlaying(false);
    setPosition(null);
  }, []);
  const toggle = useCallback(() => {
    const { position: here, total: all } = latest.current;
    if (here === null) return;
    // Played again from the end, it starts over.
    if (here >= all && !playing) {
      setPosition(1);
      setPlaying(true);
    } else {
      setPlaying(!playing);
    }
  }, [playing]);
  const step = useCallback((delta: number) => {
    const { position: here, total: all } = latest.current;
    if (here === null) return;
    setPlaying(false);
    setPosition(stepBy(here, delta, all));
  }, []);
  const seek = useCallback((to: number) => {
    const { total: all } = latest.current;
    setPlaying(false);
    setPosition(clampPosition(to, all));
  }, []);

  const open = available && position !== null && total > 0;
  return {
    open,
    position: open ? clampPosition(position, total) : total,
    playing: open && playing,
    speed,
    start,
    exit,
    toggle,
    step,
    seek,
    setSpeed,
  };
}
