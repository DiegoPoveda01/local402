import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  authorizeEntry,
  Horizon,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { FacilitatorStellarSigner } from "@x402/stellar";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ExactFxFacilitatorScheme, FX_SCHEME, FX_TESTNET } from "../src/index.js";

/**
 * What the facilitator checks once it talks to the network: the payer's authorization, the simulation,
 * its events and signatures, and every way `settle` can end. The Soroban RPC is replaced by stubs, so
 * these run offline; `fx.test.ts` runs the same path against testnet.
 */

const SELLER = "GC57EF3M4NJXMYB56JMSS52RCBVPS5OJAT7WMK54CCYSBGPRQ64GVM62";
const PAYER = Keypair.random();
const OTHER = Keypair.random();
const FX = FX_TESTNET.fxContract;
const XLM = FX_TESTNET.xlm;
const MAX_SEND = 1_000_000n;
const AMOUNT = 10_000n;
const LEDGER = 1_000;
// 60 s of 5 s ledgers past LEDGER: the expiration the client would sign for.
const EXPIRATION = LEDGER + 12;
const HASH = "a".repeat(64);

const facilitatorKey = Keypair.random();
const signer = createEd25519Signer(facilitatorKey.secret(), "stellar:testnet");
const FACILITATOR = signer.address;
const scheme = (overrides: { signer?: FacilitatorStellarSigner; selectSigner?: () => string; settleBudgetSeconds?: number; maxTransactionFeeStroops?: number } = {}) =>
  new ExactFxFacilitatorScheme(overrides.signer ?? signer, {
    fxContract: FX,
    sendAssets: [XLM],
    selectSigner: overrides.selectSigner,
    settleBudgetSeconds: overrides.settleBudgetSeconds,
    maxTransactionFeeStroops: overrides.maxTransactionFeeStroops,
  });

const requirements: PaymentRequirements = {
  scheme: FX_SCHEME,
  network: "stellar:testnet",
  asset: USDC_TESTNET_ADDRESS,
  amount: String(AMOUNT),
  payTo: SELLER,
  maxTimeoutSeconds: 60,
  extra: scheme().getExtra(),
};

const address = (value: string) => nativeToScVal(value, { type: "address" });
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });
const symbol = (value: string) => nativeToScVal(value, { type: "symbol" });

const payArgs = (destAmount = AMOUNT) => [
  address(PAYER.publicKey()),
  address(XLM),
  i128(MAX_SEND),
  address(USDC_TESTNET_ADDRESS),
  i128(destAmount),
  address(SELLER),
  nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 120), { type: "u64" }),
];

const invocation = (contract: string, name: string, args: xdr.ScVal[], subInvocations: xdr.SorobanAuthorizedInvocation[] = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contract).toScAddress(), functionName: name, args }),
    ),
    subInvocations,
  });

/** The transfer of `maxSend` into FxPay that `pay` makes on the payer's behalf. */
const transferIn = (overrides: { contract?: string; to?: string; amount?: bigint; nested?: xdr.SorobanAuthorizedInvocation[] } = {}) =>
  invocation(
    overrides.contract ?? XLM,
    "transfer",
    [address(PAYER.publicKey()), address(overrides.to ?? FX), i128(overrides.amount ?? MAX_SEND)],
    overrides.nested,
  );

interface AuthOverrides {
  signer?: Keypair;
  expiration?: number;
  root?: xdr.SorobanAuthorizedInvocation;
  subs?: xdr.SorobanAuthorizedInvocation[];
  signed?: boolean;
}

/** The payer's authorization of `pay(args)`, signed the way `authorizeEntry` signs it in a wallet. */
async function authEntry(args: xdr.ScVal[], overrides: AuthOverrides = {}): Promise<xdr.SorobanAuthorizationEntry> {
  const by = overrides.signer ?? PAYER;
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(by.publicKey()).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: overrides.expiration ?? EXPIRATION,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: overrides.root ?? invocation(FX, "pay", args, overrides.subs ?? [transferIn()]),
  });
  if (overrides.signed === false) return entry;
  return authorizeEntry(entry, by, overrides.expiration ?? EXPIRATION, Networks.TESTNET);
}

/** A `pay` transaction as the client sends it, with `auth` in place of the payer's one entry if given. */
async function payTransaction(overrides: AuthOverrides & { auth?: xdr.SorobanAuthorizationEntry[] } = {}): Promise<string> {
  const args = payArgs();
  const auth = overrides.auth ?? [await authEntry(args, overrides)];
  return new TransactionBuilder(new Account(PAYER.publicKey(), "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: FX, function: "pay", args, auth }))
    .setTimeout(120)
    .build()
    .toXDR();
}

const payload = (transaction: string) =>
  ({ x402Version: 2, accepted: requirements, payload: { transaction } }) as PaymentPayload;

/** A token `transfer` event, emitted by the token contract `asset`. */
function transferEvent(asset: string, from: string, to: string, data: xdr.ScVal, name = "transfer"): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: Address.fromString(asset).toBuffer() as unknown as xdr.ContractId,
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics: [symbol(name), address(from), address(to)], data })),
    }),
  });
}

/** FxPay paying the seller exactly what the requirements ask for. */
const delivery = () => transferEvent(USDC_TESTNET_ADDRESS, FX, SELLER, i128(AMOUNT));

function simulation(events = [delivery()], minResourceFee = "50000"): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    _parsed: true,
    id: "1",
    latestLedger: LEDGER,
    events,
    minResourceFee,
    transactionData: new SorobanDataBuilder(),
  } as rpc.Api.SimulateTransactionSuccessResponse;
}

const server = rpc.Server.prototype;

beforeEach(() => {
  // Horizon estimates the ledger time; offline it falls back to 5 s, as it does when Horizon is down.
  vi.spyOn(Horizon.Server.prototype, "ledgers").mockImplementation(() => {
    throw new Error("offline");
  });
  vi.spyOn(server, "getLatestLedger").mockResolvedValue({ id: "x", sequence: LEDGER, protocolVersion: 23 } as never);
  vi.spyOn(server, "simulateTransaction").mockResolvedValue(simulation());
  vi.spyOn(server, "getFeeStats").mockResolvedValue({ sorobanInclusionFee: { p99: "2500" } } as never);
  vi.spyOn(server, "getAccount").mockImplementation(async (id) => new Account(id, "41"));
  vi.spyOn(server, "sendTransaction").mockResolvedValue({ status: "PENDING", hash: HASH } as never);
  vi.spyOn(server, "getTransaction").mockResolvedValue({
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    returnValue: i128(990_000n),
  } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const reasonOf = async (transaction: string | Promise<string>, facilitator = scheme()) =>
  (await facilitator.verify(payload(await transaction), requirements)).invalidReason;

describe("exact-fx verification, against the network", () => {
  it("accepts a signed `pay` whose simulation delivers the exact amount to the seller", async () => {
    expect(await scheme().verify(payload(await payTransaction()), requirements)).toEqual({
      isValid: true,
      payer: PAYER.publicKey(),
    });
  });

  it("wants exactly one authorization, an address one, from the payer", async () => {
    expect(await reasonOf(payTransaction({ auth: [] }))).toBe("invalid_exact_fx_payload_unexpected_auth_entries");
    const entry = await authEntry(payArgs());
    expect(await reasonOf(payTransaction({ auth: [entry, entry] }))).toBe("invalid_exact_fx_payload_unexpected_auth_entries");
    const sourceAccount = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation(FX, "pay", payArgs(), [transferIn()]),
    });
    expect(await reasonOf(payTransaction({ auth: [sourceAccount] }))).toBe("invalid_exact_fx_payload_unsupported_credential_type");
    expect(await reasonOf(payTransaction({ signer: OTHER }))).toBe("invalid_exact_fx_payload_auth_not_from_payer");
  });

  it("refuses a signature that stays valid long after the payment window", async () => {
    // The window (12 ledgers) plus 2 ledgers, and 42 more for the signing grace and clock skew (210 s).
    expect(await reasonOf(payTransaction({ expiration: EXPIRATION + 44 }))).toBeUndefined();
    expect(await reasonOf(payTransaction({ expiration: EXPIRATION + 45 }))).toBe("invalid_exact_fx_signature_expiration_too_far");
  });

  it("wants the authorization to cover exactly the `pay` call it sponsors", async () => {
    const root = (contract: string, name: string, args = payArgs()) => payTransaction({ root: invocation(contract, name, args, [transferIn()]) });
    expect(await reasonOf(root(FX_TESTNET.eurc, "pay"))).toBe("invalid_exact_fx_payload_wrong_auth_root");
    expect(await reasonOf(root(FX, "quote"))).toBe("invalid_exact_fx_payload_wrong_auth_root");
    expect(await reasonOf(root(FX, "pay", payArgs(AMOUNT * 2n)))).toBe("invalid_exact_fx_payload_wrong_auth_root");
  });

  it("wants inside it only the transfer of `maxSend` into FxPay", async () => {
    const subs = (...subs: xdr.SorobanAuthorizedInvocation[]) => reasonOf(payTransaction({ subs }));
    const wrong = "invalid_exact_fx_payload_wrong_auth_subinvocation";
    expect(await subs()).toBe(wrong);
    expect(await subs(transferIn(), transferIn())).toBe(wrong);
    expect(await subs(transferIn({ contract: FX_TESTNET.eurc }))).toBe(wrong);
    expect(await subs(transferIn({ to: OTHER.publicKey() }))).toBe(wrong);
    expect(await subs(transferIn({ amount: MAX_SEND + 1n }))).toBe(wrong);
    expect(await subs(transferIn({ nested: [transferIn()] }))).toBe(wrong);
    expect(await subs(invocation(XLM, "approve", [address(PAYER.publicKey()), address(FX), i128(MAX_SEND)]))).toBe(wrong);
  });

  it("rejects a payment whose simulation fails or costs more than the fee ceiling", async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce({ id: "1", latestLedger: LEDGER, events: [], error: "HostError", _parsed: true } as never);
    expect(await reasonOf(payTransaction())).toBe("invalid_exact_fx_payload_simulation_failed");
    // 990_000 of resources plus the 10_000 inclusion ceiling is exactly the default maximum.
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce(simulation([delivery()], "990000"));
    expect(await reasonOf(payTransaction())).toBeUndefined();
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce(simulation([delivery()], "990001"));
    expect(await reasonOf(payTransaction())).toBe("invalid_exact_fx_payload_fee_exceeds_maximum");
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce(simulation());
    expect(await reasonOf(payTransaction(), scheme({ maxTransactionFeeStroops: 59_999 }))).toBe("invalid_exact_fx_payload_fee_exceeds_maximum");
  });

  it("wants the simulation to show FxPay delivering the exact amount of the asset to the seller", async () => {
    const withEvents = async (...events: xdr.DiagnosticEvent[]) => {
      vi.mocked(server.simulateTransaction).mockResolvedValueOnce(simulation(events));
      return reasonOf(payTransaction());
    };
    const none = "invalid_exact_fx_payload_no_delivery";
    expect(await withEvents()).toBe(none);
    expect(await withEvents(transferEvent(USDC_TESTNET_ADDRESS, FX, SELLER, i128(AMOUNT - 1n)))).toBe(none);
    expect(await withEvents(transferEvent(USDC_TESTNET_ADDRESS, FX, OTHER.publicKey(), i128(AMOUNT)))).toBe(none);
    expect(await withEvents(transferEvent(USDC_TESTNET_ADDRESS, PAYER.publicKey(), SELLER, i128(AMOUNT)))).toBe(none);
    expect(await withEvents(transferEvent(XLM, FX, SELLER, i128(AMOUNT)))).toBe(none);
    expect(await withEvents(transferEvent(USDC_TESTNET_ADDRESS, FX, SELLER, i128(AMOUNT), "mint"))).toBe(none);
    // A transfer to a muxed destination carries its amount in a map.
    const muxed = nativeToScVal({ amount: AMOUNT, to_muxed_id: 5n }, { type: { amount: ["symbol", "i128"], to_muxed_id: ["symbol", "u64"] } });
    expect(await withEvents(transferEvent(USDC_TESTNET_ADDRESS, FX, SELLER, muxed))).toBeUndefined();
  });

  it("rejects a simulation that moves tokens out of an account the facilitator signs for", async () => {
    for (const name of ["transfer", "burn", "approve"]) {
      vi.mocked(server.simulateTransaction).mockResolvedValueOnce(
        simulation([delivery(), transferEvent(XLM, FACILITATOR, OTHER.publicKey(), i128(1n), name)]),
      );
      expect(await reasonOf(payTransaction())).toBe("invalid_exact_fx_payload_moves_facilitator_funds");
    }
    // Tokens paid to the facilitator move nothing of its own.
    vi.mocked(server.simulateTransaction).mockResolvedValueOnce(simulation([delivery(), transferEvent(XLM, OTHER.publicKey(), FACILITATOR, i128(1n))]));
    expect(await reasonOf(payTransaction())).toBeUndefined();
  });

  it("rejects an authorization the payer has not signed", async () => {
    expect(await reasonOf(payTransaction({ signed: false }))).toBe("invalid_exact_fx_payload_missing_payer_signature");
  });
});

describe("exact-fx settlement", () => {
  const settle = async (facilitator = scheme(), transaction?: string) =>
    facilitator.settle(payload(transaction ?? (await payTransaction())), requirements);

  it("submits from its own account, bids twice the recent p99 fee and reports what the swap spent", async () => {
    expect(await settle()).toEqual({
      success: true,
      network: "stellar:testnet",
      transaction: HASH,
      payer: PAYER.publicKey(),
      extra: { sendAsset: XLM, sendAmount: "990000" },
    });
    const sent = vi.mocked(server.sendTransaction).mock.calls[0][0] as unknown as { source: string; fee: string; signatures: unknown[] };
    expect(sent.source).toBe(FACILITATOR);
    expect(sent.fee).toBe("5000");
    expect(sent.signatures).toHaveLength(1);
  });

  it("keeps its fee bid between 1_000 stroops and its ceiling", async () => {
    vi.mocked(server.getFeeStats).mockRejectedValueOnce(new Error("down"));
    await settle();
    vi.mocked(server.getFeeStats).mockResolvedValueOnce({ sorobanInclusionFee: { p99: "1000000" } } as never);
    await settle();
    const fees = vi.mocked(server.sendTransaction).mock.calls.map(([tx]) => (tx as unknown as { fee: string }).fee);
    expect(fees).toEqual(["1000", "10000"]);
  });

  it("sends nothing for a payment that does not verify", async () => {
    expect(await settle(scheme(), await payTransaction({ signed: false }))).toMatchObject({
      success: false,
      transaction: "",
      errorReason: "invalid_exact_fx_payload_missing_payer_signature",
    });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("fails before sending when it cannot pick or use a signer", async () => {
    expect((await settle(scheme({ selectSigner: () => OTHER.publicKey() }))).errorReason).toBe("settle_exact_fx_signer_selection_failed");
    const broken = { ...signer, signTransaction: async () => ({ signedTxXdr: "", error: { message: "locked", code: 1 } }) };
    expect((await settle(scheme({ signer: broken as FacilitatorStellarSigner }))).errorReason).toBe("settle_exact_fx_signing_failed");
    vi.mocked(server.getAccount).mockRejectedValueOnce(new Error("rpc down"));
    expect(await settle()).toMatchObject({ success: false, transaction: "", errorReason: "unexpected_settle_error" });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("reports a refused submission and a failed transaction apart", async () => {
    vi.mocked(server.sendTransaction).mockResolvedValueOnce({ status: "ERROR", hash: HASH } as never);
    expect(await settle()).toMatchObject({ success: false, transaction: "", errorReason: "settle_exact_fx_submission_failed" });
    vi.mocked(server.getTransaction).mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.FAILED } as never);
    expect(await settle()).toMatchObject({ success: false, transaction: HASH, errorReason: "settle_exact_fx_transaction_failed" });
  });

  it("waits for a transaction the ledger has not closed yet", async () => {
    vi.mocked(server.getTransaction).mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never);
    expect(await settle()).toMatchObject({ success: true, transaction: HASH });
    expect(server.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns the hash as pending, not failed, once the transaction has left", async () => {
    // Out of budget while the ledger still has not seen it.
    vi.mocked(server.getTransaction).mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never);
    expect(await settle(scheme({ settleBudgetSeconds: 1 }))).toMatchObject({
      success: false,
      transaction: HASH,
      errorReason: "settle_exact_fx_confirmation_pending",
    });
    // The RPC failing after the submission.
    vi.mocked(server.getTransaction).mockRejectedValue(new Error("rpc down"));
    expect(await settle()).toMatchObject({ success: false, transaction: HASH, errorReason: "settle_exact_fx_confirmation_pending" });
  });
});
