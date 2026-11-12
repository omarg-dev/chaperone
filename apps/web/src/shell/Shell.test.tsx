import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escalated, mockDevice, mockServer, renderApp, run } from "../test-utils";
import { CONTACT, REPO_URL } from "./Footer";

beforeEach(() => {
  mockDevice(false);
  mockServer();
});
afterEach(() => vi.unstubAllGlobals());

const menuButton = () => screen.getByRole("button", { name: /^Menu/ });

describe("the phone menu", () => {
  it("opens the navigation from one button, and puts the focus on its first link", async () => {
    const user = userEvent.setup();
    renderApp("/runs");
    const button = menuButton();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "topbar-menu");
    const menu = document.getElementById("topbar-menu") as HTMLElement;
    // The links and the theme button are the menu's, so a phone finds both behind the one button.
    expect(within(menu).getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveTextContent("Close");
    expect(within(menu).getByRole("link", { name: "Runs" })).toHaveFocus();
  });

  it("closes on Escape and gives the focus back to its button", async () => {
    const user = userEvent.setup();
    renderApp("/runs");
    await user.click(menuButton());
    await user.keyboard("{Escape}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("closes when a link is followed or the page is pressed, and stays open for the theme", async () => {
    const user = userEvent.setup();
    renderApp("/runs");
    const nav = screen.getByRole("navigation", { name: "Main" });

    await user.click(menuButton());
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");

    await user.click(within(nav).getByRole("link", { name: "Docs" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByRole("navigation", { name: "On this page" })).toBeInTheDocument();

    await user.click(menuButton());
    await user.click(screen.getByRole("main"));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("says on the closed button how many purchases are waiting", async () => {
    mockServer({
      runs: [
        run("run_a", "sc_b01", "2026-10-24T10:00:00Z", escalated.waiting),
        run("run_b", "sc_b02", "2026-10-24T09:00:00Z", escalated.waiting),
      ],
    });
    renderApp("/docs");
    expect(
      await screen.findByRole("button", { name: "Menu, 2 purchases waiting on you" }),
    ).toHaveTextContent("2");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Waiting on you, 2 purchases" })).toHaveAttribute(
      "href",
      "/escalations",
    );
  });

  it("keeps Start a run in the bar, outside the menu", () => {
    renderApp("/docs");
    const menu = document.getElementById("topbar-menu") as HTMLElement;
    const start = screen.getByRole("link", { name: "Start a run" });
    expect(start).toHaveAttribute("href", "/start");
    expect(menu.contains(start)).toBe(false);
  });
});

describe("the footer", () => {
  it.each([
    "/",
    "/runs",
    "/escalations",
    "/dashboard",
    "/docs",
    "/start",
    "/runs/run_nope",
    "/nope",
  ])("is on %s", async (path) => {
    renderApp(path);
    const foot = await screen.findByRole("contentinfo");
    expect(foot).toHaveTextContent("Made by Omar Ghazal");
    expect(within(foot).getByRole("link", { name: CONTACT })).toHaveAttribute(
      "href",
      `mailto:${CONTACT}`,
    );
    expect(within(foot).getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
      "href",
      REPO_URL,
    );
    expect(within(foot).getByRole("link", { name: "MIT licence" })).toHaveAttribute(
      "href",
      `${REPO_URL}/blob/main/LICENSE`,
    );
    expect(within(foot).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(foot).toHaveTextContent("Built on PayPal's sandbox. Sandbox money only.");
  });

  it("has no logo of any company: words and links only", () => {
    renderApp("/docs");
    expect(screen.getByRole("contentinfo").querySelector("img, svg, picture")).toBeNull();
  });
});

describe("following a link", () => {
  it("opens the next page at its top, and an address naming a part at that part", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const scrolled: string[] = [];
    // jsdom has no scrollIntoView, so the test gives it one for as long as it runs.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    renderApp("/runs");
    // The first page opens where the browser puts it.
    expect(scrollTo).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Docs" }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    renderApp("/docs#postman");
    expect(scrolled).toContain("postman");
    scrollTo.mockRestore();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
