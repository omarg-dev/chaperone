import { describe, expect, it } from "vitest";
import { FAKE_VAULT_ID, paymentSetupFromEnv } from "./payments.js";

const SANDBOX = {
  SANDBOX_CLIENT_ID: "client-id",
  SANDBOX_CLIENT_SECRET: "client-secret",
  SANDBOX_MERCHANT_SELLER_1: "m1",
  SANDBOX_MERCHANT_SELLER_2: "m2",
  SANDBOX_MERCHANT_SELLER_3: "m3",
  SANDBOX_MERCHANT_SELLER_4: "m4",
  SANDBOX_MERCHANT_ATTACKER_1: "a1",
  SANDBOX_MERCHANT_ATTACKER_2: "a2",
};

describe("paymentSetupFromEnv", () => {
  it("with no sandbox variables, is one fake the server owns, and says nothing about it", () => {
    const { setup, note } = paymentSetupFromEnv({});
    expect(setup).toMatchObject({ name: "fake", vaultId: FAKE_VAULT_ID });
    expect(note).toBeNull();
  });

  it("with the sandbox variables and the buyer's wallet, is the sandbox", () => {
    const { setup, note } = paymentSetupFromEnv({
      ...SANDBOX,
      SANDBOX_BUYER_VAULT_ID: " VAULT-1 ",
    });
    expect(setup).toMatchObject({ name: "sandbox", vaultId: "VAULT-1" });
    expect(note).toBeNull();
  });

  it("with the sandbox variables but no wallet, is the sandbox, and says live runs have nothing to hold money against", () => {
    const { setup, note } = paymentSetupFromEnv(SANDBOX);
    expect(setup).toMatchObject({ name: "sandbox", vaultId: null });
    expect(note).toMatch(/SANDBOX_BUYER_VAULT_ID/);
  });

  it("with some of the sandbox variables, falls back to the fake and names what's missing", () => {
    const { setup, note } = paymentSetupFromEnv({ SANDBOX_CLIENT_ID: "client-id" });
    expect(setup.name).toBe("fake");
    expect(note).toMatch(/practice money only/);
    expect(note).toMatch(/SANDBOX_CLIENT_SECRET/);
  });

  it("is not moved by a model key or the SDKs' own variables", () => {
    const { setup } = paymentSetupFromEnv({
      FIREWALL_ANTHROPIC_API_KEY: "key",
      ANTHROPIC_API_KEY: "junk",
    });
    expect(setup.name).toBe("fake");
  });
});
