import type { DynamicPrice } from "@x402/core/http";
import type { AssetAmount, Network } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ReflectorFiatOracle, type FiatRateSource } from "./oracle.js";
import { quoteLocalPrice, type LocalQuote, type QuoteOptions } from "./quote.js";

export interface LocalPriceOptions extends Omit<QuoteOptions, "oracle" | "tokenDecimals"> {
  network: Network;
  oracle?: FiatRateSource;
}

/**
 * x402 route price expressed in local currency, e.g. `price: localPrice("50 CLP", { network })`.
 *
 * Emits a standard `exact` USDC requirement, so existing Stellar x402 clients pay it unchanged.
 * The quote is attached as `extra.local402` and frozen for its TTL: the resource server
 * rebuilds requirements when the paid retry arrives and needs the exact same amount.
 */
export function localPrice(price: string, options: LocalPriceOptions): DynamicPrice {
  const oracle = options.oracle ?? new ReflectorFiatOracle();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let cached: { quote: LocalQuote; asset: string } | undefined;

  return async (): Promise<AssetAmount> => {
    if (!cached || cached.quote.expiresAt <= now()) {
      // The default Stellar asset (USDC) and its decimals come from the official scheme.
      const unit = await new ExactStellarScheme().parsePrice("1", options.network);
      const tokenDecimals = unit.amount.length - 1;
      const quote = await quoteLocalPrice(price, { ...options, oracle, tokenDecimals, now });
      cached = { quote, asset: unit.asset };
    }
    return {
      asset: cached.asset,
      amount: cached.quote.tokenAmount,
      extra: { local402: cached.quote },
    };
  };
}
