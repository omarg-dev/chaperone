import type { CSSProperties, ReactNode } from "react";
import { formatElapsed } from "../format";
import { COLUMN_LABELS, type TimelineFooter, type TimelineItem } from "./types";

export type { NodeTone, TimelineFooter, TimelineItem } from "./types";

interface Row {
  key: string;
  at: string;
  catalog: TimelineItem[];
  route: TimelineItem[];
  seller: TimelineItem[];
  spine: boolean;
  firstMoney: boolean;
}

// Items that share a group share a row; the rest each have a row of their own. A row's spine is
// the money's route from the first item that says so, and the route's dashed line before it.
function rowsOf(items: readonly TimelineItem[]): Row[] {
  const rows: Row[] = [];
  const byGroup = new Map<string, Row>();
  let money = false;
  for (const item of items) {
    let row = item.group ? byGroup.get(item.group) : undefined;
    if (!row) {
      if (item.spine === "money") money = true;
      row = {
        key: item.group ?? item.id,
        at: item.at,
        catalog: [],
        route: [],
        seller: [],
        spine: money,
        firstMoney: item.spine === "money" && !rows.some((r) => r.spine),
      };
      rows.push(row);
      if (item.group) byGroup.set(item.group, row);
    } else if (item.spine === "money" && !row.spine) {
      // The hold belongs to a row that already exists (the checkout's): the spine starts there.
      money = true;
      row.spine = true;
      row.firstMoney = !rows.some((r) => r !== row && r.spine);
    }
    row[item.zone].push(item);
  }
  // A row after the first money row carries the spine on.
  let seen = false;
  for (const row of rows) {
    if (row.spine) seen = true;
    else if (seen) row.spine = true;
  }
  return rows;
}

function Item({ item }: { item: TimelineItem }) {
  const tone = item.tone ?? "none";
  if (item.kind === "station") {
    return (
      <div className={`tl-station tl-tone-${tone}`}>
        <span className="tl-node" aria-hidden="true" />
        <div className="tl-station-head">
          {item.tag && <span className="tl-tag">{item.tag}</span>}
          {item.title && <span className="tl-station-title">{item.title}</span>}
          {item.aside}
        </div>
        {item.body}
      </div>
    );
  }
  return (
    <article className={`tl-event tl-tone-${tone}`}>
      {item.tag && <span className="tl-tag">{item.tag}</span>}
      <div className="tl-event-head">
        <span className="tl-event-title">{item.title}</span>
        {item.aside}
      </div>
      {item.body}
    </article>
  );
}

function Cell({ items, zone }: { items: TimelineItem[]; zone: "catalog" | "route" | "seller" }) {
  return (
    <div className={`tl-cell tl-cell-${zone}`} data-zone={zone}>
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </div>
  );
}

// One vertical timeline in three columns: the person, agent and catalog on the left, the money's
// route down the middle, and seller-written text on the right behind the hatch. Each row is a
// moment; the time column says how far into the run it was.
export function Timeline({
  items,
  startedAt,
  label,
  footer,
}: {
  items: readonly TimelineItem[];
  startedAt: string | null;
  label: string;
  footer?: TimelineFooter;
}) {
  const rows = rowsOf(items);
  const elapsed = (at: string) =>
    startedAt ? formatElapsed(Date.parse(at) - Date.parse(startedAt)) : "";

  return (
    <section className="tl" aria-label={label}>
      <div className="tl-scroll">
        <div className="tl-grid">
          <div className="tl-head" aria-hidden="true">
            <span className="tl-head-time">Time</span>
            <span className="tl-head-cell tl-head-catalog">{COLUMN_LABELS.catalog}</span>
            <span className="tl-head-cell tl-head-route">{COLUMN_LABELS.route}</span>
            <span className="tl-head-cell tl-head-seller">
              <span className="tl-head-seller-label">{COLUMN_LABELS.seller}</span>
            </span>
          </div>
          <ol className="tl-rows">
            {rows.map((row) => (
              <li
                key={row.key}
                className="tl-row"
                data-spine={row.spine ? "money" : "none"}
                data-first-money={row.firstMoney || undefined}
              >
                <time className="tl-time" dateTime={row.at}>
                  {elapsed(row.at)}
                </time>
                <Cell items={row.catalog} zone="catalog" />
                <Cell items={row.route} zone="route" />
                <Cell items={row.seller} zone="seller" />
              </li>
            ))}
          </ol>
          {footer && <Footer footer={footer} />}
        </div>
      </div>
    </section>
  );
}

function Footer({ footer }: { footer: TimelineFooter }) {
  const lane = (zone: "catalog" | "route" | "seller", content: ReactNode) => {
    const taken = footer.taken === zone;
    const style = { "--exit-tone": toneVar(footer.takenTone) } as CSSProperties;
    return (
      <div
        className={`tl-exit tl-exit-${zone}${taken ? " tl-exit-taken" : ""}`}
        style={taken ? style : undefined}
      >
        <div className="tl-exit-label">{content}</div>
      </div>
    );
  };
  return (
    <div className="tl-foot">
      <span className="tl-time" />
      {lane("catalog", footer.catalog)}
      {lane("route", footer.route)}
      {lane("seller", footer.seller)}
    </div>
  );
}

function toneVar(tone: TimelineFooter["takenTone"]): string {
  switch (tone) {
    case "attacker":
      return "var(--attacker)";
    case "hold":
      return "var(--hold)";
    case "approve":
      return "var(--approve)";
    case "escalate":
      return "var(--escalate)";
    case "block":
      return "var(--block)";
    default:
      return "var(--ink)";
  }
}
