import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { UfRateSource, type FiatRateSource } from "@local402/pricing";
import { Local402Client, type Price } from "../src/index.js";

// 1 CLP = 0.00105408590567 USD, so 50 CLP = 527043 USDC units.
const rates: Record<string, bigint> = { CLP: 105408590567n, EUR: 115458117990386n };
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

const client = (options: { maxPrice?: string; maxOverchargeBps?: number } = {}) =>
  new Local402Client({ secret: Keypair.random().secret(), oracle, ...options });

describe("Local402Client.checkPrice", () => {
  it("accepts a fair quote", async () => {
    await expect(client().checkPrice(price("527043"))).resolves.toBeUndefined();
  });

  it("refuses a seller rate that overcharges beyond the tolerance", async () => {
    await expect(client().checkPrice(price("537583"))).resolves.toBeUndefined(); // just under +2%
    await expect(client().checkPrice(price("540000"))).rejects.toThrow(/seller charges 540000/);
  });

  it("enforces the limit across currencies", async () => {
    // 500 CLP = 5270430 units: 0.05 EUR (577291) fits, 5 EUR (57729059) does not.
    const eur = price("577291", { amount: "0.05", currency: "EUR" });
    await expect(client({ maxPrice: "500 CLP" }).checkPrice(eur)).resolves.toBeUndefined();
    await expect(client({ maxPrice: "500 CLP" }).checkPrice(price("57729059", { amount: "5", currency: "EUR" }))).rejects.toThrow();
    await expect(client({ maxPrice: "40 CLP" }).checkPrice(price("527043"))).rejects.toThrow(/above the 40 CLP limit/);
  });

  it("caps prices in UF using the CLP rate", async () => {
    const withUf = new Local402Client({
      secret: Keypair.random().secret(),
      oracle: new UfRateSource(oracle, async () => ({ clp: "40000", source: "test" })),
      maxPrice: "1000 CLP",
    });
    // 0.01 UF = 400 CLP = 4216344 units; 0.05 UF = 2000 CLP, over the limit
    await expect(withUf.checkPrice(price("4216344", { amount: "0.01", currency: "CLF" }))).resolves.toBeUndefined();
    await expect(withUf.checkPrice(price("21081719", { amount: "0.05", currency: "CLF" }))).rejects.toThrow(/limit/);
  });
});
