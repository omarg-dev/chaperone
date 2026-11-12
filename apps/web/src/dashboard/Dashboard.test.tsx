import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsList } from "../api";
import { escalated, loadDashboard, mockDevice, mockServer, renderApp, run } from "../test-utils";
import { viewOf } from "./Dashboard";
import { fakeResults, sandboxResults } from "./fixtures";

// Every page of results mounts the data grid with its 60 rows, which jsdom draws slowly: seconds
// when many test files share the machine. The waits are as short as before; a test is given the
// time the machine needs.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(loadDashboard, 60_000);
beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

const summary = (name: string, results: typeof fakeResults, startedAt: string) => ({
  name,
  paymentAdapter: results.meta.paymentAdapter,
  column: results.meta.column,
  gateModel: results.meta.gateModel,
  seeds: results.meta.seeds,
  scenarios: results.meta.scenarios,
  date: startedAt.slice(0, 10),
  startedAt,
});

const NEWEST = "2026-11-07T1647-sandbox-claude-haiku-5-5";
const OLDEST = "2026-11-01T0900-fake-claude-haiku-5-5";
const list: ResultsList = {
  available: true,
  results: [
    summary(NEWEST, sandboxResults, "2026-11-07T16:47:28.519Z"),
    summary(OLDEST, fakeResults, "2026-11-01T09:00:00.000Z"),
  ],
  unreadable: [],
};
const files = { [NEWEST]: sandboxResults, [OLDEST]: fakeResults };

const at = "2026-10-24T10:00:00Z";

describe("the dashboard, with no results", () => {
  it("says the server has no results folder", async () => {
    mockServer();
    renderApp("/dashboard?view=result");
    expect(await screen.findByText("This server has no results folder.")).toBeInTheDocument();
    expect(screen.getByText(/RESULTS_DIR/)).toBeInTheDocument();
  });

  it("says an empty folder is empty", async () => {
    mockServer({ results: { list: { available: true, results: [], unreadable: [] } } });
    renderApp("/dashboard?view=result");
    expect(await screen.findByText("No eval results yet.")).toBeInTheDocument();
    expect(screen.getByText(/run-matrix/)).toBeInTheDocument();
  });

  it("names a file it couldn't read, with why", async () => {
    mockServer({
      results: {
        list: {
          available: true,
          results: [],
          unreadable: [{ name: "broken", reason: "The file isn't valid JSON." }],
        },
      },
    });
    renderApp("/dashboard?view=result");
    expect(
      await screen.findByText(/One file in the results folder couldn't be read/),
    ).toHaveTextContent("broken (The file isn't valid JSON)");
  });

  it("says when the server can't be read at all, and can try again", async () => {
    mockServer({ down: true });
    renderApp("/dashboard?view=result");
    expect(await screen.findByText("The benchmark results couldn't be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the dashboard, with results", () => {
  it("shows the newest result by default, and says what produced it", async () => {
    mockServer({ results: { list, files } });
    renderApp("/dashboard?view=result");
    // The newest is the sandbox one: no banner, and it says so.
    expect(await screen.findByText(/Sandbox result/)).toBeInTheDocument();
    expect(screen.queryByText(/not a sandbox result/i)).not.toBeInTheDocument();
    const facts = screen.getByText("Payment adapter").closest("dl") as HTMLElement;
    expect(facts).toHaveTextContent("sandbox");
    expect(facts).toHaveTextContent("Claude Haiku 5.5 (claude-haiku-5-5)");
    expect(facts).toHaveTextContent("claude-haiku-5-5");
    expect(facts).toHaveTextContent("1, 2, 3, 4");
    expect(facts).toHaveTextContent("7 Nov 2026");
  });

  it("carries a banner on a fake result, in the escalate amber and not the attacker's red", async () => {
    mockServer({ results: { list: { ...list, results: [list.results[1] as never] }, files } });
    renderApp("/dashboard?view=result");
    const banner = await screen.findByRole("note", { name: "" });
    expect(banner).toHaveTextContent("Development numbers, not a sandbox result.");
    expect(banner).toHaveTextContent("fake payment adapter");
    expect(banner).toHaveClass("fake-banner");
    expect(banner).not.toHaveClass("pill-attacker");
    const facts = screen.getByText("Payment adapter").closest("dl") as HTMLElement;
    expect(facts).toHaveTextContent("fake");
  });

  it("shows the harness's headline numbers for each firewall setting", async () => {
    mockServer({ results: { list: { ...list, results: [list.results[1] as never] }, files } });
    renderApp("/dashboard?view=result");
    const comparison = await screen.findByRole("region", {
      name: "Off, Rules only and the full check, compared",
    });
    expect(
      screen.getByRole("heading", {
        name: "With the full check, 1 of 32 attack runs still got through.",
      }),
    ).toBeInTheDocument();
    const text = comparison.textContent ?? "";
    for (const expected of [
      "71.9%",
      "25.0%",
      "3.1%",
      "1.0% (1 of 97)",
      "9.2% (11 of 120)",
      "$0.0029",
      "4.9 s",
    ]) {
      expect(text).toContain(expected);
    }
    // The dots say the same counts in words, for a screen reader.
    expect(
      within(comparison).getByRole("img", {
        name: "8 of 32 reached the attacker, 15 held or blocked, the agent was not fooled in 9",
      }),
    ).toBeInTheDocument();
    // Above zero is the attacker's colour: the full check let one attack run through.
    const big = comparison.querySelectorAll(".cmp-big");
    expect([...big].map((el) => el.classList.contains("cmp-big-attacker"))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("opens an older result from the picker, and keeps the choice in the address", async () => {
    const user = userEvent.setup();
    mockServer({ results: { list, files } });
    renderApp("/dashboard?view=result");
    const picker = await screen.findByRole("combobox", { name: "Result" });
    expect(picker).toHaveDisplayValue(/Newest: 7 Nov 2026 · sandbox/);
    await user.selectOptions(picker, OLDEST);
    expect(
      await screen.findByText("Development numbers, not a sandbox result."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/dashboard?view=result&result=${OLDEST}`,
    );
    // The picker says what each result is, so an old one isn't mistaken for the newest.
    expect(
      within(picker).getByRole("option", {
        name: /1 Nov 2026 · fake · Claude Haiku 5.5 · our tasks · seeds 1, 2, 3, 4/,
      }),
    ).toBeInTheDocument();
  });

  it("opens the result a shared address names, and the newest for one the server doesn't have", async () => {
    mockServer({ results: { list, files } });
    renderApp(`/dashboard?result=${OLDEST}`);
    // Two grids are drawn in this test, which takes longer than a wait does when the machine is busy.
    const slow = { timeout: 10_000 };
    expect(
      await screen.findByText("Development numbers, not a sandbox result.", {}, slow),
    ).toBeInTheDocument();
    renderApp("/dashboard?result=nowhere");
    expect((await screen.findAllByText(/Sandbox result/, {}, slow)).length).toBeGreaterThan(0);
  });

  it("says why a file the server refused couldn't be shown", async () => {
    mockServer({
      results: {
        list,
        files: { [NEWEST]: { error: 422, message: "The file isn't valid JSON." } },
      },
    });
    renderApp("/dashboard?view=result");
    expect(await screen.findByText("That result couldn't be read.")).toBeInTheDocument();
    expect(screen.getByText("The file isn't valid JSON.")).toBeInTheDocument();
  });
});

describe("the table of runs", () => {
  const onlyFake = { list: { ...list, results: [list.results[1] as never] }, files };

  it("draws each run's outcome under each firewall setting, attacks first", async () => {
    mockServer({ results: onlyFake });
    renderApp("/dashboard?view=result");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    for (const header of [
      "Scenario",
      "Seed",
      "Kind",
      "Agent",
      "Off",
      "Rules only",
      "Full check",
      "Run",
    ]) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
    const first = table.querySelector('.ag-row[row-index="0"]') as HTMLElement;
    expect(first).toHaveTextContent("sc_a01");
    expect(first).toHaveTextContent("Attack");
    expect(within(first).getByRole("img", { name: "Verdict: Paid attacker" })).toBeInTheDocument();
    expect(within(first).getAllByRole("img", { name: "Verdict: Blocked" })).toHaveLength(2);
  });

  it("filters by kind and by what a setting did, and says how many are left", async () => {
    const user = userEvent.setup();
    mockServer({ results: onlyFake });
    renderApp("/dashboard?view=result");
    await screen.findByText("120 runs");
    await user.selectOptions(screen.getByRole("combobox", { name: "Attack" }), "attack");
    expect(screen.getByText("32 of 120 runs")).toBeInTheDocument();
    // A setting means nothing until an outcome is chosen.
    expect(screen.getByRole("combobox", { name: "Under" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Ended as" }), "attacker");
    await user.selectOptions(screen.getByRole("combobox", { name: "Under" }), "gate0");
    expect(screen.getByText("8 of 120 runs")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Under" }), "full");
    expect(await screen.findByText("1 of 120 runs")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Attack" }), "benign");
    expect(await screen.findByText("No run matches these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("120 runs")).toBeInTheDocument();
  });

  it("links a run to the run view only when this server has it", async () => {
    const first = fakeResults.cells.find(
      (c) => c.run.scenarioId === "sc_a01" && c.run.seed === "1",
    );
    const runId = first?.run.runId as string;
    mockServer({
      results: onlyFake,
      runs: [run(runId, "sc_a01", at, { verdict: "block", decidedBy: "review", kind: "attack" })],
    });
    renderApp("/dashboard?view=result");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    const row = table.querySelector('.ag-row[row-index="0"]') as HTMLElement;
    await waitFor(() =>
      expect(within(row).getByRole("link", { name: "Open run" })).toHaveAttribute(
        "href",
        `/runs/${runId}`,
      ),
    );
    const second = table.querySelector('.ag-row[row-index="1"]') as HTMLElement;
    expect(second).toHaveTextContent("Not on this server");
    expect(within(second).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("the drill-down under a run", () => {
  const onlyFake = { list: { ...list, results: [list.results[1] as never] }, files };
  const rowOf = (table: HTMLElement, index: number) =>
    table.querySelector(`.ag-row[row-index="${index}"]`) as HTMLElement;
  const opened = () => screen.queryByRole("region", { name: /under each setting/ });

  async function openTable() {
    mockServer({
      results: onlyFake,
      scenarios: [
        { scenarioId: "sc_a01", title: "Wireless keyboard", request: "x" },
        { scenarioId: "sc_a02", title: "Wired keyboard", request: "x" },
      ],
    });
    renderApp("/dashboard?view=result");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    return table;
  }

  it("opens the cell under off, Rules only and the full check when its row is clicked", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    expect(opened()).toBeNull();
    const toggle = within(rowOf(table, 0)).getByRole("button", { name: /under each setting/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    const detail = await screen.findByRole("region", {
      name: "Wireless keyboard, seed 1, under each setting",
    });
    // A column for each setting, in the page's order, with what each is.
    const headers = within(detail).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "OffNobody checks",
      "Rules onlyFixed rules, no AI",
      "Full checkRules and AI reviewers",
    ]);
    // Gate 0 blocked this checkout, so the full check stopped there and Gates 1 to 3 never ran.
    const gate0 = within(detail).getByRole("row", { name: /^Gate 0 / });
    expect(within(gate0).getAllByRole("img", { name: "Verdict: Block" })).toHaveLength(2);
    expect(
      within(within(detail).getByRole("row", { name: /^Gate 1/ })).getByText("Didn't run"),
    ).toBeVisible();
    expect(
      within(detail).getByText(
        "Gate 1, Gate 2 and Gate 3 didn't run under Full check. Gate 0 blocked, which ends the review.",
      ),
    ).toBeVisible();
    const verdict = within(detail).getByRole("row", { name: /^Verdict/ });
    expect(within(verdict).getByText("No review")).toBeVisible();
    expect(within(verdict).getAllByRole("img", { name: "Verdict: Block" })).toHaveLength(2);
    expect(within(detail).getByRole("row", { name: /^Review time/ })).toHaveTextContent("1 ms");
    // The open row says so.
    expect(
      within(rowOf(table, 0)).getByRole("button", { name: /under each setting/ }),
    ).toHaveAttribute("aria-expanded", "true");
    // Blocking is neutral: nothing in the drill-down is the attacker's red.
    expect(detail.querySelector(".pill-attacker")).toBeNull();
  });

  it("shows what each gate cost where the full check ran its model gates", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    // An attack the unverified-seller rule can't see: Gate 0 passes it and the model gates judge it.
    const index = Array.from(table.querySelectorAll(".ag-row[row-index]")).findIndex((row) =>
      row.textContent?.includes("Sent to a person"),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await user.click(within(rowOf(table, index)).getByText(/keyboard/));
    const detail = await screen.findByRole("region", { name: /under each setting/ });
    const gate2 = within(detail).getByRole("row", { name: /^Gate 2/ });
    expect(gate2).toHaveTextContent(/Escalate.*\$0\.\d{4}/);
    expect(within(detail).getByRole("row", { name: /^Review cost/ })).toHaveTextContent(
      /\$0\.\d{4}/,
    );
  });

  it("closes from its button, from the same row, and when another row is opened", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(opened()).toBeNull());

    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: /under each setting/ });
    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await waitFor(() => expect(opened()).toBeNull());

    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: "Wireless keyboard, seed 1, under each setting" });
    // Opening the next row (the second seed of the same scenario) closes the first.
    const next = (await waitFor(() => {
      const row = table.querySelector('.ag-row[row-id^="sc_a01:2:"]');
      expect(row).not.toBeNull();
      return row;
    })) as HTMLElement;
    await user.click(within(next).getByText("Wireless keyboard"));
    expect(
      await screen.findByRole("region", { name: "Wireless keyboard, seed 2, under each setting" }),
    ).toBeVisible();
    expect(screen.getAllByRole("region", { name: /under each setting/ })).toHaveLength(1);
  });

  it("opens from the keyboard: Enter on the row's cell", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    // A click focuses the cell and opens it; Enter on the focused cell closes it, and opens it again.
    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: /under each setting/ });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(opened()).toBeNull());
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("region", { name: /under each setting/ })).toBeVisible();
  });

  it("keeps the detail right under its row when the table is sorted", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    // The fourth seed of the first scenario is the table's fourth row; sorting by seed, biggest
    // first, puts it first. The detail goes with it, since it is AG's own master/detail row and not a
    // copy of the row that sorts on its own.
    await user.click(within(rowOf(table, 3)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: "Wireless keyboard, seed 4, under each setting" });
    expect(rowOf(table, 3).classList.contains("is-open")).toBe(true);
    const seed = within(table).getByText("Seed").closest(".ag-header-cell-label") as HTMLElement;
    await user.click(seed);
    await user.click(seed);
    // The open row moves from fourth to first and its detail with it, right under it. (jsdom draws
    // only the rows around the focused cell, so the moved row is found by its detail and neighbour.)
    await waitFor(() => {
      const detail = table.querySelector('.ag-row[row-id="detail_sc_a01:4:claude-haiku-5-5"]');
      expect(detail?.getAttribute("row-index")).toBe("1");
      expect(detail?.classList.contains("is-detail")).toBe(true);
      const next = table.querySelector('.ag-row[row-id="sc_a02:4:claude-haiku-5-5"]');
      expect(next?.getAttribute("row-index")).toBe("2");
    });
  });

  it("keeps the other columns, filters and links as they were", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: /under each setting/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "Attack" }), "benign");
    // The open row isn't a benign one any more, so its detail goes with it.
    await waitFor(() => expect(opened()).toBeNull());
    expect(screen.getByText("88 of 120 runs")).toBeInTheDocument();
  });
});

describe("the table grouped by attack", () => {
  const onlyFake = { list: { ...list, results: [list.results[1] as never] }, files };
  const groupRow = (table: HTMLElement, name: string) =>
    Array.from(table.querySelectorAll<HTMLElement>(".ag-row.is-group")).find((row) =>
      row.textContent?.includes(name),
    );

  async function groupedTable() {
    const user = userEvent.setup();
    mockServer({
      results: onlyFake,
      scenarios: [{ scenarioId: "sc_a01", title: "Wireless keyboard", request: "x" }],
    });
    renderApp("/dashboard?view=result");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("checkbox", { name: "Group by attack" }));
    await waitFor(() =>
      expect(table.querySelectorAll(".ag-row.is-group").length).toBeGreaterThan(0),
    );
    return { user, table };
  }

  it("is off until asked for, and a group row says how many of its runs got through", async () => {
    const { table } = await groupedTable();
    // What Rules only let through is one view: the attacks its rules can't see.
    const verified = groupRow(table, "A1 (verified)") as HTMLElement;
    expect(verified).toHaveTextContent("4 runs");
    const cell = (config: string) => verified.querySelector(`[col-id="${config}"]`) as HTMLElement;
    expect(cell("off")).toHaveTextContent("4 of 4 got through");
    expect(cell("gate0")).toHaveTextContent("4 of 4 got through");
    expect(cell("full")).toHaveTextContent("1 of 4 got through");
    // Money that reached an attacker is red, and a zero isn't.
    expect(cell("gate0").querySelector(".group-figure-attacker")).not.toBeNull();
    const a7 = (groupRow(table, "A7") as HTMLElement).querySelector('[col-id="full"]');
    expect(a7).toHaveTextContent("0 of 4 got through");
    expect(a7?.querySelector(".group-figure-attacker")).toBeNull();
    const unverified = groupRow(table, "A1 (unverified)") as HTMLElement;
    expect(unverified.querySelector('[col-id="gate0"]')).toHaveTextContent("0 of 4 got through");
    // The benign runs are a group with no attacks to count.
    expect(
      groupRow(table, "Runs with no attack")?.querySelector('[col-id="off"]'),
    ).toHaveTextContent("No attacks");
  });

  it("opens a group to its runs, and a run to its detail, and ungroups", async () => {
    const { user, table } = await groupedTable();
    const verified = groupRow(table, "A1 (verified)") as HTMLElement;
    const opener = within(verified).getByRole("button", { name: "Show the runs of A1 (verified)" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await user.click(opener);
    await waitFor(() =>
      expect(
        within(groupRow(table, "A1 (verified)") as HTMLElement).getByRole("button", {
          name: "Hide the runs of A1 (verified)",
        }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
    // Its runs are under it, and one opens its cell under each setting like any other.
    const runs = await waitFor(() => {
      const found = Array.from(
        table.querySelectorAll<HTMLElement>(".ag-row:not(.is-group)"),
      ).filter((row) => within(row).queryByRole("button", { name: /under each setting/ }));
      expect(found.length).toBeGreaterThanOrEqual(2);
      return found;
    });
    await user.click(runs[0]?.querySelector(".cell-title") as HTMLElement);
    expect(await screen.findByRole("region", { name: /under each setting/ })).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "Group by attack" }));
    await waitFor(() => expect(table.querySelectorAll(".ag-row.is-group").length).toBe(0));
    expect(screen.getByText("120 runs")).toBeInTheDocument();
  });

  it("groups only the runs the filters let through", async () => {
    const { user, table } = await groupedTable();
    await user.selectOptions(screen.getByRole("combobox", { name: "Attack" }), "benign");
    await waitFor(() => expect(table.querySelectorAll(".ag-row.is-group").length).toBe(1));
    expect(groupRow(table, "Runs with no attack")).toHaveTextContent("88 runs");
  });
});

describe("charting the table", () => {
  const onlyFake = { list: { ...list, results: [list.results[1] as never] }, files };

  it("offers a chart of the attacks, and a chart of picked cells once some are picked", async () => {
    mockServer({ results: onlyFake });
    renderApp("/dashboard?view=result");
    await screen.findByRole("region", { name: "Every run in this matrix" });
    expect(screen.getByRole("button", { name: "Chart attacks" })).toBeEnabled();
    // Nothing is picked until someone drags across cells, and the button says how to.
    const picked = screen.getByRole("button", { name: "Chart picked cells" });
    expect(picked).toBeDisabled();
    expect(picked).toHaveAttribute("title", "Drag across cells in the table to pick some.");
    // The chart has its own place in the page, empty and hidden until it is drawn.
    expect(screen.queryByRole("region", { name: "Chart" })).not.toBeInTheDocument();
  });

  it("has nothing to chart when no attack is shown", async () => {
    const user = userEvent.setup();
    mockServer({ results: onlyFake });
    renderApp("/dashboard?view=result");
    await screen.findByRole("region", { name: "Every run in this matrix" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Attack" }), "benign");
    expect(screen.getByRole("button", { name: "Chart attacks" })).toBeDisabled();
  });
});

describe("this server's runs", () => {
  it("counts them, labelled as this server's and not the eval's", async () => {
    mockServer({
      runs: [
        run("a", "sc_a01", at, { verdict: "block", decidedBy: "review" }),
        run("b", "sc_a02", at, { verdict: "approve", decidedBy: "no_review", attackerPaid: true }),
        run("c", "sc_b01", at, escalated.waiting),
        run("d", "sc_b02", at, escalated.released),
        run("e", "sc_b03", at, { verdict: "approve", decidedBy: "review" }),
      ],
    });
    renderApp("/dashboard?view=result");
    const strip = await screen.findByRole("region", { name: "This server's runs" });
    expect(strip).toHaveTextContent(
      "Counted from the runs on this server, not from the benchmark.",
    );
    const stat = (label: string) =>
      within(strip).getByRole("link", { name: new RegExp(label) }).textContent;
    expect(stat("Runs")).toBe("5Runs");
    expect(stat("Waiting on you")).toBe("1Waiting on you");
    expect(stat("Paid an attacker")).toBe("1Paid an attacker");
    expect(stat("Blocked")).toBe("1Blocked");
    expect(stat("Approved")).toBe("1Approved");
    expect(stat("Holds released")).toBe("1Holds released");
    expect(within(strip).getByRole("link", { name: /Paid an attacker/ })).toHaveAttribute(
      "href",
      "/runs?outcome=attacker_paid",
    );
  });

  it("says so when there are none", async () => {
    mockServer({ runs: [] });
    renderApp("/dashboard?view=result");
    const strip = await screen.findByRole("region", { name: "This server's runs" });
    expect(await within(strip).findByText("No runs on this server yet.")).toBeInTheDocument();
  });
});

describe("the dashboard's two views", () => {
  it("opens on AG Studio, says what the benchmark is, and keeps one result a tab away", async () => {
    const user = userEvent.setup();
    // Only a fake file, so the Studio view says it has nothing to explore and loads no canvas.
    mockServer({
      results: {
        list: { available: true, results: [list.results[1] as never], unreadable: [] },
        files,
      },
    });
    renderApp("/dashboard");
    const studio = await screen.findByRole("tab", { name: "Every result in AG Studio" });
    expect(studio).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No sandbox results to explore yet.")).toBeInTheDocument();
    // The four words every number is in, once, above both views.
    for (const term of ["Attack", "Clean cart", "Attack success", "False escalation"]) {
      expect(screen.getByText(term, { selector: "dt" })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("tab", { name: "One result, run by run" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard?view=result");
    expect(
      await screen.findByText(
        "Development numbers, not a sandbox result.",
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
  });

  it("says where the numbers come from, from the sandbox files", async () => {
    mockServer({ results: { list, files } });
    renderApp("/dashboard?view=result");
    const note = await screen.findByRole("note", { name: "Where these numbers come from" });
    expect(note).toHaveTextContent(/^Run on PayPal's payment sandbox on 7 Nov 2026, seeds/);
  });
});

describe("which view the address asks for", () => {
  it("is Studio unless it asks for one result, or names one", () => {
    const view = (query: string) => viewOf(new URLSearchParams(query));
    expect(view("")).toBe("studio");
    expect(view("view=studio")).toBe("studio");
    expect(view("view=studio&result=x")).toBe("studio");
    expect(view("view=result")).toBe("file");
    expect(view("view=file")).toBe("file");
    expect(view("result=x")).toBe("file");
  });
});
