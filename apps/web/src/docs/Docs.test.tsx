import { screen } from "@testing-library/react";
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
      name: (m[2] ?? "").replace(/`/g, ""),
    }));
    expect(headings.length).toBeGreaterThan(8);
    for (const { level, name } of headings) {
      expect(screen.getByRole("heading", { level, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });

  it("gives the quick start's example command the README gives", () => {
    expect(README).toContain(EXAMPLE);
    expect(SDK_DOCS).toContain(EXAMPLE);
  });
});
