import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline, type TimelineItem } from "./Timeline";

const at = (s: number) => new Date(Date.UTC(2026, 9, 24, 11, 3, s)).toISOString();
const items: TimelineItem[] = [
  { id: "a", at: at(0), zone: "catalog", kind: "event", tag: "Person", title: "Asked" },
  { id: "b", at: at(3), zone: "catalog", kind: "event", title: "Opened", group: "open" },
  { id: "c", at: at(3), zone: "seller", kind: "event", title: "Page text", group: "open" },
  { id: "d", at: at(9), zone: "route", kind: "station", title: "Gate 0", spine: "money" },
  { id: "e", at: at(70), zone: "route", kind: "station", title: "Review" },
];

describe("the timeline", () => {
  it("puts each item in its zone's column, and items of one group on one row", () => {
    render(<Timeline items={items} startedAt={at(0)} label="Test run" />);
    const rows = within(screen.getByRole("region", { name: "Test run" })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    const open = rows[1] as HTMLElement;
    expect(within(open).getByText("Opened").closest("[data-zone]")).toHaveAttribute(
      "data-zone",
      "catalog",
    );
    expect(within(open).getByText("Page text").closest("[data-zone]")).toHaveAttribute(
      "data-zone",
      "seller",
    );
  });

  it("labels each row with how far into the run it was", () => {
    render(<Timeline items={items} startedAt={at(0)} label="Test run" />);
    expect([...document.querySelectorAll(".tl-row .tl-time")].map((t) => t.textContent)).toEqual([
      "0s",
      "3s",
      "9s",
      "1m 10s",
    ]);
  });

  it("draws the spine dashed until an item says the money is on the route, then solid", () => {
    render(<Timeline items={items} startedAt={at(0)} label="Test run" />);
    const spines = [...document.querySelectorAll(".tl-row")].map((r) =>
      r.getAttribute("data-spine"),
    );
    expect(spines).toEqual(["none", "none", "money", "money"]);
    expect(document.querySelectorAll("[data-first-money]")).toHaveLength(1);
  });

  it("draws the roads not taken at the foot, and the one taken solid", () => {
    render(
      <Timeline
        items={items}
        startedAt={at(0)}
        label="Test run"
        footer={{
          catalog: "Capture",
          route: "Person",
          seller: "Void",
          taken: "seller",
          takenTone: "block",
        }}
      />,
    );
    expect(document.querySelectorAll(".tl-exit-taken")).toHaveLength(1);
    expect(document.querySelector(".tl-exit-taken")).toHaveTextContent("Void");
  });
});
