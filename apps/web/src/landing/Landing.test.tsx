import type { ResultsView } from "@firewall/eval/view";
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsList } from "../api";
import { sandboxResults } from "../dashboard/fixtures";
import { mockDevice, mockServer, renderApp } from "../test-utils";

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

const section = (name: string) => screen.getByRole("region", { name });

// The dashboard's sandbox fixture (68.8% of 16 attacks with the firewall off, 0.0% with the full
// tree), as our own set for Claude Haiku 5.5, and again as a held-out set of three scenarios.
const heldOut: ResultsView = {
  ...sandboxResults,
  meta: { ...sandboxResults.meta, scenarios: ["sc_h01", "sc_h02", "sc_h03"] },
};
const summary = (name: string, results: ResultsView) => ({
  name,
  paymentAdapter: results.meta.paymentAdapter,
  column: results.meta.column,
  gateModel: results.meta.gateModel,
  seeds: results.meta.seeds,
  scenarios: results.meta.scenarios,
  date: results.meta.date,
  startedAt: results.meta.startedAt,
});
const list: ResultsList = {
  available: true,
  results: [summary("own", sandboxResults), summary("held", heldOut)],
  unreadable: [],
};

describe("the landing page", () => {
  it("is what / shows, in eight sections with the two ways in", async () => {
    mockServer();
    renderApp("/");
    expect(
      await screen.findByRole("heading", { level: 1, name: "The pause before your agent pays." }),
    ).toBeInTheDocument();
    for (const name of [
      "Chaperone",
      "The attack",
      "The hold",
      "Four gates",
      "The proof",
      "Held-out attacks",
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
    expect(within(hero).getByRole("link", { name: "See the results" })).toHaveAttribute(
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
    expect(within(index).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Chaperone, home" })).toHaveAttribute("href", "/");
  });

  it("says when there are no results, and draws no figures and no placeholder model", async () => {
    mockServer();
    renderApp("/");
    const proof = section("The proof");
    expect(await within(proof).findByText(/No sandbox results on this server yet/)).toBeVisible();
    for (const name of ["The proof", "Held-out attacks"]) {
      expect(section(name).textContent).not.toMatch(/\d%|Running/);
    }
  });

  it("draws each model with a results file, off and on, and the held-out set apart", async () => {
    mockServer({ results: { list, files: { own: sandboxResults, held: heldOut } } });
    renderApp("/");
    const proof = section("The proof");
    const model = await within(proof).findByRole("article");
    expect(within(model).getByRole("heading", { name: "Claude Haiku 5.5" })).toBeInTheDocument();
    const row = (label: string) => within(model).getByText(label).parentElement as HTMLElement;
    expect(within(row("Firewall off")).getByText("68.8%")).toBeInTheDocument();
    expect(row("Firewall off")).toHaveTextContent("11 of 16");
    expect(within(row("With Chaperone")).getByText("0.0%")).toBeInTheDocument();
    expect(row("With Chaperone")).toHaveTextContent("0 of 16");
    expect(model).toHaveTextContent("Clean carts: 0 blocked, 4 sent to you, of 49");
    expect(proof).toHaveTextContent("Real payment sandbox · run 2026-10-26 · 2 seeds");
    expect(proof).toHaveTextContent("gates on Claude Haiku 5.5 for every model");

    const held = section("Held-out attacks");
    expect(held).toHaveTextContent("3 attacks ported from published agent security benchmarks");
    expect(within(held).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText(/Gemini|Running/)).toBeNull();
  });

  it("leaves a fake result off the page", async () => {
    const fake = { ...sandboxResults, meta: { ...sandboxResults.meta, paymentAdapter: "fake" } };
    mockServer({
      results: {
        list: { ...list, results: [summary("fake", fake as ResultsView)] },
        files: { fake: fake as ResultsView },
      },
    });
    renderApp("/");
    expect(
      await within(section("The proof")).findByText(/No sandbox results on this server yet/),
    ).toBeVisible();
  });
});
