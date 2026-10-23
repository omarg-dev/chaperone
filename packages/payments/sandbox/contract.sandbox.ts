import { paymentContract } from "../src/contract.js";
import { createSandboxPaymentAdapter, sandboxConfigFromEnv } from "../src/sandbox.js";
import { approveAsBuyer, buyerLoginFromEnv } from "./buyer.js";

// The payment contract against the real sandbox:
//
//   pnpm --filter @firewall/payments test:sandbox
//
// It can't run in CI, which has no sandbox credentials, so it isn't part of `pnpm test`. Missing
// variables fail the run rather than skipping it. The sandbox can't move time, so the time-limit
// tests aren't registered here; they run against the fake.
//
// The buyer's wallet is saved once per run, with a scripted approval, unless
// SANDBOX_BUYER_VAULT_ID names one saved before. The run pays out to seller_1 and seller_2 only,
// so the attackers' sandbox balances stay at what the arena's attacks put there.

const RETURN_URL = "https://checkout-firewall.invalid/payments/approved";

const config = { ...sandboxConfigFromEnv(), returnUrl: RETURN_URL };
const login = buyerLoginFromEnv();
const adapter = createSandboxPaymentAdapter(config);

let wallet: Promise<string> | undefined;
const savedWallet = () => {
  wallet ??= process.env.SANDBOX_BUYER_VAULT_ID
    ? Promise.resolve(process.env.SANDBOX_BUYER_VAULT_ID)
    : (async () => {
        const setup = await adapter.startWalletSetup();
        await approveAsBuyer(setup.approveUrl, login, RETURN_URL);
        return adapter.finishWalletSetup(setup.setupTokenId);
      })();
  return wallet;
};

paymentContract("sandbox", { savedWallet: true, timeTravel: false }, async () => ({
  adapter,
  payees: ["seller_1", "seller_2"],
  vaultId: await savedWallet(),
  payoutPollMs: 5_000,
  approve: async (orderId) => {
    const order = await adapter.getOrder(orderId);
    if (!order.approveUrl) throw new Error(`Order ${orderId} has no approval link`);
    await approveAsBuyer(order.approveUrl, login, RETURN_URL);
  },
}));
