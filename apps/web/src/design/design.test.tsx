import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Amount, amountParts, formatMoney, Rate, rateParts } from "./Amount";
import { Mark } from "./Mark";
import { MONEY_STATE_LABELS, MONEY_STATES, MoneyGlyph } from "./MoneyGlyph";
import { Page, Section } from "./Page";
import { PageRoute, Station } from "./PageRoute";
import { GATE_STATE_LABELS, GATE_STATES, MONEY_OF_GATE, Pill } from "./Pill";
import { Seal, sealGroups } from "./Seal";
import { Toggle } from "./Toggle";
import { Vault } from "./Vault";
import { Zone } from "./Zone";

describe("the gate state pill", () => {
  it.each(GATE_STATES)("renders %s with an accessible label", (state) => {
    render(<Pill state={state} />);
    const pill = screen.getByRole("img", { name: `Verdict: ${GATE_STATE_LABELS[state]}` });
    expect(pill).toHaveClass(`pill-${state}`);
  });

  it("covers the five states, and a filled red pill belongs to the paid attacker alone", () => {
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

describe("amounts", () => {
  it("raises the fraction: the whole part full size, the cents at half size", () => {
    expect(amountParts(10999)).toEqual({ whole: "$109", fraction: ".99" });
    expect(amountParts(13900)).toEqual({ whole: "$139", fraction: ".00" });
    expect(amountParts(5)).toEqual({ whole: "$0", fraction: ".05" });
    expect(amountParts(123456)).toEqual({ whole: "$1,234", fraction: ".56" });
  });

  it("sets a rate the same way: 68.8% is 68 and a raised .8%", () => {
    expect(rateParts(68.8)).toEqual({ whole: "68", fraction: ".8%" });
    expect(rateParts(0)).toEqual({ whole: "0", fraction: ".0%" });
    expect(rateParts(25, 0)).toEqual({ whole: "25", fraction: "%" });
  });

  it("is said once to assistive technology, whole, and drawn raised for the eye", () => {
    const { container } = render(<Amount cents={10999} size="xl" />);
    expect(screen.getByText("$109.99")).toHaveClass("visually-hidden");
    const drawn = container.querySelector('[aria-hidden="true"]');
    expect(drawn).toHaveTextContent("$109.99");
    expect(drawn?.querySelector(".amt-c")).toHaveTextContent(".99");
    expect(container.querySelector(".amt")).toHaveClass("amt-xl", "amt-plain");
  });

  it("strikes voided money through and paints an attacker's red, and nothing else is either", () => {
    const { container, rerender } = render(<Amount cents={13900} tone="voided" />);
    expect(container.querySelector(".amt")).toHaveClass("amt-voided");
    rerender(<Amount cents={7999} tone="attacker" />);
    expect(container.querySelector(".amt")).toHaveClass("amt-attacker");
    rerender(<Amount cents={7999} />);
    expect(container.querySelector(".amt")).not.toHaveClass("amt-attacker", "amt-voided");
    rerender(<Rate percent={68.8} tone="attacker" />);
    expect(screen.getByText("68.8%")).toBeInTheDocument();
  });
});

describe("the money-state glyphs", () => {
  it("are eight, each with its own words", () => {
    expect(MONEY_STATES).toHaveLength(8);
    expect(new Set(Object.values(MONEY_STATE_LABELS)).size).toBe(8);
  });

  it.each(MONEY_STATES)("draws %s as its own silhouette", (state) => {
    const { container } = render(<MoneyGlyph state={state} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass(`glyph-${state}`);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.childElementCount).toBeGreaterThan(0);
  });

  it("gives every state a different drawing, so none is told apart by colour alone", () => {
    const drawings = MONEY_STATES.map((state) => {
      const { container } = render(<MoneyGlyph state={state} />);
      return container.querySelector("svg")?.innerHTML;
    });
    expect(new Set(drawings).size).toBe(8);
  });

  it("draws each gate state as the money state it leads to", () => {
    expect(MONEY_OF_GATE).toEqual({
      approve: "captured",
      held: "held",
      escalate: "person",
      block: "voided",
      attacker: "attacker",
    });
  });

  it("leaves Paid attacker as the one filled pill", () => {
    render(
      <>
        <Pill state="attacker" />
        <Pill state="block" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Verdict: Paid attacker" })).toHaveClass(
      "pill-attacker",
    );
    expect(document.querySelectorAll(".pill-attacker")).toHaveLength(1);
  });
});

describe("the route line", () => {
  it("is a page's title station, with each section a station of its own", () => {
    const { container } = render(
      <PageRoute title="Runs" lede="Every purchase.">
        <Station heading="Where the money went">x</Station>
        <Station heading="211 runs" step={2}>
          y
        </Station>
      </PageRoute>,
    );
    expect(container.querySelector("[data-route]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Runs" })).toBeInTheDocument();
    expect(container.querySelectorAll(".station-title")).toHaveLength(1);
    expect(container.querySelectorAll(".station-section")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "211 runs" })).toBeInTheDocument();
  });

  it("is the run page's alone: a plain page has sections and no stations", () => {
    const { container } = render(
      <Page title="Runs" lede="Every purchase.">
        <Section heading="211 runs" step={2}>
          y
        </Section>
      </Page>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "211 runs" })).toBeInTheDocument();
    expect(container.querySelector("[data-route], .station")).toBeNull();
  });

  it("holds the money in a vault, which is named", () => {
    render(
      <Vault label="Held right now">
        <p>$171.98</p>
      </Vault>,
    );
    expect(screen.getByRole("region", { name: "Held right now" })).toHaveClass("vault");
  });
});

describe("the seal", () => {
  it("reads a hash in groups of eight, with or without its prefix", () => {
    const hash = "sha256:ffd84b5aec819dad904174d33fad04f5e63c10716c3e470e009aafdc1753f57a";
    expect(sealGroups(hash)).toEqual(["ffd84b5a", "ec819dad", "904174d3"]);
    expect(sealGroups(hash.replace("sha256:", ""))).toEqual(["ffd84b5a", "ec819dad", "904174d3"]);
  });

  it("says who locked it, and the hash, in its name", () => {
    render(<Seal hash="ffd84b5aec819dad904174d3" lockedAt="24 Oct 2026, 11:03 UTC" />);
    expect(
      screen.getByRole("img", { name: "Seal: locked by you, sha256 ffd84b5a ec819dad 904174d3" }),
    ).toBeInTheDocument();
  });
});

describe("the toggle", () => {
  it("is a checkbox with its label, which says what it does", async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    render(
      <Toggle checked={false} onChange={(on) => seen.push(on)} hint="Rows under their attack">
        Group by attack
      </Toggle>,
    );
    const box = screen.getByRole("checkbox", { name: "Group by attack" });
    expect(box).not.toBeChecked();
    expect(screen.getByText("Group by attack").closest("label")).toHaveAttribute(
      "title",
      "Rows under their attack",
    );
    await user.click(box);
    expect(seen).toEqual([true]);
  });
});
