import { Networks } from "@stellar/stellar-sdk";
import type { Network } from "@x402/core/types";
import type { ClientStellarSigner } from "@x402/stellar";
import { FXPAY_MAINNET, Local402Client, type Local402ClientOptions, type PaidResult, type PayAsset } from "@local402/client";
import { formatUnits, fxNetwork, quoteFx } from "@local402/fx";

/** A wallet's `signAuthEntry`, as Varial (`@stellar/freighter-api`) exposes it. */
export type SignAuthEntry = (
  entry: string,
  options: { networkPassphrase: string; address: string },
) => Promise<{ signedAuthEntry?: string | Uint8Array | null; error?: { message?: string } | string }>;

export const passphrase = (network: Network) => (network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET);
const fxContractFor = (network: Network) => (network === "stellar:pubnet" ? FXPAY_MAINNET : undefined);

/** Signs the payer's authorization entries through the wallet: no key ever reaches the page. */
export function walletSigner(address: string, network: Network, sign: SignAuthEntry): ClientStellarSigner {
  return {
    address,
    signAuthEntry: async (entry) => {
      const signed = await sign(entry, { networkPassphrase: passphrase(network), address });
      if (signed.error || !signed.signedAuthEntry) {
        throw new Error(typeof signed.error === "string" ? signed.error : (signed.error?.message ?? "The wallet did not sign"));
      }
      // Older wallet versions return the signature as bytes rather than base64.
      const value = signed.signedAuthEntry;
      return { signedAuthEntry: typeof value === "string" ? value : Buffer.from(value).toString("base64"), signerAddress: address };
    },
  };
}

/**
 * What paying with `payWith` takes, for display: the USDC price itself, or what FxPay currently quotes in
 * XLM or EURC for it. The payment authorizes up to 2% more and refunds whatever the swap does not use.
 */
export async function estimate(payWith: PayAsset, network: Network, asset: string, amount: string): Promise<string> {
  if (payWith === "USDC") return formatUnits(BigInt(amount));
  const fx = fxNetwork(network, fxContractFor(network));
  const sendAsset = payWith === "XLM" ? fx.xlm : fx.eurc;
  const rpcConfig = fx.rpcUrl ? { url: fx.rpcUrl } : undefined;
  return formatUnits(await quoteFx({ fxContract: fx.fxContract!, sendAsset, rpcConfig }, network, asset, amount));
}

/**
 * Pays `url` with the Local402 client. Price, overcharge and swap checks all run before the wallet is
 * asked to sign, so a refused payment never reaches it.
 */
export async function payFromWallet(url: string, options: Local402ClientOptions & { signer: ClientStellarSigner; network: Network }): Promise<PaidResult> {
  const client = new Local402Client({ fxContract: fxContractFor(options.network), ...options });
  const result = await client.pay(url);
  if ("free" in result) throw new Error(`${url} did not ask for payment`);
  return result;
}
