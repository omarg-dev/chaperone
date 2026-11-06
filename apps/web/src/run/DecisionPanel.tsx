import { useState } from "react";
import { ApiError, type DecisionResult, postDecision } from "../api";
import { Button, formatMoney } from "../design";
import type { CartLine } from "./timeline";

// Carrying out a person's decision on a purchase Chaperone paused, shared by the run view and the
// escalation inbox so the two can't behave differently. The server carries the decision out (capture
// and pay the seller, or void the hold) and answers when the money has moved, so the buttons wait
// for it. `onDecided` gets what the server answered, and is also called on a 409, when someone
// else decided first and the log has the answer.
export function useDecision(
  runId: string,
  onDecided: (result: DecisionResult | null) => void,
  // Called with the server's message when a decision didn't go through, so a list can keep the run.
  onFailed?: (message: string) => void,
) {
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    setAsking(decision);
    setProblem(null);
    try {
      onDecided(await postDecision(runId, decision));
    } catch (error) {
      // The server's message is written for a person, whether it's "no payment platform is
      // connected" or "the platform refused".
      const message =
        error instanceof ApiError
          ? error.message
          : "The server didn't answer. Nothing was changed; try again.";
      setProblem(message);
      onFailed?.(message);
      // Someone else may have decided it already: show what the log says now.
      if (error instanceof ApiError && error.status === 409) onDecided(null);
    } finally {
      setAsking(null);
    }
  };

  return { asking, problem, decide };
}

// The two ways out, as in the approved Spine decision screen. Rejecting is the filled button,
// because it is the safe one. Both stay on screen whatever the server says: when it can't carry a
// decision out, its message is shown under them.
export function DecisionButtons({ asking, problem, decide }: ReturnType<typeof useDecision>) {
  const busy = asking !== null;
  return (
    <>
      <div className="decision-actions">
        <Button type="button" disabled={busy} onClick={() => decide("reject")}>
          <span className="decision-choice">
            <span className="decision-choice-title">
              {asking === "reject" ? "Releasing the hold…" : "Reject and release hold"}
            </span>
            <span className="decision-choice-note">Nobody is paid</span>
          </span>
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => decide("approve")}>
          <span className="decision-choice">
            <span className="decision-choice-title">
              {asking === "approve" ? "Paying…" : "Approve and pay"}
            </span>
            <span className="decision-choice-note">The seller is paid</span>
          </span>
        </Button>
      </div>
      {problem && (
        <p className="decision-problem" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

// The held cart: each line with its store and amount.
export function HeldCart({ cart }: { cart: CartLine[] }) {
  return (
    <ul className="decision-lines">
      {cart.map((line) => (
        <li key={`${line.listingId}-${line.payeeKey}`}>
          <div>
            <span className="t-item">
              {line.quantity > 1 ? `${line.quantity} × ` : ""}
              {line.productName}
            </span>
            {line.sellerName && <span className="decision-seller">{line.sellerName}</span>}
          </div>
          <span className="money money-sm">{formatMoney(line.totalCents)}</span>
        </li>
      ))}
    </ul>
  );
}

// What a person can do with a purchase Chaperone paused: the held cart, and the two ways out.
export function DecisionPanel({
  runId,
  cart,
  onDecided,
}: {
  runId: string;
  cart: CartLine[];
  onDecided: () => void;
}) {
  const decision = useDecision(runId, () => onDecided());
  return (
    <section className="decision" aria-label="Your decision">
      <div className="decision-cart">
        <HeldCart cart={cart} />
      </div>
      <DecisionButtons {...decision} />
    </section>
  );
}
