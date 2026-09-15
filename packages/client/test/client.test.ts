import { describe, expect, it } from "vitest";
import { Account, Contract, Keypair, nativeToScVal, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { PaymentPayload } from "@x402/core/types";
import { UfRateSource, type FiatRateSource } from "@local402/pricing";
import { fxMaxSend, Local402Client, SpendingBudget, type Price } from "../src/index.js";

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

  it("stops at a budget shared between clients", async () => {
    // 100 CLP = 1054086 units: one 50 CLP payment fits after another, a third does not.
    const budget = new SpendingBudget("100 CLP");
    const [usdc, xlm] = [0, 1].map(() => new Local402Client({ secret: Keypair.random().secret(), oracle, budget }));
    await expect(usdc.checkPrice(price("527043"))).resolves.toBeUndefined();
    budget.spent += 527043n;
    await expect(xlm.checkPrice(price("527043"))).resolves.toBeUndefined();
    budget.spent += 527043n;
    await expect(usdc.checkPrice(price("527043"))).rejects.toThrow(/exceed the 100 CLP budget/);
  });
});

describe("Local402Client.checkFxLeg", () => {
  // 1 XLM = 0.19161695781320 USD, so 527043 USDC units are worth 2750503 XLM units.
  const assetOracle: FiatRateSource = {
    async getRate(symbol) {
      const usdPerUnit = { XLM: 19161695781320n, EUR: 115458117990386n }[symbol]!;
      return { usdPerUnit, decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: `test:${symbol}` };
    },
  };
  const payer = (payWith: "XLM" | "EURC", maxFxPremiumBps?: number) =>
    new Local402Client({ secret: Keypair.random().secret(), oracle, assetOracle, payWith, maxFxPremiumBps });

  it("accepts a swap within the premium limit and reports it", async () => {
    // Soroswap mainnet quote plus 2% slippage: about 2.6% over the oracle.
    const fx = await payer("XLM").checkFxLeg("527043", 2_822_000n);
    expect(fx).toMatchObject({ oracleSend: "2750503", premiumBps: 259, oracleSource: "test:XLM" });
    // A pool pricing XLM above the oracle only helps the payer.
    expect((await payer("XLM").checkFxLeg("527043", 300_000n)).premiumBps).toBeLessThan(0);
  });

  it("refuses a swap that may spend too much of the send asset", async () => {
    // 527043 USDC units = 456480 EURC units at 1.1546 USD per euro; a pool pricing EURC at 0.74 USD asks ~56% more.
    await expect(payer("EURC").checkFxLeg("527043", 712_000n)).rejects.toThrow(/above the 456480 the oracle rate implies \(limit 5%\)/);
    await expect(payer("EURC", 6_000).checkFxLeg("527043", 712_000n)).resolves.toMatchObject({ premiumBps: 5597 });
  });

  it("reads maxSend from the signed FxPay call", () => {
    const address = (value: string) => nativeToScVal(value, { type: "address" });
    const from = Keypair.random().publicKey();
    const transaction = new TransactionBuilder(new Account(from, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(
        new Contract(FX).call("pay", address(from), address(FX), nativeToScVal(2_822_000n, { type: "i128" }), address(FX), nativeToScVal(527_043n, { type: "i128" }), address(from), nativeToScVal(1n, { type: "u64" })),
      )
      .setTimeout(60)
      .build();
    const payload = { payload: { transaction: transaction.toXDR() }, accepted: { network: "stellar:testnet" } } as unknown as PaymentPayload;
    expect(fxMaxSend(payload)).toBe(2_822_000n);
  });
});

const FX = "CDLIJ3SXAYQDCIO4GLS3OQPUKT6JTWICRDTOB3F5ESG5TWYKRRPJ6IUC";
