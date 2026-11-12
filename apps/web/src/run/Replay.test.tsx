import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDevice, mockServer, renderApp } from "../test-utils";
import type { RunEvent } from "./events";
import { fixtures, payees, upTo } from "./fixtures";
import { describeEvent, elapsedAt } from "./playhead";
import { URL_SETTLE_MS } from "./useReplay";

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => mockDevice(false));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const idOf = (log: RunEvent[]) => log[0]?.runId as string;
// The position (how many events are shown) at which an event of this lane and type has just appeared.
const positionOf = (log: RunEvent[], lane: string, type: string) =>
  log.findIndex((e) => e.lane === lane && e.type === type) + 1;

const open = async (log: RunEvent[], query = "") => {
  const fetchMock = mockServer({ events: { [idOf(log)]: log }, payees });
  renderApp(`/runs/${idOf(log)}${query}`);
  await screen.findByRole("heading", { level: 1 });
  // A link that carries a position opens the replay as soon as the run is known to be done.
  if (/[?&]at=\d|[?&]at=ev_/.test(query)) await screen.findByRole("region", { name: "Replay" });
  return fetchMock;
};
// The position the playhead has reached after playing for a while from the first event, at 1x
// (the recorded gaps are all shorter than the cap) or at 4x.
const positionAfter = (log: RunEvent[], ms: number, speed = 1) => {
  let position = 1;
  while (position < log.length && elapsedAt(log, position + 1) / speed <= ms) position++;
  return position;
};
// Where the playhead is. The clock the tests move runs a little with real time too, so a position
// reached by waiting is checked within a few events, and one reached by pausing exactly.
const currentPosition = () =>
  Number(/^(\d+) of /.exec(within(bar()).getByText(/^\d+ of \d+ ·/).textContent ?? "")?.[1]);
// Lets the clock run for a while, a few milliseconds at a time: each step of the playhead is
// scheduled once React has drawn the one before, so it can't go on by two in one jump.
const wait = async (ms: number) => {
  for (let spent = 0; spent < ms; spent += 50) {
    await act(() => vi.advanceTimersByTimeAsync(50));
  }
};
const bar = () => screen.getByRole("region", { name: "Replay" });
const timeline = () => screen.getByRole("region", { name: "Timeline of the run" });
const readout = (position: number, total: number) =>
  expect(within(bar()).getByText(new RegExp(`^${position} of ${total} ·`))).toBeInTheDocument();

describe("the way into a replay", () => {
  it("is offered on a finished run, which opens as the whole run, as before", async () => {
    await open(fixtures.approved);
    expect(screen.getByRole("button", { name: "Replay this run" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Replay" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The cart matches what you asked for.",
    );
    expect(screen.getByText("Paid to Larkspur Goods")).toBeInTheDocument();
  });

  it("is offered on a run waiting for a person too, since nothing more will arrive", async () => {
    await open(fixtures.escalated);
    expect(screen.getByRole("button", { name: "Replay this run" })).toBeInTheDocument();
  });

  it("waits for a run in progress to be over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse("2026-10-24T11:03:30Z"));
    const log = upTo(fixtures.approved, "agent", "agent_started");
    mockServer({ events: { [idOf(log)]: log }, payees });
    renderApp(`/runs/${idOf(log)}?at=3`);
    expect(await screen.findByText("Following this run as it happens.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay this run" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Replay" })).toBeNull();
  });
});

describe("playing a run back", () => {
  const log = fixtures.approved;

  it("opens on the first event and builds the timeline up as the playhead passes each event", async () => {
    await open(log);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    await user.click(screen.getByRole("button", { name: "Replay this run" }));

    readout(1, log.length);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent is shopping.");
    expect(within(timeline()).queryByText("Gate 0")).toBeNull();
    expect(screen.queryByText("Paid to Northgate Supply")).toBeNull();
    expect(screen.getByText(/Replay, step 1 of/)).toBeInTheDocument();
    expect(within(bar()).getByText("The run started")).toBeInTheDocument();

    // The recorded events are 380 ms apart: at 1x the playhead goes on by one each time.
    await wait(400);
    expect(currentPosition()).toBeGreaterThanOrEqual(positionAfter(log, 400));
    expect(currentPosition()).toBeLessThanOrEqual(positionAfter(log, 400) + 2);
    await wait(1200);
    expect(currentPosition()).toBeGreaterThanOrEqual(positionAfter(log, 1600));
    expect(positionAfter(log, 1600)).toBeGreaterThan(positionAfter(log, 400));

    // Played out, the replay is the whole run and says so.
    await wait(400 * log.length);
    readout(log.length, log.length);
    expect(within(bar()).getByRole("button", { name: "Play again" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The cart matches what you asked for.",
    );
    expect(within(timeline()).getByText("Overall result")).toBeInTheDocument();
    expect(screen.queryByText(/Replay, step/)).toBeNull();
  });

  it("pauses, steps either way, and picks up where it stopped", async () => {
    await open(log, "?at=10");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    readout(10, log.length);

    // Opened from a link it is paused, and stays where it is.
    await wait(3000);
    readout(10, log.length);

    await user.click(within(bar()).getByRole("button", { name: "Next step" }));
    readout(11, log.length);
    await user.click(within(bar()).getByRole("button", { name: "Previous step" }));
    await user.click(within(bar()).getByRole("button", { name: "Previous step" }));
    readout(9, log.length);

    await user.click(within(bar()).getByRole("button", { name: "Play" }));
    await wait(400);
    expect(currentPosition()).toBeGreaterThanOrEqual(10);
    await user.click(within(bar()).getByRole("button", { name: "Pause" }));
    const stopped = currentPosition();
    await wait(3000);
    expect(currentPosition()).toBe(stopped);
  });

  it("plays from the start again after the end", async () => {
    await open(log, `?at=${log.length}`);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    await user.click(within(bar()).getByRole("button", { name: "Play again" }));
    readout(1, log.length);
    await wait(400);
    expect(currentPosition()).toBeGreaterThanOrEqual(2);
  });

  it("goes quicker at 4x, and straight to the end when instant", async () => {
    await open(log, "?at=1");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    await user.click(within(bar()).getByRole("button", { name: "4×" }));
    expect(within(bar()).getByRole("button", { name: "4×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(bar()).getByRole("button", { name: "1×" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(within(bar()).getByRole("button", { name: "Play" }));
    await wait(400);
    // A quarter of the real gaps: the same events in a quarter of the time.
    expect(currentPosition()).toBeGreaterThanOrEqual(positionAfter(log, 400, 4));
    expect(positionAfter(log, 400, 4)).toBeGreaterThan(positionAfter(log, 400));

    await user.click(within(bar()).getByRole("button", { name: "Instant" }));
    await wait(10);
    readout(log.length, log.length);
  });

  it("scrubs to any event", async () => {
    await open(log, "?at=5");
    fireEvent.change(within(bar()).getByRole("slider", { name: "Position in the run" }), {
      target: { value: "20" },
    });
    readout(20, log.length);
    expect(within(bar()).getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/^Step 20 of 51, /),
    );
  });

  it("leaves the replay for the whole run", async () => {
    await open(log, "?at=5");
    const user = userEvent.setup({ delay: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent is shopping.");
    await user.click(within(bar()).getByRole("button", { name: "Exit replay" }));
    expect(screen.queryByRole("region", { name: "Replay" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The cart matches what you asked for.",
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/runs\/[^?]+$/),
    );
  });
});

describe("the playhead's place in the address", () => {
  const log = fixtures.approved;

  it("opens a shared link at that moment, by position", async () => {
    await open(log, "?at=12");
    readout(12, log.length);
  });

  it("opens a shared link at that moment, by event", async () => {
    await open(log, `?at=${log[19]?.eventId}`);
    readout(20, log.length);
  });

  it("follows the playhead once it is still, without piling up history", async () => {
    const user = userEvent.setup({ delay: null });
    await open(log, "?at=12");
    await user.click(within(bar()).getByRole("button", { name: "Next step" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?at=13"), {
      timeout: URL_SETTLE_MS * 10,
    });
  });

  it("is left alone while the run plays, and written when it pauses", async () => {
    await open(log, "?at=5");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    await user.click(within(bar()).getByRole("button", { name: "Play" }));
    await wait(2000);
    expect(screen.getByTestId("location")).toHaveTextContent(/\?at=5$/);
    await user.click(within(bar()).getByRole("button", { name: "Pause" }));
    const stopped = /^(\d+) of /.exec(
      within(bar()).getByText(/^\d+ of \d+ ·/).textContent ?? "",
    )?.[1];
    expect(Number(stopped)).toBeGreaterThan(5);
    await wait(URL_SETTLE_MS + 50);
    expect(screen.getByTestId("location")).toHaveTextContent(new RegExp(`\\?at=${stopped}$`));
  });

  it("drops an `at` that means nothing, and keeps the other parameters", async () => {
    await open(log, "?at=nonsense&x=1");
    expect(screen.queryByRole("region", { name: "Replay" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/\?x=1$/));
  });

  it("takes a position past the end as the end", async () => {
    await open(log, "?at=9999");
    readout(log.length, log.length);
  });
});

describe("what a replay shows", () => {
  it("is the same as the run view at the last position", async () => {
    const log = fixtures.escalatedApproved;
    await open(log);
    const snapshot = () => ({
      top: document.querySelector(".run-top")?.innerHTML,
      brief: screen.getByLabelText("The locked rules").innerHTML,
      timeline: timeline().innerHTML,
      decision: screen.queryByRole("region", { name: "Your decision" }) !== null,
    });
    const whole = snapshot();
    expect(whole.timeline.length).toBeGreaterThan(1000);

    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    mockDevice(false);
    await open(log, `?at=${log.length}`);
    readout(log.length, log.length);
    expect(snapshot()).toEqual(whole);
  });

  it("is the same for an escalated run that is still waiting, decision and all", async () => {
    const log = fixtures.escalated;
    await open(log);
    const whole = {
      top: document.querySelector(".run-top")?.innerHTML,
      timeline: timeline().innerHTML,
    };
    expect(screen.getByRole("region", { name: "Your decision" })).toBeInTheDocument();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    mockDevice(false);
    await open(log, `?at=${log.length}`);
    expect(screen.getByRole("region", { name: "Your decision" })).toBeInTheDocument();
    expect({
      top: document.querySelector(".run-top")?.innerHTML,
      timeline: timeline().innerHTML,
    }).toEqual(whole);
  });

  it("follows the money in the header: nothing, then held, then captured and paid to an attacker", async () => {
    const log = fixtures.attackerPaid;
    await open(log, "?at=3");
    expect(screen.queryByText("On hold, not charged")).toBeNull();
    expect(document.querySelector(".run-money")).toBeNull();

    const held = positionOf(log, "payments", "payment_call") + 4;
    const heldAt =
      log.findIndex(
        (e) =>
          e.type === "payment_call" &&
          (e.payload as { operation?: string }).operation === "authorize_order",
      ) + 1;
    expect(heldAt).toBeGreaterThan(0);
    fireEvent.change(within(bar()).getByRole("slider"), { target: { value: String(heldAt) } });
    expect(screen.getByText("On hold, not charged")).toBeInTheDocument();
    expect(document.querySelector(".run-money-attacker")).toBeNull();
    expect(held).toBeGreaterThan(0);

    fireEvent.change(within(bar()).getByRole("slider"), { target: { value: String(log.length) } });
    expect(screen.getByText("Paid to an attacker's store")).toBeInTheDocument();
    expect(document.querySelector(".run-money-attacker")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Verdict: Paid attacker" })).toBeInTheDocument();
  });

  it("doesn't offer a decision that was already made while the playhead is before it", async () => {
    const log = fixtures.escalatedApproved;
    const escalatedAt = positionOf(log, "review", "escalated");
    await open(log, `?at=${escalatedAt}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "We've paused this purchase.",
    );
    expect(screen.queryByRole("region", { name: "Your decision" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve and pay/ })).toBeNull();
  });

  it("outlines the passage Gate 1 flagged from the moment it flags it, before its verdict", async () => {
    const log = fixtures.escalated;
    const flagged = positionOf(log, "gate1", "gate1_facts");
    await open(log, `?at=${flagged - 1}`);
    expect(document.querySelector(".tl-passage mark")).toBeNull();
    fireEvent.change(within(bar()).getByRole("slider"), { target: { value: String(flagged) } });
    expect(
      within(bar()).getByText(
        "Seller pages (Gate 1): flagged a passage that tries to steer the purchase",
      ),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".tl-passage mark").length).toBeGreaterThan(0);
    // Gate 1's own verdict, and its card, come a moment later.
    expect(within(timeline()).queryByText("Gate 1")).toBeNull();
    expect(document.querySelector(".tl-crosses-flagged")).toBeNull();
    fireEvent.change(within(bar()).getByRole("slider"), {
      target: { value: String(positionOf(log, "gate1", "verdict")) },
    });
    expect(document.querySelector(".tl-crosses-flagged")).not.toBeNull();
  });

  it("keeps the seller's words in the seller column, at every moment of the run", async () => {
    const log = fixtures.escalated;
    await open(log, `?at=1`);
    for (let position = 1; position <= log.length; position++) {
      fireEvent.change(within(bar()).getByRole("slider"), { target: { value: String(position) } });
      const outside = [
        screen.getByRole("heading", { level: 1 }),
        bar(),
        ...timeline().querySelectorAll('[data-zone="catalog"], [data-zone="route"]'),
      ];
      for (const el of outside)
        expect(el.textContent, `at ${position}`).not.toContain("Halvard Link");
    }
  });
});

describe("the keyboard", () => {
  const log = fixtures.approved;

  it("plays and pauses on space, and steps on the arrow keys", async () => {
    await open(log, "?at=10");
    // The focus starts on Play, whose own space is a press of it.
    await waitFor(() => expect(within(bar()).getByRole("button", { name: "Play" })).toHaveFocus());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    await user.keyboard(" ");
    await wait(400);
    expect(currentPosition()).toBeGreaterThanOrEqual(11);
    await user.keyboard(" ");
    const stopped = currentPosition();
    await wait(3000);
    expect(currentPosition()).toBe(stopped);

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(currentPosition()).toBe(stopped + 2);
    await user.keyboard("{ArrowLeft}");
    expect(currentPosition()).toBe(stopped + 1);
    await user.keyboard("{End}");
    readout(log.length, log.length);
    await user.keyboard("{Home}");
    readout(1, log.length);
  });

  it("plays and pauses on space from anywhere on the page", async () => {
    await open(log, "?at=10");
    // Let the bar settle (it moves the focus to Play) before taking the focus away, or the key
    // can land before the page listens for it.
    await waitFor(() => expect(within(bar()).getByRole("button", { name: "Play" })).toHaveFocus());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
    (document.activeElement as HTMLElement).blur();
    await user.keyboard(" ");
    // Longer than the longest gap the replay waits (1.5 s), so a loaded machine can't miss it.
    await wait(1600);
    expect(currentPosition()).toBeGreaterThanOrEqual(11);
    expect(within(bar()).getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});

describe("when the person asks for less motion", () => {
  const reduced = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: query.includes("reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  it("opens paused, and scrolls without animating", async () => {
    reduced();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await open(fixtures.approved);
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Replay this run" }));
    readout(1, fixtures.approved.length);
    expect(within(bar()).getByRole("button", { name: "Play" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 600));
    readout(1, fixtures.approved.length);

    await user.click(within(bar()).getByRole("button", { name: "Next step" }));
    expect(scroll).toHaveBeenLastCalledWith({ block: "end", behavior: "auto" });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("naming each moment", () => {
  it("has words for every event in the recorded runs", () => {
    for (const log of Object.values(fixtures)) {
      for (const event of log) expect(describeEvent(event).length).toBeGreaterThan(3);
    }
  });
});
