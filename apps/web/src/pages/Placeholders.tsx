import { Link } from "react-router";
import { buttonClass, EmptyState } from "../design";
import { PageHeader } from "./Page";

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
