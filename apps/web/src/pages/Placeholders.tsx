import { Link } from "react-router";
import { buttonClass, EmptyState, Page } from "../design";

export function NotFound() {
  return (
    <Page title="Page not found">
      <EmptyState
        title="There's nothing at this address."
        label="Not here"
        action={
          <Link to="/runs" className={buttonClass("secondary", true)}>
            Go to runs
          </Link>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </Page>
  );
}
