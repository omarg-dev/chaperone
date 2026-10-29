import type { ReactNode } from "react";

// A page's title and one line saying what the page is for.
export function PageHeader({
  title,
  lede,
  aside,
}: {
  title: string;
  lede?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="t-page-title">{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {aside}
    </header>
  );
}
