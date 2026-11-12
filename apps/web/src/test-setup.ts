import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// A page that draws a grid or a lazy chunk is slow to appear when many test files share the machine;
// waiting longer for it to show up never makes a test pass that would have failed.
configure({ asyncUtilTimeout: 8000 });

// jsdom lays nothing out, so it has no window.scrollTo; the shell calls it each time a link is
// followed. A test that checks the scrolling spies on it.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// Times show in the viewer's zone, so the tests pick one.
process.env.TZ = "Asia/Riyadh";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
