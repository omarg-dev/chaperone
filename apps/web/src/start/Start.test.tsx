import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveStatus, MandateRow, MandateView } from "../api";
import { mockDevice, mockServer, renderApp, run } from "../test-utils";
import { SDK_EXAMPLE } from "./snippet";

// The repo's root, from this file (a path, since the DOM's URL isn't the one fs reads).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeEach(() => mockDevice(false));
afterEach(() => vi.unstubAllGlobals());

const SCENARIOS = [
  { scenarioId: "sc_b01", title: "Tactile keyboard", request: "Buy me a tactile keyboard, $120." },
  { scenarioId: "sc_a01", title: "Wired keyboard", request: "Buy me a wired keyboard, $90." },
];

const status = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  available: true,
  reason: null,
  payments: "fake",
  busy: false,
  agentModel: "Claude Haiku 5.5",
  gateModel: "claude-haiku-5-5",
  budget: {
    capUsd: 1,
    spentUsd: 0.03,
    remainingUsd: 0.97,
    agentRoomUsd: 0.96,
    exhausted: false,
    resetsAt: "2026-11-02T00:00:00.000Z",
  },
  ...over,
});

const row = (
  label: string,
  value: string,
  field: string | null,
  editText?: string,
): MandateRow => ({
  label,
  value,
  field,
  editText: editText ?? null,
  hint: editText === undefined ? null : `hint for ${label.toLowerCase()}`,
});

const view = (over: Partial<MandateView> = {}): MandateView => ({
  runId: "run_new",
  scenarioId: "sc_b01",
  request: "Buy me a tactile keyboard, $120.",
  state: "drafted",
  rows: [
    row("Category", "keyboard", "category", "keyboard"),
    row("Price ceiling", "$120.00 each", "maxUnitPriceCents", "120.00"),
    row("Sellers", "verified sellers only", null),
    row("Not covered", '"mid-range"', null),
  ],
  problems: [],
  canConfirm: true,
  lock: null,
  note: null,
  costUsd: 0.0005,
  ...over,
});

// A server for the whole flow: the calls made are kept, in order.
function flow(over: { status?: LiveStatus; draft?: MandateView } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const state = { mandate: over.draft ?? view() };
  mockServer({
    scenarios: SCENARIOS,
    runs: [],
    events: { run_new: [] },
    live: (call) => {
      calls.push(call);
      if (call.path === "/live/status") return { status: 200, body: over.status ?? status() };
      if (call.method === "POST" && call.path === "/live/runs") {
        return { status: 201, body: state.mandate };
      }
      if (call.path === "/live/runs/run_new/mandate" && call.method === "GET") {
        return { status: 200, body: state.mandate };
      }
      if (call.path === "/live/runs/run_new/mandate") {
        const body = call.body as { action: string };
        if (body.action === "confirm") {
          state.mandate = view({
            state: "locked",
            lock: { hash: "sha256:abcdef0123456789", confirmedAt: "2026-11-01T12:00:00.000Z" },
            rows: state.mandate.rows.map((r) => ({ ...r, editText: null, hint: null })),
          });
        }
        if (body.action === "reject") state.mandate = view({ state: "rejected" });
        return { status: 200, body: state.mandate };
      }
      if (call.path === "/live/runs/run_new/start") {
        return { status: 202, body: { runId: "run_new", firewall: "full" } };
      }
      return undefined;
    },
  });
  return { calls, state };
}

const posts = (calls: { method: string }[]) => calls.filter((c) => c.method === "POST");

describe("choosing a task", () => {
  it("lists each task's title and the person's request, defaults the firewall to full, and never says which are attacks", async () => {
    flow();
    renderApp("/start");
    expect(await screen.findByRole("radio", { name: /Tactile keyboard/ })).toBeInTheDocument();
    expect(screen.getByText("Buy me a tactile keyboard, $120.", { exact: false })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Wired keyboard/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Full/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Gate 0 only/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Off/ })).not.toBeChecked();
    const page = document.querySelector(".start") as HTMLElement;
    expect(page.textContent?.toLowerCase()).not.toContain("attack");
    expect(page.textContent?.toLowerCase()).not.toContain("benign");
  });

  it("shows the three steps, with the first current", async () => {
    flow();
    renderApp("/start");
    const steps = await screen.findByRole("list", { name: "Steps" });
    const items = within(steps).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["1Choose a task", "2Set the mandate", "3Run"]);
    expect(items[0]).toHaveAttribute("aria-current", "step");
  });

  it("can't draft until a task is chosen, then asks the server for a draft of that scenario", async () => {
    const { calls } = flow();
    renderApp("/start");
    const button = await screen.findByRole("button", { name: "Draft the mandate" });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Wired keyboard/ }));
    await userEvent.click(button);
    await screen.findByRole("list", { name: "The mandate's terms" });
    expect(posts(calls)[0]).toMatchObject({
      path: "/live/runs",
      body: { scenarioId: "sc_a01" },
    });
  });

  it("shows the server's own message when a draft is refused", async () => {
    mockServer({
      scenarios: SCENARIOS,
      live: (call) =>
        call.path === "/live/status"
          ? { status: 200, body: status() }
          : {
              status: 502,
              body: { error: "draft_failed", message: "The mandate couldn't be drafted just now." },
            },
    });
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The mandate couldn't be drafted just now.",
    );
  });
});

describe("setting the mandate", () => {
  async function drafted() {
    const server = flow();
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    await screen.findByRole("list", { name: "The mandate's terms" });
    return server;
  }

  it("shows the request and every term the person is agreeing to, and what isn't covered", async () => {
    await drafted();
    expect(screen.getByText("Buy me a tactile keyboard, $120.", { selector: "q" })).toBeVisible();
    const terms = within(screen.getByRole("list", { name: "The mandate's terms" }));
    expect(terms.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("keyboard"),
      expect.stringContaining("$120.00 each"),
      expect.stringContaining("verified sellers only"),
      expect.stringContaining("In your request, but not made a rule"),
    ]);
    // Only the terms the builder supports editing have a Change button.
    expect(screen.getByRole("button", { name: "Change category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change price ceiling" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change sellers" })).toBeNull();
    // The second step is current, the first is a summary.
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("radio", { name: /Tactile keyboard/ })).toBeNull();
  });

  it("edits a term, starting from its current value, and shows what the server says is now locked in", async () => {
    const { calls, state } = await drafted();
    await userEvent.click(screen.getByRole("button", { name: "Change price ceiling" }));
    const input = screen.getByRole("textbox", { name: "New price ceiling" });
    expect(input).toHaveValue("120.00");
    expect(screen.getByText("hint for price ceiling")).toBeVisible();
    state.mandate = view({
      rows: state.mandate.rows.map((r) =>
        r.field === "maxUnitPriceCents" ? { ...r, value: "$99.50 each", editText: "99.50" } : r,
      ),
    });
    await userEvent.clear(input);
    await userEvent.type(input, "99.50");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("$99.50 each")).toBeVisible();
    expect(posts(calls).at(-1)).toMatchObject({
      path: "/live/runs/run_new/mandate",
      body: { action: "edit", field: "maxUnitPriceCents", input: "99.50" },
    });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps the edit box open and shows why when the server can't read an edit", async () => {
    const calls: unknown[] = [];
    mockServer({
      scenarios: SCENARIOS,
      live: (call) => {
        calls.push(call);
        if (call.path === "/live/status") return { status: 200, body: status() };
        if (call.path === "/live/runs") return { status: 201, body: view() };
        return {
          status: 422,
          body: { error: "unreadable_edit", message: '"lots" isn\'t a price' },
        };
      },
    });
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Change price ceiling" }));
    const input = screen.getByRole("textbox", { name: "New price ceiling" });
    await userEvent.clear(input);
    await userEvent.type(input, "lots");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('"lots" isn\'t a price');
    expect(screen.getByRole("textbox", { name: "New price ceiling" })).toBeInTheDocument();
    // Cancelling puts the term back as it was.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("$120.00 each")).toBeVisible();
  });

  it("can't be locked without a price ceiling, and says so", async () => {
    flow({ draft: view({ canConfirm: false }) });
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    expect(await screen.findByRole("button", { name: "Lock this mandate" })).toBeDisabled();
    expect(screen.getByText(/Set a price ceiling first/)).toBeVisible();
  });

  it("locks on confirm: the terms stay in view, can't be changed, and the third step opens", async () => {
    const { calls } = await drafted();
    await userEvent.click(screen.getByRole("button", { name: "Lock this mandate" }));
    expect(await screen.findByText("Locked.")).toBeVisible();
    expect(screen.getByText("sha256:abcdef0…")).toBeVisible();
    expect(posts(calls).at(-1)).toMatchObject({ body: { action: "confirm" } });
    expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock this mandate" })).toBeNull();
    expect(screen.getByText("$120.00 each")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start the run" })).toBeEnabled();
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
  });

  it("goes back to choosing a task when the mandate is rejected", async () => {
    const { calls } = await drafted();
    await userEvent.click(screen.getByRole("button", { name: "Reject and start over" }));
    expect(await screen.findByRole("radio", { name: /Tactile keyboard/ })).toBeInTheDocument();
    expect(posts(calls).at(-1)).toMatchObject({ body: { action: "reject" } });
    expect(screen.queryByRole("list", { name: "The mandate's terms" })).toBeNull();
  });

  it("picks up where the person was after a reload, from the run in the address", async () => {
    flow();
    renderApp("/start?run=run_new&firewall=gate0");
    expect(await screen.findByRole("list", { name: "The mandate's terms" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lock this mandate" }));
    expect(await screen.findByText("Gate 0 only")).toBeVisible();
  });

  it("starts over when the run in the address is gone", async () => {
    mockServer({
      scenarios: SCENARIOS,
      live: (call) =>
        call.path === "/live/status"
          ? { status: 200, body: status() }
          : { status: 404, body: { error: "not_found", message: "No live run" } },
    });
    renderApp("/start?run=run_gone");
    expect(await screen.findByRole("radio", { name: /Tactile keyboard/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("run_gone"));
    expect(screen.getByTestId("location")).toHaveTextContent("/start");
  });
});

describe("running", () => {
  async function locked(firewallLabel?: RegExp) {
    const server = flow();
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    if (firewallLabel) await userEvent.click(screen.getByRole("radio", { name: firewallLabel }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Lock this mandate" }));
    await screen.findByRole("button", { name: "Start the run" });
    return server;
  }

  it("says what is about to happen: the agent, the firewall setting, the money and the day's budget", async () => {
    await locked(/Gate 0 only/);
    const facts = within(document.querySelector(".launch-facts") as HTMLElement);
    expect(facts.getByText("Claude Haiku 5.5")).toBeVisible();
    expect(facts.getByText("Gate 0 only")).toBeVisible();
    expect(facts.getByText("Practice money")).toBeVisible();
    expect(facts.getByText(/\$0\.97 of today's \$1\.00 is left/)).toBeVisible();
  });

  it("says Sandbox when the server holds money on the sandbox", async () => {
    flow({ status: status({ payments: "sandbox" }) });
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Lock this mandate" }));
    expect(await screen.findByText("Sandbox")).toBeVisible();
  });

  it("starts the run with the chosen setting and goes to its page, which follows it", async () => {
    const { calls } = await locked(/Off/);
    await userEvent.click(screen.getByRole("button", { name: "Start the run" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/runs/run_new"));
    expect(posts(calls).at(-1)).toMatchObject({
      path: "/live/runs/run_new/start",
      body: { firewall: "off" },
    });
  });

  it("stays on the page with the server's message when the start is refused", async () => {
    mockServer({
      scenarios: SCENARIOS,
      live: (call) => {
        if (call.path === "/live/status") return { status: 200, body: status() };
        if (call.path === "/live/runs") return { status: 201, body: view() };
        if (call.path.endsWith("/start")) {
          return {
            status: 409,
            body: { error: "run_in_progress", message: "Another live run is in progress." },
          };
        }
        return {
          status: 200,
          body: view({
            state: "locked",
            lock: { hash: "sha256:abcdef0123456789", confirmedAt: "2026-11-01T12:00:00.000Z" },
          }),
        };
      },
    });
    renderApp("/start");
    await userEvent.click(await screen.findByRole("radio", { name: /Tactile keyboard/ }));
    await userEvent.click(screen.getByRole("button", { name: "Draft the mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Lock this mandate" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start the run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another live run is in progress.");
    expect(screen.getByTestId("location")).toHaveTextContent("/start");
    expect(screen.getByRole("button", { name: "Start the run" })).toBeEnabled();
  });

  it("holds the start back while another live run is in progress", async () => {
    flow({ status: status({ busy: true }) });
    renderApp("/start?run=run_new");
    await userEvent.click(await screen.findByRole("button", { name: "Lock this mandate" }));
    expect(await screen.findByText(/Another live run is in progress/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start the run" })).toBeDisabled();
  });
});

describe("when live runs can't start", () => {
  it("says plainly that they're off, why, and where to replay a recorded run", async () => {
    flow({
      status: status({
        available: false,
        reason: "This server has no model key, so it can't run a shopper live.",
        payments: null,
      }),
    });
    renderApp("/start");
    expect(
      await screen.findByRole("heading", { name: "Live runs are off on this server." }),
    ).toBeVisible();
    expect(screen.getByText(/has no model key/)).toBeVisible();
    expect(screen.getByText(/Recorded runs still replay, and everything else works/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Draft the mandate" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Replay a recorded run" }));
    expect(await screen.findByRole("heading", { name: "Runs" })).toBeVisible();
  });

  it("says when today's budget is used up, and when it starts again", async () => {
    flow({
      status: status({
        budget: {
          capUsd: 1,
          spentUsd: 1,
          remainingUsd: 0,
          agentRoomUsd: 0,
          exhausted: true,
          resetsAt: "2026-11-02T00:00:00.000Z",
        },
      }),
    });
    renderApp("/start");
    expect(
      await screen.findByRole("heading", { name: "Today's live runs are used up." }),
    ).toBeVisible();
    expect(screen.getByText(/daily budget of \$1\.00 is spent/)).toBeVisible();
    expect(screen.getByText(/2 Nov 2026, 03:00 GMT\+3/)).toBeVisible();
  });

  it("still shows how to connect your own agent when live runs are off", async () => {
    flow({ status: status({ available: false, reason: "Off.", payments: null }) });
    renderApp("/start?tab=agent");
    expect(await screen.findByText(/wraps your agent's payment tool/)).toBeVisible();
  });
});

describe("connect your own agent", () => {
  it("shows the SDK's example file exactly, the same one the README carries", async () => {
    flow();
    renderApp("/start");
    await userEvent.click(await screen.findByRole("tab", { name: "Connect your own agent" }));
    const code = document.querySelector(".snippet-code code") as HTMLElement;
    const file = readFileSync(join(ROOT, "packages/sdk/examples/protect-your-agent.ts"), "utf8");
    expect(code.textContent).toBe(file);
    expect(SDK_EXAMPLE).toBe(file);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const readmeSnippet = /```ts\n([\s\S]*?)```/.exec(
      readme.slice(readme.indexOf("## Protect your agent")),
    )?.[1];
    expect(code.textContent).toBe(readmeSnippet);
    expect(screen.getByTestId("location")).toHaveTextContent("tab=agent");
  });

  it("is documentation: it offers no upload and no run", async () => {
    flow();
    renderApp("/start?tab=agent");
    await screen.findByText(/wraps your agent's payment tool/);
    expect(screen.queryByRole("button", { name: /upload|start the run|draft/i })).toBeNull();
    expect(document.querySelector("input[type=file]")).toBeNull();
    expect(screen.getByText(/You can't upload an agent here/)).toBeVisible();
  });

  it("switches between the tabs, keeping the address in step", async () => {
    flow();
    renderApp("/start?tab=agent");
    await userEvent.click(await screen.findByRole("tab", { name: "Run a shopper here" }));
    expect(await screen.findByRole("radio", { name: /Tactile keyboard/ })).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("tab=");
  });
});

describe("getting to the page", () => {
  it("has a Start a run action in the top bar, and on the empty Runs page", async () => {
    mockServer({ runs: [], live: () => ({ status: 200, body: status() }), scenarios: SCENARIOS });
    renderApp("/runs");
    await screen.findByText("No runs yet.");
    const links = screen.getAllByRole("link", { name: "Start a run" });
    expect(links).toHaveLength(2);
    await userEvent.click(links[1] as HTMLElement);
    expect(await screen.findByRole("heading", { name: "Start a run", level: 1 })).toBeVisible();
  });

  it("keeps the top bar's action when there are runs, and says which money a live run moved", async () => {
    mockServer({
      runs: [
        run("run_live", "sc_b01", "2026-11-01T10:00:00Z", { origin: "web", payments: "fake" }),
        run("run_box", "sc_b01", "2026-11-01T09:00:00Z", { origin: "web", payments: "sandbox" }),
        run("run_eval", "sc_b01", "2026-11-01T08:00:00Z"),
      ],
      scenarios: SCENARIOS,
    });
    renderApp("/runs");
    const list = await screen.findByRole("list", { name: "Runs" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Practice money")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("Sandbox")).toBeVisible();
    expect(within(rows[2] as HTMLElement).queryByText(/Practice money|Sandbox/)).toBeNull();
    expect(screen.getAllByRole("link", { name: "Start a run" })).toHaveLength(1);
  });
});
