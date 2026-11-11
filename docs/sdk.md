# Chaperone SDK

**For developers** who want to put Chaperone in front of a shopping agent of their own. To see Chaperone at work without writing any code, [start a run](/start) or open [the runs](/runs) and watch a recorded one.

`@firewall/sdk` puts Chaperone in front of your own shopping agent. You give it your agent's tools, and the payment tool holds the cart instead of paying for it. A review then decides whether to capture the payment, void it or ask the person.

## Quick start

The SDK isn't on npm yet. It is a workspace package, so you run it from a clone of the repo, with Node 22.

```sh
git clone https://github.com/omarg-dev/chaperone
cd chaperone
pnpm install
pnpm --filter @firewall/sdk example   # verdict: block, money: voided
```

The example runs offline in about a minute. An in-memory fake stands in for the payment platform, and a scripted model for yours. It is `packages/sdk/examples/protect-your-agent.ts`, a test runs it, and it makes the three calls below in order.

## The calls

### createFirewall(options)

Builds the firewall for one run. The options:

- `log`: the event log every step is written to.
- `source`: the catalog source, which supplies the merchant's catalog and the page content the agent was shown (see "Bring your own store").
- `payments`: your payment adapter. The firewall wraps it, so every payment call is on the log.
- `vaultId`: the buyer's saved wallet, which the hold is authorized against.
- `mandate`: the mandate the person confirmed, or `{ builder, person }` to build it in the run. Without one, Gate 0 blocks the cart, since there is nothing to check it against.
- `config`: how much of the review runs (below).
- `gates`: the model gates, built from your own settings. The SDK never creates a model client from the environment.
- `paymentTools`: the names of the tools that pay (below).

### firewall.wrap(tools)

Returns the same tools with each payment tool replaced by a guarded one. The guarded tool never captures and never calls your original `execute`. It creates the order, authorizes it against the wallet, and tells the agent the order is placed and pending review. The order held is the cart the catalog source reports, not the amounts in the agent's arguments, which are recorded with the call. Every other tool is passed through as it was.

### firewall.settle()

Reviews the held cart and acts on the verdict. Approve captures and pays each seller, block voids, and escalate leaves the hold for a person. It returns `null` when nothing was held, and it reviews once however many times you call it. `review()` and `enforce()` are its two halves.

### firewall.decide(decision)

The person's decision on an escalated cart: `firewall.decide("approve")` or `firewall.decide("reject")`, with an optional note.

## Configurations

`config` is one of three:

- `off` ("Off" on the site): nobody reviews the cart. It is captured and paid out, which is the baseline to measure against.
- `gate0` ("Rules only"): Gate 0's fixed rules, in code. No model is called.
- `full` ("Full check"): Gate 0, then the model gates. This is the default, and it needs the `gates` option. Without it, `createFirewall` throws a `FirewallConfigError`.

## Payment tools

By default these tools count as payment tools: `checkout`, `create_order` and `pay_order`. The first is ours. The other two are the payment platform's agent toolkit, whose order tools capture at once and can't hold money.

Name your own with `paymentTools: ["buy_now"]`. An explicit list replaces the defaults. A payment tool that isn't in the list is not guarded, and it pays at once, so check the names before you rely on it.

## When the review runs

After the agent has finished, never inside the tool call. Gate 3 checks every step the agent took, and those steps aren't all there until the agent stops. The tool also gives the same answer whatever the cart is, so an agent steered by an attacker can't learn anything about the gates by probing the checkout. The model gates take seconds and the hold lasts days, so waiting costs nothing.

Stop your agent loop at the checkout, as the example does, or let it run on. The review reads the event log either way.

## Any model

The model your agent runs on doesn't matter to the firewall. The benchmark ran Claude Haiku 5.5 and OpenAI GPT-6 Luna through the same gates.

Your tools do need to be AI SDK `tool()` objects. For another framework, you need a small adapter that presents your tools in that shape.

## Bring your own store

The gates need two things the agent can't be trusted to report: the merchant's catalog, meaning what each listing really is, costs and is sold by, and the page content the agent was shown. The arena provides both and writes them to the event log as it serves them.

Both come through the `CatalogSource` interface (`packages/sdk/src/source.ts`). The arena's source, `arenaSource`, is the only one today, so the SDK protects agents shopping in the arena. A source for a real marketplace would give the same two things from that merchant. That is future work.

## Try the API in Postman {#postman}

You can try the whole flow without code. The collection `docs/postman/chaperone.postman_collection.json` has every public call of the server, in the order you would use them: check the server, start a live run, confirm the mandate, let the agent shop, read its events, decide a held cart and read the benchmark results. It also has the arena calls an agent's tools make. The SDK puts Chaperone in front of your own agent; the collection lets you drive Chaperone's own agent and watch what happens.

To use it:

1. In Postman, choose Import and pick the collection file. Import `docs/postman/local.postman_environment.json` too if you run the server yourself.
2. The collection's `baseUrl` is `https://chaperone.omarg.dev`. For a local server (`pnpm dev`, port 3000), select the "Chaperone, local server" environment.
3. Send the requests in each folder from the top. "Start a live run" saves the run's ID into `runId`, and the requests after it use it.

There is no sign-in and no key. Live runs spend from a daily cap (`FIREWALL_LIVE_DAILY_USD`, $0.25 by default) and only one goes at a time, so "Start a live run" answers 429 once the day's budget is used and 503 on a server with no model key; everything else still works. A decision is refused with a 409 for a run that isn't held for a person.
