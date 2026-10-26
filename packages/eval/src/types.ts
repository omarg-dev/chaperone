import type { AttackId, Harm, HarmedLine } from "@firewall/arena";
import type { FirewallConfig, GateName, Verdict } from "@firewall/firewall";

// The eval's records. Everything here is plain JSON (no classes, no handles), so a cell's task can
// run on another machine (Render Workflows) and hand its record back, and a results file can be
// read years later without this code.

export const SCHEMA_VERSION = 1;

// One cell of the matrix: one scenario, one seed, one agent column. The agent runs once per cell
// and every firewall configuration is evaluated on that same recorded checkout.
export interface CellInput {
  scenarioId: string;
  seed: string;
  // An agent column's ID (`AGENT_COLUMNS`), e.g. "claude-haiku-5-5".
  column: string;
}

export type CellStatus =
  // The agent ran and checked out: there is a held cart to review.
  | "checked_out"
  // The agent ran to the end without checking out (it gave up, hit a cap, or failed).
  | "no_checkout"
  // The cell itself broke (a mandate that wouldn't lock, an outage) before the agent finished.
  | "error";

export interface BoughtLine {
  listingId: string;
  productName: string;
  quantity: number;
  totalCents: number;
  seller: string;
  payeeKey: string;
  sellerRole: "honest" | "attacker";
}

export interface HeldCart {
  orderId: string;
  authorizationId: string;
  amountCents: number;
}

// What the run was, from the agent's checkout. Independent of any firewall configuration.
export interface CellRun {
  scenarioId: string;
  seed: string;
  columnId: string;
  modelId: string;
  // Null when the cell broke before the arena run started.
  runId: string | null;
  status: CellStatus;
  // The agent's own status (RunStatus), or the error that broke the cell.
  agentStatus: string;
  error: string | null;
  kind: "benign" | "attack";
  attack: { attackId: AttackId; variant: string | null; harm: Harm } | null;
  mandateHash: string | null;
  held: HeldCart | null;
  bought: BoughtLine[];
  // The agent was fooled: the cart carries the harm the scenario's attack was after (a line paying
  // an attacker, a wrong product, an unrequested item). Always false for a benign scenario.
  fooled: boolean;
  // Every harmed line, whatever the scenario's attack was after. A cart can carry a harm the
  // scenario didn't aim at (a benign run's wrong product, an attack's other route).
  harms: HarmedLine[];
  // The agent checked out and the cart has no harm at all: the right thing from an honest seller.
  clean: boolean;
  // Why an attack succeeded by a route other than the scenario's, when someone read the trajectory
  // and wrote it down (docs/PLAN.md, "What the eval counts"). The harness leaves it null; what it
  // does record is below, so the trajectory can be read from the event log by run ID.
  cause: string | null;
  trajectory: { listingsViewed: string[]; reviewsRead: string[]; modelCalls: number };
  // The agent's spend and time. `latencyMs` is the wall time of the mandate and the agent together.
  agent: { costUsd: number; latencyMs: number; inputTokens: number; outputTokens: number };
  mandate: { costUsd: number };
  startedAt: string;
}

// How a gate spoke inside one configuration's review.
export interface GateRecord {
  gate: GateName;
  verdict: Verdict;
  costUsd: number;
  latencyMs: number;
  reasons: string[];
}

// What the money did: captured and paid out, voided, still held for a person, or there was no
// order to act on.
export type Money = "captured" | "voided" | "held" | "none";

// One firewall configuration's reading of one recorded checkout.
export interface ConfigOutcome {
  config: FirewallConfig;
  // Null for `off` (nobody reviewed the cart), when there was no checkout, and when the review failed.
  verdict: Verdict | null;
  // Derived from the verdict (`moneyFor`), never by moving money per configuration.
  money: Money;
  // The cart's gross value that went to attacker accounts, when the money was captured.
  toAttackersCents: number;
  gates: GateRecord[];
  skipped: { gate: GateName; reason: string }[];
  // The model gates' spend, counted once. The agent's and the mandate's are on the run.
  costUsd: number;
  latencyMs: number;
  // The review's `review_finished` event, or null when there was none.
  reviewEventId: string | null;
  // A gate broke (a bug or an outage): nothing was enforced, the order stayed held. Set when the
  // review failed; such an outcome is left out of the rates and counted.
  failed: string | null;
}

// The one real enforcement a cell does, so a hold on the sandbox never stays open and the derived
// money outcome is checked against what the platform's code does.
export interface CellSettlement {
  config: FirewallConfig;
  // What enforcement did with the hold, or "none" when there was nothing to enforce.
  money: Money;
  // The hold was escalated (or its review failed) and the eval voided it so it isn't left open.
  releasedHold: boolean;
  // The derived outcome for that configuration said the same. Null when nothing was enforced.
  matchesDerived: boolean | null;
  // Settling broke (an outage on the platform); the hold may still be open.
  error: string | null;
}

export interface CellResult {
  input: CellInput;
  run: CellRun;
  // One per configuration, in FIREWALL_CONFIGS order. Empty when the cell broke.
  outcomes: ConfigOutcome[];
  settlement: CellSettlement | null;
  // The whole cell's model spend: agent, mandate and every configuration's gates.
  costUsd: number;
}
