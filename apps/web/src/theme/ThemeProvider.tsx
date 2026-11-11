import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  applyPreference,
  deviceQuery,
  type ResolvedTheme,
  readPreference,
  resolveTheme,
  safeStorage,
  type ThemePreference,
  toggled,
  writePreference,
} from "./theme";

interface ThemeState {
  preference: ThemePreference;
  // What is showing now, whether the person picked it or the device did.
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  // Switches to the other theme. Landing back on what the device shows is following it again.
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(() => readPreference(safeStorage()));
  const [deviceIsDark, setDeviceIsDark] = useState(() => deviceQuery()?.matches ?? false);

  useEffect(() => {
    const query = deviceQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setDeviceIsDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyPreference(document.documentElement, preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writePreference(safeStorage(), next);
    setPreferenceState(next);
  }, []);

  const resolved = resolveTheme(preference, deviceIsDark);
  const toggle = useCallback(
    () => setPreference(toggled(resolved, deviceIsDark)),
    [resolved, deviceIsDark, setPreference],
  );

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider above it");
  return state;
}
