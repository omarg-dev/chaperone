import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDevice } from "../test-utils";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { readPreference, resolveTheme, THEME_KEY } from "./theme";

afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <ThemeProvider>
      <ThemeSwitch />
    </ThemeProvider>,
  );

const root = document.documentElement;
const switchEl = () => screen.getByRole("group", { name: "Theme" });

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
});

describe("the theme switch", () => {
  it("follows the device by default, and keeps following it as it changes", async () => {
    const setDevice = mockDevice(true);
    mount();

    expect(screen.getByRole("radio", { name: "Match device" })).toBeChecked();
    expect(root).not.toHaveAttribute("data-theme");
    expect(switchEl()).toHaveAttribute("data-resolved", "dark");

    setDevice(false);
    await vi.waitFor(() => expect(switchEl()).toHaveAttribute("data-resolved", "light"));
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("remembers a choice in this browser", async () => {
    mockDevice(false);
    const user = userEvent.setup();
    const first = mount();

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(switchEl()).toHaveAttribute("data-resolved", "dark");

    // A later visit starts from the choice, whatever the device says.
    first.unmount();
    root.removeAttribute("data-theme");
    mount();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("goes back to following the device, and forgets the choice", async () => {
    mockDevice(true);
    localStorage.setItem(THEME_KEY, "light");
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(root).toHaveAttribute("data-theme", "light");

    await user.click(screen.getByRole("radio", { name: "Match device" }));
    expect(root).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(switchEl()).toHaveAttribute("data-resolved", "dark");
  });
});
