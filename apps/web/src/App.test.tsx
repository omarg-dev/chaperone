import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp, reviewFinished, run } from "./test-utils";

beforeEach(() => {
  mockDevice(false);
  mockServer();
});
afterEach(() => vi.unstubAllGlobals());

const headings = {
  "/runs": "Runs",
  "/escalations": "Escalations",
  "/dashboard": "Dashboard",
  "/arena": "Arena",
};

describe("navigation", () => {
  it("shows the mark and name, and every destination in the top bar", async () => {
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const name of ["Runs", "Escalations", "Dashboard", "Arena"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Chaperone, home" })).toHaveTextContent("Chaperone");
    expect(within(nav).getByText("Under construction")).toBeInTheDocument();
    await screen.findByText("No runs yet.");
  });

  it.each(Object.entries(headings))("renders %s", async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: new RegExp(heading) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the pages from the links", async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("link", { name: /Dashboard/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    await user.click(within(nav).getByRole("link", { name: /Arena/ }));
    expect(
      screen.getByRole("heading", { name: "The arena arrives in version 1.3." }),
    ).toBeInTheDocument();
  });

  it("names what each empty page will hold", async () => {
    renderApp("/escalations");
    expect(await screen.findByText("Nothing is waiting for you.")).toBeInTheDocument();
    renderApp("/dashboard");
    expect(await screen.findByText("No numbers to show yet.")).toBeInTheDocument();
  });

  it("has a page for a run, and one for an address that isn't a page", async () => {
    renderApp("/runs/run_abc");
    expect(await screen.findByText("The live run view is on its way.")).toBeInTheDocument();
    renderApp("/nowhere");
    expect(await screen.findByText("There's nothing at this address.")).toBeInTheDocument();
  });

  it("counts the escalations waiting for a person", async () => {
    mockServer({
      runs: [
        run("run_a", "sc_b01", "2026-10-24T10:00:00Z"),
        run("run_b", "sc_b02", "2026-10-24T09:00:00Z"),
      ],
      events: { run_a: [reviewFinished("escalate")], run_b: [reviewFinished("approve")] },
    });
    renderApp("/dashboard");
    expect(await screen.findByRole("status", { name: "1 waiting for you" })).toHaveTextContent("1");
  });
});
