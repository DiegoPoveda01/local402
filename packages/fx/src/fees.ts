import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcClient, type FacilitatorStellarSigner, type RpcConfig } from "@x402/stellar";
import type { Network } from "@x402/core/types";

/** 0.0001 XLM: ten times the base fee, still negligible, and enough to clear mainnet's usual Soroban surge pricing. */
const MIN_INCLUSION_FEE_STROOPS = 1_000;

/** Twice the network's recent p99 Soroban inclusion fee, at least MIN_INCLUSION_FEE_STROOPS and at most `max`. */
export async function inclusionFeeBid(server: ReturnType<typeof getRpcClient>, max: number): Promise<number> {
  const p99 = await server
    .getFeeStats()
    .then((stats) => Number(stats.sorobanInclusionFee.p99))
    .catch(() => 0);
  return Math.min(Math.max(MIN_INCLUSION_FEE_STROOPS, 2 * (p99 || 0)), max);
}

/**
 * `ExactStellarScheme` (@x402/stellar 2.25) always bids the 100-stroop base fee, which mainnet often rejects or never
 * includes. Passed as its `feeBumpSigner`, this re-wraps the fee bump it builds with `inclusionFeeBid` before signing.
 * The inner transaction and its signatures are untouched, and one fee payer can serve every channel account.
 */
export function feeBumpSigner(
  signer: FacilitatorStellarSigner,
  options: { network: Network; rpcConfig?: RpcConfig; maxInclusionFeeStroops?: number },
): FacilitatorStellarSigner {
  const networkPassphrase = getNetworkPassphrase(options.network);
  const server = getRpcClient(options.network, options.rpcConfig);
  return {
    ...signer,
    async signTransaction(xdr, opts) {
      const bump = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      if (!(bump instanceof FeeBumpTransaction)) return signer.signTransaction(xdr, opts);
      const fee = await inclusionFeeBid(server, options.maxInclusionFeeStroops ?? 10_000);
      const rebid = TransactionBuilder.buildFeeBumpTransaction(signer.address, String(fee), bump.innerTransaction, networkPassphrase);
      return signer.signTransaction(rebid.toXDR(), opts);
    },
  };
}
