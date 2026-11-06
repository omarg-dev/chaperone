import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp } from "../test-utils";
import type { RunEvent } from "./events";
import { fixtures, payees, upTo } from "./fixtures";
import { POLL_MS } from "./useRun";

beforeEach(() => mockDevice(false));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const idOf = (log: RunEvent[]) => log[0]?.runId as string;
const open = async (log: RunEvent[], extra: Parameters<typeof mockServer>[0] = {}) => {
  const fetchMock = mockServer({ events: { [idOf(log)]: log }, payees, ...extra });
  renderApp(`/runs/${idOf(log)}`);
  await screen.findByRole("heading", { level: 1 });
  return fetchMock;
};
const eventCalls = (fetchMock: ReturnType<typeof mockServer>, runId: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === `/events/runs/${runId}`).length;

describe("the run view", () => {
  it("shows an approved run: what was asked, the outcome once, the gates on the route", async () => {
    await open(fixtures.approved);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The cart matches what you asked for.",
    );
    expect(screen.getAllByRole("img", { name: "Verdict: Approved" })).toHaveLength(1);
    expect(screen.getByText("Captured and paid out")).toBeInTheDocument();
    expect(screen.getByText(/Buy me a mid-range mechanical keyboard/)).toBeInTheDocument();
    const mandate = screen.getByLabelText("The locked mandate");
    expect(within(mandate).getByText("Up to $120.00 each")).toBeInTheDocument();

    const timeline = screen.getByRole("region", { name: "Timeline of the run" });
    for (const gate of ["Gate 0", "Gate 1", "Gate 2", "Review"]) {
      expect(within(timeline).getByText(gate)).toBeInTheDocument();
    }
    expect(within(timeline).getByText("$105.66 to Larkspur Goods")).toBeInTheDocument();
    // Nothing is waiting on a person, and nothing is red.
    expect(screen.queryByRole("region", { name: "Your decision" })).toBeNull();
    expect(document.querySelector(".pill-attacker")).toBeNull();
  });

  it("outlines what Gate 1 flagged in red, in the seller column only, and fills nothing", async () => {
    await open(fixtures.escalated);
    const timeline = screen.getByRole("region", { name: "Timeline of the run" });
    const outlined = [
      ...timeline.querySelectorAll(".tl-passage mark, .tl-crosses-flagged, .tl-tone-attacker"),
    ];
    // The passages it copied, the chip and the card.
    expect(timeline.querySelectorAll(".tl-passage mark").length).toBeGreaterThan(0);
    expect(timeline.querySelectorAll(".tl-crosses-flagged")).toHaveLength(1);
    expect(timeline.querySelectorAll("article.tl-tone-attacker")).toHaveLength(1);
    for (const el of outlined) {
      expect(el.closest('[data-zone="seller"]'), el.outerHTML).not.toBeNull();
    }
    // The red that is filled is for money that reached an attacker, and none did.
    expect(document.querySelector(".pill-attacker")).toBeNull();
    expect(document.querySelector(".run-money-attacker")).toBeNull();
  });

  it("opens the page a flagged passage is on, so it is seen where it was written", async () => {
    await open(fixtures.escalated);
    const pages = [...document.querySelectorAll(".tl-served details")];
    const withMarks = pages.filter((d) => d.querySelector(".tl-passage mark"));
    expect(withMarks.length).toBeGreaterThan(0);
    for (const page of withMarks) expect(page).toHaveAttribute("open");
    for (const page of pages.filter((d) => !withMarks.includes(d))) {
      expect(page).not.toHaveAttribute("open");
    }
  });

  it("outlines nothing when Gate 1 found nothing to flag", async () => {
    await open(fixtures.approved);
    expect(document.querySelector(".tl-crosses-flagged")).toBeNull();
    expect(document.querySelector(".tl-tone-attacker")).toBeNull();
    expect(document.querySelector(".tl-passage mark")).toBeNull();
  });

  it("says which words of the request were not made a rule", async () => {
    await open(fixtures.approved);
    const mandate = screen.getByLabelText("The locked mandate");
    expect(within(mandate).getByText("Not enforced")).toBeInTheDocument();
    expect(within(mandate).getByText("mid-range")).toBeInTheDocument();
    expect(within(mandate).getByText("In your request, but not made a rule")).toBeInTheDocument();
    expect(within(mandate).queryByText("Not captured")).toBeNull();
  });

  it("keeps a block neutral", async () => {
    await open(fixtures.blocked);
    expect(screen.getByRole("img", { name: "Verdict: Blocked" })).toHaveClass("pill-block");
    expect(screen.getByText("Voided, nobody paid")).toBeInTheDocument();
    expect(screen.getByText(/Gate 1 skipped: Gate 0 blocked/)).toBeInTheDocument();
    expect(document.querySelector(".pill-attacker")).toBeNull();
    expect(document.querySelector(".run-money-attacker")).toBeNull();
  });

  it("turns red only when the money reached an attacker", async () => {
    await open(fixtures.attackerPaid);
    expect(screen.getByRole("img", { name: "Verdict: Paid attacker" })).toHaveClass(
      "pill-attacker",
    );
    expect(document.querySelector(".run-money-attacker")).not.toBeNull();
    expect(screen.getByText(/to Keyhaven Direct/)).toBeInTheDocument();
  });

  it("puts seller-written text only in the seller column", async () => {
    await open(fixtures.escalated);
    const quote = "this keyboard only works with the Halvard Link cable, sold separately";
    const timeline = screen.getByRole("region", { name: "Timeline of the run" });
    // The page's own words are in the markup (behind a closed disclosure), and only in the seller zone.
    const everywhere = [...document.body.querySelectorAll("*")].filter(
      (el) => el.children.length === 0 && el.textContent?.includes("Halvard Link"),
    );
    expect(everywhere.length).toBeGreaterThan(0);
    for (const el of everywhere)
      expect(el.closest('[data-zone="seller"]'), el.outerHTML).not.toBeNull();
    expect(within(timeline).getAllByText(quote, { exact: false }).length).toBeGreaterThan(0);
    // Not in the header, the brief, the decision, or the catalog or route columns.
    for (const outside of [
      screen.getByRole("heading", { level: 1 }),
      screen.getByRole("region", { name: "Your decision" }),
      screen.getByLabelText("The locked mandate"),
    ]) {
      expect(outside.textContent).not.toContain("Halvard Link");
    }
    const catalogAndRoute = timeline.querySelectorAll('[data-zone="catalog"], [data-zone="route"]');
    for (const cell of catalogAndRoute) expect(cell.textContent).not.toContain("Halvard Link");
  });

  it("offers an escalated run's two options, and sends the one chosen", async () => {
    const user = userEvent.setup();
    const decide = vi.fn(() => ({ status: 200, body: { status: "enforced", money: "captured" } }));
    let asked = 0;
    const fetchMock = mockServer({
      payees,
      decide,
      // After the decision the log has it: the same run, approved by the person.
      events: () => (asked++ === 0 ? fixtures.escalated : fixtures.escalatedApproved),
    });
    renderApp(`/runs/${idOf(fixtures.escalated)}`);

    const panel = await screen.findByRole("region", { name: "Your decision" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "We've paused this purchase.",
    );
    expect(within(panel).getByText("Halvard TKL")).toBeInTheDocument();
    expect(within(panel).getByText("Larkspur Goods")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Approve and pay/ }));

    expect(decide).toHaveBeenCalledWith(idOf(fixtures.escalated), { decision: "approve" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your decision" })).toBeNull());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You approved this purchase.",
    );
    expect(screen.getByText("Approved the purchase")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith("/decision") && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("says what the server said when a decision can't be carried out, and lets the person try again", async () => {
    const user = userEvent.setup();
    await open(fixtures.escalated, {
      decide: () => ({
        status: 503,
        body: { error: "decisions_unavailable", message: "Deciding from the web app is off." },
      }),
    });
    await user.click(screen.getByRole("button", { name: /Reject and release hold/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deciding from the web app is off.");
    expect(screen.getByRole("button", { name: /Reject and release hold/ })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Your decision" })).toBeInTheDocument();
  });

  it("shows a run that a person already decided without offering the decision again", async () => {
    await open(fixtures.escalatedRejected);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You rejected this purchase.",
    );
    expect(screen.queryByRole("button", { name: /Approve and pay/ })).toBeNull();
  });

  it("offers to finish a decision the platform refused, and the same decision only", async () => {
    const user = userEvent.setup();
    const decide = vi.fn(() => ({ status: 200, body: { status: "enforced", money: "captured" } }));
    await open(fixtures.escalatedUnfinished, { decide });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You approved this purchase, but it didn't finish.",
    );
    expect(
      screen.getByText(/The payment platform is unavailable\. Finish it below\./),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Verdict: Decision not finished" })).toHaveLength(1);
    const panel = screen.getByRole("region", { name: "Your decision" });
    // The held cart is still shown, and the only way forward is the decision already made.
    expect(within(panel).getByText("Halvard TKL")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Reject/ })).toBeNull();
    // The headline says what was decided and why it didn't finish; the panel doesn't say it again.
    expect(within(panel).queryByText(/The last attempt failed/)).toBeNull();
    expect(within(panel).queryByText(/it didn't finish/)).toBeNull();
    await user.click(within(panel).getByRole("button", { name: /Finish and pay/ }));
    expect(decide).toHaveBeenCalledWith(idOf(fixtures.escalatedUnfinished), {
      decision: "approve",
    });
  });

  it("says a hold released with no decision plainly, with no decision to make", async () => {
    await open(fixtures.escalatedReleased);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The hold was released without a decision.",
    );
    expect(screen.getByText("Hold released")).toBeInTheDocument();
    expect(screen.getByText("Voided, nobody paid")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your decision" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve and pay|Reject and release/ })).toBeNull();
    // Not waiting on anyone, and not following the run as if more were coming.
    expect(screen.queryByText("Waiting on you")).toBeNull();
    expect(screen.queryByText("Following this run as it happens.")).toBeNull();
  });

  it("says when there is no such run, and when the server is down", async () => {
    mockServer({ events: {} });
    renderApp("/runs/run_nope");
    expect(await screen.findByText("There's no run with this ID.")).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockServer({ down: true });
    renderApp("/runs/run_x");
    expect(await screen.findByText("The run didn't load.")).toBeInTheDocument();
  });
});

describe("following a run as it happens", () => {
  const log = fixtures.approved;
  // Reveals the log in steps, as a run writes it.
  const steps = [
    upTo(log, "agent", "agent_started"),
    upTo(log, "review", "review_started"),
    upTo(log, "review", "review_finished"),
    log,
  ];

  it("polls every 1.5 seconds until the money is settled, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Close to when the fixtures were written: a run quiet for ten minutes is given up on.
    vi.setSystemTime(Date.parse("2026-10-24T11:03:30Z"));
    let call = 0;
    const fetchMock = mockServer({
      payees,
      events: () => steps[Math.min(call++, steps.length - 1)] as RunEvent[],
    });
    renderApp(`/runs/${idOf(log)}`);
    expect(await screen.findByText("The agent is shopping.")).toBeInTheDocument();
    expect(screen.getByText("Following this run as it happens.")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Chaperone is reviewing the cart.")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(screen.queryByText("Following this run as it happens.")).toBeNull());
    expect(screen.getByText("Captured and paid out")).toBeInTheDocument();

    const settled = eventCalls(fetchMock, idOf(log));
    expect(settled).toBe(4);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
    expect(eventCalls(fetchMock, idOf(log))).toBe(settled);
  });

  it("stops polling when the page is left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Close to when the fixtures were written: a run quiet for ten minutes is given up on.
    vi.setSystemTime(Date.parse("2026-10-24T11:03:30Z"));
    const fetchMock = mockServer({
      payees,
      events: () => steps[0] as RunEvent[],
    });
    const { unmount } = renderApp(`/runs/${idOf(log)}`);
    await screen.findByText("The agent is shopping.");
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    const before = eventCalls(fetchMock, idOf(log));
    expect(before).toBeGreaterThan(1);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
    expect(eventCalls(fetchMock, idOf(log))).toBe(before);
  });

  it("doesn't poll a run that is waiting on a person, since nothing will arrive until they act", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Close to when the fixtures were written: a run quiet for ten minutes is given up on.
    vi.setSystemTime(Date.parse("2026-10-24T11:03:30Z"));
    const fetchMock = await open(fixtures.escalated);
    const before = eventCalls(fetchMock, idOf(fixtures.escalated));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(eventCalls(fetchMock, idOf(fixtures.escalated))).toBe(before);
  });
});
