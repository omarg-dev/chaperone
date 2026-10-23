// Saves the buyer's sandbox wallet once, with a scripted approval, and prints its vault ID.
//
//   pnpm --filter @firewall/payments save-wallet
//
// Put the ID in SANDBOX_BUYER_VAULT_ID, and the contract run, the sandbox checks and later the
// arena authorize against it instead of saving a new wallet each time. The ID is only usable with
// this app's own credentials, but keep it out of the repo and chat all the same.

import { approveAsBuyer, buyerLoginFromEnv } from "../sandbox/buyer.js";
import { createSandboxPaymentAdapter, sandboxConfigFromEnv } from "../src/sandbox.js";

const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";

try {
  const adapter = createSandboxPaymentAdapter({ ...sandboxConfigFromEnv(), returnUrl: RETURN_URL });
  const setup = await adapter.startWalletSetup();
  await approveAsBuyer(setup.approveUrl, buyerLoginFromEnv(), RETURN_URL);
  console.log(await adapter.finishWalletSetup(setup.setupTokenId));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
