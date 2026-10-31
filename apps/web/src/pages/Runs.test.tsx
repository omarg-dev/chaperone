import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escalated, mockDevice, mockServer, renderApp, run } from "../test-utils";

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
        run("run_person", "sc_b04", "2026-10-21T09:30:00Z", escalated.decided("approve")),
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

  it("pages through a long history, fifty runs at a time", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 130 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z"),
    );
    mockServer({ runs: many });
    renderApp("/runs");
    const list = await screen.findByRole("list", { name: "Runs" });
    expect(within(list).getAllByRole("link")).toHaveLength(50);
    expect(screen.getByText("Showing 1–50 of 130 runs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 51–100 of 130 runs")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?page=2");
    expect(
      within(screen.getByRole("list", { name: "Runs" })).getAllByRole("link")[0],
    ).toHaveAttribute("href", "/runs/run_50");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Runs" })).getAllByRole("link")).toHaveLength(
      30,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("the history's filters", () => {
  const runs = [
    run("run_paid", "sc_a01", "2026-10-24T11:03:00Z", {
      kind: "attack",
      decidedBy: "no_review",
      attackerPaid: true,
      reviews: ["off"],
    }),
    run("run_blocked", "sc_a01", "2026-10-24T11:02:00Z", {
      kind: "attack",
      verdict: "block",
      decidedBy: "review",
      reviews: ["off", "gate0", "full"],
    }),
    run("run_approved", "sc_b01", "2026-10-24T11:01:00Z", {
      kind: "benign",
      verdict: "approve",
      decidedBy: "review",
      reviews: ["full"],
    }),
    run("run_held", "sc_b01", "2026-10-24T11:00:00Z", {
      kind: "benign",
      ...escalated.waiting,
      reviews: ["full"],
    }),
  ];
  const scenarios = [
    { scenarioId: "sc_a01", title: "Wireless tactile keyboard", request: "x" },
    { scenarioId: "sc_b01", title: "Tactile keyboard under $120", request: "x" },
  ];
  const shownIds = () =>
    within(screen.getByRole("list", { name: "Runs" }))
      .getAllByRole("link")
      .map((a) => a.getAttribute("href")?.replace("/runs/", ""));

  it("opens on the filters in the address, so a filtered view can be shared", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs?outcome=blocked&kind=attack");
    await screen.findByRole("list", { name: "Runs" });
    expect(shownIds()).toEqual(["run_blocked"]);
    expect(screen.getByLabelText("Outcome")).toHaveValue("blocked");
    expect(screen.getByLabelText("Kind")).toHaveValue("attack");
    expect(screen.getByText("Showing 1–1 of 1 matching runs, out of 4")).toBeInTheDocument();
  });

  it("filters held for a person by the hold: waiting and unfinished are, a released hold isn't", async () => {
    const user = userEvent.setup();
    mockServer({
      runs: [
        ...runs,
        run("run_unfinished", "sc_b01", "2026-10-24T10:59:00Z", {
          kind: "benign",
          ...escalated.unfinished("approve"),
          reviews: ["full"],
        }),
        // An eval cell's escalation, voided when the cell was settled.
        run("run_released", "sc_b01", "2026-10-24T10:58:00Z", {
          kind: "benign",
          ...escalated.released,
          reviews: ["off", "gate0", "full"],
        }),
      ],
      scenarios,
    });
    renderApp("/runs");
    await screen.findByRole("list", { name: "Runs" });

    await user.selectOptions(screen.getByLabelText("Outcome"), "Held for a person");
    expect(shownIds()).toEqual(["run_held", "run_unfinished"]);
    const unfinished = screen
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes("run_unfinished")) as HTMLElement;
    expect(within(unfinished).getByText("Decision not finished")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?outcome=held");

    await user.selectOptions(screen.getByLabelText("Outcome"), "Hold released");
    expect(shownIds()).toEqual(["run_released"]);
    const released = within(screen.getByRole("list", { name: "Runs" })).getAllByRole("listitem")[0];
    expect(within(released as HTMLElement).getByText("Hold released")).toBeInTheDocument();
    expect(within(released as HTMLElement).queryByRole("img", { name: /Verdict/ })).toBeNull();
  });

  it("writes each filter into the address as it is chosen", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await screen.findByRole("list", { name: "Runs" });
    expect(shownIds()).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText("Outcome"), "Paid attacker");
    expect(shownIds()).toEqual(["run_paid"]);
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?outcome=attacker_paid");

    await user.selectOptions(screen.getByLabelText("Outcome"), "Any outcome");
    await user.selectOptions(screen.getByLabelText("Firewall"), "Full");
    expect(shownIds()).toEqual(["run_blocked", "run_approved", "run_held"]);
    await user.selectOptions(screen.getByLabelText("Scenario"), "Tactile keyboard under $120");
    await user.selectOptions(screen.getByLabelText("Kind"), "Benign");
    expect(shownIds()).toEqual(["run_approved", "run_held"]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/runs?firewall=full&scenario=sc_b01&kind=benign",
    );
  });

  it("searches by run ID once the typing pauses", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await screen.findByRole("list", { name: "Runs" });
    await user.type(screen.getByRole("searchbox"), "APPROVED");
    await waitFor(() => expect(shownIds()).toEqual(["run_approved"]));
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?q=APPROVED");
  });

  it("starts again from the first page when a filter changes", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 120 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z", { kind: i % 2 ? "attack" : "benign" }),
    );
    mockServer({ runs: many });
    renderApp("/runs?page=2");
    await screen.findByText("Showing 51–100 of 120 runs");
    await user.selectOptions(screen.getByLabelText("Kind"), "Attack");
    expect(screen.getByText(/Showing 1–50 of 60 matching runs/)).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?kind=attack");
  });

  it("says when nothing matches, and clears the filters", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs?outcome=firewall_off&kind=benign");
    expect(
      await screen.findByRole("heading", { name: "No runs match these filters." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Runs" })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    expect(shownIds()).toHaveLength(4);
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/runs$/);
  });

  it("shows the paid attacker, the setting a run was reviewed under, and which it was reviewed under first", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs");
    const list = await screen.findByRole("list", { name: "Runs" });
    const [paid, blocked, approved] = within(list).getAllByRole("listitem");
    expect(
      within(paid as HTMLElement).getByRole("img", { name: "Verdict: Paid attacker" }),
    ).toBeInTheDocument();
    expect(within(paid as HTMLElement).getByText("Attack")).toBeInTheDocument();
    expect(within(paid as HTMLElement).getByText("Off")).toBeInTheDocument();
    expect(within(blocked as HTMLElement).getByText("Full")).toBeInTheDocument();
    expect(within(blocked as HTMLElement).getByText("after Off, Gate 0 only")).toBeInTheDocument();
    expect(within(approved as HTMLElement).queryByText(/^after/)).toBeNull();
    expect(within(approved as HTMLElement).queryByText("Attack")).toBeNull();
  });
});
