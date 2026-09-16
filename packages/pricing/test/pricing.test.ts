import { describe, expect, it, vi } from "vitest";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { AssetAmount } from "@x402/core/types";
import { localPrice, parseLocalPrice, quoteLocalPrice, UfRateSource, type FiatRateSource } from "../src/index.js";
import { chileDate, firstUf, parseSiiUf } from "../src/uf.js";
import { medianRecord, recentRun } from "../src/oracle.js";

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
  it("returns a USDC requirement with the quote attached and keeps offering it for half its TTL", async () => {
    const oracle = fixedOracle(CLP_RATE);
    let now = NOW;
    const price = localPrice("50 CLP", { network: "stellar:testnet", oracle, now: () => now });

    const first = await price({} as never);
    expect(first).toMatchObject({
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "527043",
      extra: { local402: { currency: "CLP", localAmount: "50" } },
    });

    // A payer who gets the quote now still has half the TTL to sign and retry before it expires.
    now += 30;
    expect(await price({} as never)).toEqual(first);
    expect(oracle.calls).toBe(1);

    now += 1;
    await price({} as never);
    expect(oracle.calls).toBe(2);
  });

  it("honors a signed quote on the paid retry, even from another instance with a newer rate", async () => {
    const issuer = localPrice("50 CLP", { network: "stellar:testnet", oracle: fixedOracle(CLP_RATE), now: () => NOW, quoteSecret: "s" });
    const other = localPrice("50 CLP", { network: "stellar:testnet", oracle: fixedOracle(CLP_RATE * 2n), now: () => NOW + 30, quoteSecret: "s" });
    const offered = (await issuer({} as never)) as { asset: string; amount: string; extra: { local402: Record<string, unknown> } };
    expect(offered.extra.local402.signature).toMatch(/^[0-9a-f]{64}$/);

    const retry = (accepted: object) =>
      ({ paymentHeader: encodePaymentSignatureHeader({ x402Version: 2, accepted, payload: {} } as never) }) as never;
    const accepted = { scheme: "exact", network: "stellar:testnet", payTo: "G", maxTimeoutSeconds: 60, ...offered };
    expect(await other(retry(accepted))).toEqual(offered);

    // A cheaper amount, a quote for another price or an unsigned quote gets a fresh quote instead.
    const fresh = await other({} as never);
    expect(fresh).not.toEqual(offered);
    expect(await other(retry({ ...accepted, amount: "1" }))).toEqual(fresh);
    expect(await other(retry({ ...accepted, extra: { local402: { ...offered.extra.local402, localAmount: "5" } } }))).toEqual(fresh);
    const tampered = { ...offered.extra.local402, tokenAmount: "1" };
    expect(await other(retry({ ...accepted, amount: "1", extra: { local402: tampered } }))).toEqual(fresh);
  });

  it("does not honor an expired signed quote", async () => {
    let now = NOW;
    const price = localPrice("50 CLP", { network: "stellar:testnet", oracle: fixedOracle(CLP_RATE), now: () => now, quoteSecret: "s" });
    const offered = (await price({} as never)) as AssetAmount;
    now += 61;
    const header = encodePaymentSignatureHeader({ x402Version: 2, accepted: { scheme: "exact", network: "stellar:testnet", payTo: "G", maxTimeoutSeconds: 60, ...offered }, payload: {} } as never);
    const retried = (await price({ paymentHeader: header } as never)) as unknown as { extra: { local402: { expiresAt: number } } };
    expect(retried.extra.local402.expiresAt).toBe(now + 60);
  });
});

describe("medianRecord", () => {
  it("ignores a single outlier tick and keeps the latest timestamp", () => {
    // Real CLP prints from Reflector mainnet, including a 0.65% outlier.
    const records = [
      { price: 105408496043n, timestamp: 1789447200n },
      { price: 105408490439n, timestamp: 1789446900n },
      { price: 104719706665n, timestamp: 1789446600n },
      { price: 105408494990n, timestamp: 1789446300n },
      { price: 105408496273n, timestamp: 1789447500n },
    ];
    expect(medianRecord(records)).toEqual({ price: 105408494990n, timestamp: 1789447500 });
    expect(medianRecord(records.slice(0, 2)).price).toBe(105408493241n);
  });
});

describe("recentRun", () => {
  it("cuts the history at a gap, so the median stays inside one run of periods", () => {
    const records = [
      { price: 3n, timestamp: 1789447500n },
      { price: 1n, timestamp: 1789447200n },
      // A missing period: everything older belongs to a different stretch of the day.
      { price: 100n, timestamp: 1789445400n },
      { price: 200n, timestamp: 1789445100n },
    ];
    expect(recentRun(records).map((r) => r.price)).toEqual([3n, 1n]);
    expect(medianRecord(recentRun(records)).price).toBe(2n);
  });

  it("keeps an evenly spaced history whole, newest first", () => {
    const records = [
      { price: 1n, timestamp: 1789446900n },
      { price: 2n, timestamp: 1789447500n },
      { price: 3n, timestamp: 1789447200n },
    ];
    expect(recentRun(records).map((r) => r.price)).toEqual([2n, 3n, 1n]);
  });
});

describe("quoteLocalPrice guards", () => {
  it("refuses a rate a feed reports as zero", async () => {
    await expect(quoteLocalPrice("50 CLP", { oracle: fixedOracle(0n), now: () => NOW })).rejects.toThrow(/positive price/);
  });

  it("refuses a rate dated in the future", async () => {
    await expect(quoteLocalPrice("50 CLP", { oracle: fixedOracle(CLP_RATE, NOW + 5_000), now: () => NOW })).rejects.toThrow(/in the future/);
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
    // 40934.58 CLP * 0.00105408590567 USD/CLP = 43.14856383252106... USD, rounded up like every
    // other conversion here so the seller is never paid less than the price.
    expect(rate).toMatchObject({ decimals: 14, timestamp: NOW - 60, source: "uf-test:uf*test" });
    expect(rate.usdPerUnit).toBe(4314856383252107n);
    // The CLP timestamp says nothing about which day's UF this is, so the rate carries the day too.
    expect(rate.valueDate).toBe(chileDate());

    // 0.01 UF = 0.4314856383... USD, rounded up to USDC base units
    const quote = await quoteLocalPrice("0.01 UF", { oracle, now: () => NOW });
    expect(quote.tokenAmount).toBe("4314857");
    await oracle.getRate("CLF");
    expect(lookups).toBe(1);
  });

  it("keeps the last UF value when the source goes down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
      let down = false;
      const oracle = new UfRateSource(fixedOracle(CLP_RATE), async () => {
        if (down) throw new Error("fetch failed");
        return { clp: "40934.58", source: "uf-test" };
      });
      const first = await oracle.getRate("CLF");
      down = true;
      vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
      expect((await oracle.getRate("CLF")).usdPerUnit).toBe(first.usdPerUnit);
      vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
      await expect(oracle.getRate("CLF")).rejects.toThrow("fetch failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a day's UF from the SII yearly table", () => {
    const html = `<div class='meses' id='mes_agosto'><table><tr><th width='40'><strong>15</strong></th>
      <td width='200'>40.100,00</td></tr></table></div>
      <div class='meses' id='mes_septiembre'><table><tr>
      <th width='40'><strong>5</strong></th>
      <td width='200'>40.880,36</td>
      <th width='40'><strong>15</strong></th>
      <td width='200'>40.934,58</td></tr></table></div>`;
    expect(parseSiiUf(html, "2026-09-15")).toBe("40934.58");
    expect(parseSiiUf(html, "2026-09-05")).toBe("40880.36");
    expect(parseSiiUf(html, "2026-08-15")).toBe("40100.00");
    expect(parseSiiUf(html, "2026-10-01")).toBeUndefined();
  });

  it("falls back to the next UF source", async () => {
    const down = async () => {
      throw new Error("sii down");
    };
    await expect(firstUf(down, async () => ({ clp: "1", source: "b" }))()).resolves.toEqual({ clp: "1", source: "b" });
    await expect(firstUf(down, down)()).rejects.toThrow("No UF source available: sii down; sii down");
  });

  it("passes other currencies through", async () => {
    const oracle = new UfRateSource(fixedOracle(CLP_RATE), async () => {
      throw new Error("should not be called");
    });
    expect((await oracle.getRate("CLP")).usdPerUnit).toBe(CLP_RATE);
  });
});
