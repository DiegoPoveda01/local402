import { Local402Error } from "@local402/pricing";
import { StrKey } from "@stellar/stellar-sdk";
import { FX_MAINNET } from "./mainnet.js";

/**
 * `exact-fx`: the seller receives exactly `amount` of `asset` (like `exact`), while the payer
 * spends a different asset that the FxPay contract swaps on Soroswap within the same transaction.
 */
export const FX_SCHEME = "exact-fx";

/**
 * Extra validity the payer gives the swap deadline and the signature expiration, on top of
 * `maxTimeoutSeconds`, to cover the time a human spends reading and approving the wallet prompt.
 *
 * Both sides need the same number: the payer computes the deadline before asking for the signature,
 * so a prompt left open for a minute would otherwise produce a payload the facilitator rejects as
 * expired. The facilitator allows the same window when checking how far ahead a deadline may be.
 */
export const SIGNING_GRACE_SECONDS = 180;

/** FxPay deployment and assets on Stellar testnet. */
export const FX_TESTNET = {
  fxContract: "CD6PUDBJNDYWLTQPHYU26OCEH4GWR7WN3UIXAEKUP3DQIS3DKJQIF7DL",
  xlm: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  /** Soroswap's testnet EURC (tstEURC:GBB74VBG…). It has no USDC pool, so FxPay routes it through XLM. */
  eurc: "CDHCVLBJWUA62CYRTTG46MBTPTXQ4VHKPTUTG6UNUPN4OTMK3FFJ77CE",
} as const;

/**
 * FxPay settings for a network. Mainnet uses Circle's EURC and a mainnet RPC; its FxPay address comes from
 * the deployment (`scripts/mainnet/deploy-fxpay.sh`), so it is undefined until one is passed in.
 */
export function fxNetwork(network: string, fxContract?: string): { fxContract?: string; xlm: string; eurc: string; rpcUrl?: string } {
  if (network !== "stellar:pubnet" && network !== "stellar:testnet") {
    throw new Local402Error("INVALID_CONFIG", `network must be stellar:pubnet or stellar:testnet, got ${network}.`);
  }
  if (fxContract !== undefined) contractAddress("fxContract", fxContract);
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
    throw new Local402Error("INVALID_REQUIREMENTS", "exact-fx requires areFeesSponsored to be true");
  }
  if (typeof fxContract !== "string" || !Array.isArray(sendAssets)) {
    throw new Local402Error("INVALID_REQUIREMENTS", "exact-fx requirements are missing fxContract or sendAssets");
  }
  return { areFeesSponsored, fxContract, sendAssets: sendAssets.map(String) };
}

/** Throws `INVALID_CONFIG` unless `value` is a Soroban contract address (C…). */
export function contractAddress(name: string, value: unknown): string {
  if (typeof value !== "string" || !StrKey.isValidContract(value)) {
    // This message ends up in logs: never repeat something shaped like a secret key.
    const got = /^S[A-Z2-7]{55}$/.test(String(value)) ? "a secret key (not shown)" : value;
    throw new Local402Error("INVALID_CONFIG", `${name} must be a contract address (C…), got ${got}.`);
  }
  return value;
}

/** Throws `INVALID_CONFIG` unless `value` is undefined or an integer in [min, max]. */
export function integerIn(name: string, value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (value !== undefined && !(Number.isInteger(value) && (value as number) >= min && (value as number) <= max)) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
    throw new Local402Error("INVALID_CONFIG", `${name} must be a whole number ${range}, got ${value}.`);
  }
}
