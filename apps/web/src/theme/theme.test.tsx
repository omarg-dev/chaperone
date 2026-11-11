import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDevice } from "../test-utils";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { readPreference, resolveTheme, THEME_KEY, toggled } from "./theme";

afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <ThemeProvider>
      <ThemeSwitch />
    </ThemeProvider>,
  );

const root = document.documentElement;
const toggle = (to: "light" | "dark") =>
  screen.getByRole("button", { name: `Switch to ${to} theme` });

describe("resolveTheme", () => {
  it("follows the device until a theme is picked", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads only a stored light or dark, and survives storage that throws", () => {
    expect(readPreference({ getItem: () => "dark" })).toBe("dark");
    expect(readPreference({ getItem: () => "purple" })).toBe("system");
    expect(readPreference({ getItem: () => null })).toBe("system");
    expect(
      readPreference({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("system");
  });

  it("switches to the other theme, and follows the device again when that is the device's", () => {
    // On a light device: dark is a pick, and back to light is no pick at all.
    expect(toggled("light", false)).toBe("dark");
    expect(toggled("dark", false)).toBe("system");
    // On a dark device, the other way round.
    expect(toggled("dark", true)).toBe("light");
    expect(toggled("light", true)).toBe("system");
  });
});

describe("the theme switch", () => {
  it("is one button, named for what a click does", () => {
    mockDevice(false);
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(toggle("dark")).toHaveAttribute("data-resolved", "light");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("follows the device by default, and keeps following it as it changes", async () => {
    const setDevice = mockDevice(true);
    mount();

    expect(toggle("light")).toHaveAttribute("data-resolved", "dark");
    expect(root).not.toHaveAttribute("data-theme");

    setDevice(false);
    await vi.waitFor(() => expect(toggle("dark")).toHaveAttribute("data-resolved", "light"));
    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("remembers a choice in this browser", async () => {
    mockDevice(false);
    const user = userEvent.setup();
    const first = mount();

    await user.click(toggle("dark"));
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(toggle("light")).toHaveAttribute("data-resolved", "dark");

    // A later visit starts from the choice, whatever the device says.
    first.unmount();
    root.removeAttribute("data-theme");
    mount();
    expect(toggle("light")).toBeInTheDocument();
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("goes back to following the device when switched back to its theme, and forgets the choice", async () => {
    const setDevice = mockDevice(true);
    localStorage.setItem(THEME_KEY, "light");
    const user = userEvent.setup();
    mount();
    expect(root).toHaveAttribute("data-theme", "light");

    await user.click(toggle("dark"));
    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(toggle("light")).toHaveAttribute("data-resolved", "dark");

    // Following again: the device going light takes the page with it.
    setDevice(false);
    await vi.waitFor(() => expect(toggle("dark")).toHaveAttribute("data-resolved", "light"));
  });
});
