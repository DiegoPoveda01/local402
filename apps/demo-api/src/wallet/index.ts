// Browser bundle (public/wallet.js, built by scripts/vercel/build.ts): pays the mainnet API from the visitor's
// Freighter wallet with the same Local402Client agents use. Freighter signs the authorization entries; no key
// ever reaches the page, and the facilitator pays the network fees.
import "./buffer.js";
import { getNetworkDetails, isConnected, requestAccess, signAuthEntry } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import type { ClientStellarSigner } from "@x402/stellar";
import { FXPAY_MAINNET, Local402Client, type PaidResult, type PayAsset } from "@local402/client";

/** Refuse anything above this, whatever the seller quotes. */
const MAX_PRICE = "200 CLP";

async function connect(): Promise<string> {
  if (!(await isConnected()).isConnected) throw new Error("no_freighter");
  const access = await requestAccess();
  if (access.error) throw new Error(access.error.message ?? String(access.error));
  const details = await getNetworkDetails();
  if (details.networkPassphrase !== Networks.PUBLIC) throw new Error("wrong_network");
  return access.address;
}

function freighterSigner(address: string): ClientStellarSigner {
  return {
    address,
    signAuthEntry: async (entry) => {
      const signed = await signAuthEntry(entry, { networkPassphrase: Networks.PUBLIC, address });
      if (signed.error || !signed.signedAuthEntry) throw new Error(signed.error?.message ?? "Freighter did not sign");
      // Older Freighter versions return the signature as a Buffer rather than base64.
      const value = signed.signedAuthEntry as string | Uint8Array;
      return { signedAuthEntry: typeof value === "string" ? value : Buffer.from(value).toString("base64"), signerAddress: address };
    },
  };
}

async function pay(url: string, address: string, payWith: PayAsset): Promise<PaidResult> {
  const client = new Local402Client({ signer: freighterSigner(address), network: "stellar:pubnet", payWith, maxPrice: MAX_PRICE, fxContract: FXPAY_MAINNET });
  const result = await client.pay(url);
  if ("free" in result) throw new Error(`${url} did not ask for payment`);
  return result;
}

(globalThis as { local402Wallet?: unknown }).local402Wallet = { connect, pay, maxPrice: MAX_PRICE };
