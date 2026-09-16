import { fromScaled, parseLocalPrice, toScaled } from "./money.js";
import type { FiatRateSource } from "./oracle.js";

export interface LocalQuote {
  currency: string;
  localAmount: string;
  /** USD value of one unit of the currency, as a decimal string. */
  usdPerUnit: string;
  /** Amount the payer must send, in the settlement token's smallest unit. */
  tokenAmount: string;
  tokenDecimals: number;
  oracleSource: string;
  oracleTimestamp: number;
  /** Day the rate's underlying value is dated, when that differs from `oracleTimestamp` (see `FiatRate`). */
  oracleValueDate?: string;
  /** Unix seconds after which the seller will no longer honor this quote. */
  expiresAt: number;
  /** HMAC by the issuing seller, present when quotes are signed (see `localPrice`). */
  signature?: string;
}

export interface QuoteOptions {
  oracle: FiatRateSource;
  /** Reject oracle prices older than this. Reflector updates every 300 s. */
  maxOracleAgeSeconds?: number;
  /** How long the quoted token amount stays valid. */
  quoteTtlSeconds?: number;
  tokenDecimals?: number;
  now?: () => number;
}

/**
 * Converts a local price such as "50 CLP" into a USD-stablecoin amount.
 * Rounds up so the seller never receives less than the local price.
 */
export async function quoteLocalPrice(price: string, options: QuoteOptions): Promise<LocalQuote> {
  const { amount, currency } = parseLocalPrice(price);
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxOracleAgeSeconds ?? 900;
  const tokenDecimals = options.tokenDecimals ?? 7;

  const rate = await options.oracle.getRate(currency);
  if (now - rate.timestamp > maxAge) {
    throw new Error(`Oracle rate for ${currency} is stale (${now - rate.timestamp}s old, max ${maxAge}s)`);
  }
  // A clock ahead of ours is not freshness: without this, any future timestamp passes the check above.
  if (rate.timestamp - now > maxAge) {
    throw new Error(`Oracle rate for ${currency} is dated ${rate.timestamp - now}s in the future`);
  }
  // A paused or delisted feed can report zero. Quoting it would emit a requirement for 0 tokens, which
  // settles happily: the buyer gets the resource, the seller is paid nothing, and it books as a sale.
  if (rate.usdPerUnit <= 0n) {
    throw new Error(`Oracle rate for ${currency} is not a positive price (${rate.usdPerUnit})`);
  }

  // tokens = local * usdPerUnit, rescaled from (localDecimals + rateDecimals) to tokenDecimals.
  const local = toScaled(amount);
  const product = local.value * rate.usdPerUnit;
  const shift = local.decimals + rate.decimals - tokenDecimals;
  const tokens = shift >= 0 ? ceilDiv(product, 10n ** BigInt(shift)) : product * 10n ** BigInt(-shift);
  if (tokens <= 0n) {
    throw new Error(`${price} rounds to ${tokens} token units at the current rate`);
  }

  return {
    currency,
    localAmount: amount,
    usdPerUnit: fromScaled(rate.usdPerUnit, rate.decimals),
    tokenAmount: tokens.toString(),
    tokenDecimals,
    oracleSource: rate.source,
    oracleTimestamp: rate.timestamp,
    oracleValueDate: rate.valueDate,
    expiresAt: now + (options.quoteTtlSeconds ?? 60),
  };
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
