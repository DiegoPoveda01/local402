import { Local402Error, parseLocalPrice } from "@local402/pricing";

/** Spending limits in local currency. Each one may use its own currency. */
export interface Limits {
  /** Most a single payment may cost, e.g. "500 CLP". */
  payment: string;
  /** Most the agent may spend per calendar day (machine time zone), e.g. "2000 CLP". */
  day: string;
  /** Most the agent may ever spend from this wallet on this network, e.g. "5000 CLP". */
  total: string;
}

/** Low on purpose: an agent with no configuration should not be able to spend much. */
export const DEFAULT_LIMITS: Limits = { payment: "500 CLP", day: "2000 CLP", total: "5000 CLP" };

const PERIODS = ["payment", "day", "total"] as const;

/**
 * Reads `LIMITS`, a comma-separated list such as "5000 NGN/payment, 2000 CLP/day". Periods left out keep their
 * default. `MAX_PRICE` and `BUDGET`, the 0.1 settings, still set the per-payment and total limits.
 */
export function parseLimits(env: { LIMITS?: string; MAX_PRICE?: string; BUDGET?: string }): Limits {
  const limits = { ...DEFAULT_LIMITS };
  if (env.MAX_PRICE) limits.payment = env.MAX_PRICE;
  if (env.BUDGET) limits.total = env.BUDGET;
  for (const entry of (env.LIMITS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [price, period] = entry.split("/").map((s) => s.trim());
    if (!(PERIODS as readonly string[]).includes(period)) {
      throw new Local402Error("INVALID_CONFIG", `LIMITS entry "${entry}" must end in /payment, /day or /total, e.g. "2000 CLP/day"`);
    }
    limits[period as (typeof PERIODS)[number]] = price;
  }
  for (const price of Object.values(limits)) parseLocalPrice(price);
  return limits;
}
