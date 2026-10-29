import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  applyPreference,
  deviceQuery,
  type ResolvedTheme,
  readPreference,
  resolveTheme,
  safeStorage,
  type ThemePreference,
  writePreference,
} from "./theme";

interface ThemeState {
  preference: ThemePreference;
  // What is showing now, whether the person picked it or the device did.
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
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

  return (
    <ThemeContext.Provider
      value={{ preference, resolved: resolveTheme(preference, deviceIsDark), setPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider above it");
  return state;
}
