import { Link } from "react-router";
import { Section, Vault } from "../design";
import { SDK_EXAMPLE } from "./snippet";

// "Connect your own agent": how to put Chaperone in front of an agent of your own, with the SDK.
// Documentation only: nothing here uploads or runs an agent. The example is the SDK's own example
// file (one source with the README, checked by tests), so it is the code that was run. The vault
// holds what the SDK does with the money, since that is what it is for: a checkout is held.
export function AgentTab() {
  return (
    <div className="agent-tab">
      <Vault label="How it holds a checkout" className="agent-vault">
        <h2 className="page-heading t-section">How it works</h2>
        <p className="agent-for">
          This tab is for developers. To see Chaperone work without writing code,{" "}
          <Link to="/start">run a shopper here</Link>.
        </p>
        <p className="agent-lede">
          Chaperone's SDK wraps your agent's payment tool, so a checkout holds the cart instead of
          paying for it. Your agent keeps its own tools and loop. After it stops, Chaperone reviews
          the held cart, then pays the seller, cancels the hold, or leaves it for a person to
          decide.
        </p>
        <ol className="agent-steps">
          <li>
            <strong>Start a run</strong> in the practice marketplace (the arena) and create a
            firewall for it, with the rules the person locked (the mandate).
          </li>
          <li>
            <strong>Wrap your tools.</strong> The tool that pays is guarded. Every other tool is
            passed through as it was.
          </li>
          <li>
            <strong>Run your agent as before,</strong> then call <code>settle()</code> to review the
            cart and act on the result.
          </li>
        </ol>
      </Vault>

      <Section heading="The SDK's own example">
        <figure className="snippet">
          <figcaption className="t-meta">
            It runs offline in about a minute, with the in-memory payment stand-in and a scripted
            model: <code>pnpm --filter @firewall/sdk example</code>.
          </figcaption>
          <pre className="snippet-code">
            <code>{SDK_EXAMPLE}</code>
          </pre>
        </figure>
      </Section>

      <Section heading="What to know">
        <ul className="agent-notes">
          <li>
            Your payment tool is named <code>checkout</code>, <code>create_order</code> or{" "}
            <code>pay_order</code> by default. Name your own with <code>paymentTools</code>. A
            payment tool that isn't named is not guarded, and it pays at once.
          </li>
          <li>
            For now Chaperone protects agents that shop in the arena. It needs the merchant's
            catalog and the pages the agent was shown, which the arena provides. A real marketplace
            needs the same two things from that merchant.
          </li>
          <li>
            This is documentation. You can't upload an agent here; the SDK is a workspace package in
            the repo for now.
          </li>
        </ul>
      </Section>
    </div>
  );
}
