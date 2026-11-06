import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { escalated, loadGrid, mockDevice, mockServer, renderApp, run } from "../test-utils";

// The history is an AG grid, loaded on demand: its first draw in jsdom is slow when many test files
// share the machine, so it is loaded before any test starts the clock.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(loadGrid, 60_000);
beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

// The grid draws the rows in view; each is a `row` with its run's ID (the header row has none).
const rowsShown = () =>
  screen.getAllByRole("row").filter((row) => row.getAttribute("row-id") !== null);
const shownIds = () => rowsShown().map((row) => row.getAttribute("row-id"));
const rowOf = (runId: string) => {
  const row = rowsShown().find((candidate) => candidate.getAttribute("row-id") === runId);
  if (!row) throw new Error(`${runId} isn't drawn`);
  return row;
};
// The grid is there before its rows are.
const gridDrawn = async () => {
  await screen.findByRole("grid");
  await waitFor(() => expect(rowsShown().length).toBeGreaterThan(0));
};
// The grid redraws a moment after its rows change, so what is shown is waited for.
const shownAre = (ids: string[]) => waitFor(() => expect(shownIds()).toEqual(ids));
const header = (name: string) => screen.getByRole("columnheader", { name: new RegExp(name) });
// A click on a column's label, which sorts by it.
const sortBy = (name: string) =>
  fireEvent.click(header(name).querySelector(".ag-header-cell-label") as HTMLElement);

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

    await gridDrawn();
    // The runs are in the server's order: newest first, which is the page's own sort.
    expect(rowsShown().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Mechanical keyboard, wired"),
      expect.stringContaining("Tactile mechanical keyboard under $120"),
      expect.stringContaining("Noise-cancelling headphones"),
      expect.stringContaining("sc_b03"),
      expect.stringContaining("sc_b04"),
      expect.stringContaining("sc_b05"),
    ]);
    const rows = rowsShown();

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
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("says so when the server doesn't answer, and tries again on request", async () => {
    const user = userEvent.setup();
    mockServer({ down: true });
    renderApp("/runs");
    expect(await screen.findByRole("heading", { name: "Runs didn't load." })).toBeInTheDocument();

    const fetchMock = mockServer({ runs: [run("run_a", "sc_b01", "2026-10-24T10:00:00Z")] });
    await user.click(screen.getAllByRole("button", { name: "Refresh" })[0] as HTMLElement);
    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/events/runs", expect.anything());
  });

  it("draws a long history as it scrolls, not a page at a time", async () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z"),
    );
    mockServer({ runs: many });
    renderApp("/runs");
    await gridDrawn();
    // Every run is in the history and counted, and only the rows in view are in the page.
    expect(screen.getByText("3000 runs")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3001");
    expect(rowsShown().length).toBeGreaterThan(0);
    expect(rowsShown().length).toBeLessThan(60);
    // There are no pages to move between.
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Pages of runs" })).toBeNull();
  });

  it("opens a run from the keyboard: Enter on its row", async () => {
    const user = userEvent.setup();
    mockServer({
      runs: [
        run("run_a", "sc_b01", "2026-10-24T11:00:00Z", { verdict: "block", decidedBy: "review" }),
        run("run_b", "sc_b01", "2026-10-24T10:00:00Z", { verdict: "approve", decidedBy: "review" }),
      ],
    });
    renderApp("/runs");
    await gridDrawn();
    // A click puts the focus on a cell; the arrow keys move it, Enter opens that row's run.
    await user.click(within(rowOf("run_a")).getByText("24 Oct 2026, 14:00 GMT+3"));
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/runs/run_b"));
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
  it("opens on the filters in the address, so a filtered view can be shared", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs?outcome=blocked&kind=attack");
    await gridDrawn();
    await shownAre(["run_blocked"]);
    expect(screen.getByLabelText("Outcome")).toHaveValue("blocked");
    expect(screen.getByLabelText("Kind")).toHaveValue("attack");
    expect(screen.getByText("Showing 1 of 4 runs")).toBeInTheDocument();
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
    await gridDrawn();

    await user.selectOptions(screen.getByLabelText("Outcome"), "Held for a person");
    await shownAre(["run_held", "run_unfinished"]);
    expect(within(rowOf("run_unfinished")).getByText("Decision not finished")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?outcome=held");

    await user.selectOptions(screen.getByLabelText("Outcome"), "Hold released");
    await shownAre(["run_released"]);
    const released = rowOf("run_released");
    expect(within(released).getByText("Hold released")).toBeInTheDocument();
    expect(within(released).queryByRole("img", { name: /Verdict/ })).toBeNull();
  });

  it("writes each filter into the address as it is chosen", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    await waitFor(() => expect(shownIds()).toHaveLength(4));

    await user.selectOptions(screen.getByLabelText("Outcome"), "Paid attacker");
    await shownAre(["run_paid"]);
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?outcome=attacker_paid");

    await user.selectOptions(screen.getByLabelText("Outcome"), "Any outcome");
    await user.selectOptions(screen.getByLabelText("Firewall"), "Full");
    await shownAre(["run_blocked", "run_approved", "run_held"]);
    await user.selectOptions(screen.getByLabelText("Scenario"), "Tactile keyboard under $120");
    await user.selectOptions(screen.getByLabelText("Kind"), "Benign");
    await shownAre(["run_approved", "run_held"]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/runs?firewall=full&scenario=sc_b01&kind=benign",
    );
  });

  it("searches by run ID once the typing pauses", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    await user.type(screen.getByRole("searchbox"), "APPROVED");
    await shownAre(["run_approved"]);
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?q=APPROVED");
  });

  it("ignores the page an old link names, and drops it from the address once a filter changes", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 120 }, (_, i) =>
      run(`run_${i}`, "sc_b01", "2026-10-24T10:00:00Z", { kind: i % 2 ? "attack" : "benign" }),
    );
    mockServer({ runs: many });
    renderApp("/runs?page=2");
    await screen.findByText("120 runs");
    await user.selectOptions(screen.getByLabelText("Kind"), "Attack");
    expect(screen.getByText("Showing 60 of 120 runs")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?kind=attack");
  });

  it("searches by the scenario's title as well as the run ID", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    await user.type(screen.getByRole("searchbox"), "wireless");
    await shownAre(["run_paid", "run_blocked"]);
    expect(screen.getByText("Showing 2 of 4 runs")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/runs?q=wireless");
  });

  it("says when nothing matches, and clears the filters", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs?outcome=firewall_off&kind=benign");
    expect(
      await screen.findByRole("heading", { name: "No runs match these filters." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    await waitFor(() => expect(shownIds()).toHaveLength(4));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/runs$/);
  });

  it("shows the paid attacker, the setting a run was reviewed under, and which it was reviewed under first", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    const [paid, blocked, approved] = rowsShown();
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

describe("the history's sort", () => {
  const runs = [
    run("run_new", "sc_b01", "2026-10-24T11:03:00Z", {
      kind: "benign",
      verdict: "approve",
      decidedBy: "review",
    }),
    run("run_paid", "sc_a01", "2026-10-24T11:02:00Z", {
      kind: "attack",
      decidedBy: "no_review",
      attackerPaid: true,
      reviews: ["off"],
    }),
    run("run_held", "sc_b02", "2026-10-24T11:01:00Z", {
      kind: "benign",
      ...escalated.waiting,
      reviews: ["full"],
    }),
    run("run_old", "sc_b01", "2026-10-24T11:00:00Z", {
      kind: "benign",
      verdict: "block",
      decidedBy: "review",
    }),
  ];
  const scenarios = [
    { scenarioId: "sc_a01", title: "Wireless keyboard", request: "x" },
    { scenarioId: "sc_b01", title: "Tactile keyboard", request: "x" },
    { scenarioId: "sc_b02", title: "Headphones", request: "x" },
  ];

  it("starts newest first, and says so on the column", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    await shownAre(["run_new", "run_paid", "run_held", "run_old"]);
    expect(header("Started")).toHaveAttribute("aria-sort", "descending");
    expect(header("Verdict")).toHaveAttribute("aria-sort", "none");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/runs$/));
  });

  it("sorts by a column on a click, and keeps the sort in the address", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();

    sortBy("Verdict");
    // Money that reached an attacker first, then what is waiting for a person.
    await shownAre(["run_paid", "run_held", "run_old", "run_new"]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/runs?sort=verdict"),
    );
    expect(header("Verdict")).toHaveAttribute("aria-sort", "ascending");

    sortBy("Verdict");
    await shownAre(["run_new", "run_old", "run_held", "run_paid"]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/runs?sort=-verdict"),
    );

    sortBy("Scenario");
    // Two runs of one scenario keep the order the server sent them in.
    await shownAre(["run_held", "run_new", "run_old", "run_paid"]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/runs?sort=scenario"),
    );

    // The newest first is the plain address again.
    sortBy("Started");
    await shownAre(["run_new", "run_paid", "run_held", "run_old"]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/runs$/));
  });

  it("sorts from the keyboard: Enter on a column's header", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs");
    await gridDrawn();
    await shownAre(["run_new", "run_paid", "run_held", "run_old"]);
    header("Verdict").focus();
    await user.keyboard("{Enter}");
    await shownAre(["run_paid", "run_held", "run_old", "run_new"]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/runs?sort=verdict"),
    );
  });

  it("opens on the sort in the address, with the filters", async () => {
    mockServer({ runs, scenarios });
    renderApp("/runs?kind=benign&sort=-scenario");
    await gridDrawn();
    await shownAre(["run_new", "run_old", "run_held"]);
    expect(header("Scenario")).toHaveAttribute("aria-sort", "descending");
  });

  it("keeps the sort when the filters are cleared", async () => {
    const user = userEvent.setup();
    mockServer({ runs, scenarios });
    renderApp("/runs?kind=attack&sort=verdict");
    await gridDrawn();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    await waitFor(() => expect(shownIds()).toHaveLength(4));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/runs?sort=verdict"),
    );
  });
});
