import type { RunSummary } from "../api";
import { isHeldForPerson, outcomeOf } from "../runs/state";

// This server's own runs, counted from the run log. Not the eval: these are whatever has been run
// here, by anyone, and say nothing about how often an agent is fooled.
//
// Each run is exactly one outcome (`outcomeOf`, the Runs page's rule), so the counts never add up to
// more than the total. "Waiting on you" is `isHeldForPerson`, the same rule as the count in the top
// bar, so the two can't differ.
export interface LiveCounts {
  total: number;
  waiting: number;
  attackerPaid: number;
  blocked: number;
  approved: number;
  released: number;
}

export function liveCounts(runs: readonly RunSummary[]): LiveCounts {
  const counts: LiveCounts = {
    total: runs.length,
    waiting: 0,
    attackerPaid: 0,
    blocked: 0,
    approved: 0,
    released: 0,
  };
  for (const run of runs) {
    if (isHeldForPerson(run)) counts.waiting += 1;
    switch (outcomeOf(run)) {
      case "attacker_paid":
        counts.attackerPaid += 1;
        break;
      case "blocked":
        counts.blocked += 1;
        break;
      case "approved":
        counts.approved += 1;
        break;
      case "released":
        counts.released += 1;
        break;
    }
  }
  return counts;
}

export interface LiveStat {
  key: keyof LiveCounts;
  label: string;
  value: number;
  // Where the runs behind the number are listed.
  to: string;
  // Money reached an attacker (red), a person is needed (amber), or neither.
  tone: "attacker" | "escalate" | "plain";
}

// The strip, in reading order. A number links to the runs it counts.
export function liveStats(counts: LiveCounts): LiveStat[] {
  return [
    { key: "total", label: "Runs", value: counts.total, to: "/runs", tone: "plain" },
    {
      key: "waiting",
      label: "Waiting on you",
      value: counts.waiting,
      to: "/escalations",
      tone: counts.waiting > 0 ? "escalate" : "plain",
    },
    {
      key: "attackerPaid",
      label: "Paid an attacker",
      value: counts.attackerPaid,
      to: "/runs?outcome=attacker_paid",
      // Zero is neutral: red is only for money that reached an attacker.
      tone: counts.attackerPaid > 0 ? "attacker" : "plain",
    },
    {
      key: "blocked",
      label: "Blocked",
      value: counts.blocked,
      to: "/runs?outcome=blocked",
      tone: "plain",
    },
    {
      key: "approved",
      label: "Approved",
      value: counts.approved,
      to: "/runs?outcome=approved",
      tone: "plain",
    },
    {
      key: "released",
      label: "Holds released",
      value: counts.released,
      to: "/runs?outcome=released",
      tone: "plain",
    },
  ];
}
