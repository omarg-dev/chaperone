import { NavLink, Outlet } from "react-router";
import { buttonClass, Wordmark } from "../design";
import { useRuns } from "../runs/RunsProvider";
import { ThemeSwitch } from "../theme/ThemeSwitch";

export function Shell() {
  const { heldForPerson } = useRuns();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" end className="topbar-home" aria-label="Chaperone, home">
          <Wordmark />
        </NavLink>
        <nav aria-label="Main" className="topbar-nav">
          <NavLink to="/runs" className="nav-link">
            Runs
          </NavLink>
          <NavLink to="/escalations" className="nav-link">
            Escalations
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
          <NavLink to="/arena" className="nav-link nav-link-soon">
            Arena
            <span className="nav-soon">Under construction</span>
          </NavLink>
        </nav>
        <div className="topbar-end">
          {/* The one filled button on a screen, until the page it opens is the one on screen: then
              it is the current link, like the others. */}
          <NavLink
            to="/start"
            className={({ isActive }) =>
              isActive
                ? "nav-link active topbar-start-here"
                : `${buttonClass("primary", true)} topbar-start`
            }
          >
            Start a run
          </NavLink>
          <ThemeSwitch />
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
