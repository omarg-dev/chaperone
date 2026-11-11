import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "../api";
import { INBOX_POLL_MS } from "../inbox/useFreshness";
import type { RunEvent } from "../run/events";
import { fixtures } from "../run/fixtures";
import { escalated, mockDevice, mockServer, renderApp, run } from "../test-utils";

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => mockDevice(false));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Two real logs of a run held for a person: a poisoned page (one line from Gate 1, one from Gate 2)
// and an extra item in the cart (Gate 0 and Gate 2). The first was held a few seconds earlier.
const POISONED = fixtures.escalated;
const EXTRA = fixtures.extraItem;
// The same held purchase after a person approved it and the platform refused to capture: their
// decision is on the log and the hold is still open.
const UNFINISHED = fixtures.escalatedUnfinished;
// An escalated eval cell: its hold was voided when the cell was settled, and no one decided.
const RELEASED = fixtures.escalatedReleased;
const UNFINISHED_OF_POISONED = UNFINISHED.map((e) => ({
  ...e,
  runId: POISONED[0]?.runId as string,
}));
const idOf = (log: RunEvent[]) => log[0]?.runId as string;
const logs = { [idOf(POISONED)]: POISONED, [idOf(EXTRA)]: EXTRA };

const held = (log: RunEvent[], startedAt: string) =>
  run(idOf(log), "sc_b01", startedAt, escalated.waiting);
const person = (id: string, verdict: "approve" | "block", at: string) => ({
  ...run(id, "sc_b01", at, escalated.decided(verdict)),
  lastEventAt: at,
});
const scenarios = [
  { scenarioId: "sc_b01", title: "Mechanical keyboard, tactile", request: "Buy a keyboard." },
];

// Two days after the first log escalated, so what is shown is the same on any day the tests run.
const SET_NOW = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-26T12:00:00Z"));
};

const listCalls = (fetchMock: ReturnType<typeof mockServer>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === "/events/runs").length;
const decisionCalls = (fetchMock: ReturnType<typeof mockServer>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/decision"));

describe("the escalation inbox", () => {
  it("lists what is waiting on a person, oldest hold first, and nothing else", async () => {
    SET_NOW();
    mockServer({
      scenarios,
      events: logs,
      runs: [
        // Written to later, held earlier: the order comes from when each was held.
        { ...held(EXTRA, "2026-10-24T09:00:00Z"), eventCount: EXTRA.length },
        { ...held(POISONED, "2026-10-24T10:00:00Z"), eventCount: POISONED.length },
        run("run_done", "sc_b01", "2026-10-24T08:00:00Z", {
          verdict: "approve",
          decidedBy: "review",
        }),
        run("run_off", "sc_b01", "2026-10-24T07:00:00Z", { decidedBy: "no_review" }),
        run("run_failed", "sc_b01", "2026-10-24T06:00:00Z", { reviewFailed: true }),
      ],
    });
    renderApp("/escalations");

    const items = await screen.findAllByRole("listitem", { name: "Mechanical keyboard, tactile" });
    // The run's ID is a developer's word, so it isn't on the page: each purchase links to its run.
    const linked = (item: HTMLElement) =>
      within(item).getByRole("link", { name: "See everything the agent did" }).getAttribute("href");
    expect(items.map(linked)).toEqual([`/runs/${idOf(POISONED)}`, `/runs/${idOf(EXTRA)}`]);
    expect(items[0]).not.toHaveTextContent(/run_/);
    expect(screen.getByRole("status", { name: "2 waiting for you" })).toBeInTheDocument();
  });

  it("shows what was asked, the held cart, one line per gate that escalated, and a link to the run", async () => {
    SET_NOW();
    mockServer({ scenarios, events: logs, runs: [held(POISONED, "2026-10-24T11:03:00Z")] });
    renderApp("/escalations");

    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(within(item).getByText(/Buy me a mid-range mechanical keyboard/)).toBeInTheDocument();
    const cart = within(item).getByRole("region", { name: "The held cart" });
    expect(within(cart).getByText("Halvard TKL")).toBeInTheDocument();
    expect(within(cart).getByText("Larkspur Goods")).toBeInTheDocument();
    expect(within(cart).getByText("$109.99")).toBeInTheDocument();

    const why = within(item).getByRole("region", { name: "Why Chaperone paused it" });
    const lines = within(why).getAllByRole("listitem");
    // Each check by what it does, never "Gate 1".
    expect(lines.map((li) => li.querySelector(".held-gate")?.textContent)).toEqual([
      "Seller pages",
      "Cart review",
      "Agent's path",
    ]);
    expect(why).not.toHaveTextContent(/Gate \d|mandate|auditor/);
    expect(lines[0]).toHaveTextContent("the page claims another item has to be bought too");

    expect(within(item).getByText("On hold for 2 days")).toBeInTheDocument();
    expect(within(item).getByText("Hold ends in 36 days")).toBeInTheDocument();
    expect(
      within(item).getByRole("link", { name: "See everything the agent did" }),
    ).toHaveAttribute("href", `/runs/${idOf(POISONED)}`);
    // A held purchase is amber, never red.
    expect(document.querySelector(".pill-attacker")).toBeNull();
    expect(item).toHaveAttribute("data-state", "escalate");
    expect(within(item).getByText("On hold for")).toHaveClass("held-for-label");
  });

  it("says the same as the run page about why a cart was held", async () => {
    SET_NOW();
    mockServer({ scenarios, events: logs, runs: [held(EXTRA, "2026-10-24T11:03:00Z")] });
    renderApp("/escalations");
    const why = await screen.findByRole("region", { name: "Why Chaperone paused it" });
    expect(within(why).getByText("Fixed rules")).toBeInTheDocument();
    expect(
      within(why).getByText("A mouse: your rules ask for a keyboard and allow no extras"),
    ).toBeInTheDocument();
    expect(within(why).getAllByRole("listitem")).toHaveLength(3);
  });

  it("never shows the words a seller wrote", async () => {
    SET_NOW();
    mockServer({ scenarios, events: logs, runs: [held(POISONED, "2026-10-24T11:03:00Z")] });
    renderApp("/escalations");
    await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(document.body.textContent).not.toContain("Halvard Link");
    expect(document.querySelector('[data-zone="seller"]')).toBeNull();
  });

  it("says what approving and rejecting will do, before the buttons", async () => {
    SET_NOW();
    mockServer({ scenarios, events: logs, runs: [held(POISONED, "2026-10-24T11:03:00Z")] });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    const what = within(item).getByText(
      /Approve, and \$109\.99 is charged and paid to Larkspur Goods\. Reject, and the hold is released/,
    );
    const approve = within(item).getByRole("button", { name: /Approve and pay/ });
    expect(what.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says a hold that has just begun without a broken number", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(POISONED.at(-1)?.ts as string) + 20_000);
    mockServer({ scenarios, events: logs, runs: [held(POISONED, "2026-10-24T11:03:00Z")] });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(within(item).getByText("On hold for less than a minute")).toBeInTheDocument();
    expect(item.querySelector(".held-for-span")).toHaveTextContent("<1 minute");
  });

  it("doesn't say when the hold ends if the log doesn't", async () => {
    SET_NOW();
    const unreported = POISONED.map((e) => {
      const p = e.payload as { operation?: string; result?: Record<string, unknown> };
      return e.lane === "payments" && p.operation === "authorize_order"
        ? { ...e, payload: { ...p, result: { ...p.result, expiresAt: "" } } }
        : e;
    });
    mockServer({
      scenarios,
      events: { [idOf(POISONED)]: unreported },
      runs: [held(POISONED, "2026-10-24T11:03:00Z")],
    });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(within(item).getByText(/^On hold for \d/)).toBeInTheDocument();
    expect(item.textContent).not.toMatch(/Hold ends|hold has ended/);
  });

  it("doesn't list an escalation whose hold was released with nobody deciding, as an eval's cleanup leaves it", async () => {
    mockServer({
      scenarios,
      events: { [idOf(RELEASED)]: RELEASED },
      runs: [run(idOf(RELEASED), "sc_b01", "2026-10-24T10:00:00Z", escalated.released)],
    });
    renderApp("/escalations");
    expect(await screen.findByText("Nothing is waiting on you.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve and pay/ })).toBeNull();
    expect(screen.getByRole("status", { name: "0 waiting for you" })).toBeInTheDocument();
  });

  it("waits for the log to say the review escalated before offering a decision", async () => {
    const before = POISONED.filter((e) => e.type !== "escalated");
    mockServer({
      scenarios,
      events: { [idOf(POISONED)]: before },
      runs: [held(POISONED, "2026-10-24T11:03:00Z")],
    });
    renderApp("/escalations");
    expect(await screen.findByText("Nothing is waiting on you.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve and pay/ })).toBeNull();
  });
});

describe("the vault on the inbox", () => {
  it("holds the oldest hold's cart, and the other holds' carts sit on the page, since a screen has one vault", async () => {
    SET_NOW();
    mockServer({
      scenarios,
      events: logs,
      runs: [
        { ...held(EXTRA, "2026-10-24T09:00:00Z"), eventCount: EXTRA.length },
        { ...held(POISONED, "2026-10-24T10:00:00Z"), eventCount: POISONED.length },
      ],
    });
    renderApp("/escalations");
    const items = await screen.findAllByRole("listitem", { name: "Mechanical keyboard, tactile" });
    const carts = items.map((item) => within(item).getByRole("region", { name: "The held cart" }));
    // The poisoned run was held first (2 days before "now"), so it is the first item.
    expect(carts[0]).toHaveClass("vault");
    expect(carts[1]).not.toHaveClass("vault");
    expect(document.querySelectorAll(".vault")).toHaveLength(1);
  });

  it("says who an approval pays, and totals a cart of several lines once", async () => {
    SET_NOW();
    mockServer({
      scenarios,
      events: logs,
      runs: [{ ...held(EXTRA, "2026-10-24T09:00:00Z"), eventCount: EXTRA.length }],
    });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    const cart = within(item).getByRole("region", { name: "The held cart" });
    expect(within(cart).getByText("Both sellers are paid")).toBeInTheDocument();
    expect(within(cart).getByText("Total")).toBeInTheDocument();
    expect(within(cart).getByText("$128.98")).toBeInTheDocument();
  });

  it("is empty, and still a vault, when nothing is waiting", async () => {
    mockServer({ runs: [] });
    renderApp("/escalations");
    const vault = await screen.findByRole("region", { name: "Held for you right now" });
    expect(vault).toHaveClass("vault");
    expect(within(vault).getByRole("link", { name: "See every run" })).toHaveAttribute(
      "href",
      "/runs",
    );
  });
});

describe("deciding from the inbox", () => {
  it("sends the decision, takes the run out of the list and says what came of it", async () => {
    SET_NOW();
    const user = userEvent.setup();
    const decide = vi.fn(() => ({ status: 200, body: { status: "enforced", money: "captured" } }));
    const server = {
      scenarios,
      events: logs,
      decide,
      runs: [
        { ...held(POISONED, "2026-10-24T10:00:00Z"), eventCount: POISONED.length },
        { ...held(EXTRA, "2026-10-24T09:00:00Z"), eventCount: EXTRA.length },
      ],
    };
    const fetchMock = mockServer(server);
    renderApp("/escalations");

    const items = await screen.findAllByRole("listitem", { name: "Mechanical keyboard, tactile" });
    const first = items[0] as HTMLElement;
    // After the decision the list says a person decided it.
    server.runs = [
      {
        ...person(idOf(POISONED), "approve", "2026-10-26T12:00:00Z"),
        eventCount: POISONED.length + 3,
      },
      { ...held(EXTRA, "2026-10-24T09:00:00Z"), eventCount: EXTRA.length },
    ];
    const before = listCalls(fetchMock);
    await user.click(within(first).getByRole("button", { name: /Approve and pay/ }));

    expect(decide).toHaveBeenCalledWith(idOf(POISONED), { decision: "approve" });
    await waitFor(() =>
      expect(
        screen.getAllByRole("listitem", { name: "Mechanical keyboard, tactile" }),
      ).toHaveLength(1),
    );
    const note = screen.getByText(/Approved\. \$109\.99 was charged and the seller was paid\./);
    const confirmation = note.closest("p") as HTMLElement;
    expect(within(confirmation).getByRole("link", { name: "View the run" })).toHaveAttribute(
      "href",
      `/runs/${idOf(POISONED)}`,
    );
    expect(screen.getByRole("status", { name: "1 waiting for you" })).toBeInTheDocument();
    // The list is read again, and the run isn't listed twice (as held, or as recently decided).
    await waitFor(() => expect(listCalls(fetchMock)).toBeGreaterThan(before));
    expect(screen.queryByRole("region", { name: "Recently decided" })).toBeNull();

    await user.click(within(confirmation).getByRole("button", { name: /Dismiss/ }));
    expect(screen.queryByText(/was charged and the seller was paid/)).toBeNull();
    expect(screen.getByRole("region", { name: "Recently decided" })).toBeInTheDocument();
  });

  it("says a reject released the hold and nobody was paid", async () => {
    SET_NOW();
    const user = userEvent.setup();
    mockServer({
      scenarios,
      events: logs,
      decide: () => ({ status: 200, body: { status: "enforced", money: "voided" } }),
      runs: [held(POISONED, "2026-10-24T10:00:00Z")],
    });
    renderApp("/escalations");
    await user.click(await screen.findByRole("button", { name: /Reject and release hold/ }));
    expect(
      await screen.findByText(
        /Rejected\. The hold on \$109\.99 was released and nobody was paid\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting on you.")).toBeInTheDocument();
  });

  it("shows the server's message plainly when it has no payment platform, and keeps the buttons", async () => {
    SET_NOW();
    const user = userEvent.setup();
    const fetchMock = mockServer({
      scenarios,
      events: logs,
      // The mock's default answer: a 503 with "No payment platform."
      runs: [held(POISONED, "2026-10-24T10:00:00Z")],
    });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    await user.click(within(item).getByRole("button", { name: /Approve and pay/ }));

    expect(await within(item).findByRole("alert")).toHaveTextContent("No payment platform.");
    expect(within(item).getByRole("button", { name: /Approve and pay/ })).toBeEnabled();
    expect(within(item).getByRole("button", { name: /Reject and release hold/ })).toBeEnabled();
    expect(decisionCalls(fetchMock)).toHaveLength(1);
    expect(screen.queryByText(/was captured/)).toBeNull();
  });

  it("shows a message for a fake-adapter run's 409 the same way, and treats it as decided", async () => {
    SET_NOW();
    const user = userEvent.setup();
    mockServer({
      scenarios,
      events: logs,
      decide: () => ({
        status: 409,
        body: { error: "cannot_decide", message: "This run was already decided: reject (ev_1)" },
      }),
      runs: [held(POISONED, "2026-10-24T10:00:00Z")],
    });
    renderApp("/escalations");
    await user.click(await screen.findByRole("button", { name: /Approve and pay/ }));
    expect(await screen.findByText(/already decided/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Approve and pay/ })).toBeNull(),
    );
  });

  it("offers to finish a decision that was written but not carried out, and says why it didn't finish", async () => {
    SET_NOW();
    const user = userEvent.setup();
    const decide = vi.fn(() => ({ status: 200, body: { status: "enforced", money: "captured" } }));
    const server = {
      scenarios,
      events: { [idOf(UNFINISHED)]: UNFINISHED },
      decide,
      runs: [
        {
          ...run(
            idOf(UNFINISHED),
            "sc_b01",
            "2026-10-24T10:00:00Z",
            escalated.unfinished("approve"),
          ),
          eventCount: UNFINISHED.length,
        },
      ],
    };
    mockServer(server);
    renderApp("/escalations");

    // The platform refused, so the hold is open: the run is still here, says what was decided and
    // why it didn't finish, and offers that decision and no other.
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(within(item).getByText("Decision not finished")).toBeInTheDocument();
    expect(item.textContent).toMatch(/You approved this purchase, but it didn't finish/);
    expect(item.textContent).toMatch(
      /The last attempt failed: The payment platform is unavailable/,
    );
    expect(within(item).queryByRole("button", { name: /Reject/ })).toBeNull();
    expect(screen.getByRole("status", { name: "1 waiting for you" })).toBeInTheDocument();

    // Finishing sends the same decision again, and the run leaves with a note once it has gone through.
    server.runs = [person(idOf(UNFINISHED), "approve", "2026-10-26T12:00:00Z")] as never;
    await user.click(within(item).getByRole("button", { name: /Finish and pay/ }));
    expect(decide).toHaveBeenCalledWith(idOf(UNFINISHED), { decision: "approve" });
    expect(
      await screen.findByText(/Approved\. \$109\.99 was charged and the seller was paid\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finish and pay/ })).toBeNull();
  });

  it("keeps an unfinished decision in the list when finishing it fails too, with the message", async () => {
    SET_NOW();
    const user = userEvent.setup();
    mockServer({
      scenarios,
      events: { [idOf(UNFINISHED)]: UNFINISHED },
      decide: () => ({
        status: 502,
        body: { error: "payment_failed", message: "The platform refused the capture." },
      }),
      runs: [
        {
          ...run(
            idOf(UNFINISHED),
            "sc_b01",
            "2026-10-24T10:00:00Z",
            escalated.unfinished("approve"),
          ),
          eventCount: UNFINISHED.length,
        },
      ],
    });
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    await user.click(within(item).getByRole("button", { name: /Finish and pay/ }));
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      "The platform refused the capture.",
    );
    expect(within(item).getByRole("button", { name: /Finish and pay/ })).toBeEnabled();
    expect(screen.getByRole("status", { name: "1 waiting for you" })).toBeInTheDocument();
  });

  it("offers a first decision again after a failed one, once the list says it is written", async () => {
    SET_NOW();
    const user = userEvent.setup();
    const server = {
      scenarios,
      events: logs as Record<string, RunEvent[]>,
      decide: () => ({
        status: 502,
        body: { error: "payment_failed", message: "The platform refused the capture." },
      }),
      runs: [held(POISONED, "2026-10-24T10:00:00Z")] as RunSummary[],
    };
    mockServer(server);
    renderApp("/escalations");
    const item = await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    // The decision is on the log by now, and the hold is open: the list reads the run as unfinished.
    server.events = { [idOf(POISONED)]: UNFINISHED_OF_POISONED };
    server.runs = [
      {
        ...run(idOf(POISONED), "sc_b01", "2026-10-24T10:00:00Z", escalated.unfinished("approve")),
        eventCount: UNFINISHED_OF_POISONED.length,
      },
    ];
    await user.click(within(item).getByRole("button", { name: /Approve and pay/ }));
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      "The platform refused the capture.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "Mechanical keyboard, tactile" }),
      ).toHaveTextContent(/Decision not finished/),
    );
    expect(screen.getByRole("status", { name: "1 waiting for you" })).toBeInTheDocument();
  });
});

describe("the empty inbox and the runs decided lately", () => {
  it("says nothing is waiting on you, using the empty state", async () => {
    mockServer({ scenarios, runs: [run("run_a", "sc_b01", "2026-10-24T10:00:00Z")] });
    renderApp("/escalations");
    expect(
      await screen.findByRole("heading", { name: "Nothing is waiting on you." }),
    ).toBeInTheDocument();
    expect(document.querySelector(".empty")).not.toBeNull();
  });

  it("says nothing is waiting when there are no runs at all", async () => {
    mockServer({ scenarios });
    renderApp("/escalations");
    expect(
      await screen.findByRole("heading", { name: "Nothing is waiting on you." }),
    ).toBeInTheDocument();
  });

  it("lists the last few runs a person decided, newest first, with how each came out", async () => {
    SET_NOW();
    const decided = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      person(`run_d${n}`, n % 2 === 0 ? "block" : "approve", `2026-10-0${n}T10:00:00Z`),
    );
    mockServer({
      scenarios,
      runs: [
        ...decided,
        run("run_r", "sc_b01", "2026-10-29T10:00:00Z", { verdict: "approve", decidedBy: "review" }),
      ],
    });
    renderApp("/escalations");
    const section = await screen.findByRole("region", { name: "Recently decided" });
    const rows = within(section).getAllByRole("listitem");
    expect(
      rows.map((row) => within(row).getByRole("link").getAttribute("href")?.replace("/runs/", "")),
    ).toEqual(["run_d7", "run_d6", "run_d5", "run_d4", "run_d3"]);
    expect(
      within(rows[0] as HTMLElement).getByRole("img", { name: "Verdict: Approved" }),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole("img", { name: "Verdict: Rejected" }),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("link", { name: "Mechanical keyboard, tactile" }),
    ).toHaveAttribute("href", "/runs/run_d7");
    expect(within(rows[0] as HTMLElement).getByText("19 days ago")).toBeInTheDocument();
  });
});

describe("keeping the inbox current", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse("2026-10-26T12:00:00Z"));
  });

  it("reads the list again on a timer, so a run that escalates shows up", async () => {
    const server = {
      scenarios,
      events: logs,
      runs: [held(POISONED, "2026-10-24T10:00:00Z")],
    };
    const fetchMock = mockServer(server);
    renderApp("/escalations");
    await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    expect(screen.getByRole("status", { name: "1 waiting for you" })).toBeInTheDocument();

    const before = listCalls(fetchMock);
    server.runs = [held(POISONED, "2026-10-24T10:00:00Z"), held(EXTRA, "2026-10-24T11:00:00Z")];
    await act(() => vi.advanceTimersByTimeAsync(INBOX_POLL_MS));
    await waitFor(() =>
      expect(
        screen.getAllByRole("listitem", { name: "Mechanical keyboard, tactile" }),
      ).toHaveLength(2),
    );
    expect(listCalls(fetchMock)).toBeGreaterThan(before);
    expect(screen.getByRole("status", { name: "2 waiting for you" })).toBeInTheDocument();
  });

  it("reads the list again when the window gets focus", async () => {
    const fetchMock = mockServer({ scenarios, runs: [] });
    renderApp("/escalations");
    await screen.findByText("Nothing is waiting on you.");
    const before = listCalls(fetchMock);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(listCalls(fetchMock)).toBeGreaterThan(before));
  });

  it("doesn't read a held run's log again until the run has grown", async () => {
    const fetchMock = mockServer({
      scenarios,
      events: logs,
      runs: [{ ...held(POISONED, "2026-10-24T10:00:00Z"), eventCount: POISONED.length }],
    });
    renderApp("/escalations");
    await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    const logCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url) === `/events/runs/${idOf(POISONED)}`)
        .length;
    const before = logCalls();
    await act(() => vi.advanceTimersByTimeAsync(INBOX_POLL_MS * 3));
    expect(logCalls()).toBe(before);
  });

  it("stops when the page is left", async () => {
    const fetchMock = mockServer({ scenarios, runs: [] });
    const { unmount } = renderApp("/escalations");
    await screen.findByText("Nothing is waiting on you.");
    await act(() => vi.advanceTimersByTimeAsync(INBOX_POLL_MS));
    const before = listCalls(fetchMock);
    expect(before).toBeGreaterThan(1);
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(INBOX_POLL_MS * 5);
    });
    expect(listCalls(fetchMock)).toBe(before);
  });

  it("keeps what is on screen when a read fails", async () => {
    const server: Parameters<typeof mockServer>[0] = {
      scenarios,
      events: logs,
      runs: [held(POISONED, "2026-10-24T10:00:00Z")],
    };
    mockServer(server);
    renderApp("/escalations");
    await screen.findByRole("listitem", { name: "Mechanical keyboard, tactile" });
    server.down = true;
    await act(() => vi.advanceTimersByTimeAsync(INBOX_POLL_MS));
    expect(
      screen.getByRole("listitem", { name: "Mechanical keyboard, tactile" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Escalations didn't load.")).toBeNull();
  });
});

describe("when the server is down", () => {
  it("says the inbox didn't load and offers another try", async () => {
    mockServer({ down: true });
    renderApp("/escalations");
    expect(await screen.findByText("Escalations didn't load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });
});
