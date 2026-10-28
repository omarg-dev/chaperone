import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp, reviewFinished, run } from "../test-utils";

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

describe("the Runs page", () => {
  it("lists the runs the server has, with scenario, time and verdict", async () => {
    mockServer({
      // The server sends them newest first, and the page keeps that order.
      runs: [
        run("run_new", "sc_a01", "2026-10-24T11:03:00Z"),
        run("run_mid", "sc_b01", "2026-10-24T10:00:00Z"),
        run("run_old", "sc_b02", "2026-10-23T09:30:00Z"),
        run("run_bare", "sc_b03", "2026-10-22T09:30:00Z"),
      ],
      scenarios: [
        { scenarioId: "sc_a01", title: "Mechanical keyboard, wired", request: "x" },
        { scenarioId: "sc_b01", title: "Tactile mechanical keyboard under $120", request: "x" },
        { scenarioId: "sc_b02", title: "Noise-cancelling headphones", request: "x" },
      ],
      events: {
        run_new: [reviewFinished("block")],
        run_mid: [reviewFinished("approve")],
        run_old: [reviewFinished(null)],
        run_bare: [],
      },
    });
    renderApp("/runs");

    const list = await screen.findByRole("list", { name: "Runs" });
    const rows = within(list).getAllByRole("listitem");
    // The column header row is hidden from assistive technology; the runs are in the server's order.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Mechanical keyboard, wired"),
      expect.stringContaining("Tactile mechanical keyboard under $120"),
      expect.stringContaining("Noise-cancelling headphones"),
      expect.stringContaining("sc_b03"),
    ]);

    const first = rows[0] as HTMLElement;
    expect(within(first).getByText("sc_a01 · run_new")).toBeInTheDocument();
    // Riyadh time, day first.
    expect(within(first).getByText("24 Oct 2026 14:03")).toBeInTheDocument();
    expect(await within(first).findByRole("img", { name: "Verdict: Block" })).toBeInTheDocument();
    expect(
      await within(rows[1] as HTMLElement).findByRole("img", { name: "Verdict: Approve" }),
    ).toBeInTheDocument();
    expect(await within(rows[2] as HTMLElement).findByText("Firewall off")).toBeInTheDocument();
    expect(await within(rows[3] as HTMLElement).findByText("No review yet")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Mechanical keyboard, wired" })).toHaveAttribute(
      "href",
      "/runs/run_new",
    );
  });

  it("shows a designed empty state that says what will appear", async () => {
    mockServer({ runs: [] });
    renderApp("/runs");
    expect(await screen.findByRole("heading", { name: "No runs yet." })).toBeInTheDocument();
    expect(screen.getByText(/shows up here with its scenario/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Runs" })).not.toBeInTheDocument();
  });

  it("says so when the server doesn't answer, and tries again on request", async () => {
    const user = userEvent.setup();
    mockServer({ down: true });
    renderApp("/runs");
    expect(await screen.findByRole("heading", { name: "Runs didn't load." })).toBeInTheDocument();

    const fetchMock = mockServer({ runs: [run("run_a", "sc_b01", "2026-10-24T10:00:00Z")] });
    await user.click(screen.getAllByRole("button", { name: "Refresh" })[0] as HTMLElement);
    expect(await screen.findByRole("list", { name: "Runs" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/events/runs", expect.anything());
  });

  it("lists only the newest runs when there are very many", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z"),
    );
    mockServer({ runs: many });
    renderApp("/runs");
    expect(await screen.findByText("Showing the newest 100 of 130 runs.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Runs" })).getAllByRole("link")).toHaveLength(
      100,
    );
  });
});
