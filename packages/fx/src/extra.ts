import { FX_MAINNET } from "./mainnet.js";

/**
 * `exact-fx`: the seller receives exactly `amount` of `asset` (like `exact`), while the payer
 * spends a different asset that the FxPay contract swaps on Soroswap within the same transaction.
 */
export const FX_SCHEME = "exact-fx";

/** FxPay deployment and assets on Stellar testnet. */
export const FX_TESTNET = {
  fxContract: "CDLIJ3SXAYQDCIO4GLS3OQPUKT6JTWICRDTOB3F5ESG5TWYKRRPJ6IUC",
  xlm: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  /** Soroswap's testnet EURC (tstEURC:GBB74VBG…). It has no USDC pool, so FxPay routes it through XLM. */
  eurc: "CDHCVLBJWUA62CYRTTG46MBTPTXQ4VHKPTUTG6UNUPN4OTMK3FFJ77CE",
} as const;

/**
 * FxPay settings for a network. Mainnet uses Circle's EURC and a mainnet RPC; its FxPay address comes from
 * the deployment (`scripts/mainnet/deploy-fxpay.sh`), so it is undefined until one is passed in.
 */
export function fxNetwork(network: string, fxContract?: string): { fxContract?: string; xlm: string; eurc: string; rpcUrl?: string } {
  if (network === "stellar:pubnet") {
    return { fxContract, xlm: FX_MAINNET.xlm, eurc: FX_MAINNET.eurc.contract, rpcUrl: FX_MAINNET.rpcUrl };
  }
  return { fxContract: fxContract ?? FX_TESTNET.fxContract, xlm: FX_TESTNET.xlm, eurc: FX_TESTNET.eurc };
}

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
