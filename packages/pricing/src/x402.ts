import { createHmac, timingSafeEqual } from "node:crypto";
import { decodePaymentSignatureHeader, type DynamicPrice, type HTTPRequestContext } from "@x402/core/http";
import type { AssetAmount, Network } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { parseLocalPrice } from "./money.js";
import { ReflectorFiatOracle, type FiatRateSource } from "./oracle.js";
import { quoteLocalPrice, type LocalQuote, type QuoteOptions } from "./quote.js";

export interface LocalPriceOptions extends Omit<QuoteOptions, "oracle" | "tokenDecimals"> {
  network: Network;
  oracle?: FiatRateSource;
  /**
   * Signs quotes so a paid retry can be honored by any server instance holding the same secret,
   * not only the one that issued the 402. Defaults to `LOCAL402_QUOTE_SECRET`.
   */
  quoteSecret?: string;
}

let warnedUnsignedQuotes = false;

/**
 * Without a secret, a quote can only be honored by the instance that issued the 402, through the
 * in-memory cache below. That is fine for one process and silently wrong behind a load balancer or on
 * serverless, where the paid retry usually lands elsewhere, re-quotes, and rejects the payment the
 * payer already signed. It works in local development and in the tests, so say it out loud instead.
 */
function warnUnsignedQuotes() {
  if (warnedUnsignedQuotes) return;
  warnedUnsignedQuotes = true;
  console.warn(
    "LOCAL402_QUOTE_SECRET is not set: quotes are unsigned and only honored by the instance that issued them. " +
      "Set it (the same value on every instance) before running more than one.",
  );
}

/**
 * x402 route price expressed in local currency, e.g. `price: localPrice("50 CLP", { network })`.
 *
 * Emits a standard `exact` USDC requirement, so existing Stellar x402 clients pay it unchanged.
 * The quote is attached as `extra.local402` and frozen for its TTL: the resource server
 * rebuilds requirements when the paid retry arrives and needs the exact same amount.
 * A new 402 gets a fresh quote once half the TTL has passed, so the payer always has time to sign
 * and retry before the quote it accepted expires.
 */
export function localPrice(price: string, options: LocalPriceOptions): DynamicPrice {
  const oracle = options.oracle ?? new ReflectorFiatOracle();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const secret = options.quoteSecret ?? process.env.LOCAL402_QUOTE_SECRET;
  if (!secret) warnUnsignedQuotes();
  const { amount, currency } = parseLocalPrice(price);
  const ttl = options.quoteTtlSeconds ?? 60;
  let cached: { quote: LocalQuote; asset: string } | undefined;

  const sign = (quote: LocalQuote, asset: string) =>
    createHmac("sha256", secret!)
      .update(JSON.stringify([options.network, asset, quote.currency, quote.localAmount, quote.usdPerUnit, quote.tokenAmount, quote.tokenDecimals, quote.oracleSource, quote.oracleValueDate ?? null, quote.oracleTimestamp, quote.expiresAt]))
      .digest("hex");

  // The quote the payer accepted, if this server signed it for this price and it has not expired.
  const signedQuote = (context: HTTPRequestContext | undefined, asset: string): LocalQuote | undefined => {
    if (!secret || !context?.paymentHeader) return undefined;
    try {
      const { accepted } = decodePaymentSignatureHeader(context.paymentHeader);
      const quote = accepted.extra?.local402 as LocalQuote | undefined;
      if (!quote?.signature || accepted.asset !== asset || accepted.amount !== quote.tokenAmount) return undefined;
      if (quote.currency !== currency || quote.localAmount !== amount || quote.expiresAt <= now()) return undefined;
      const expected = Buffer.from(sign(quote, asset), "hex");
      const given = Buffer.from(quote.signature, "hex");
      return given.length === expected.length && timingSafeEqual(given, expected) ? quote : undefined;
    } catch {
      return undefined;
    }
  };

  return async (context): Promise<AssetAmount> => {
    // The default Stellar asset (USDC) and its decimals come from the official scheme.
    const unit = await new ExactStellarScheme().parsePrice("1", options.network);
    const honored = signedQuote(context, unit.asset);
    if (honored) return { asset: unit.asset, amount: honored.tokenAmount, extra: { local402: honored } };

    if (!cached || cached.quote.expiresAt - now() < ttl / 2) {
      const quote = await quoteLocalPrice(price, { ...options, oracle, tokenDecimals: unit.amount.length - 1, now });
      if (secret) quote.signature = sign(quote, unit.asset);
      cached = { quote, asset: unit.asset };
    }
    return {
      asset: cached.asset,
      amount: cached.quote.tokenAmount,
      extra: { local402: cached.quote },
    };
  };
}
