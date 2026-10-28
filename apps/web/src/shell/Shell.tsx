import { NavLink, Outlet } from "react-router";
import { Wordmark } from "../design";
import { useRuns } from "../runs/RunsProvider";
import { ThemeSwitch } from "../theme/ThemeSwitch";

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS = {
  runs: "M2 4h12M2 8h12M2 12h8",
  escalations: "M8 2.5v7M5 5.5l3-3 3 3M3 13h10",
  dashboard: "M3 13V8M8 13V3M13 13V6",
  arena: "M2.5 6.5 8 3l5.5 3.5V13h-11z",
};

export function Shell() {
  const { openEscalations } = useRuns();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/runs" className="topbar-home" aria-label="Chaperone, home">
          <Wordmark />
        </NavLink>
        <nav aria-label="Main" className="topbar-nav">
          <NavLink to="/runs" className="nav-link">
            <NavIcon d={ICONS.runs} />
            Runs
          </NavLink>
          <NavLink to="/escalations" className="nav-link">
            <NavIcon d={ICONS.escalations} />
            Escalations
            <span
              className={`count${openEscalations > 0 ? " count-live" : ""}`}
              role="status"
              aria-label={`${openEscalations} waiting for you`}
            >
              {openEscalations}
            </span>
          </NavLink>
          <NavLink to="/dashboard" className="nav-link">
            <NavIcon d={ICONS.dashboard} />
            Dashboard
          </NavLink>
          <NavLink to="/arena" className="nav-link nav-link-soon">
            <NavIcon d={ICONS.arena} />
            Arena
            <span className="badge">Under construction</span>
          </NavLink>
        </nav>
        <div className="topbar-end">
          <ThemeSwitch />
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
