import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp } from "../test-utils";

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

const section = (name: string) => screen.getByRole("region", { name });

describe("the landing page", () => {
  it("is what / shows, in seven sections with the two ways in", async () => {
    mockServer();
    renderApp("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: /talked into paying the wrong store/ }),
    ).toBeInTheDocument();
    for (const name of [
      "Chaperone",
      "The attack",
      "The hold",
      "Four gates",
      "The proof",
      "Any agent",
      "Try it",
    ]) {
      expect(section(name)).toBeInTheDocument();
    }
    const hero = section("Chaperone");
    expect(within(hero).getByRole("link", { name: "Start a run" })).toHaveAttribute(
      "href",
      "/start",
    );
    expect(within(hero).getByRole("link", { name: "See the benchmark" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(
      within(section("Any agent")).getByRole("link", { name: "Read the docs" }),
    ).toHaveAttribute("href", "/docs");
    expect(within(section("Try it")).getByRole("link", { name: "Start a run" })).toHaveAttribute(
      "href",
      "/start",
    );
    const index = screen.getByRole("navigation", { name: "Sections" });
    expect(within(index).getAllByRole("button")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Chaperone, home" })).toHaveAttribute("href", "/");
  });

  it("says Running for every model when there are no results, and draws no figures", async () => {
    mockServer();
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const proof = section("The proof");
    expect(await within(proof).findAllByText("Running")).toHaveLength(3);
    expect(proof.textContent).not.toMatch(/\d%/);
  });
});
