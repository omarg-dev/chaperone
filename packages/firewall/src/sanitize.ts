import { CODE_MAX_CHARS, QUOTE_MAX_CHARS } from "./facts.js";

// The two places seller-written text survives extraction, quotes and discount codes, are cleaned
// here in code, whatever the model wrote. The schema asks for short exact quotes, but structured
// outputs can't enforce a length, and a model that was talked round could still write anything into
// a string field. So a quote is kept only if it really is text from the document it names (the
// model can't invent one), reduced to plain words and punctuation, and capped.

// Letters, combining marks, digits, whitespace and ordinary punctuation. Everything else goes:
// control and format characters (zero-width and bidi overrides among them), angle brackets, braces
// and the other characters markup and JSON are made of.
const NOT_PLAIN = /[^\p{L}\p{M}\p{N}\s.,;:!?'"()%$&/+\-@]/gu;

function plain(text: string): string {
  return text.normalize("NFKC").replace(NOT_PLAIN, " ").replace(/\s+/g, " ").trim();
}

const comparable = (text: string) => plain(text).toLowerCase();

function cap(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

// The quote, cleaned and capped, or null when it isn't text from the document.
export function verifiedQuote(quote: string, documentText: string): string | null {
  const wanted = comparable(quote);
  if (wanted.length === 0) return null;
  if (!comparable(documentText).includes(wanted)) return null;
  return cap(plain(quote), QUOTE_MAX_CHARS);
}

// A snippet code cut from a document itself (a tripwire's match), cleaned and capped the same way.
export function cleanSnippet(text: string): string | null {
  const cleaned = plain(text);
  return cleaned.length === 0 ? null : cap(cleaned, QUOTE_MAX_CHARS);
}

// A discount code as a code: capitals, digits, hyphens and underscores, capped. Null when nothing
// code-like is left. Coupon codes match without regard to case in the shop too.
export function cleanCode(code: string): string | null {
  const cleaned = code
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  return cleaned.length === 0 ? null : cleaned.slice(0, CODE_MAX_CHARS);
}
