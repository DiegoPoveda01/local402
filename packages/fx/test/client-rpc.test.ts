import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Asset,
  Horizon,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  scValToNative,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ExactFxClientScheme, ExactFxFacilitatorScheme, feeBumpSigner, FX_SCHEME, FX_TESTNET, maxSendFor } from "../src/index.js";

/**
 * The payer's side of `exact-fx` against a stand-in Soroban RPC that answers like FxPay: `quote`, the
 * token `balance`, and `pay` asking for the payer's authorization. What the client signs is then handed
 * to the facilitator, so the two halves are checked against each other, offline.
 */

const SELLER = "GC57EF3M4NJXMYB56JMSS52RCBVPS5OJAT7WMK54CCYSBGPRQ64GVM62";
const FX = FX_TESTNET.fxContract;
const XLM = FX_TESTNET.xlm;
const LEDGER = 1_000;
const QUOTE = 980_000n;

const payerKey = Keypair.random();
const payer = createEd25519Signer(payerKey.secret(), "stellar:testnet");
const facilitatorSigner = createEd25519Signer(Keypair.random().secret(), "stellar:testnet");
const facilitator = new ExactFxFacilitatorScheme(facilitatorSigner, { fxContract: FX, sendAssets: [XLM, FX_TESTNET.eurc] });
const client = (options: { sendAsset?: string; slippageBps?: number } = {}) =>
  new ExactFxClientScheme(payer, { fxContract: FX, sendAsset: options.sendAsset ?? XLM, slippageBps: options.slippageBps });

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

const invocation = (contract: string, name: string, args: xdr.ScVal[], subInvocations: xdr.SorobanAuthorizedInvocation[] = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contract).toScAddress(), functionName: name, args }),
    ),
    subInvocations,
  });

/** What the network asks `who` to sign for `pay(args)`: the call and its transfer of `max_send` into FxPay. */
function payAuth(args: xdr.ScVal[], who: string): xdr.SorobanAuthorizationEntry {
  const [from, sendAsset, maxSend] = args;
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(who).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation(FX, "pay", args, [invocation(scValToNative(sendAsset), "transfer", [from, address(FX), maxSend])]),
  });
}

/** FxPay paying the seller, as the token contract reports it. */
const delivery = () =>
  new xdr.DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: Address.fromString(USDC_TESTNET_ADDRESS).toBuffer() as unknown as xdr.ContractId,
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({ topics: [nativeToScVal("transfer", { type: "symbol" }), address(FX), address(SELLER)], data: i128(10_000n) }),
      ),
    }),
  });

const success = (retval: xdr.ScVal, auth: xdr.SorobanAuthorizationEntry[] = [], events: xdr.DiagnosticEvent[] = []) =>
  ({
    _parsed: true,
    id: "1",
    latestLedger: LEDGER,
    events,
    minResourceFee: "50000",
    transactionData: new SorobanDataBuilder(),
    result: { auth, retval },
  }) as rpc.Api.SimulateTransactionSuccessResponse;

const failure = (error: string) => ({ _parsed: true, id: "1", latestLedger: LEDGER, events: [], error }) as never;

/** How the stand-in network behaves; each test changes what it needs. */
let network: { balance: bigint | Error; payFails: boolean; authFor?: string };

beforeEach(() => {
  network = { balance: 50_000_000n, payFails: false };
  vi.spyOn(Horizon.Server.prototype, "ledgers").mockImplementation(() => {
    throw new Error("offline");
  });
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ id: "x", sequence: LEDGER, protocolVersion: 23 } as never);
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation(async (tx) => {
    const operation = (tx as Transaction).operations[0] as Operation.InvokeHostFunction;
    const call = operation.func.invokeContract();
    const args = call.args();
    switch (call.functionName().toString()) {
      case "quote":
        return success(i128(QUOTE));
      case "balance":
        if (network.balance instanceof Error) throw network.balance;
        return success(i128(network.balance));
      case "pay":
        if (network.payFails) return failure("HostError: Error(Contract, #10)");
        return success(i128(QUOTE), [payAuth(args, network.authFor ?? scValToNative(args[0]))], [delivery()]);
      default:
        throw new Error(`unexpected call ${call.functionName().toString()}`);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const payArgsOf = (payload: { payload: Record<string, unknown> }) => {
  const tx = new Transaction(String(payload.payload.transaction), Networks.TESTNET);
  const operation = tx.operations[0] as Operation.InvokeHostFunction;
  return { args: operation.func.invokeContract().args().map((arg) => scValToNative(arg)), auth: operation.auth ?? [] };
};

describe("exact-fx client, against the network", () => {
  it("signs a `pay` of the quote plus slippage that the facilitator accepts", async () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = await client().createPaymentPayload(2, requirements);
    const { args, auth } = payArgsOf(payload);
    expect(args.slice(0, 6)).toEqual([payerKey.publicKey(), XLM, maxSendFor(QUOTE, 200), USDC_TESTNET_ADDRESS, 10_000n, SELLER]);
    // The 60 s timeout plus the 180 s signing grace, in time and in 5 s ledgers.
    expect(Number(args[6]) - before).toBeGreaterThanOrEqual(240);
    expect(Number(args[6]) - before).toBeLessThanOrEqual(241);
    expect(auth).toHaveLength(1);
    expect(auth[0].credentials().address().signatureExpirationLedger()).toBe(LEDGER + 48);
    expect(await facilitator.verify({ ...payload, accepted: requirements } as PaymentPayload, requirements)).toEqual({
      isValid: true,
      payer: payerKey.publicKey(),
    });
  });

  it("allows only the slippage it was given over the quote", async () => {
    const { args } = payArgsOf(await client({ slippageBps: 0 }).createPaymentPayload(2, requirements));
    expect(args[2]).toBe(QUOTE);
  });

  it("says when the payer cannot cover the quote plus slippage", async () => {
    network.payFails = true;
    network.balance = 500_000n;
    const short = client().createPaymentPayload(2, requirements);
    await expect(short).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(client().createPaymentPayload(2, requirements)).rejects.toThrow(
      /needs 0\.09996 available to sign .* holds 0\.05\. .* On XLM the account reserve/,
    );
    // EURC has no reserve to explain.
    await expect(client({ sendAsset: FX_TESTNET.eurc }).createPaymentPayload(2, requirements)).rejects.toThrow(/be there first\.$/);
  });

  it("keeps the network's own error when the balance does not explain it", async () => {
    network.payFails = true;
    await expect(client().createPaymentPayload(2, requirements)).rejects.not.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    network.balance = new Error("rpc down");
    await expect(client().createPaymentPayload(2, requirements)).rejects.toThrow(/Contract, #10/);
  });

  it("refuses to sign when the network asks someone else to authorize the payment", async () => {
    network.authFor = Keypair.random().publicKey();
    await expect(client().createPaymentPayload(2, requirements)).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
  });
});

describe("feeBumpSigner", () => {
  const inner = () =>
    new TransactionBuilder(new Account(payerKey.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: SELLER, asset: Asset.native(), amount: "1" }))
      .setTimeout(60)
      .build();

  it("re-bids the fee bump it is asked to sign, and passes anything else through", async () => {
    vi.spyOn(rpc.Server.prototype, "getFeeStats").mockResolvedValue({ sorobanInclusionFee: { p99: "2500" } } as never);
    const sign = vi.fn(async (xdr: string) => ({ signedTxXdr: xdr, signerAddress: facilitatorSigner.address }));
    const bumping = feeBumpSigner({ ...facilitatorSigner, signTransaction: sign }, { network: "stellar:testnet" });

    const bump = TransactionBuilder.buildFeeBumpTransaction(facilitatorSigner.address, "100", inner(), Networks.TESTNET);
    const { signedTxXdr } = await bumping.signTransaction(bump.toXDR());
    const rebid = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    // Twice the p99 per operation, for the inner payment and the bump itself; the inner transaction is untouched.
    expect(rebid.fee).toBe("10000");
    expect("innerTransaction" in rebid && rebid.innerTransaction.toXDR()).toBe(bump.innerTransaction.toXDR());

    const plain = inner().toXDR();
    await bumping.signTransaction(plain);
    expect(sign).toHaveBeenLastCalledWith(plain, undefined);
  });
});
