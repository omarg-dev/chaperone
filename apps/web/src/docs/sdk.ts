// The SDK docs are one Markdown file in the repo, docs/sdk.md, read at build time, so the page and
// the README's link point at the same text.
import { Marked, marked } from "marked";
import source from "../../../../docs/sdk.md?raw";

export const SDK_DOCS: string = source;

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// The title is the page's h1; the contents list is the sections under it.
export function headingsOf(markdown: string): Heading[] {
  return marked
    .lexer(markdown)
    .flatMap((token) =>
      token.type === "heading"
        ? [{ text: token.text, depth: token.depth, id: slug(token.text) }]
        : [],
    );
}

const renderer = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

export function renderDocs(markdown: string): string {
  return renderer.parse(markdown, { async: false });
}
