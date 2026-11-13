import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** One settled payment, as the agent's operator would want it on a receipt. */
export interface Receipt {
  at: string;
  url: string;
  network: string;
  payWith: string;
  /** Price as the seller set it, with the rate the seller quoted. */
  price?: { amount: string; currency: string; usdPerUnit: string; oracleSource: string };
  /** USDC the seller received, in its smallest unit (7 decimals). */
  usdcUnits: string;
  usdc: string;
  /** Send-asset amount an XLM or EURC payment consumed. */
  spent?: { asset: string; amount: string };
  transaction: string;
  explorerUrl: string;
}

/** Payments kept as JSON lines on disk, so limits still hold after the MCP server restarts. */
export class PaymentHistory {
  private receipts: Receipt[] = [];

  constructor(readonly file: string) {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) this.receipts.push(JSON.parse(line) as Receipt);
    }
  }

  add(receipt: Receipt): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(receipt) + "\n");
    this.receipts.push(receipt);
  }

  /** Newest first. */
  list(limit = 20): Receipt[] {
    return this.receipts.slice(-limit).reverse();
  }

  /** USDC units paid at or after `since`. */
  spentSince(since: Date): bigint {
    return this.receipts.filter((r) => new Date(r.at) >= since).reduce((sum, r) => sum + BigInt(r.usdcUnits), 0n);
  }
}

/** Midnight of `now`'s day in the machine's time zone. */
export function startOfDay(now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}

export const formatUsdc = (units: bigint | string) => (Number(units) / 1e7).toFixed(7);
