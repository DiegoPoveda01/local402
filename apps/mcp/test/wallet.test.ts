import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { Price } from "@local402/client";
import type { FiatRateSource } from "@local402/pricing";
import { PaymentHistory, type Receipt } from "../src/history.js";
import { DEFAULT_LIMITS, parseLimits, type Limits } from "../src/limits.js";
import { AgentWallet } from "../src/wallet.js";

// 1 CLP = 0.00105408590567 USD, so 50 CLP = 527043 USDC units and 1 NGN is worth less than 1 CLP.
const rates: Record<string, bigint> = { CLP: 105408590567n, EUR: 115458117990386n, NGN: 65000000000n };
const oracle: FiatRateSource = {
  async getRate(currency) {
    return { usdPerUnit: rates[currency], decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: "test" };
  },
};

const price = (amount: string, local = { amount: "50", currency: "CLP" }): Price => ({
  url: "http://seller.test/data",
  local: { ...local, usdPerUnit: "0", oracleSource: "seller" },
  amount,
  asset: "USDC",
  scheme: "exact",
  payTo: "G...",
});

const receipt = (at: Date, usdcUnits: string): Receipt => ({
  at: at.toISOString(),
  url: "http://seller.test/data",
  network: "stellar:testnet",
  payWith: "USDC",
  usdcUnits,
  usdc: "0",
  transaction: "abc",
  explorerUrl: "https://stellar.expert/explorer/testnet/tx/abc",
});

const dirs: string[] = [];
const historyFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "local402-mcp-"));
  dirs.push(dir);
  return join(dir, "history.jsonl");
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const NOON = new Date(2026, 10, 16, 12);
const secret = Keypair.random().secret();
const wallet = (file: string, limits: Limits = DEFAULT_LIMITS, now = NOON) =>
  new AgentWallet({ secret, oracle }, limits, new PaymentHistory(file), "USDC", () => now);

describe("parseLimits", () => {
  it("defaults to low limits", () => {
    expect(parseLimits({})).toEqual({ payment: "500 CLP", day: "2000 CLP", total: "5000 CLP" });
  });

  it("reads limits per period, each in its own currency", () => {
    expect(parseLimits({ LIMITS: "5000 NGN/payment, 2000 CLP/day" })).toEqual({ payment: "5000 NGN", day: "2000 CLP", total: "5000 CLP" });
    expect(parseLimits({ MAX_PRICE: "100 CLP", BUDGET: "1 EUR", LIMITS: "20 EUR/total" })).toEqual({ payment: "100 CLP", day: "2000 CLP", total: "20 EUR" });
  });

  it("rejects an entry without a period", () => {
    expect(() => parseLimits({ LIMITS: "2000 CLP" })).toThrow(/must end in \/payment, \/day or \/total/);
    expect(() => parseLimits({ LIMITS: "2000 CLP/week" })).toThrow(/must end in/);
    expect(() => parseLimits({ LIMITS: "lots/day" })).toThrow();
  });
});

describe("AgentWallet limits", () => {
  it("refuses a payment over the per-payment limit, in another currency", async () => {
    const agent = wallet(historyFile(), { ...DEFAULT_LIMITS, payment: "5000 NGN" });
    // 5000 NGN = 32500000 units: 50 CLP fits, 5 EUR (57729059 units) does not.
    await expect(agent.check(price("527043"))).resolves.toBeUndefined();
    await expect(agent.check(price("57729059", { amount: "5", currency: "EUR" }))).rejects.toMatchObject({ code: "REFUSED_MAX_PRICE" });
  });

  it("refuses a payment over the daily limit and allows it again the next day", async () => {
    const file = historyFile();
    const agent = wallet(file);
    // 2000 CLP = 21081719 units, room for 39 payments of 50 CLP: 38 made today, one more fits.
    for (let i = 0; i < 38; i++) agent.history.add(receipt(new Date(2026, 10, 16, 9), "527043"));
    await expect(agent.check(price("527043"))).resolves.toBeUndefined();
    agent.history.add(receipt(new Date(2026, 10, 16, 10), "527043"));
    await expect(agent.check(price("527043"))).rejects.toMatchObject({ code: "REFUSED_BUDGET", message: expect.stringMatching(/2000 CLP budget/) });
    await expect(wallet(file, DEFAULT_LIMITS, new Date(2026, 10, 17, 0, 1)).check(price("527043"))).resolves.toBeUndefined();
  });

  it("keeps the limits after a restart", async () => {
    const file = historyFile();
    const before = wallet(file, { ...DEFAULT_LIMITS, total: "100 CLP" });
    before.history.add(receipt(new Date(2026, 10, 1), "527043"));
    before.history.add(receipt(new Date(2026, 10, 2), "527043"));
    await expect(before.check(price("527043"))).rejects.toMatchObject({ code: "REFUSED_BUDGET" });

    // A new process reads the same history file: the total limit is still spent, and so is today's.
    const after = wallet(file, { ...DEFAULT_LIMITS, total: "100 CLP" });
    expect(after.status().total).toEqual({ limit: "100 CLP", spentUsdc: "0.1054086" });
    await expect(after.check(price("527043"))).rejects.toMatchObject({ code: "REFUSED_BUDGET", message: expect.stringMatching(/100 CLP budget/) });
    const today = wallet(file);
    today.history.add(receipt(new Date(2026, 10, 16, 8), "21081718"));
    expect(wallet(file).status().daily.spentUsdc).toBe("2.1081718");
    await expect(wallet(file).check(price("527043"))).rejects.toMatchObject({ message: expect.stringMatching(/2000 CLP budget/) });
  });

  it("lists payments newest first", () => {
    const agent = wallet(historyFile());
    agent.history.add(receipt(new Date(2026, 10, 1), "1"));
    agent.history.add(receipt(new Date(2026, 10, 2), "2"));
    expect(agent.history.list().map((r) => r.usdcUnits)).toEqual(["2", "1"]);
    expect(agent.history.list(1).map((r) => r.usdcUnits)).toEqual(["2"]);
  });
});
