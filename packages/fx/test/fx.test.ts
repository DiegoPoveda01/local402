import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import {
  ExactFxClientScheme,
  ExactFxFacilitatorScheme,
  FX_SCHEME,
  FX_TESTNET,
  maxSendFor,
  parseFxExtra,
} from "../src/index.js";

describe("maxSendFor", () => {
  it("adds slippage and rounds up", () => {
    expect(maxSendFor(4_996_678n, 200)).toBe(5_096_612n);
    expect(maxSendFor(1n, 1)).toBe(2n);
    expect(maxSendFor(10_000n, 0)).toBe(10_000n);
  });
});

describe("parseFxExtra", () => {
  it("requires sponsored fees and FX settings", () => {
    expect(() => parseFxExtra({ fxContract: "C", sendAssets: [] })).toThrow(/areFeesSponsored/);
    expect(() => parseFxExtra({ areFeesSponsored: true })).toThrow(/fxContract/);
  });
});

// Live checks against testnet: set FX_PAYER_SECRET to a funded account holding XLM.
const PAYER_SECRET = process.env.FX_PAYER_SECRET;
// Testnet seller with a USDC trustline; FxPay cannot deliver USDC to an account without one.
const SELLER = "GC57EF3M4NJXMYB56JMSS52RCBVPS5OJAT7WMK54CCYSBGPRQ64GVM62";

describe.skipIf(!PAYER_SECRET)("exact-fx facilitator on testnet", () => {
  const payer = createEd25519Signer(PAYER_SECRET ?? Keypair.random().secret(), "stellar:testnet");
  // Verification never signs, so a throwaway facilitator key is enough.
  const facilitator = new ExactFxFacilitatorScheme(createEd25519Signer(Keypair.random().secret(), "stellar:testnet"), {
    fxContract: FX_TESTNET.fxContract,
    sendAssets: [FX_TESTNET.xlm],
  });
  const requirements: PaymentRequirements = {
    scheme: FX_SCHEME,
    network: "stellar:testnet",
    asset: USDC_TESTNET_ADDRESS,
    amount: "10000",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: facilitator.getExtra(),
  };
  const client = new ExactFxClientScheme(payer, { fxContract: FX_TESTNET.fxContract, sendAsset: FX_TESTNET.xlm });

  let payload: PaymentPayload;
  const verify = (overrides: Partial<PaymentRequirements>) =>
    facilitator.verify(payload, { ...requirements, ...overrides });

  it("accepts a genuine payment", { timeout: 60_000 }, async () => {
    const result = await client.createPaymentPayload(2, requirements);
    payload = { ...result, accepted: requirements } as PaymentPayload;
    expect(await verify({})).toEqual({ isValid: true, payer: payer.address });
  });

  it("rejects a payment for a different amount, recipient or asset", { timeout: 60_000 }, async () => {
    expect((await verify({ amount: "20000" })).invalidReason).toBe("invalid_exact_fx_payload_wrong_amount");
    expect((await verify({ payTo: Keypair.random().publicKey() })).invalidReason).toBe(
      "invalid_exact_fx_payload_wrong_recipient",
    );
    expect((await verify({ asset: FX_TESTNET.xlm })).invalidReason).toBe("invalid_exact_fx_payload_wrong_asset");
  });

  it("rejects send assets the facilitator does not allow", { timeout: 60_000 }, async () => {
    const strict = new ExactFxFacilitatorScheme(createEd25519Signer(Keypair.random().secret(), "stellar:testnet"), {
      fxContract: FX_TESTNET.fxContract,
      sendAssets: [],
    });
    expect((await strict.verify(payload, requirements)).invalidReason).toBe(
      "invalid_exact_fx_payload_unsupported_send_asset",
    );
  });

  it("refuses to sign for an untrusted FX contract", async () => {
    const other = { ...requirements, extra: { ...requirements.extra, fxContract: FX_TESTNET.xlm } };
    await expect(client.createPaymentPayload(2, other)).rejects.toThrow(/Untrusted FX contract/);
  });
});
