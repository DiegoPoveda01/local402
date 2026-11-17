import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettleResultContext } from "@x402/core/server";
import { fxNetwork } from "@local402/fx";
import {
  FileReceiptStore,
  MemoryReceiptStore,
  RECEIPT_CSV_COLUMNS,
  receiptsHandler,
  receiptsToCsv,
  receiptsToJson,
  recordReceipts,
  type Receipt,
  type ReceiptStore,
} from "../src/index.js";

const { xlm, eurc } = fxNetwork("stellar:testnet");
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAYER = "GAMEBKSUXN7JVQDGSAIX2ATSZUISQIC6RZVEGFYYVK52236KIECWOPXC";
const PAY_TO = "GBM4GPHHCXQTGV3HXXN6CGPP3T27V4PYGYOS5QHZJ5DKBHYDSZRQYLSF";
const ORACLE_TIME = 1_763_300_000;

/** What `onAfterSettle` receives for a 50 CLP payment, by USDC or through exact-fx. */
function settled({ scheme = "exact", spent, quote = true, tx = "a".repeat(64) }: { scheme?: string; spent?: [string, string]; quote?: boolean; tx?: string } = {}) {
  return {
    paymentPayload: { resource: { url: "https://local402.xyz/indicadores" } },
    requirements: {
      scheme,
      network: "stellar:testnet",
      asset: USDC,
      amount: "527043",
      payTo: PAY_TO,
      extra: quote
        ? { local402: { currency: "CLP", localAmount: "50", usdPerUnit: "0.00105408590567", tokenAmount: "527043", tokenDecimals: 7, oracleSource: "reflector:test", oracleTimestamp: ORACLE_TIME, expiresAt: ORACLE_TIME + 60 } }
        : {},
    },
    result: { success: true, transaction: tx, network: "stellar:testnet", payer: PAYER, extra: spent && { sendAsset: spent[0], sendAmount: spent[1] } },
  } as unknown as SettleResultContext;
}

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "local402-receipts-"));
  dirs.push(dir);
  return join(dir, "books", "receipts.json");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The same contract holds for every store. */
describe.each([
  ["MemoryReceiptStore", () => new MemoryReceiptStore()],
  ["FileReceiptStore", () => new FileReceiptStore(tempFile())],
])("%s", (_name, make: () => ReceiptStore) => {
  it("numbers receipts in order and lists them newest first", async () => {
    const store = make();
    const record = recordReceipts(store);
    await record(settled({ tx: "1".repeat(64) }));
    await record(settled({ tx: "2".repeat(64) }));
    const receipts = await store.list();
    expect(receipts.map((r) => [r.id, r.transaction])).toEqual([["000002", "2".repeat(64)], ["000001", "1".repeat(64)]]);
  });

  it("records the seller's price, the rate and its oracle time, the USDC received, payer, scheme and transaction", async () => {
    const store = make();
    await recordReceipts(store)(settled());
    const [receipt] = await store.list();
    expect(receipt).toMatchObject({
      resource: "https://local402.xyz/indicadores",
      scheme: "exact",
      network: "stellar:testnet",
      payer: PAYER,
      payTo: PAY_TO,
      local: { amount: "50", currency: "CLP" },
      rate: { usdPerUnit: "0.00105408590567", source: "reflector:test", oracleTimestamp: ORACLE_TIME },
      settled: { asset: USDC, amount: "527043", decimals: 7 },
      transaction: "a".repeat(64),
    });
    expect(receipt.spent).toBeUndefined();
    expect(Date.parse(receipt.paidAt)).not.toBeNaN();
  });
});

describe("FileReceiptStore", () => {
  it("keeps receipts across restarts, creating the folder on the first sale", async () => {
    const file = tempFile();
    await recordReceipts(new FileReceiptStore(file))(settled({ tx: "1".repeat(64) }));
    const reopened = new FileReceiptStore(file);
    await recordReceipts(reopened)(settled({ tx: "2".repeat(64) }));
    expect((await reopened.list()).map((r) => r.id)).toEqual(["000002", "000001"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(2);
  });

  it("refuses a file it cannot read instead of overwriting the books with the next sale", () => {
    const broken = tempFile();
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(broken, "{ not json");
    expect(() => new FileReceiptStore(broken)).toThrow(SyntaxError);
    writeFileSync(broken, "{}");
    expect(() => new FileReceiptStore(broken)).toThrow(expect.objectContaining({ code: "INVALID_CONFIG" }));
    expect(readFileSync(broken, "utf8")).toBe("{}");
  });
});

describe("recordReceipts", () => {
  it("records what an exact-fx payer spent and the swap's premium over the oracle", async () => {
    const store = new MemoryReceiptStore();
    const fxPremium = vi.fn(async () => 42);
    await recordReceipts(store, { fxPremium })(settled({ scheme: "exact-fx", spent: [xlm, "31250000"] }));
    const [receipt] = await store.list();
    expect(fxPremium).toHaveBeenCalledWith({ asset: xlm, amount: "31250000" }, "527043");
    expect(receipt).toMatchObject({ scheme: "exact-fx", spent: { asset: xlm, amount: "31250000" }, fxPremiumBps: 42 });
  });

  it("keeps the receipt when the premium cannot be priced", async () => {
    const store = new MemoryReceiptStore();
    await recordReceipts(store, { fxPremium: async () => { throw new Error("oracle down"); } })(settled({ scheme: "exact-fx", spent: [eurc, "450000"] }));
    const [receipt] = await store.list();
    expect(receipt.spent).toEqual({ asset: eurc, amount: "450000" });
    expect(receipt.fxPremiumBps).toBeUndefined();
  });

  it("skips payments without a Local402 quote and announces each stored receipt", async () => {
    const store = new MemoryReceiptStore();
    const onReceipt = vi.fn();
    const record = recordReceipts(store, { onReceipt });
    await record(settled({ quote: false }));
    expect(await store.list()).toEqual([]);
    await record(settled());
    expect(onReceipt).toHaveBeenCalledWith((await store.list())[0]);
  });
});

async function sampleStore(): Promise<MemoryReceiptStore> {
  const store = new MemoryReceiptStore();
  const record = recordReceipts(store, { fxPremium: async () => 87 });
  await record(settled({ tx: "1".repeat(64) }));
  await record(settled({ scheme: "exact-fx", spent: [xlm, "31250000"], tx: "2".repeat(64) }));
  await record(settled({ scheme: "exact-fx", spent: [eurc, "4500000"], tx: "3".repeat(64) }));
  return store;
}
const sample = async (): Promise<Receipt[]> => (await sampleStore()).list();

describe("receiptsToCsv", () => {
  it("writes one row per receipt with exact amounts, symbols and the oracle time", async () => {
    const receipts = await sample();
    const lines = receiptsToCsv(receipts).split("\r\n");
    expect(lines[0]).toBe(RECEIPT_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(receipts.length + 2); // header, rows and the final line break
    const rows = lines.slice(1, -1).map((line) => Object.fromEntries(line.split(",").map((cell, i) => [RECEIPT_CSV_COLUMNS[i], cell])));
    expect(rows.map((r) => [r.id, r.paid_asset, r.paid_amount, r.fx_premium_bps])).toEqual([
      ["000003", "EURC", "0.45", "87"],
      ["000002", "XLM", "3.125", "87"],
      ["000001", "USDC", "0.0527043", ""],
    ]);
    expect(rows[2]).toMatchObject({
      local_amount: "50",
      currency: "CLP",
      usd_per_unit: "0.00105408590567",
      rate_source: "reflector:test",
      oracle_time: new Date(ORACLE_TIME * 1000).toISOString(),
      usdc_received: "0.0527043",
      scheme: "exact",
      network: "stellar:testnet",
      payer: PAYER,
      pay_to: PAY_TO,
      transaction: "1".repeat(64),
    });
  });

  it("quotes cells and keeps a spreadsheet from running one as a formula", async () => {
    const [receipt] = await sample();
    const csv = receiptsToCsv([{ ...receipt, resource: '=HYPERLINK("x"),1', spent: undefined, fxPremiumBps: -12 }]);
    expect(csv).toContain(`"'=HYPERLINK(""x""),1"`);
    expect(csv).toContain(",-12,");
  });

  it("writes only the header for an empty book", () => {
    expect(receiptsToCsv([])).toBe(`${RECEIPT_CSV_COLUMNS.join(",")}\r\n`);
  });
});

describe("receiptsToJson", () => {
  it("round-trips the receipts as stored", async () => {
    const receipts = await sample();
    expect(JSON.parse(receiptsToJson(receipts))).toEqual(receipts);
  });
});

describe("receiptsHandler", () => {
  async function serve(store: ReceiptStore, format?: "json" | "csv") {
    const server = createServer(receiptsHandler(store, format));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    } finally {
      server.close();
    }
  }

  it("serves the receipts as JSON and as a CSV download", async () => {
    const store = await sampleStore();
    const json = await serve(store);
    expect(json.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await json.json()).toEqual(await store.list());
    const csv = await serve(store, "csv");
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="local402-receipts.csv"');
    expect(await csv.text()).toBe(receiptsToCsv(await store.list()));
  });

  it("answers 503 when the store fails, and refuses an unknown format", async () => {
    const down: ReceiptStore = { add: async () => { throw new Error("down"); }, list: async () => { throw new Error("down"); } };
    const res = await serve(down, "csv");
    expect(res.status).toBe(503);
    expect(() => receiptsHandler(down, "xml" as never)).toThrow(expect.objectContaining({ code: "INVALID_CONFIG" }));
  });
});
