import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp, run } from "../test-utils";

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

describe("the Runs page", () => {
  it("lists the runs the server has, with scenario, time and verdict", async () => {
    mockServer({
      // The server sends them newest first, and the page keeps that order.
      runs: [
        run("run_new", "sc_a01", "2026-10-24T11:03:00Z", { verdict: "block", decidedBy: "review" }),
        run("run_mid", "sc_b01", "2026-10-24T10:00:00Z", {
          verdict: "approve",
          decidedBy: "review",
        }),
        run("run_old", "sc_b02", "2026-10-23T09:30:00Z", { decidedBy: "no_review" }),
        run("run_bare", "sc_b03", "2026-10-22T09:30:00Z"),
        run("run_person", "sc_b04", "2026-10-21T09:30:00Z", {
          verdict: "approve",
          decidedBy: "person",
        }),
        run("run_failed", "sc_b05", "2026-10-20T09:30:00Z", { reviewFailed: true }),
      ],
      scenarios: [
        { scenarioId: "sc_a01", title: "Mechanical keyboard, wired", request: "x" },
        { scenarioId: "sc_b01", title: "Tactile mechanical keyboard under $120", request: "x" },
        { scenarioId: "sc_b02", title: "Noise-cancelling headphones", request: "x" },
      ],
    });
    renderApp("/runs");

    const list = await screen.findByRole("list", { name: "Runs" });
    // The column header row is hidden from assistive technology; the runs are in the server's order.
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Mechanical keyboard, wired"),
      expect.stringContaining("Tactile mechanical keyboard under $120"),
      expect.stringContaining("Noise-cancelling headphones"),
      expect.stringContaining("sc_b03"),
      expect.stringContaining("sc_b04"),
      expect.stringContaining("sc_b05"),
    ]);

    const [first, second, third, fourth, fifth, sixth] = rows as HTMLElement[];
    expect(within(first as HTMLElement).getByText("sc_a01 · run_new")).toBeInTheDocument();
    // The viewer's own time zone (the tests run in Riyadh), day first, with the zone named.
    expect(within(first as HTMLElement).getByText("24 Oct 2026, 14:03 GMT+3")).toBeInTheDocument();
    expect(
      within(first as HTMLElement).getByRole("img", { name: "Verdict: Block" }),
    ).toBeInTheDocument();
    expect(
      within(second as HTMLElement).getByRole("img", { name: "Verdict: Approve" }),
    ).toBeInTheDocument();
    expect(within(third as HTMLElement).getByText("Firewall off")).toBeInTheDocument();
    expect(within(fourth as HTMLElement).getByText("No review yet")).toBeInTheDocument();
    expect(
      within(fifth as HTMLElement).getByRole("img", { name: "Verdict: Approve" }),
    ).toBeInTheDocument();
    expect(within(fifth as HTMLElement).getByText("You decided")).toBeInTheDocument();
    expect(
      within(sixth as HTMLElement).getByRole("img", { name: "Verdict: Held" }),
    ).toBeInTheDocument();
    expect(
      within(first as HTMLElement).getByRole("link", { name: "Mechanical keyboard, wired" }),
    ).toHaveAttribute("href", "/runs/run_new");
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

  it("lists every run, however many there are", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z"),
    );
    mockServer({ runs: many });
    renderApp("/runs");
    const list = await screen.findByRole("list", { name: "Runs" });
    expect(within(list).getAllByRole("link")).toHaveLength(130);
  });
});
