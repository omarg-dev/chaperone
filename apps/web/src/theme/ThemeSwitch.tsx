import { useTheme } from "./ThemeProvider";
import { THEME_PREFERENCES, type ThemePreference } from "./theme";

const LABELS: Record<ThemePreference, string> = {
  system: "Match device",
  light: "Light",
  dark: "Dark",
};

const PATHS: Record<ThemePreference, string[]> = {
  system: [
    "M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3Z",
    "M5.5 13.5h5",
  ],
  light: [
    "M8 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z",
    "M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
  ],
  dark: ["M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6Z"],
};

// A three-way switch: match the device (the default), light or dark. Real radio buttons, so the
// arrow keys and the screen reader's group announcement come for free.
export function ThemeSwitch() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <fieldset className="theme-switch" data-resolved={resolved}>
      <legend className="visually-hidden">Theme</legend>
      {THEME_PREFERENCES.map((option) => (
        <label key={option} className="theme-option" title={LABELS[option]}>
          <input
            type="radio"
            name="theme"
            className="visually-hidden"
            checked={preference === option}
            onChange={() => setPreference(option)}
          />
          <span className="visually-hidden">{LABELS[option]}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {PATHS[option].map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </label>
      ))}
    </fieldset>
  );
}
