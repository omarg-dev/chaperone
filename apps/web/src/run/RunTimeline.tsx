import type { ReactNode } from "react";
import { Disclosure, formatMoney, type GateState, Pill, ReadChip } from "../design";
import { formatCost } from "../format";
import { Timeline, type TimelineFooter, type TimelineItem } from "../timeline/Timeline";
import type { NodeTone } from "../timeline/types";
import type { FactRow, RunItem, RunModel, Segment, ServedPage, Verdict } from "./timeline";

// Draws a RunModel with the timeline component. Nothing here decides anything: the model says what
// each item is, and this turns it into the words, pills and disclosures of the design.

const tone = (verdict: Verdict | null): NodeTone => verdict ?? "none";

const humanise = (rule: string) => {
  const text = rule.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function Facts({ rows }: { rows: FactRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="tl-facts">
      {rows.map((row) => (
        <div key={`${row.label}|${row.value}`}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Spend({ costUsd, latencyMs }: { costUsd: number; latencyMs: number }) {
  return (
    <p className="tl-spend t-data">
      {formatCost(costUsd)} · {latencyMs} ms
    </p>
  );
}

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.marked ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
          <mark key={index}>{segment.text}</mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder.
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

// Everything a seller wrote, as the arena served it. It is only ever drawn in the seller column.
function ServedPages({ pages }: { pages: ServedPage[] }) {
  return (
    <div className="tl-served">
      {pages.map((page) => (
        <Disclosure
          key={`${page.listingId}-${page.blocks.length}`}
          title={page.productName}
          summary={`${page.blocks.length} ${page.blocks.length === 1 ? "passage" : "passages"}`}
        >
          <div className="tl-passages">
            {page.blocks.map((block, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional and never reorder.
              <p key={index} className="tl-passage">
                <span className="tl-passage-label">
                  {block.label}
                  {block.by ? `, ${block.by}` : ""}
                </span>
                <Marked segments={block.segments} />
              </p>
            ))}
          </div>
        </Disclosure>
      ))}
    </div>
  );
}

function readsOf(item: Extract<RunItem, { kind: "gate" }>): ReactNode {
  const { reads } = item;
  return (
    <span className="tl-reads">
      {reads.catalog && <ReadChip kind="catalog">Catalog</ReadChip>}
      <ReadChip kind={reads.seller === "quarantine" ? "seller" : "never"}>Seller</ReadChip>
      <ReadChip
        kind={reads.facts === "writes" ? "facts" : reads.facts === "reads" ? "facts-in" : "never"}
      >
        Facts
      </ReadChip>
    </span>
  );
}

function toTimelineItem(item: RunItem): TimelineItem {
  const base = { id: item.id, at: item.at, zone: item.zone, group: item.group };
  const spine = item.spine ? { spine: item.spine } : {};
  switch (item.kind) {
    case "step":
      return {
        ...base,
        kind: "event",
        tag: item.tag,
        title: item.title,
        tone: item.tag === "Person" ? "hold" : "none",
        body:
          item.lines.length > 0 || item.quote ? (
            <>
              {item.lines.map((line) => (
                <span key={line} className="tl-event-line">
                  {line}
                </span>
              ))}
              {item.quote && <q className="tl-own-words">{item.quote}</q>}
            </>
          ) : undefined,
      };
    case "hold":
      return {
        ...base,
        ...spine,
        kind: "station",
        title: "",
        tone: "hold",
        aside: <Pill state="held" label="Held at checkout" />,
      };
    case "gate": {
      const state: GateState = item.verdict;
      return {
        ...base,
        kind: "station",
        title: item.label,
        tone: tone(item.verdict),
        aside: <Pill state={state} />,
        body: (
          <>
            {readsOf(item)}
            {item.gate === "gate1" && item.facts.length > 0 && (
              <Disclosure
                title="Typed facts it passed on"
                summary={`${item.facts.length} ${item.facts.length === 1 ? "line" : "lines"}`}
              >
                <Facts rows={item.facts} />
                <Spend costUsd={item.costUsd} latencyMs={item.latencyMs} />
              </Disclosure>
            )}
          </>
        ),
      };
    }
    case "review":
      return {
        ...base,
        kind: "station",
        title: "Review",
        tone: tone(item.verdict),
        aside: item.verdict ? (
          <Pill state={item.verdict} />
        ) : (
          <span className="badge">Nobody reviewed the cart</span>
        ),
        body:
          item.config !== "full" ? <span className="tl-skip">Firewall: {item.config}</span> : null,
      };
    case "skipped":
      return {
        ...base,
        kind: "station",
        title: "",
        tone: "none",
        body: <span className="tl-skip">{item.text}</span>,
      };
    case "gate0_card": {
      const passed = item.checks.filter((c) => c.passed).length;
      return {
        ...base,
        kind: "event",
        tag: "Read from the catalog",
        title: item.title,
        tone: tone(item.verdict),
        body: (
          <Disclosure title="Rule results" summary={`${passed} of ${item.checks.length} passed`}>
            <ul className="tl-checks">
              {item.checks.map((check, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: checks are positional and never reorder.
                <li key={index} className={check.passed ? "tl-check-pass" : "tl-check-fail"}>
                  <strong>{humanise(check.rule)}</strong>
                  <span className="visually-hidden">{check.passed ? " passed" : " failed"}</span>
                  {check.reason}
                </li>
              ))}
            </ul>
            <Spend costUsd={item.costUsd} latencyMs={item.latencyMs} />
          </Disclosure>
        ),
      };
    }
    case "gate2_card":
      return {
        ...base,
        kind: "event",
        tag: "Read the catalog and Gate 1's facts",
        title: item.title,
        tone: tone(item.verdict),
        body: (
          <Disclosure title="How it judged">
            {item.explanation && <p className="tl-explanation">{item.explanation}</p>}
            {item.lines.map((line) => (
              <div key={line.productName} className="tl-line-facts">
                <span className="tl-line-name">{line.productName}</span>
                <Facts rows={line.rows} />
              </div>
            ))}
            {item.notes.length > 0 && (
              <ul className="tl-notes">
                {item.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            <Spend costUsd={item.costUsd} latencyMs={item.latencyMs} />
          </Disclosure>
        ),
      };
    case "gate1_card":
      return {
        ...base,
        kind: "event",
        tag: "Read again, in quarantine",
        title: item.title,
        // Red, as an outline, when Gate 1 flagged the page: where the attacker's money would have come from.
        tone: item.flagged ? "attacker" : tone(item.verdict),
        body: (
          <>
            <span className={`tl-crosses${item.flagged ? " tl-crosses-flagged" : ""}`}>
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" focusable="false">
                <path
                  d="M17 6 H2 M6.5 1.5 L2 6 L6.5 10.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {item.crosses}
            </span>
            {item.quotes.map((quote) => (
              <figure key={quote.quote} className="tl-quote">
                <blockquote>{quote.quote}</blockquote>
                <figcaption>
                  {quote.flag}, on {quote.productName}
                </figcaption>
              </figure>
            ))}
            {item.discountCodes.length > 0 && (
              <span className="tl-event-line">
                Discount {item.discountCodes.length === 1 ? "code" : "codes"}:{" "}
                {item.discountCodes.join(", ")}
              </span>
            )}
          </>
        ),
      };
    case "served":
      return {
        ...base,
        kind: "event",
        tag: "Arena · served to the agent",
        title: item.title,
        body: item.pages.length > 0 ? <ServedPages pages={item.pages} /> : undefined,
      };
  }
}

export function toTimelineItems(model: RunModel): TimelineItem[] {
  return model.items.map(toTimelineItem);
}

// The three places the money can leave the route, with the one it took drawn solid.
export function exitsOf(model: RunModel): TimelineFooter {
  const { exit, money } = model;
  const attacker = money.paidToAttackerCents > 0;
  return {
    taken: exit === "capture" ? "catalog" : exit === "void" ? "seller" : exit ? "route" : undefined,
    takenTone:
      exit === "capture" ? (attacker ? "attacker" : "approve") : exit === "void" ? "block" : "hold",
    catalog: (
      <>
        <span className="tl-exit-title">Capture and pay the seller</span>
        {exit === "capture" &&
          money.payouts.map((payout) => (
            <span key={payout.payeeKey} className="tl-exit-line">
              {formatMoney(payout.amountCents)} to {payout.sellerName}
            </span>
          ))}
      </>
    ),
    route: (
      <>
        {exit === "person" && (
          <span className="tl-exit-dot" role="img" aria-label="The money, held" />
        )}
        <span className="tl-exit-title">To the person</span>
        {exit === "person" && (
          <span className="tl-exit-line">
            {model.awaitingPerson ? "Waiting on you" : "Stays held, nobody is deciding"}
          </span>
        )}
      </>
    ),
    seller: (
      <>
        <span className="tl-exit-title">Void the hold</span>
        {exit === "void" && <span className="tl-exit-line">Nobody is paid</span>}
      </>
    ),
  };
}

export function RunTimeline({ model }: { model: RunModel }) {
  return (
    <Timeline
      label="Timeline of the run"
      startedAt={model.startedAt}
      items={toTimelineItems(model)}
      footer={exitsOf(model)}
    />
  );
}
