import { contract, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
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
import { FX_SCHEME, parseFxExtra } from "./extra.js";

export interface ExactFxClientOptions {
  /** FxPay contract this client trusts with its funds. */
  fxContract: string;
  /** Asset contract the client pays with, e.g. the XLM SAC. */
  sendAsset: string;
  /** Extra input allowed over the current quote; unused input is refunded. Default 200 (2%). */
  slippageBps?: number;
  rpcConfig?: RpcConfig;
}

/** Adds `slippageBps` to a quote, rounding up. */
export function maxSendFor(quote: bigint, slippageBps: number): bigint {
  const scaled = quote * BigInt(10_000 + slippageBps);
  return (scaled + 9_999n) / 10_000n;
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

    const quote = await contract.AssembledTransaction.build({
      ...base,
      method: "quote",
      args: [address(sendAsset), address(asset), i128(amount)],
      parseResultXdr: (result) => scValToNative(result) as bigint,
    });
    handleSimulationResult(quote.simulation);
    const maxSend = maxSendFor(quote.result, this.options.slippageBps ?? 200);

    const latestLedger = await getRpcClient(network, rpcConfig).getLatestLedger();
    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(network);
    const maxLedger = latestLedger.sequence + Math.ceil(maxTimeoutSeconds / ledgerSeconds);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + maxTimeoutSeconds);

    const tx = await contract.AssembledTransaction.build({
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
    handleSimulationResult(tx.simulation);

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
