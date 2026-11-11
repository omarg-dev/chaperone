import { useTheme } from "./ThemeProvider";

// The icon of the theme a click switches to: a moon while the page is light, a sun while it is dark.
const PATHS = {
  dark: ["M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6Z"],
  light: [
    "M8 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z",
    "M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
  ],
};

// One button that switches between light and dark. The page follows the device until it is
// clicked; its name is what a click does ("Switch to dark theme"), which is also its text where
// there is room for words (the phone menu).
export function ThemeSwitch() {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  const says = `Switch to ${next} theme`;
  return (
    <button
      type="button"
      className="theme-toggle"
      data-resolved={resolved}
      title={says}
      onClick={toggle}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {PATHS[next].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span className="theme-toggle-text">{says}</span>
    </button>
  );
}
