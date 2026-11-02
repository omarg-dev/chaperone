import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsList } from "../api";
import { escalated, loadDashboard, mockDevice, mockServer, renderApp, run } from "../test-utils";
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
  date: startedAt.slice(0, 10),
  startedAt,
});

const NEWEST = "2026-10-30T0900-sandbox-claude-haiku-5-5";
const OLDEST = "2026-10-26T0012-fake-claude-haiku-5-5";
const list: ResultsList = {
  available: true,
  results: [
    summary(NEWEST, sandboxResults, "2026-10-30T09:00:00.000Z"),
    summary(OLDEST, fakeResults, "2026-10-26T00:12:12.476Z"),
  ],
  unreadable: [],
};
const files = { [NEWEST]: sandboxResults, [OLDEST]: fakeResults };

const at = "2026-10-24T10:00:00Z";

describe("the dashboard, with no results", () => {
  it("says the server has no results folder", async () => {
    mockServer();
    renderApp("/dashboard");
    expect(await screen.findByText("This server has no results folder.")).toBeInTheDocument();
    expect(screen.getByText(/RESULTS_DIR/)).toBeInTheDocument();
  });

  it("says an empty folder is empty", async () => {
    mockServer({ results: { list: { available: true, results: [], unreadable: [] } } });
    renderApp("/dashboard");
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
    renderApp("/dashboard");
    expect(
      await screen.findByText(/One file in the results folder couldn't be read/),
    ).toHaveTextContent("broken (The file isn't valid JSON)");
  });

  it("says when the server can't be read at all, and can try again", async () => {
    mockServer({ down: true });
    renderApp("/dashboard");
    expect(await screen.findByText("The eval results couldn't be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the dashboard, with results", () => {
  it("shows the newest result by default, and says what produced it", async () => {
    mockServer({ results: { list, files } });
    renderApp("/dashboard");
    // The newest is the sandbox one: no banner, and it says so.
    expect(await screen.findByText(/Sandbox result/)).toBeInTheDocument();
    expect(screen.queryByText(/not a sandbox result/i)).not.toBeInTheDocument();
    const facts = screen.getByText("Payment adapter").closest("dl") as HTMLElement;
    expect(facts).toHaveTextContent("sandbox");
    expect(facts).toHaveTextContent("Claude Haiku 5.5 (claude-haiku-5-5)");
    expect(facts).toHaveTextContent("claude-haiku-5-5");
    expect(facts).toHaveTextContent("1, 2");
    expect(facts).toHaveTextContent("26 Oct 2026");
  });

  it("carries a banner on a fake result, in the escalate amber and not the attacker's red", async () => {
    mockServer({ results: { list: { ...list, results: [list.results[1] as never] }, files } });
    renderApp("/dashboard");
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
    renderApp("/dashboard");
    const comparison = await screen.findByRole("region", {
      name: "Off, Gate 0 only and the full tree, compared",
    });
    expect(
      screen.getByRole("heading", { name: "With the full tree, no attack reached the attacker." }),
    ).toBeInTheDocument();
    const text = comparison.textContent ?? "";
    for (const expected of [
      "68.8%",
      "25.0%",
      "0.0%",
      "8.2% (4 of 49)",
      "15.0% (9 of 60)",
      "$0.0023",
      "3.3 s",
    ]) {
      expect(text).toContain(expected);
    }
    // The dots say the same counts in words, for a screen reader.
    expect(
      within(comparison).getByRole("img", {
        name: "4 of 16 reached the attacker, 7 held or blocked, the agent was not fooled in 5",
      }),
    ).toBeInTheDocument();
    // Above zero is the attacker's colour; zero is neutral.
    const big = comparison.querySelectorAll(".cmp-big");
    expect([...big].map((el) => el.classList.contains("cmp-big-attacker"))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("opens an older result from the picker, and keeps the choice in the address", async () => {
    const user = userEvent.setup();
    mockServer({ results: { list, files } });
    renderApp("/dashboard");
    const picker = await screen.findByRole("combobox", { name: "Result" });
    expect(picker).toHaveDisplayValue(/Newest: 30 Oct 2026 · sandbox/);
    await user.selectOptions(picker, OLDEST);
    expect(
      await screen.findByText("Development numbers, not a sandbox result."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/dashboard?result=${OLDEST}`);
    // The picker says what each result is, so an old one isn't mistaken for the newest.
    expect(
      within(picker).getByRole("option", {
        name: /26 Oct 2026 · fake · Claude Haiku 5.5 · seeds 1, 2/,
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
    renderApp("/dashboard");
    expect(await screen.findByText("That result couldn't be read.")).toBeInTheDocument();
    expect(screen.getByText("The file isn't valid JSON.")).toBeInTheDocument();
  });
});

describe("the table of runs", () => {
  const onlyFake = { list: { ...list, results: [list.results[1] as never] }, files };

  it("draws each run's outcome under each firewall setting, attacks first", async () => {
    mockServer({ results: onlyFake });
    renderApp("/dashboard");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    for (const header of [
      "Scenario",
      "Seed",
      "Kind",
      "Agent",
      "Off",
      "Gate 0 only",
      "Full tree",
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
    renderApp("/dashboard");
    await screen.findByText("60 runs");
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "attack");
    expect(screen.getByText("16 of 60 runs")).toBeInTheDocument();
    // A setting means nothing until an outcome is chosen.
    expect(screen.getByRole("combobox", { name: "Under" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Ended as" }), "attacker");
    await user.selectOptions(screen.getByRole("combobox", { name: "Under" }), "gate0");
    expect(screen.getByText("4 of 60 runs")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Under" }), "full");
    expect(await screen.findByText("No run matches these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("60 runs")).toBeInTheDocument();
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
    renderApp("/dashboard");
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
    renderApp("/dashboard");
    const table = await screen.findByRole("region", { name: "Every run in this matrix" });
    await waitFor(() => expect(table.querySelectorAll(".ag-row").length).toBeGreaterThan(0));
    return table;
  }

  it("opens the cell under off, Gate 0 only and the full tree when its row is clicked", async () => {
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
      "OffNo review",
      "Gate 0 onlyRules, no model",
      "Full treeEvery gate",
    ]);
    // Gate 0 blocked this checkout, so the full tree stopped there and Gates 1 and 2 never ran.
    const gate0 = within(detail).getByRole("row", { name: /^Gate 0 / });
    expect(within(gate0).getAllByRole("img", { name: "Verdict: Block" })).toHaveLength(2);
    expect(
      within(within(detail).getByRole("row", { name: /^Gate 1/ })).getByText("Didn't run"),
    ).toBeVisible();
    expect(
      within(detail).getByText(
        "Gate 1 and Gate 2 didn't run under Full tree. Gate 0 blocked, which ends the review.",
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

  it("shows what each gate cost where the full tree ran its model gates", async () => {
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

  it("keeps the other columns, filters and links as they were", async () => {
    const user = userEvent.setup();
    const table = await openTable();
    await user.click(within(rowOf(table, 0)).getByText("Wireless keyboard"));
    await screen.findByRole("region", { name: /under each setting/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "benign");
    // The open row isn't a benign one any more, so its detail goes with it.
    await waitFor(() => expect(opened()).toBeNull());
    expect(screen.getByText("44 of 60 runs")).toBeInTheDocument();
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
    renderApp("/dashboard");
    const strip = await screen.findByRole("region", { name: "This server's runs" });
    expect(strip).toHaveTextContent("Counted from the run log here, not from the eval.");
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
    renderApp("/dashboard");
    const strip = await screen.findByRole("region", { name: "This server's runs" });
    expect(await within(strip).findByText("No runs on this server yet.")).toBeInTheDocument();
  });
});
