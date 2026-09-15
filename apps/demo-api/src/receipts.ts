import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Response } from "express";
import type { SettleResultContext } from "@x402/core/server";
import type { LocalQuote } from "@local402/pricing";

/** What a seller needs to book a sale made in local currency and settled on Stellar. */
export interface Receipt {
  id: string;
  resource: string;
  paidAt: string;
  scheme: string;
  network: string;
  payer?: string;
  payTo: string;
  /** Price as the seller set it, e.g. 50 CLP. */
  local: { amount: string; currency: string };
  /** Exchange rate used for the quote and where it came from. */
  rate: { usdPerUnit: string; source: string; oracleTimestamp: number };
  /** Token the seller actually received, in its smallest unit. */
  settled: { asset: string; amount: string; decimals: number };
  /** Asset the payer spent when it differs from the settled one (exact-fx). */
  spent?: { asset: string; amount: string };
  transaction: string;
}

export class ReceiptBook {
  private readonly receipts: Receipt[];
  private readonly listeners = new Set<Response>();

  /** Keeps receipts in memory and, when given a file, across restarts. */
  constructor(private readonly file?: string) {
    try {
      this.receipts = file ? (JSON.parse(readFileSync(file, "utf8")) as Receipt[]) : [];
    } catch {
      this.receipts = [];
    }
  }

  /** `onAfterSettle` hook for an x402 resource server. */
  readonly record = async (ctx: SettleResultContext): Promise<void> => {
    const { requirements, result } = ctx;
    const quote = requirements.extra?.local402 as LocalQuote | undefined;
    if (!quote) return;
    const extra = result.extra as { sendAsset?: string; sendAmount?: string } | undefined;
    const receipt: Receipt = {
      id: `${this.receipts.length + 1}`.padStart(6, "0"),
      resource: ctx.paymentPayload.resource?.url ?? "",
      paidAt: new Date().toISOString(),
      scheme: requirements.scheme,
      network: requirements.network,
      payer: result.payer,
      payTo: requirements.payTo,
      local: { amount: quote.localAmount, currency: quote.currency },
      rate: { usdPerUnit: quote.usdPerUnit, source: quote.oracleSource, oracleTimestamp: quote.oracleTimestamp },
      settled: { asset: requirements.asset, amount: requirements.amount, decimals: quote.tokenDecimals },
      spent: extra?.sendAsset && extra.sendAmount ? { asset: extra.sendAsset, amount: extra.sendAmount } : undefined,
      transaction: result.transaction,
    };
    this.receipts.unshift(receipt);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.receipts, null, 2));
    }
    const event = `data: ${JSON.stringify(receipt)}\n\n`;
    for (const listener of this.listeners) listener.write(event);
  };

  list(): Receipt[] {
    return this.receipts;
  }

  /** Streams new receipts as server-sent events. */
  subscribe(res: Response): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    this.listeners.add(res);
    res.on("close", () => this.listeners.delete(res));
  }
}
