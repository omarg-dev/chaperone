import type { ReactNode } from "react";

export type ZoneKind = "catalog" | "route" | "seller";

export const ZONE_LABELS: Record<ZoneKind, string> = {
  catalog: "Catalog",
  route: "The route",
  seller: "Seller-written",
};

// One of the three grounds. The catalog is trusted data (what Gates 0 and 2 read), the route is
// Chaperone's own zone where the money is held, and seller text is untrusted and always sits
// behind the hatch (only Gate 1 reads it). Wrap seller text in a "seller" zone, never anywhere else.
export function Zone({
  kind,
  label,
  children,
}: {
  kind: ZoneKind;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`zone zone-${kind}`} data-zone={kind}>
      <span className="zone-label">{label ?? ZONE_LABELS[kind]}</span>
      {kind === "seller" ? <div className="zone-text">{children}</div> : children}
    </section>
  );
}

export type ReadKind = "catalog" | "seller" | "never" | "facts" | "facts-in";

const READ_LABELS: Record<ReadKind, string> = {
  catalog: "reads the catalog",
  seller: "reads seller text, in quarantine",
  never: "never sees seller text",
  facts: "writes typed facts",
  "facts-in": "reads the typed facts, never the text they came from",
};

// A small chip saying what a gate reads.
export function ReadChip({ kind, children }: { kind: ReadKind; children: ReactNode }) {
  return (
    <span className={`read read-${kind}`} title={READ_LABELS[kind]}>
      {children}
    </span>
  );
}
