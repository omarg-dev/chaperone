import { useState } from "react";
import { ApiError, type DecisionResult, postDecision } from "../api";
import { Amount, Button, formatMoney } from "../design";
import type { CartLine, HeldReason } from "./timeline";

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
          : "Chaperone's server didn't answer, so nothing was changed. Try again.";
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

// A decision that was recorded but didn't finish: the money is still held. The only way forward is
// the decision already made, sent again (the server finishes what is left, and refuses the
// opposite), so that is the one button.
export interface Unfinished {
  decision: "approve" | "reject";
  problem: string | null;
}

// The two ways out, as in the approved Spine decision screen. Rejecting is the filled button,
// because it is the safe one. Both stay on screen whatever the server says: when it can't carry a
// decision out, its message is shown under them. A decision already made but not carried out
// (`unfinished`) says so and offers to finish it instead.
export function DecisionButtons({
  asking,
  problem,
  decide,
  unfinished,
  saidAbove = false,
  sellers = 1,
}: ReturnType<typeof useDecision> & {
  // How many sellers an approval pays, so the button says who is paid.
  sellers?: number;
  unfinished?: Unfinished | null;
  // The page already says what was decided and why it didn't finish (the run view's headline does),
  // so it isn't said again here.
  saidAbove?: boolean;
}) {
  const busy = asking !== null;
  const paid =
    sellers === 1
      ? "The seller is paid"
      : sellers === 2
        ? "Both sellers are paid"
        : `All ${sellers} sellers are paid`;
  if (unfinished) {
    const approved = unfinished.decision === "approve";
    return (
      <div className="decision-finish">
        {!saidAbove && (
          <p className="decision-unfinished">
            You {approved ? "approved" : "rejected"} this purchase, but it didn't finish.
            {unfinished.problem ? ` The last attempt failed: ${unfinished.problem}` : ""}
          </p>
        )}
        <div className="decision-actions">
          <Button
            type="button"
            variant={approved ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => decide(unfinished.decision)}
          >
            <span className="decision-choice">
              <span className="decision-choice-title">
                {asking
                  ? approved
                    ? "Paying…"
                    : "Releasing the hold…"
                  : approved
                    ? "Finish and pay"
                    : "Finish and release hold"}
              </span>
              <span className="decision-choice-note">{approved ? paid : "Nobody is paid"}</span>
            </span>
          </Button>
        </div>
        {problem && (
          <p className="decision-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    );
  }
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
            <span className="decision-choice-note">{paid}</span>
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
export function HeldCart({
  cart,
  size = "sm",
  amounts = true,
}: {
  cart: CartLine[];
  size?: "sm" | "lg";
  // Each line's amount, or only what it is: a cart of one line has the page's own amount to say it.
  amounts?: boolean;
}) {
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
          {amounts && <Amount cents={line.totalCents} size={size} />}
        </li>
      ))}
    </ul>
  );
}

// Why a purchase is waiting, one line for each check that sent it to the person, under that check's
// plain name. The run page and the inbox both say it before the buttons.
export function HeldReasons({ reasons }: { reasons: HeldReason[] }) {
  return (
    <ul className="held-reasons">
      {reasons.length === 0 && (
        <li>
          <span>Chaperone couldn't be sure this cart is what you asked for.</span>
        </li>
      )}
      {reasons.map((reason) => (
        <li key={reason.gate}>
          <span className="held-gate">{reason.label}</span>
          <span>{reason.reason}</span>
        </li>
      ))}
    </ul>
  );
}

// What each button will do, said before the buttons: who is paid and how much, or that nobody is.
export function whatHappens(cart: readonly CartLine[], amountCents: number | null): string {
  const sellers = [...new Set(cart.map((line) => line.sellerName).filter(Boolean))];
  const who = sellers.length === 1 ? sellers[0] : sellers.length > 1 ? "the sellers" : "the seller";
  const amount = amountCents === null ? "the held amount" : formatMoney(amountCents);
  return `Approve, and ${amount} is charged and paid to ${who}. Reject, and the hold is released: nothing is charged and nobody is paid.`;
}

// What a person can do with a purchase Chaperone paused: why it is waiting, the held cart, what each
// choice does, and the two ways out. It is a station on the route in the hold's own tint, not a
// card: "The decision is yours."
export function DecisionPanel({
  runId,
  cart,
  reasons,
  amountCents,
  unfinished,
  onDecided,
}: {
  runId: string;
  cart: CartLine[];
  reasons: HeldReason[];
  amountCents: number | null;
  unfinished?: Unfinished | null;
  onDecided: () => void;
}) {
  const decision = useDecision(runId, () => onDecided());
  const sellers = new Set(cart.map((line) => line.payeeKey)).size;
  return (
    <section className="decision station-section" aria-label="Your decision">
      <span className="station station-ring" aria-hidden="true" />
      <div className="decision-why">
        <h2 className="decision-heading t-section">The decision is yours.</h2>
        {!unfinished && (
          <>
            <h3 className="t-meta held-label">Why Chaperone paused it</h3>
            <HeldReasons reasons={reasons} />
          </>
        )}
      </div>
      <div className="decision-act">
        <div className="decision-cart">
          {/* One line is the whole cart, and the header already says its amount. */}
          <HeldCart cart={cart} amounts={cart.length > 1} />
        </div>
        {!unfinished && <p className="decision-what">{whatHappens(cart, amountCents)}</p>}
        <DecisionButtons {...decision} unfinished={unfinished} saidAbove sellers={sellers} />
      </div>
    </section>
  );
}
