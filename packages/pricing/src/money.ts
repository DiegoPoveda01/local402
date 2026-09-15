export interface LocalMoney {
  /** Decimal amount as written by the seller, e.g. "50" or "1.20". */
  amount: string;
  /** ISO 4217 code, e.g. "CLP", "EUR", "BRL". */
  currency: string;
}

const LOCAL_PRICE = /^\s*(\d+(?:\.\d+)?)\s+([A-Za-z]{2,3})\s*$/;
// Common names that are not ISO 4217 codes.
const ALIASES: Record<string, string> = { UF: "CLF" };

/** Parses a seller price such as "50 CLP", "1.20 EUR" or "0.5 UF". */
export function parseLocalPrice(price: string): LocalMoney {
  const match = LOCAL_PRICE.exec(price);
  if (!match) {
    throw new Error(`Invalid local price "${price}". Expected "<amount> <CURRENCY>", e.g. "50 CLP".`);
  }
  const code = match[2].toUpperCase();
  return { amount: match[1], currency: ALIASES[code] ?? code };
}

/** Converts a decimal string to an integer scaled by 10^decimals, plus the decimals it used. */
export function toScaled(amount: string): { value: bigint; decimals: number } {
  const [whole, fraction = ""] = amount.split(".");
  return { value: BigInt(whole + fraction), decimals: fraction.length };
}

/** Formats an integer scaled by 10^decimals as a decimal string without trailing zeros. */
export function fromScaled(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
