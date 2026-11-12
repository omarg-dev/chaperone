import { Link } from "react-router";
import { Section } from "../design";
import { useRuns } from "../runs/RunsProvider";
import { liveCounts, liveStats } from "./live";

// This server's runs, counted from its run log. It is not the eval: it counts whatever has run here,
// so it says so, and it sits apart from the results below it.
export function LiveStrip() {
  const { status, runs } = useRuns();
  const counts = liveCounts(runs);
  return (
    <Section
      heading="This server's runs"
      note="Counted from the runs on this server, not from the benchmark."
      className="live"
    >
      {status === "error" && runs.length === 0 ? (
        <p className="t-meta" role="status">
          The server's runs couldn't be read.
        </p>
      ) : status === "loading" && runs.length === 0 ? (
        <p className="t-meta" role="status">
          Loading runs…
        </p>
      ) : counts.total === 0 ? (
        <p className="t-meta">No runs on this server yet.</p>
      ) : (
        <ul className="live-stats">
          {liveStats(counts).map((stat) => (
            <li key={stat.key} className={`live-stat live-${stat.tone}`}>
              <Link to={stat.to} className="live-link">
                <span className="live-value">{stat.value}</span>
                <span className="live-label">{stat.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
