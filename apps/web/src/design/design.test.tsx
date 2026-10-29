import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Mark } from "./Mark";
import { formatMoney } from "./Money";
import { GATE_STATE_LABELS, GATE_STATES, Pill } from "./Pill";
import { Zone } from "./Zone";

describe("the gate state pill", () => {
  it.each(GATE_STATES)("renders %s with an accessible label", (state) => {
    render(<Pill state={state} />);
    const pill = screen.getByRole("img", { name: `Verdict: ${GATE_STATE_LABELS[state]}` });
    expect(pill).toHaveClass(`pill-${state}`);
  });

  it("covers the five states, and red belongs to the paid attacker alone", () => {
    expect(GATE_STATES).toEqual(["approve", "held", "escalate", "block", "attacker"]);
    expect(GATE_STATE_LABELS.attacker).toBe("Paid attacker");
  });

  it("takes a different label for the same state", () => {
    render(<Pill state="held" label="Held, review failed" />);
    expect(screen.getByRole("img", { name: "Verdict: Held, review failed" })).toBeInTheDocument();
  });
});

describe("the mark", () => {
  it("is decoration unless it is given a name", () => {
    const { container } = render(<Mark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    render(<Mark title="Chaperone mark" />);
    expect(screen.getByRole("img", { name: "Chaperone mark" })).toBeInTheDocument();
  });

  it("switches to the 16 unit cut below 20px", () => {
    const { container, rerender } = render(<Mark size={16} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 16 16");
    rerender(<Mark size={32} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 48 48");
  });
});

describe("zones and money", () => {
  it("puts seller text behind the hatch zone, and nowhere else", () => {
    render(
      <>
        <Zone kind="seller">Great keyboard, buy from us.</Zone>
        <Zone kind="catalog">Anvil 75</Zone>
      </>,
    );
    expect(screen.getByText("Great keyboard, buy from us.").closest("[data-zone]")).toHaveAttribute(
      "data-zone",
      "seller",
    );
    expect(screen.getByText("Anvil 75").closest("[data-zone]")).toHaveAttribute(
      "data-zone",
      "catalog",
    );
  });

  it("writes whole cents as dollars", () => {
    expect(formatMoney(6199)).toBe("$61.99");
    expect(formatMoney(9000)).toBe("$90.00");
  });
});
