import { useSyncExternalStore } from "react";

// The width at and under which the app is on a phone: the top bar folds into a menu (shell.css uses
// the same number) and a page may draw less (a table with fewer columns).
export const NARROW_QUERY = "(max-width: 760px)";

const query = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY)
    : undefined;

function subscribe(onChange: () => void) {
  const media = query();
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

// Whether the screen is a phone's width right now. Layout is CSS's job; this is for what CSS can't
// do, such as giving a grid different columns.
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}
