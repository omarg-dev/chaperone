import { useEffect, useState } from "react";

// How often the inbox reads the run list while it is open.
export const INBOX_POLL_MS = 7000;

// Keeps a page current: calls `refresh` every few seconds while the tab is visible, and again the
// moment the window gets focus or the tab comes back, so a run that escalated in the meantime shows
// up. Returns the time of the last tick, which the page uses for "held for 3 hours". Stops when the
// page is left.
export function useFreshness(refresh: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      refresh();
    };
    const timer = setInterval(() => {
      if (!document.hidden) tick();
    }, INBOX_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  return now;
}
