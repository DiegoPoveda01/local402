import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SettleResultContext } from "@x402/core/server";
import { fxNetwork } from "@local402/fx";
import { Local402Error, type LocalQuote } from "@local402/pricing";

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
  /** Exchange rate used for the quote, where it came from and when the oracle published it (Unix seconds). */
  rate: { usdPerUnit: string; source: string; oracleTimestamp: number };
  /** Token the seller actually received, in its smallest unit. */
  settled: { asset: string; amount: string; decimals: number };
  /** Asset the payer spent when it differs from the settled one (exact-fx). */
  spent?: { asset: string; amount: string };
  /** How much more the payer spent than the oracle value of the settled USDC, in basis points (exact-fx). */
  fxPremiumBps?: number;
  transaction: string;
}

/**
 * Where receipts are kept. `MemoryReceiptStore` and `FileReceiptStore` come with the package; any other
 * backend (a database, Redis) implements these two methods.
 */
export interface ReceiptStore {
  /** Saves a receipt and returns it with an id unique within the store. */
  add(receipt: Omit<Receipt, "id">): Promise<Receipt>;
  /** Every receipt, newest first. */
  list(): Promise<Receipt[]>;
}

/** The stores here number receipts 000001, 000002…, in the order they were paid. */
export const receiptId = (n: number): string => `${n}`.padStart(6, "0");

/** Receipts kept for as long as the process runs. */
export class MemoryReceiptStore implements ReceiptStore {
  protected receipts: Receipt[] = [];

  async add(receipt: Omit<Receipt, "id">): Promise<Receipt> {
    const saved = { id: receiptId(this.receipts.length + 1), ...receipt };
    this.receipts.unshift(saved);
    return saved;
  }

  async list(): Promise<Receipt[]> {
    return [...this.receipts];
  }
}

/** Receipts kept in a JSON file, so they survive restarts. One process should write to a file at a time. */
export class FileReceiptStore extends MemoryReceiptStore {
  constructor(private readonly file: string) {
    super();
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    // Starting empty over an unreadable file would overwrite the seller's books with the next sale.
    const receipts: unknown = JSON.parse(text);
    if (!Array.isArray(receipts)) throw new Local402Error("INVALID_CONFIG", `${file} is not a JSON array of receipts.`);
    this.receipts = receipts as Receipt[];
  }

  override async add(receipt: Omit<Receipt, "id">): Promise<Receipt> {
    const saved = await super.add(receipt);
    mkdirSync(dirname(this.file), { recursive: true });
    // Written beside the file and renamed over it, so a crash mid-write leaves the previous books intact.
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.receipts, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    return saved;
  }
}

/** Premium of an exact-fx payment over the oracle, in basis points, or undefined when it cannot be priced. */
export type FxPremium = (spent: { asset: string; amount: string }, settledAmount: string) => Promise<number | undefined>;

export interface RecordReceiptsOptions {
  /** Prices what a swap cost; a failure leaves `fxPremiumBps` out instead of losing the receipt. */
  fxPremium?: FxPremium;
  /** Called with each receipt once it is stored, e.g. to push it to a dashboard. */
  onReceipt?: (receipt: Receipt) => void;
}

/**
 * `onAfterSettle` hook that stores one receipt per settled Local402 payment:
 * `local402Server(url).onAfterSettle(recordReceipts(store))`. Payments without a Local402 quote are skipped.
 */
export function recordReceipts(store: ReceiptStore, { fxPremium, onReceipt }: RecordReceiptsOptions = {}) {
  return async ({ requirements, result, paymentPayload }: SettleResultContext): Promise<void> => {
    const quote = requirements.extra?.local402 as LocalQuote | undefined;
    if (!quote) return;
    const extra = result.extra as { sendAsset?: string; sendAmount?: string } | undefined;
    const spent = extra?.sendAsset && extra.sendAmount ? { asset: extra.sendAsset, amount: extra.sendAmount } : undefined;
    const fxPremiumBps = spent && fxPremium ? await fxPremium(spent, requirements.amount).catch(() => undefined) : undefined;
    const receipt = await store.add({
      resource: paymentPayload.resource?.url ?? "",
      paidAt: new Date().toISOString(),
      scheme: requirements.scheme,
      network: requirements.network,
      payer: result.payer,
      payTo: requirements.payTo,
      local: { amount: quote.localAmount, currency: quote.currency },
      rate: { usdPerUnit: quote.usdPerUnit, source: quote.oracleSource, oracleTimestamp: quote.oracleTimestamp },
      settled: { asset: requirements.asset, amount: requirements.amount, decimals: quote.tokenDecimals },
      spent,
      fxPremiumBps,
      transaction: result.transaction,
    });
    onReceipt?.(receipt);
  };
}

/** XLM and every Stellar asset contract publish 7 decimals. */
const SEND_ASSET_DECIMALS = 7;

/** Exact decimal for an amount in a token's smallest unit: ("527043", 7) is "0.0527043". */
function decimal(units: string, decimals: number): string {
  const digits = BigInt(units).toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${digits.slice(0, digits.length - decimals)}${fraction ? `.${fraction}` : ""}`;
}

/** Symbol of an asset Local402 accepts on that network, or the contract itself. */
function symbol(asset: string, network: string): string {
  if (network !== "stellar:pubnet" && network !== "stellar:testnet") return asset;
  const { xlm, eurc } = fxNetwork(network);
  return asset === xlm ? "XLM" : asset === eurc ? "EURC" : asset;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
/** RFC 4180 quoting, plus the guard a spreadsheet needs: a cell starting with `=` is a formula, not text. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const RECEIPT_CSV_COLUMNS = [
  "id", "paid_at", "resource", "local_amount", "currency", "usd_per_unit", "rate_source", "oracle_time",
  "usdc_received", "paid_asset", "paid_amount", "fx_premium_bps", "scheme", "network", "payer", "pay_to", "transaction",
] as const;

/** One row per receipt, amounts as exact decimals and times in ISO 8601, ready for a spreadsheet. */
export function receiptsToCsv(receipts: Receipt[]): string {
  const rows = receipts.map((r) => {
    const received = decimal(r.settled.amount, r.settled.decimals);
    return [
      r.id,
      r.paidAt,
      r.resource,
      r.local.amount,
      r.local.currency,
      r.rate.usdPerUnit,
      r.rate.source,
      new Date(r.rate.oracleTimestamp * 1000).toISOString(),
      received,
      r.spent ? symbol(r.spent.asset, r.network) : "USDC",
      r.spent ? decimal(r.spent.amount, SEND_ASSET_DECIMALS) : received,
      r.fxPremiumBps ?? "",
      r.scheme,
      r.network,
      r.payer ?? "",
      r.payTo,
      r.transaction,
    ]
      .map(csvCell)
      .join(",");
  });
  return `${[RECEIPT_CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

/** The receipts as stored, newest first. */
export function receiptsToJson(receipts: Receipt[]): string {
  return JSON.stringify(receipts, null, 2);
}

/**
 * Request handler that serves the store as JSON or as a CSV download. It takes Node's request and
 * response, so it mounts on Express as is: `app.get("/receipts.csv", receiptsHandler(store, "csv"))`.
 */
export function receiptsHandler(store: ReceiptStore, format: "json" | "csv" = "json") {
  if (format !== "json" && format !== "csv") throw new Local402Error("INVALID_CONFIG", `format must be json or csv, got ${format}.`);
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let receipts: Receipt[];
    try {
      receipts = await store.list();
    } catch {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "receipts are unavailable" }));
      return;
    }
    if (format === "csv") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="local402-receipts.csv"' });
      res.end(receiptsToCsv(receipts));
    } else {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(receiptsToJson(receipts));
    }
  };
}
