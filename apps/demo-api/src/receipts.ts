import type { Response } from "express";
import { receiptId, type Receipt, type ReceiptStore } from "@local402/server";

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

/** Receipts shared by every serverless instance: a `ReceiptStore` from local402-server, backed by Redis. */
export class RedisReceiptStore implements ReceiptStore {
  constructor(
    private readonly redis: Redis,
    private readonly key = "local402:receipts",
  ) {}

  async add(receipt: Omit<Receipt, "id">): Promise<Receipt> {
    const [count] = await this.redis.pipeline(["INCR", `${this.key}:count`]);
    const saved = { id: receiptId(Number(count)), ...receipt };
    await this.redis.pipeline(["LPUSH", this.key, JSON.stringify(saved)], ["LTRIM", this.key, 0, REDIS_LIMIT - 1]);
    return saved;
  }

  async list(): Promise<Receipt[]> {
    const [items] = await this.redis.pipeline(["LRANGE", this.key, 0, -1]);
    return (items as string[]).map((item) => JSON.parse(item) as Receipt);
  }
}

/** Streams new receipts to the dashboard as server-sent events. */
export class ReceiptStream {
  private readonly listeners = new Set<Response>();

  readonly send = (receipt: Receipt): void => {
    const event = `data: ${JSON.stringify(receipt)}\n\n`;
    for (const listener of this.listeners) listener.write(event);
  };

  subscribe(res: Response): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    this.listeners.add(res);
    res.on("close", () => this.listeners.delete(res));
  }
}
