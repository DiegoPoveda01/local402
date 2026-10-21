import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ChannelPool, ExactFxClientScheme, ExactFxFacilitatorScheme, FX_SCHEME, FX_TESTNET, fxNetwork, parseFxExtra } from "../src/index.js";

/** Configuration mistakes and payer refusals, each with its own code, all checked before any network call. */

const code = (code: string) => expect.objectContaining({ code });
const signer = createEd25519Signer(Keypair.random().secret(), "stellar:testnet");
const client = { fxContract: FX_TESTNET.fxContract, sendAsset: FX_TESTNET.xlm };
const facilitator = { fxContract: FX_TESTNET.fxContract, sendAssets: [FX_TESTNET.xlm] };

describe("fxNetwork", () => {
  it("knows the two Stellar networks and nothing else", () => {
    expect(fxNetwork("stellar:testnet").fxContract).toBe(FX_TESTNET.fxContract);
    expect(fxNetwork("stellar:pubnet").fxContract).toBeUndefined();
    expect(() => fxNetwork("stellar:mainnet")).toThrow(code("INVALID_CONFIG"));
    expect(() => fxNetwork("stellar:pubnet", "GABC")).toThrow(/fxContract must be a contract address/);
  });

  it("never repeats a secret key passed as a contract", () => {
    const secret = Keypair.random().secret();
    expect(() => fxNetwork("stellar:pubnet", secret)).toThrow(/a secret key \(not shown\)/);
    expect(() => fxNetwork("stellar:pubnet", secret)).not.toThrow(secret);
  });
});

describe("ExactFxClientScheme options", () => {
  it("rejects what it could never pay with", () => {
    expect(() => new ExactFxClientScheme(signer, { ...client, fxContract: "" })).toThrow(code("INVALID_CONFIG"));
    expect(() => new ExactFxClientScheme(signer, { ...client, sendAsset: "XLM" })).toThrow(/sendAsset/);
    expect(() => new ExactFxClientScheme(signer, { ...client, slippageBps: 10_001 })).toThrow(/slippageBps/);
    expect(() => new ExactFxClientScheme(signer, { ...client, slippageBps: 1.5 })).toThrow(/slippageBps/);
    expect(() => new ExactFxClientScheme(signer, { ...client, signingGraceSeconds: -1 })).toThrow(/signingGraceSeconds/);
    expect(() => new ExactFxClientScheme({} as never, client)).toThrow(/signer/);
    expect(() => new ExactFxClientScheme(signer, { ...client, slippageBps: 0 })).not.toThrow();
  });

  it("refuses an FX contract or send asset it did not agree to, before simulating anything", async () => {
    const scheme = new ExactFxClientScheme(signer, client);
    const requirements = (extra: Record<string, unknown>): PaymentRequirements => ({
      scheme: FX_SCHEME,
      network: "stellar:testnet",
      asset: USDC_TESTNET_ADDRESS,
      amount: "10000",
      payTo: Keypair.random().publicKey(),
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true, fxContract: FX_TESTNET.fxContract, sendAssets: [FX_TESTNET.xlm], ...extra },
    });
    await expect(scheme.createPaymentPayload(2, requirements({ fxContract: FX_TESTNET.xlm }))).rejects.toMatchObject({ code: "REFUSED_UNTRUSTED_FX_CONTRACT" });
    await expect(scheme.createPaymentPayload(2, requirements({ sendAssets: [FX_TESTNET.eurc] }))).rejects.toMatchObject({ code: "REFUSED_SEND_ASSET" });
    await expect(scheme.createPaymentPayload(2, requirements({ areFeesSponsored: false }))).rejects.toMatchObject({ code: "INVALID_REQUIREMENTS" });
  });
});

describe("ExactFxFacilitatorScheme options", () => {
  it("rejects a setup that could not settle", () => {
    expect(() => new ExactFxFacilitatorScheme([], facilitator)).toThrow(code("INVALID_CONFIG"));
    expect(() => new ExactFxFacilitatorScheme(signer, { ...facilitator, fxContract: "nope" })).toThrow(/fxContract/);
    expect(() => new ExactFxFacilitatorScheme(signer, { ...facilitator, sendAssets: [] })).toThrow(/sendAssets/);
    expect(() => new ExactFxFacilitatorScheme(signer, { ...facilitator, sendAssets: ["XLM"] })).toThrow(/sendAssets\[0\]/);
    expect(() => new ExactFxFacilitatorScheme(signer, { ...facilitator, maxTransactionFeeStroops: 0 })).toThrow(/maxTransactionFeeStroops/);
    expect(() => new ExactFxFacilitatorScheme(signer, { ...facilitator, settleBudgetSeconds: 0 })).toThrow(/settleBudgetSeconds/);
    expect(() => new ExactFxFacilitatorScheme(signer, facilitator)).not.toThrow();
  });
});

describe("parseFxExtra", () => {
  it("names a malformed requirement as such", () => {
    expect(() => parseFxExtra(undefined)).toThrow(code("INVALID_REQUIREMENTS"));
  });
});

describe("ChannelPool options", () => {
  it("rejects an empty or duplicated account list", () => {
    expect(() => new ChannelPool([])).toThrow(code("INVALID_CONFIG"));
    expect(() => new ChannelPool(["A", "A"])).toThrow(/distinct/);
    expect(() => new ChannelPool(["A"], -1)).toThrow(/maxQueued/);
  });

  it("names a full queue as FACILITATOR_BUSY", async () => {
    const pool = new ChannelPool(["A"], 0);
    const slow = pool.run(() => new Promise((resolve) => setTimeout(resolve, 5)));
    await expect(pool.run(async () => undefined)).rejects.toMatchObject({ code: "FACILITATOR_BUSY" });
    await slow;
  });
});
