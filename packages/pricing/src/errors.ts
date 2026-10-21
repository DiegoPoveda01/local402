/**
 * Every error Local402 throws on purpose carries one of these codes, so callers can branch on
 * `error.code` instead of matching messages. Messages may change between versions; codes do not.
 */
export type Local402ErrorCode =
  // Configuration, thrown when a price, route, client or facilitator is built.
  | "INVALID_CONFIG"
  | "INVALID_PRICE"
  | "QUOTE_SECRET_MISSING"
  | "QUOTE_SECRET_WEAK"
  // Quoting: the seller cannot price the request right now.
  | "ORACLE_UNAVAILABLE"
  | "ORACLE_NO_RATE"
  | "ORACLE_STALE"
  | "ORACLE_FUTURE"
  | "ORACLE_INVALID_PRICE"
  | "UF_UNAVAILABLE"
  | "PRICE_ROUNDS_TO_ZERO"
  // Client refusals: the payer declined to sign.
  | "REFUSED_OVERCHARGE"
  | "REFUSED_MAX_PRICE"
  | "REFUSED_BUDGET"
  | "REFUSED_FX_ORACLE_STALE"
  | "REFUSED_FX_PREMIUM"
  | "REFUSED_UNTRUSTED_FX_CONTRACT"
  | "REFUSED_SEND_ASSET"
  | "SIGNER_MISMATCH"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_REQUIREMENTS"
  | "NO_PAYMENT_OPTION"
  | "RESOURCE_UNAVAILABLE"
  | "PAYMENT_FAILED"
  // Facilitator capacity.
  | "FACILITATOR_BUSY";

export class Local402Error extends Error {
  override readonly name = "Local402Error";

  constructor(
    readonly code: Local402ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
