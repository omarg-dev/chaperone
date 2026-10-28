// The theme follows the device until the person picks one, and the pick is remembered per browser.
// An explicit pick is written to <html data-theme> (tokens.css reads it); "system" removes the
// attribute, so the device's own preference decides. index.html applies a stored pick before the
// first paint with a copy of readPreference's logic, so the page doesn't flash the wrong theme.

export const THEME_KEY = "chaperone-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(preference: ThemePreference, deviceIsDark: boolean): ResolvedTheme {
  if (preference === "system") return deviceIsDark ? "dark" : "light";
  return preference;
}

// Storage can be missing or throw (private windows, blocked site data), and the app works without it.
export function readPreference(storage: Pick<Storage, "getItem"> | undefined): ThemePreference {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function writePreference(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  preference: ThemePreference,
) {
  try {
    if (preference === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, preference);
  } catch {
    // The choice still applies for this visit.
  }
}

export function applyPreference(root: HTMLElement, preference: ThemePreference) {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export const deviceQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : undefined;

export const safeStorage = () => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};
