// The example on the "Connect your own agent" tab is the SDK's own example file, read at build time,
// so there is one source: the README's snippet is a copy of the same file, and a test in
// @firewall/sdk checks that, while the test beside this one checks the page shows it unchanged.
import example from "../../../../packages/sdk/examples/protect-your-agent.ts?raw";

export const SDK_EXAMPLE: string = example;
