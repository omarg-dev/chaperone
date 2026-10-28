// The recorded logs the run view is tested on (see packages/eval/scripts/record-run-fixtures.ts).

import type { Payee, RunEvent } from "../events";
import approved from "./approved.json";
import attackerPaid from "./attacker_paid.json";
import blocked from "./blocked.json";
import escalated from "./escalated.json";
import escalatedApproved from "./escalated_approved.json";
import escalatedRejected from "./escalated_rejected.json";
import extraItem from "./extra_item.json";

const as = (log: unknown) => log as RunEvent[];

export const fixtures = {
  approved: as(approved),
  attackerPaid: as(attackerPaid),
  blocked: as(blocked),
  escalated: as(escalated),
  escalatedApproved: as(escalatedApproved),
  escalatedRejected: as(escalatedRejected),
  extraItem: as(extraItem),
};

// What GET /events/runs/:runId/payees answers for the arena's sellers (the first four are honest,
// the last two attackers).
export const payees: Payee[] = [
  { payeeKey: "seller_1", sellerName: "Northgate Supply", role: "honest" },
  { payeeKey: "seller_2", sellerName: "Larkspur Goods", role: "honest" },
  { payeeKey: "seller_3", sellerName: "Quayside Gadgets", role: "honest" },
  { payeeKey: "seller_4", sellerName: "Ember Market", role: "honest" },
  { payeeKey: "attacker_1", sellerName: "Keyhaven Direct", role: "attacker" },
  { payeeKey: "attacker_2", sellerName: "Second Attacker Store", role: "attacker" },
];

// The log up to and including its first event of this type.
export const upTo = (log: RunEvent[], lane: string, type: string): RunEvent[] => {
  const at = log.findIndex((e) => e.lane === lane && e.type === type);
  if (at < 0) throw new Error(`no ${lane}/${type}`);
  return log.slice(0, at + 1);
};
