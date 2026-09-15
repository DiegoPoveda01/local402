/**
 * `exact-fx`: the seller receives exactly `amount` of `asset` (like `exact`), while the payer
 * spends a different asset that the FxPay contract swaps on Soroswap within the same transaction.
 */
export const FX_SCHEME = "exact-fx";

/** FxPay deployment and assets on Stellar testnet. */
export const FX_TESTNET = {
  fxContract: "CBFLBCRONSQLY2SCEK5RA5CHWYI73ZZFFIJSNYKC2BRKG4J5GHU27FAM",
  xlm: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
} as const;

/** Fields the facilitator advertises in `/supported` and that end up in the requirements' `extra`. */
export interface FxExtra {
  areFeesSponsored: boolean;
  fxContract: string;
  sendAssets: string[];
}

export function parseFxExtra(extra: Record<string, unknown> | undefined): FxExtra {
  const { areFeesSponsored, fxContract, sendAssets } = extra ?? {};
  if (areFeesSponsored !== true) {
    throw new Error("exact-fx requires areFeesSponsored to be true");
  }
  if (typeof fxContract !== "string" || !Array.isArray(sendAssets)) {
    throw new Error("exact-fx requirements are missing fxContract or sendAssets");
  }
  return { areFeesSponsored, fxContract, sendAssets: sendAssets.map(String) };
}
