import type { ReactNode } from "react";

// Detail waits behind a row with its one-line summary: "10 checks passed", then the checks.
export function Disclosure({
  title,
  summary,
  open,
  children,
}: {
  title: string;
  summary?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        <svg
          className="disclosure-chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M6 3.5 L10.5 8 L6 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          {title}
          {summary && <span className="disclosure-summary"> · {summary}</span>}
        </span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
