import { type ReactNode, useId } from "react";

// The route line: every page is the money's route drawn down its left side. A 3px aubergine spine
// runs from the title to the foot of the page, the title is a filled station on it, and each section
// is a ring station joined to its heading by a short branch. Sections are stations and nothing else:
// no cards and no dividers. The geometry is the tokens' (`--spine-*`, `--station-*`), and the CSS is
// styles/route.css.
export function PageRoute({
  title,
  lede,
  eyebrow,
  above,
  aside,
  titleSize = "display",
  className,
  headerClassName,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  // Sits over the title: a state, a badge.
  eyebrow?: ReactNode;
  // A one line row over the whole header (a breadcrumb). The spine starts below it.
  above?: ReactNode;
  // Sits at the right of the title: a tab row, a button.
  aside?: ReactNode;
  // "display" is a page's name (64px); "headline" is a sentence (the run view's).
  titleSize?: "display" | "headline";
  className?: string;
  headerClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={["route", above && "route-with-above", className].filter(Boolean).join(" ")}
      data-route=""
    >
      {above && <div className="route-above">{above}</div>}
      <header className={["route-title", headerClassName].filter(Boolean).join(" ")}>
        <span className="station station-title" aria-hidden="true" />
        <div className="route-title-text">
          {eyebrow}
          <h1 className={titleSize === "display" ? "t-display" : "t-headline"}>{title}</h1>
          {lede && <p className="t-lede route-lede">{lede}</p>}
        </div>
        {aside}
      </header>
      {children}
    </div>
  );
}

// A section of a page: a ring station on the spine, joined to its heading. `step` numbers a section
// in a sequence (Start a run), and `note` sits at the heading's far end in the record face.
export function Station({
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
      className={["station-section", className].filter(Boolean).join(" ")}
      aria-labelledby={headingId}
    >
      <span className="station station-ring" aria-hidden="true" />
      <div className="station-head">
        <h2 className="station-heading t-section" id={headingId}>
          {step !== undefined && (
            <span className="station-step t-data" aria-hidden="true">
              {step}
            </span>
          )}
          <span>{heading}</span>
        </h2>
        {note && <span className="station-note t-data">{note}</span>}
      </div>
      {children}
    </section>
  );
}
