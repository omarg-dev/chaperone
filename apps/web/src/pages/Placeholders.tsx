import { Link, useParams } from "react-router";
import { buttonClass, EmptyState } from "../design";
import { useRuns } from "../runs/RunsProvider";
import { PageHeader } from "./Page";

export function RunDetail() {
  const { runId } = useParams();
  return (
    <>
      <PageHeader
        title="Run"
        lede="The run's timeline, with the money's route and the gates on it."
      />
      <EmptyState
        title="The live run view is on its way."
        action={
          <Link to="/runs" className={buttonClass("secondary", true)}>
            Back to runs
          </Link>
        }
      >
        Soon this page shows one vertical timeline: what the agent did, where the money was held,
        and what each gate decided.
        {runId && <span className="t-data empty-id"> {runId}</span>}
      </EmptyState>
    </>
  );
}

export function Escalations() {
  const { openEscalations } = useRuns();
  return (
    <>
      <PageHeader
        title="Escalations"
        lede="Purchases Chaperone paused because the decision is yours."
      />
      <EmptyState title="Nothing is waiting for you.">
        When a gate can't be sure a cart matches what you asked for, the purchase is held here with
        the cart and the reason. You approve it or block it.
        {openEscalations > 0 && ` ${openEscalations} held right now, and the inbox is coming.`}
      </EmptyState>
    </>
  );
}

export function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        lede="How often agents are fooled, with Chaperone off and on."
      />
      <EmptyState title="No numbers to show yet.">
        This page will chart attack success, false blocks, cost and delay for each configuration,
        from the eval's runs.
      </EmptyState>
    </>
  );
}

export function Arena() {
  return (
    <>
      <PageHeader
        title="Arena"
        lede="A marketplace of honest and attacker sellers, to test any shopping agent against."
      />
      <EmptyState title="The arena arrives in version 1.3.">
        You'll point your own agent at it and watch it shop. Until then, the arena runs behind the
        scenes, and its runs show up under Runs.
      </EmptyState>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="There's nothing at this address."
        action={
          <Link to="/runs" className={buttonClass("secondary", true)}>
            Go to runs
          </Link>
        }
      >
        The link may be old, or mistyped.
      </EmptyState>
    </>
  );
}
