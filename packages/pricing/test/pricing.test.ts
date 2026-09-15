import { describe, expect, it } from "vitest";
import { localPrice, parseLocalPrice, quoteLocalPrice, UfRateSource, type FiatRateSource } from "../src/index.js";

// 1 USD = 948.6902 CLP  =>  1 CLP ≈ 0.00105408 USD (14 decimals, as Reflector publishes)
const CLP_RATE = 105408590567n;
const NOW = 1_800_000_000;

function fixedOracle(usdPerUnit: bigint, timestamp = NOW - 60): FiatRateSource & { calls: number } {
  return {
    calls: 0,
    async getRate() {
      this.calls++;
      return { usdPerUnit, decimals: 14, timestamp, source: "test" };
    },
  };
}

describe("parseLocalPrice", () => {
  it("parses amount and currency", () => {
    expect(parseLocalPrice("50 CLP")).toEqual({ amount: "50", currency: "CLP" });
    expect(parseLocalPrice(" 1.20 eur ")).toEqual({ amount: "1.20", currency: "EUR" });
    expect(parseLocalPrice("0.5 UF")).toEqual({ amount: "0.5", currency: "CLF" });
  });

  it("rejects malformed prices", () => {
    expect(() => parseLocalPrice("$50")).toThrow();
    expect(() => parseLocalPrice("50")).toThrow();
    expect(() => parseLocalPrice("-1 CLP")).toThrow();
  });
});

describe("quoteLocalPrice", () => {
  it("converts CLP to USDC base units, rounding up", async () => {
    const quote = await quoteLocalPrice("50 CLP", { oracle: fixedOracle(CLP_RATE), now: () => NOW });
    // 50 * 0.00105408590567 = 0.0527042952835 USDC -> 527043 stroops-of-USDC (7 decimals, ceil)
    expect(quote.tokenAmount).toBe("527043");
    expect(quote.currency).toBe("CLP");
    expect(quote.usdPerUnit).toBe("0.00105408590567");
    expect(quote.expiresAt).toBe(NOW + 60);
  });

  it("handles decimal local amounts", async () => {
    // 1 EUR = 1.15458117990386 USD; 1.20 EUR = 1.385497415884632 USD
    const quote = await quoteLocalPrice("1.20 EUR", { oracle: fixedOracle(115458117990386n), now: () => NOW });
    expect(quote.tokenAmount).toBe("13854975");
  });

  it("rejects stale oracle prices", async () => {
    const oracle = fixedOracle(CLP_RATE, NOW - 3600);
    await expect(quoteLocalPrice("50 CLP", { oracle, now: () => NOW })).rejects.toThrow(/stale/);
  });
});

describe("localPrice", () => {
  it("returns a USDC requirement with the quote attached and keeps it until expiry", async () => {
    const oracle = fixedOracle(CLP_RATE);
    let now = NOW;
    const price = localPrice("50 CLP", { network: "stellar:testnet", oracle, now: () => now });

    const first = await price({} as never);
    expect(first).toMatchObject({
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "527043",
      extra: { local402: { currency: "CLP", localAmount: "50" } },
    });

    now += 59;
    expect(await price({} as never)).toEqual(first);
    expect(oracle.calls).toBe(1);

    now += 1;
    await price({} as never);
    expect(oracle.calls).toBe(2);
  });
});

describe("UfRateSource", () => {
  it("prices UF as its CLP value times the CLP oracle rate", async () => {
    let lookups = 0;
    const oracle = new UfRateSource(fixedOracle(CLP_RATE), async () => {
      lookups++;
      return { clp: "40934.58", source: "uf-test" };
    });
    const rate = await oracle.getRate("CLF");
    // 40934.58 CLP * 0.00105408590567 USD/CLP = 43.14856383252106 USD
    expect(rate).toMatchObject({ decimals: 14, timestamp: NOW - 60, source: "uf-test:uf*test" });
    expect(rate.usdPerUnit).toBe(4314856383252106n);

    // 0.01 UF = 0.4314856383... USD, rounded up to USDC base units
    const quote = await quoteLocalPrice("0.01 UF", { oracle, now: () => NOW });
    expect(quote.tokenAmount).toBe("4314857");
    await oracle.getRate("CLF");
    expect(lookups).toBe(1);
  });

  it("passes other currencies through", async () => {
    const oracle = new UfRateSource(fixedOracle(CLP_RATE), async () => {
      throw new Error("should not be called");
    });
    expect((await oracle.getRate("CLP")).usdPerUnit).toBe(CLP_RATE);
  });
});
