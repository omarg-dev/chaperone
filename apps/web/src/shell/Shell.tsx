import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { buttonClass, Wordmark } from "../design";
import { useRuns } from "../runs/RunsProvider";
import { ThemeSwitch } from "../theme/ThemeSwitch";
import { Footer } from "./Footer";
import { useScrollOnNavigate } from "./useScrollOnNavigate";

// The top bar, the page and the footer. On a wide screen the bar is one row: the wordmark, where
// you can go, the theme and the one filled button. On a phone the links and the theme fold behind a
// Menu button (shell.css decides which by the screen's width), so the bar stays one short row.
export function Shell() {
  const { heldForPerson } = useRuns();
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useScrollOnNavigate();

  // While the menu is open: its first link takes the focus (the menu sits before its button in the
  // page, so a keyboard or a screen reader would otherwise have to go backwards to find it), Escape
  // closes it and gives the focus back, and a press anywhere outside the bar closes it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus();
    };
    const onPress = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  const waiting = heldForPerson === 1 ? "1 purchase" : `${heldForPerson} purchases`;
  return (
    <div className="shell">
      <header className="topbar" ref={header} data-menu={open ? "open" : "closed"}>
        <NavLink
          to="/"
          end
          className="topbar-home"
          aria-label="Chaperone, home"
          onClick={() => setOpen(false)}
        >
          <Wordmark />
        </NavLink>
        {/* A link in the menu goes somewhere, so following one closes it. The theme button stays. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the click is the links' own, heard here once */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Enter on a link is a click */}
        <div
          className="topbar-menu"
          id="topbar-menu"
          ref={menu}
          onClick={(event) => {
            if ((event.target as Element).closest("a")) setOpen(false);
          }}
        >
          <nav aria-label="Main" className="topbar-nav">
            <NavLink to="/runs" className="nav-link">
              Runs
            </NavLink>
            <NavLink
              to="/escalations"
              className="nav-link"
              aria-label={`Waiting on you, ${waiting}`}
            >
              Waiting on you
              <span
                className={`count${heldForPerson > 0 ? " count-live" : ""}`}
                role="status"
                aria-label={`${heldForPerson} waiting for you`}
              >
                {heldForPerson}
              </span>
            </NavLink>
            <NavLink to="/dashboard" className="nav-link">
              Dashboard
            </NavLink>
            <NavLink to="/docs" className="nav-link">
              Docs
            </NavLink>
          </nav>
          <ThemeSwitch />
        </div>
        {/* The one filled button on a screen, until the page it opens is the one on screen: then
            it is the current link, like the others. */}
        <NavLink
          to="/start"
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            isActive
              ? "nav-link active topbar-start-here"
              : `${buttonClass("primary", true)} topbar-start`
          }
        >
          Start a run
        </NavLink>
        <button
          type="button"
          ref={menuButton}
          className="topbar-menu-button"
          aria-expanded={open}
          aria-controls="topbar-menu"
          aria-label={heldForPerson > 0 ? `Menu, ${waiting} waiting on you` : "Menu"}
          onClick={() => setOpen((was) => !was)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d={open ? "M3.5 3.5l9 9M12.5 3.5l-9 9" : "M2 4.5h12M2 8h12M2 11.5h12"} />
          </svg>
          <span className="topbar-menu-word">{open ? "Close" : "Menu"}</span>
          {heldForPerson > 0 && !open && (
            <span className="count count-live" aria-hidden="true">
              {heldForPerson}
            </span>
          )}
        </button>
      </header>
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
