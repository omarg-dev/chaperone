import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Escalations } from "./pages/Escalations";
import { Arena, NotFound } from "./pages/Placeholders";
import { Runs } from "./pages/Runs";
import { RunView } from "./run/RunView";
import { RunsProvider } from "./runs/RunsProvider";
import { Shell } from "./shell/Shell";

// The dashboard carries the data grid, which is most of the app's weight, so it loads when someone
// opens the page and the run view and the lists don't wait for it.
const Dashboard = lazy(() =>
  import("./dashboard/Dashboard").then((module) => ({ default: module.Dashboard })),
);

export function App() {
  return (
    <RunsProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/runs" replace />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:runId" element={<RunView />} />
          <Route path="escalations" element={<Escalations />} />
          <Route
            path="dashboard"
            element={
              <Suspense
                fallback={
                  <p className="t-meta" role="status">
                    Loading the dashboard…
                  </p>
                }
              >
                <Dashboard />
              </Suspense>
            }
          />
          <Route path="arena" element={<Arena />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </RunsProvider>
  );
}
