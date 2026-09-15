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

/** Most recent receipts kept in Redis. */
const REDIS_LIMIT = 500;

/** Upstash Redis REST client, enough for a list and counters. */
export class Redis {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  /** Uses the variables Vercel's Upstash integration sets, if present. */
  static fromEnv(): Redis | undefined {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? new Redis(url, token) : undefined;
  }

  async pipeline(...commands: (string | number)[][]): Promise<unknown[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Redis ${response.status}: ${await response.text()}`);
    return ((await response.json()) as { result: unknown }[]).map((r) => r.result);
  }
}

export class ReceiptBook {
  private receipts: Receipt[] = [];
  private readonly listeners = new Set<Response>();

  /**
   * Keeps receipts in Redis when given one (shared by every serverless instance),
   * otherwise in memory and, when given a file, across restarts.
   */
  constructor(
    private readonly options: { file?: string; redis?: Redis; key?: string } = {},
  ) {
    if (options.redis || !options.file) return;
    try {
      this.receipts = JSON.parse(readFileSync(options.file, "utf8")) as Receipt[];
    } catch {
      this.receipts = [];
    }
  }

  private get key(): string {
    return this.options.key ?? "local402:receipts";
  }

  /** `onAfterSettle` hook for an x402 resource server. */
  readonly record = async (ctx: SettleResultContext): Promise<void> => {
    const { requirements, result } = ctx;
    const quote = requirements.extra?.local402 as LocalQuote | undefined;
    if (!quote) return;
    const { redis, file } = this.options;
    const count = redis ? Number((await redis.pipeline(["INCR", `${this.key}:count`]))[0]) : this.receipts.length + 1;
    const extra = result.extra as { sendAsset?: string; sendAmount?: string } | undefined;
    const receipt: Receipt = {
      id: `${count}`.padStart(6, "0"),
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
    if (redis) {
      await redis.pipeline(["LPUSH", this.key, JSON.stringify(receipt)], ["LTRIM", this.key, 0, REDIS_LIMIT - 1]);
    } else {
      this.receipts.unshift(receipt);
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(this.receipts, null, 2));
      }
    }
    const event = `data: ${JSON.stringify(receipt)}\n\n`;
    for (const listener of this.listeners) listener.write(event);
  };

  async list(): Promise<Receipt[]> {
    if (!this.options.redis) return this.receipts;
    const [items] = await this.options.redis.pipeline(["LRANGE", this.key, 0, -1]);
    return (items as string[]).map((item) => JSON.parse(item) as Receipt);
  }

  /** Streams new receipts as server-sent events. */
  subscribe(res: Response): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    this.listeners.add(res);
    res.on("close", () => this.listeners.delete(res));
  }
}
