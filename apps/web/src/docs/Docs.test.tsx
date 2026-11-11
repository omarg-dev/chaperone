import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import README from "../../../../README.md?raw";
import { mockDevice, mockServer, renderApp } from "../test-utils";
import { SDK_DOCS } from "./sdk";

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

const EXAMPLE = "pnpm --filter @firewall/sdk example";

describe("the docs page", () => {
  it("draws every heading of docs/sdk.md", () => {
    mockServer();
    renderApp("/docs");
    const headings = [...SDK_DOCS.matchAll(/^(#{1,3}) (.+)$/gm)].map((m) => ({
      level: m[1]?.length ?? 0,
      name: (m[2] ?? "").replace(/`/g, "").replace(/ \{#[a-z0-9-]+\}$/, ""),
    }));
    expect(headings.length).toBeGreaterThan(8);
    for (const { level, name } of headings) {
      expect(screen.getByRole("heading", { level, name })).toBeInTheDocument();
    }
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });

  it("lands /docs#postman on the Postman section", () => {
    mockServer();
    const { container } = renderApp("/docs");
    const heading = container.querySelector("#postman");
    expect(heading?.tagName).toBe("H2");
    expect(heading).toHaveTextContent("Try the API in Postman");
    expect(heading?.textContent).not.toContain("{#");
    expect(screen.getByRole("link", { name: "Try the API in Postman" })).toHaveAttribute(
      "href",
      "#postman",
    );
  });

  it("gives the quick start's example command the README gives", () => {
    expect(README).toContain(EXAMPLE);
    expect(SDK_DOCS).toContain(EXAMPLE);
  });

  it("says who it is for, and points everyone else at a run", () => {
    mockServer();
    renderApp("/docs");
    expect(screen.getByText("For developers")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "start a run" })).toHaveAttribute("href", "/start");
  });

  it("folds the contents into one line on a phone, and lets a keyboard reach a code block", () => {
    mockDevice(false, true);
    mockServer();
    const { container } = renderApp("/docs");
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const fold = nav.querySelector("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
    expect(within(nav).getByText("On this page", { selector: "summary" })).toBeInTheDocument();
    for (const pre of container.querySelectorAll(".docs-body pre")) {
      expect(pre).toHaveAttribute("tabindex", "0");
    }
  });
});
