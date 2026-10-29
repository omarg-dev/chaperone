import { Navigate, Route, Routes } from "react-router";
import { Arena, Dashboard, Escalations, NotFound } from "./pages/Placeholders";
import { Runs } from "./pages/Runs";
import { RunView } from "./run/RunView";
import { RunsProvider } from "./runs/RunsProvider";
import { Shell } from "./shell/Shell";

export function App() {
  return (
    <RunsProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/runs" replace />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:runId" element={<RunView />} />
          <Route path="escalations" element={<Escalations />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="arena" element={<Arena />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </RunsProvider>
  );
}
