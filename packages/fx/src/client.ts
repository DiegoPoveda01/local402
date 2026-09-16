import { Asset, contract, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { Network, PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import {
  findDefaultAsset,
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  handleSimulationResult,
  type ClientStellarSigner,
  type RpcConfig,
} from "@x402/stellar";
import { FX_SCHEME, parseFxExtra, SIGNING_GRACE_SECONDS } from "./extra.js";

export interface ExactFxClientOptions {
  /** FxPay contract this client trusts with its funds. */
  fxContract: string;
  /** Asset contract the client pays with, e.g. the XLM SAC. */
  sendAsset: string;
  /** Extra input allowed over the current quote; unused input is refunded. Default 200 (2%). */
  slippageBps?: number;
  /** Seconds of signing time the deadline allows for beyond `maxTimeoutSeconds`. Default `SIGNING_GRACE_SECONDS`. */
  signingGraceSeconds?: number;
  rpcConfig?: RpcConfig;
}

/** Adds `slippageBps` to a quote, rounding up. */
export function maxSendFor(quote: bigint, slippageBps: number): bigint {
  const scaled = quote * BigInt(10_000 + slippageBps);
  return (scaled + 9_999n) / 10_000n;
}

/** Simulates FxPay `quote`: how much `sendAsset` it currently takes to deliver `amount` of `asset`. */
export async function quoteFx(
  { fxContract, sendAsset, rpcConfig }: ExactFxClientOptions,
  network: Network,
  asset: string,
  amount: string | bigint,
): Promise<bigint> {
  const quote = await contract.AssembledTransaction.build({
    contractId: fxContract,
    networkPassphrase: getNetworkPassphrase(network),
    rpcUrl: getRpcUrl(network, rpcConfig),
    method: "quote",
    args: [nativeToScVal(sendAsset, { type: "address" }), nativeToScVal(asset, { type: "address" }), nativeToScVal(amount, { type: "i128" })],
    parseResultXdr: (result) => scValToNative(result) as bigint,
  });
  handleSimulationResult(quote.simulation);
  return quote.result;
}

/** Send assets on Stellar carry 7 decimals. For reading, not for arithmetic. */
export function formatUnits(value: bigint): string {
  const digits = value.toString().padStart(8, "0");
  const fraction = digits.slice(-7).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -7)}.${fraction}` : digits.slice(0, -7);
}

/** The payer's `sendAsset` balance, or undefined if it cannot be read — this only ever explains a failure. */
async function readBalance(
  { sendAsset, rpcConfig }: ExactFxClientOptions,
  network: Network,
  who: string,
): Promise<bigint | undefined> {
  try {
    const call = await contract.AssembledTransaction.build({
      contractId: sendAsset,
      networkPassphrase: getNetworkPassphrase(network),
      rpcUrl: getRpcUrl(network, rpcConfig),
      method: "balance",
      args: [nativeToScVal(who, { type: "address" })],
      parseResultXdr: (result) => scValToNative(result) as bigint,
    });
    handleSimulationResult(call.simulation);
    return call.result;
  } catch {
    return undefined;
  }
}

/**
 * Why the `pay` simulation failed, when the reason is the payer's balance. Simulating already runs the
 * transfer of `max_send` into FxPay, so a payer who does not hold it fails here — with whatever opaque
 * error the token contract raised. `max_send` is the quote plus slippage and the unused part comes back,
 * but the whole of it has to be there to sign, and no token error says that.
 */
async function explainShortBalance(
  options: ExactFxClientOptions,
  network: Network,
  from: string,
  maxSend: bigint,
  failure: unknown,
): Promise<unknown> {
  const balance = await readBalance(options, network, from);
  if (balance === undefined || balance >= maxSend) return failure;
  const native = options.sendAsset === Asset.native().contractId(getNetworkPassphrase(network));
  const reserve = native ? " On XLM the account reserve keeps part of the balance unspendable." : "";
  return new Error(
    `This payment needs ${formatUnits(maxSend)} available to sign (the quote plus slippage), but ${from} ` +
      `holds ${formatUnits(balance)}. Whatever the swap does not use is refunded, but the full amount must ` +
      `be there first.${reserve}`,
  );
}

/** Client side of `exact-fx`: signs an FxPay `pay` that spends `sendAsset` to deliver the required amount. */
export class ExactFxClientScheme implements SchemeNetworkClient {
  readonly scheme = FX_SCHEME;
  // Spend caps then apply to the amount delivered to the seller (USDC).
  readonly findDefaultAsset = findDefaultAsset;

  constructor(
    private readonly signer: ClientStellarSigner,
    private readonly options: ExactFxClientOptions,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const { network, payTo, asset, amount, maxTimeoutSeconds } = requirements;
    const { fxContract, sendAsset, rpcConfig } = this.options;
    const extra = parseFxExtra(requirements.extra);
    if (extra.fxContract !== fxContract) {
      throw new Error(`Untrusted FX contract ${extra.fxContract}`);
    }
    if (!extra.sendAssets.includes(sendAsset)) {
      throw new Error(`Facilitator does not accept send asset ${sendAsset}`);
    }

    const from = this.signer.address;
    const base = { contractId: fxContract, networkPassphrase: getNetworkPassphrase(network), rpcUrl: getRpcUrl(network, rpcConfig) };
    const address = (value: string) => nativeToScVal(value, { type: "address" });
    const i128 = (value: string | bigint) => nativeToScVal(value, { type: "i128" });

    const maxSend = maxSendFor(await quoteFx(this.options, network, asset, amount), this.options.slippageBps ?? 200);

    const latestLedger = await getRpcClient(network, rpcConfig).getLatestLedger();
    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(network);
    // Both are fixed here, before `signAuthEntries` opens the wallet prompt, so they must also cover
    // however long the payer takes to approve it. The facilitator allows the same grace.
    const validSeconds = maxTimeoutSeconds + (this.options.signingGraceSeconds ?? SIGNING_GRACE_SECONDS);
    const maxLedger = latestLedger.sequence + Math.ceil(validSeconds / ledgerSeconds);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + validSeconds);

    const build = () =>
      contract.AssembledTransaction.build({
        ...base,
        method: "pay",
        args: [
          address(from),
          address(sendAsset),
          i128(maxSend),
          address(asset),
          i128(amount),
          address(payTo),
          nativeToScVal(deadline, { type: "u64" }),
        ],
        parseResultXdr: (result) => result,
      });

    let tx: Awaited<ReturnType<typeof build>>;
    try {
      tx = await build();
      handleSimulationResult(tx.simulation);
    } catch (failure) {
      throw await explainShortBalance(this.options, network, from, maxSend, failure);
    }

    let missingSigners = tx.needsNonInvokerSigningBy();
    if (missingSigners.length !== 1 || missingSigners[0] !== from) {
      throw new Error(`Expected to sign with [${from}], but got [${missingSigners.join(", ")}]`);
    }
    await tx.signAuthEntries({ address: from, signAuthEntry: this.signer.signAuthEntry, expiration: maxLedger });
    await tx.simulate();
    handleSimulationResult(tx.simulation);
    missingSigners = tx.needsNonInvokerSigningBy();
    if (missingSigners.length > 0) {
      throw new Error(`unexpected signer(s) required: [${missingSigners.join(", ")}]`);
    }

    return { x402Version, payload: { transaction: tx.built!.toXDR() } };
  }
}
