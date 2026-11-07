import { type ReactNode, useId } from "react";

// A page that isn't the run page: a title, an optional lede, and sections laid out one under the
// other. The route line (PageRoute, Station) belongs to the run page only, where a run really is a
// route with money moving along it. The styles are styles/page.css.
export function Page({
  title,
  lede,
  eyebrow,
  aside,
  className,
  headerClassName,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  // Sits over the title: a state, a badge.
  eyebrow?: ReactNode;
  // Sits at the right of the title: a tab row, a button.
  aside?: ReactNode;
  className?: string;
  headerClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className={["page", className].filter(Boolean).join(" ")}>
      <header className={["page-title", headerClassName].filter(Boolean).join(" ")}>
        <div className="page-title-text">
          {eyebrow}
          <h1 className="t-display">{title}</h1>
          {lede && <p className="t-lede page-lede">{lede}</p>}
        </div>
        {aside}
      </header>
      {children}
    </div>
  );
}

// A section of a page: its heading, then whatever it holds. `step` numbers a section in a sequence
// (Start a run), and `note` sits at the heading's far end in the record face.
export function Section({
  heading,
  step,
  note,
  id,
  className,
  children,
}: {
  heading: ReactNode;
  step?: number;
  note?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  const generated = useId();
  const headingId = id ?? generated;
  return (
    <section
      className={["page-section", className].filter(Boolean).join(" ")}
      aria-labelledby={headingId}
    >
      <div className="page-head">
        <h2 className="page-heading t-section" id={headingId}>
          {step !== undefined && (
            <span className="page-step t-data" aria-hidden="true">
              {step}
            </span>
          )}
          <span>{heading}</span>
        </h2>
        {note && <span className="page-note t-data">{note}</span>}
      </div>
      {children}
    </section>
  );
}
