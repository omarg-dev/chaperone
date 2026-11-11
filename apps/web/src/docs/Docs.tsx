import { useMemo } from "react";
import { useNarrow } from "../shell/useNarrow";
import { headingsOf, renderDocs, SDK_DOCS } from "./sdk";

export function Docs() {
  const headings = useMemo(() => headingsOf(SDK_DOCS), []);
  // A code block scrolls sideways inside itself, so a keyboard can reach it to scroll it.
  const html = useMemo(() => renderDocs(SDK_DOCS).replaceAll("<pre>", '<pre tabindex="0">'), []);
  const contents = headings.filter((heading) => heading.depth > 1);
  // On a phone the contents list would push the text a screen down, so it folds into one line
  // that opens; on a laptop it stays beside the text.
  const narrow = useNarrow();
  const list = (
    <ul>
      {contents.map((heading) => (
        <li key={heading.id} className={heading.depth > 2 ? "docs-sub" : undefined}>
          <a href={`#${heading.id}`}>{heading.text}</a>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="docs">
      <nav className="docs-contents" aria-label="On this page">
        {narrow ? (
          <details className="docs-contents-fold">
            <summary>On this page</summary>
            {list}
          </details>
        ) : (
          <>
            <p className="t-meta">On this page</p>
            {list}
          </>
        )}
      </nav>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the Markdown is this repo's own file, read at build time */}
      <article className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
