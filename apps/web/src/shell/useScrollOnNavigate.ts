import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

// How long a page has to draw the part an address names (`/docs#postman`) before we stop looking.
const FIND_FOR_MS = 2000;

// The router doesn't move the page when the address changes, so a link followed from the foot of
// one page opened the next one halfway down, and an address with a part in it (`/docs#postman`,
// typed or opened from the home page) opened at the top. Following a link now starts at the top of
// the new page, or at the part it names; going back and forward is left to the browser, which keeps
// where you were. A change to the query alone (a filter, a replay's playhead) doesn't move the page.
export function useScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  // Read when the address moves, not a reason to move: a filter written with `replace` after a
  // link was followed changes how the address last changed, and mustn't send the page to the top.
  const type = useNavigationType();
  const how = useRef(type);
  how.current = type;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is the reason to scroll
  useEffect(() => {
    if (hash.length > 1) {
      const id = decodeURIComponent(hash.slice(1));
      const until = Date.now() + FIND_FOR_MS;
      let frame = 0;
      const find = () => {
        const target = document.getElementById(id);
        if (target) target.scrollIntoView?.();
        else if (Date.now() < until) frame = requestAnimationFrame(find);
      };
      find();
      return () => cancelAnimationFrame(frame);
    }
    if (how.current !== "POP") window.scrollTo(0, 0);
  }, [pathname, hash]);
}
