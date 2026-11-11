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
// check), as our own set for Claude Haiku 5.5, and again as a held-out set of three scenarios.
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
  it("is what / shows, in its sections, with the ways in and no section indicator", async () => {
    mockServer();
    renderApp("/");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Chaperone, the parent to your shopping agent.",
      }),
    ).toBeInTheDocument();
    for (const name of [
      "Chaperone",
      "The attack",
      "The hold",
      "Four gates",
      "The proof",
      "Held-out attacks",
      "The dashboard",
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
    const agent = section("Any agent");
    expect(within(agent).getByRole("link", { name: "Read the docs" })).toHaveAttribute(
      "href",
      "/docs",
    );
    expect(within(agent).getByRole("link", { name: "Try the API in Postman" })).toHaveAttribute(
      "href",
      "/docs#postman",
    );
    expect(
      within(section("The dashboard")).getByRole("link", { name: "Explore every result" }),
    ).toHaveAttribute("href", "/dashboard?view=studio");
    expect(within(section("Try it")).getByRole("link", { name: "Start a run" })).toHaveAttribute(
      "href",
      "/start",
    );
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.getByRole("link", { name: "Chaperone, home" })).toHaveAttribute("href", "/");
  });

  it("names what it works with as plain text, with no logos", async () => {
    mockServer();
    renderApp("/");
    const end = section("Try it");
    expect(await within(end).findByText("Works with")).toBeInTheDocument();
    for (const name of ["Claude", "OpenAI", "AI SDK", "AG Studio", "Postman"]) {
      expect(within(end).getByText(name)).toBeInTheDocument();
    }
    const line = within(end).getByText("Works with").closest("div") as HTMLElement;
    expect(line.querySelector("img, svg, picture")).toBeNull();
    // The footer says what it is built on, once: the home page doesn't say it a second time.
    expect(screen.getAllByText(/Built on PayPal's sandbox/)).toHaveLength(1);
    expect(end).not.toHaveTextContent("Built on PayPal's sandbox");
  });

  it("says when there are no results, and draws no figures and no placeholder model", async () => {
    mockServer();
    renderApp("/");
    const proof = section("The proof");
    expect(await within(proof).findByText(/No sandbox results on this server yet/)).toBeVisible();
    expect(section("Held-out attacks")).toHaveTextContent(
      "No held-out results on this server yet.",
    );
    for (const name of ["The proof", "Held-out attacks", "The dashboard"]) {
      expect(section(name).textContent).not.toMatch(/\d%|\d of \d|Running/);
    }
    expect(screen.queryByText(/Real payment sandbox/)).toBeNull();
  });

  it("draws each model with a results file, off and on, and the held-out set apart", async () => {
    mockServer({ results: { list, files: { own: sandboxResults, held: heldOut } } });
    renderApp("/");
    const proof = section("The proof");
    const model = await within(proof).findByRole("article");
    expect(within(model).getByRole("heading", { name: "Claude Haiku 5.5" })).toBeInTheDocument();
    const row = (label: string) => within(model).getByText(label).parentElement as HTMLElement;
    expect(within(row("Off")).getByText("68.8%")).toBeInTheDocument();
    expect(row("Off")).toHaveTextContent("11 of 16");
    expect(within(row("Full check")).getByText("0.0%")).toBeInTheDocument();
    expect(row("Full check")).toHaveTextContent("0 of 16");
    expect(model).toHaveTextContent(
      "Of 49 clean carts, the full check blocked 0 and sent 4 to you by mistake.",
    );
    // Where the numbers come from is said once, under both sets.
    expect(screen.getAllByText(/Real payment sandbox/)).toHaveLength(1);
    expect(screen.getByText(/Real payment sandbox/)).toHaveTextContent(
      "Real payment sandbox · run 2026-10-26 · 2 seeds · the gates ran on Claude Haiku 5.5 for every model",
    );

    const held = section("Held-out attacks");
    expect(held).toHaveTextContent("3 attacks taken from published agent security benchmarks");
    expect(within(held).getAllByRole("article")).toHaveLength(1);
    expect(within(held).getByRole("article")).toHaveTextContent(
      "Of 49 clean carts, the full check blocked 0 and sent 4 to you by mistake.",
    );

    // The dashboard's preview draws the files' own counts, and nothing else.
    const preview = section("The dashboard");
    expect(preview).toHaveTextContent("Claude Haiku 5.5OwnOff11 of 16");
    expect(preview).toHaveTextContent("Claude Haiku 5.5OwnFull check0 of 16");
    expect(preview).toHaveTextContent("Claude Haiku 5.5Held-outFull check0 of 16");
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
