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

// A heading can name its own anchor with a trailing {#id}, so a link such as /docs#postman keeps
// working when the heading's wording changes. The marker is not part of the heading's text.
const EXPLICIT_ID = /\s*\{#([a-z0-9-]+)\}\s*$/;

const withoutId = (text: string): string => text.replace(EXPLICIT_ID, "");

const slug = (text: string): string =>
  EXPLICIT_ID.exec(text)?.[1] ??
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
        ? [{ text: withoutId(token.text), depth: token.depth, id: slug(token.text) }]
        : [],
    );
}

const renderer = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${withoutId(this.parser.parseInline(tokens))}</h${depth}>\n`;
    },
  },
});

export function renderDocs(markdown: string): string {
  return renderer.parse(markdown, { async: false });
}
