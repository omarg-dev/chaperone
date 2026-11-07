import { useMemo } from "react";
import { headingsOf, renderDocs, SDK_DOCS } from "./sdk";

export function Docs() {
  const headings = useMemo(() => headingsOf(SDK_DOCS), []);
  const html = useMemo(() => renderDocs(SDK_DOCS), []);
  const contents = headings.filter((heading) => heading.depth > 1);
  return (
    <div className="docs">
      <nav className="docs-contents" aria-label="On this page">
        <p className="t-meta">On this page</p>
        <ul>
          {contents.map((heading) => (
            <li key={heading.id} className={heading.depth > 2 ? "docs-sub" : undefined}>
              <a href={`#${heading.id}`}>{heading.text}</a>
            </li>
          ))}
        </ul>
      </nav>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the Markdown is this repo's own file, read at build time */}
      <article className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
