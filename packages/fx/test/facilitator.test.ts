import { describe, expect, it } from "vitest";
import { Account, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ExactFxFacilitatorScheme, FX_SCHEME, FX_TESTNET } from "../src/index.js";

/**
 * Everything the facilitator rejects before it talks to the network, checked offline. A payload that
 * gets past all of this reaches `simulateTransaction`, and the reasons beyond that point are covered
 * by the live testnet tests in `fx.test.ts`.
 */

const SELLER = "GC57EF3M4NJXMYB56JMSS52RCBVPS5OJAT7WMK54CCYSBGPRQ64GVM62";
const PAYER = Keypair.random().publicKey();

const facilitator = new ExactFxFacilitatorScheme(createEd25519Signer(Keypair.random().secret(), "stellar:testnet"), {
  fxContract: FX_TESTNET.fxContract,
  sendAssets: [FX_TESTNET.xlm],
});
const [FACILITATOR] = facilitator.getSigners();

const requirements: PaymentRequirements = {
  scheme: FX_SCHEME,
  network: "stellar:testnet",
  asset: USDC_TESTNET_ADDRESS,
  amount: "10000",
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: facilitator.getExtra(),
};

const address = (value: string) => nativeToScVal(value, { type: "address" });
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });
const now = () => Math.floor(Date.now() / 1000);

interface PayOverrides {
  from?: string;
  sendAsset?: string;
  destAsset?: string;
  destAmount?: bigint;
  payTo?: string;
  deadline?: bigint;
  source?: string;
  contractId?: string;
  method?: string;
  args?: xdr.ScVal[];
}

/** A `pay` call shaped like the client's, minus the authorization the network checks would need. */
function payTransaction(overrides: PayOverrides = {}): string {
  const {
    from = PAYER,
    sendAsset = FX_TESTNET.xlm,
    destAsset = USDC_TESTNET_ADDRESS,
    destAmount = 10_000n,
    payTo = SELLER,
    deadline = BigInt(now() + 120),
    source = PAYER,
    contractId = FX_TESTNET.fxContract,
    method = "pay",
  } = overrides;
  const args = overrides.args ?? [
    address(from),
    address(sendAsset),
    i128(1_000_000n),
    address(destAsset),
    i128(destAmount),
    address(payTo),
    nativeToScVal(deadline, { type: "u64" }),
  ];
  return transactionWith(new Contract(contractId).call(method, ...args), source);
}

function transactionWith(operation: xdr.Operation, source: string): string {
  return new TransactionBuilder(new Account(source, "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(120)
    .build()
    .toXDR();
}

const verify = (transaction: string, overrides: Partial<PaymentRequirements> = {}, accepted = overrides) =>
  facilitator.verify(
    { x402Version: 2, accepted: { ...requirements, ...accepted }, payload: { transaction } } as PaymentPayload,
    { ...requirements, ...overrides },
  );

const reasonOf = async (...args: Parameters<typeof verify>) => (await verify(...args)).invalidReason;

describe("exact-fx verification, before the network", () => {
  it("rejects a payload for another protocol version, scheme or network", async () => {
    const payload = {
      x402Version: 1,
      accepted: requirements,
      payload: { transaction: payTransaction() },
    } as PaymentPayload;
    expect((await facilitator.verify(payload, requirements)).invalidReason).toBe("invalid_x402_version");
    expect(await reasonOf(payTransaction(), {}, { scheme: "exact" })).toBe("unsupported_scheme");
    expect(await reasonOf(payTransaction(), { scheme: "exact" })).toBe("unsupported_scheme");
    expect(await reasonOf(payTransaction(), {}, { network: "stellar:pubnet" })).toBe("network_mismatch");
    expect(await reasonOf(payTransaction(), { network: "eip155:1" })).toBe("invalid_network");
  });

  it("refuses requirements whose timeout it cannot work with", async () => {
    for (const maxTimeoutSeconds of [undefined, 0, -1, 301, Number.NaN, "soon"]) {
      expect(await reasonOf(payTransaction(), { maxTimeoutSeconds } as Partial<PaymentRequirements>)).toBe(
        "invalid_exact_fx_requirements_bad_timeout",
      );
    }
  });

  it("rejects a transaction it cannot read as one FxPay `pay` call", async () => {
    expect(await reasonOf("not a transaction")).toBe("invalid_exact_fx_payload_malformed");
    const payment = Operation.payment({ destination: SELLER, asset: Asset.native(), amount: "1" });
    expect(await reasonOf(transactionWith(payment, PAYER))).toBe("invalid_exact_fx_payload_wrong_operation");
    expect(await reasonOf(payTransaction({ contractId: FX_TESTNET.eurc }))).toBe(
      "invalid_exact_fx_payload_wrong_invocation",
    );
    expect(await reasonOf(payTransaction({ method: "quote" }))).toBe("invalid_exact_fx_payload_wrong_invocation");
    expect(await reasonOf(payTransaction({ args: [address(PAYER)] }))).toBe(
      "invalid_exact_fx_payload_wrong_invocation",
    );
  });

  it("refuses to be the source of the transaction it is asked to sponsor", async () => {
    expect(await reasonOf(payTransaction({ source: FACILITATOR }))).toBe(
      "invalid_exact_fx_payload_unsafe_tx_or_op_source",
    );
  });

  it("refuses to pay for itself", async () => {
    expect(await reasonOf(payTransaction({ from: FACILITATOR }))).toBe(
      "invalid_exact_fx_payload_facilitator_is_payer",
    );
  });

  it("rejects a send asset it does not accept", async () => {
    expect(await reasonOf(payTransaction({ sendAsset: FX_TESTNET.eurc }))).toBe(
      "invalid_exact_fx_payload_unsupported_send_asset",
    );
  });

  it("rejects a call that does not deliver what the requirements ask for", async () => {
    expect(await reasonOf(payTransaction({ destAsset: FX_TESTNET.xlm }))).toBe("invalid_exact_fx_payload_wrong_asset");
    expect(await reasonOf(payTransaction({ destAmount: 9_999n }))).toBe("invalid_exact_fx_payload_wrong_amount");
    expect(await reasonOf(payTransaction({ destAmount: 20_000n }))).toBe("invalid_exact_fx_payload_wrong_amount");
    expect(await reasonOf(payTransaction({ payTo: Keypair.random().publicKey() }))).toBe(
      "invalid_exact_fx_payload_wrong_recipient",
    );
  });

  it("separates a deadline that has passed from one that reaches too far", async () => {
    expect(await reasonOf(payTransaction({ deadline: BigInt(now() - 1) }))).toBe(
      "invalid_exact_fx_payload_deadline_expired",
    );
    // maxTimeoutSeconds plus the signing grace and clock skew the facilitator allows on top of it.
    expect(await reasonOf(payTransaction({ deadline: BigInt(now() + 60 + 210 + 30) }))).toBe(
      "invalid_exact_fx_payload_deadline_too_far",
    );
  });

  it("names the payer on every rejection that has already read one", async () => {
    expect(await verify(payTransaction({ destAmount: 20_000n }))).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_fx_payload_wrong_amount",
      payer: PAYER,
    });
    // Before the arguments are read there is no payer to name.
    expect(await verify("not a transaction")).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_fx_payload_malformed",
      payer: undefined,
    });
  });
});
