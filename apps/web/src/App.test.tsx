import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { escalated, loadDashboard, mockDevice, mockServer, renderApp, run } from "./test-utils";

beforeAll(loadDashboard, 60_000);
beforeEach(() => {
  mockDevice(false);
  mockServer();
});
afterEach(() => vi.unstubAllGlobals());

const headings = {
  "/runs": "Runs",
  "/escalations": "Escalations",
  "/dashboard": "How it's doing",
};

describe("navigation", () => {
  it("shows the mark and name, and every destination in the top bar", async () => {
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const name of ["Runs", "Escalations", "Dashboard", "Docs"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Chaperone, home" })).toHaveTextContent("Chaperone");
    expect(within(nav).queryByText("Under construction")).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Arena/ })).not.toBeInTheDocument();
    await screen.findByText("No runs yet.");
  });

  it.each(Object.entries(headings))("renders %s", async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = path === "/dashboard" ? "Dashboard" : heading;
    expect(within(nav).getByRole("link", { name: new RegExp(link) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the pages from the links", async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("link", { name: /Dashboard/ }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "How it's doing" }),
    ).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: /Docs/ }));
    expect(await screen.findByRole("navigation", { name: "On this page" })).toBeInTheDocument();
  });

  it("names what each empty page will hold", async () => {
    renderApp("/escalations");
    expect(await screen.findByText("Nothing is waiting on you.")).toBeInTheDocument();
    renderApp("/dashboard");
    expect(await screen.findByText("This server has no results folder.")).toBeInTheDocument();
  });

  it("has a page for a run, and one for an address that isn't a page", async () => {
    renderApp("/runs/run_abc");
    expect(await screen.findByText("We can't find this run.")).toBeInTheDocument();
    renderApp("/nowhere");
    expect(await screen.findByText("There's nothing at this address.")).toBeInTheDocument();
  });

  it("has no arena page: its address is the API's, and the app doesn't know it", async () => {
    renderApp("/arena");
    expect(await screen.findByText("There's nothing at this address.")).toBeInTheDocument();
  });

  it("counts the escalations that still need a person: waiting, or decided but not carried out", async () => {
    mockServer({
      runs: [
        run("run_a", "sc_b01", "2026-10-24T10:00:00Z", escalated.waiting),
        run("run_b", "sc_b02", "2026-10-24T09:00:00Z", { verdict: "approve", decidedBy: "review" }),
        run("run_c", "sc_b03", "2026-10-24T08:00:00Z", escalated.decided("approve")),
        run("run_d", "sc_b04", "2026-10-24T07:00:00Z", escalated.waiting),
        // The platform refused the person's decision, so its hold is still open.
        run("run_e", "sc_b05", "2026-10-24T06:00:00Z", escalated.unfinished("approve")),
        // An eval cell's escalation, its hold voided with nobody deciding: nobody is waiting.
        run("run_f", "sc_b06", "2026-10-24T05:00:00Z", escalated.released),
      ],
    });
    renderApp("/dashboard");
    expect(await screen.findByRole("status", { name: "3 waiting for you" })).toHaveTextContent("3");
  });

  it("doesn't count a run released with no decision, even when it is the only escalation", async () => {
    mockServer({
      runs: [run("run_f", "sc_b06", "2026-10-24T05:00:00Z", escalated.released)],
    });
    renderApp("/dashboard");
    expect(await screen.findByRole("status", { name: "0 waiting for you" })).toHaveTextContent("0");
  });
});

describe("the route line", () => {
  // The route line is the run page's alone. Every other page is a plain page: one title, sections.
  it.each(["/runs", "/start", "/start?tab=agent", "/escalations", "/dashboard", "/nowhere"])(
    "leaves %s without it",
    async (path) => {
      const { container } = renderApp(path);
      await screen.findByRole("heading", { level: 1 });
      expect(container.querySelector(".page")).not.toBeNull();
      expect(container.querySelector("[data-route], .station")).toBeNull();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      // A screen has at most one vault, and an empty or held one is still it.
      expect(container.querySelectorAll(".vault").length).toBeLessThanOrEqual(1);
    },
  );

  it("draws the run page on it", async () => {
    const { container } = renderApp("/runs/run_nope");
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelectorAll("[data-route]")).toHaveLength(1);
    expect(container.querySelectorAll(".station-title")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
