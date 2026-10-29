import { useState } from "react";
import { ApiError, postDecision } from "../api";
import { Button, formatMoney } from "../design";
import type { CartLine } from "./timeline";

// What a person can do with a purchase Chaperone paused, as in the approved Spine decision screen:
// the held cart, and the two ways out. Rejecting is the filled button, because it is the safe one.
// The server carries the decision out (capture and pay the seller, or void the hold) and answers
// when the money has moved, so the buttons wait for it.
export function DecisionPanel({
  runId,
  cart,
  onDecided,
}: {
  runId: string;
  cart: CartLine[];
  onDecided: () => void;
}) {
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    setAsking(decision);
    setProblem(null);
    try {
      await postDecision(runId, decision);
      onDecided();
    } catch (error) {
      // The server's message is written for a person, whether it's "no payment platform is
      // connected" or "the platform refused".
      setProblem(
        error instanceof ApiError
          ? error.message
          : "The server didn't answer. Nothing was changed; try again.",
      );
      // Someone else may have decided it already: show what the log says now.
      if (error instanceof ApiError && error.status === 409) onDecided();
    } finally {
      setAsking(null);
    }
  };

  const busy = asking !== null;
  return (
    <section className="decision" aria-label="Your decision">
      <div className="decision-cart">
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
      </div>
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
    </section>
  );
}
