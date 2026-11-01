import {
  createFakePaymentAdapter,
  createSandboxPaymentAdapter,
  type PaymentAdapter,
  sandboxConfigFromEnv,
} from "@firewall/payments";

// The one payment adapter this server moves money through, and what to call it. Live runs from the
// web app hold their cart on it, and a person's decision on an escalated run is carried out on the
// same instance: the in-memory fake keeps its orders in the process that made it, so a decision
// can only reach a fake run's hold through the fake that run used.
export interface PaymentSetup {
  // Written into each run's `run_started`, and shown beside the run as "Practice money" (fake) or
  // "Sandbox".
  name: "fake" | "sandbox";
  adapter: PaymentAdapter;
  // The buyer's saved wallet a hold is authorized against. The fake has its own; the sandbox needs
  // the one in SANDBOX_BUYER_VAULT_ID, which the server can't save itself (that takes a scripted
  // browser approval). Null: the sandbox has no wallet to hold money against.
  vaultId: string | null;
}

export const FAKE_VAULT_ID = "FAKE-WALLET";

export interface PaymentSetupResult {
  setup: PaymentSetup;
  // What to log at start-up when the choice isn't the plain one: why the fake is used although
  // some sandbox variables are set, or why live runs can't use the sandbox yet.
  note: string | null;
}

// The sandbox adapter when the sandbox variables are set, otherwise one in-process fake owned by
// the server. Nothing here reads a model key.
export function paymentSetupFromEnv(env: NodeJS.ProcessEnv): PaymentSetupResult {
  const anySandbox = Object.keys(env).some((name) => name.startsWith("SANDBOX_") && env[name]);
  try {
    const adapter = createSandboxPaymentAdapter(sandboxConfigFromEnv(env));
    const vaultId = env.SANDBOX_BUYER_VAULT_ID?.trim() || null;
    return {
      setup: { name: "sandbox", adapter, vaultId },
      note: vaultId
        ? null
        : "Live runs are off: the sandbox is connected, but SANDBOX_BUYER_VAULT_ID (the buyer's saved wallet, from `pnpm --filter @firewall/payments save-wallet`) isn't set, so there is nothing to hold money against.",
    };
  } catch (error) {
    return {
      setup: { name: "fake", adapter: createFakePaymentAdapter(), vaultId: FAKE_VAULT_ID },
      note: anySandbox
        ? `The sandbox variables are incomplete, so this server moves practice money only. ${error instanceof Error ? error.message : error}`
        : null,
    };
  }
}
