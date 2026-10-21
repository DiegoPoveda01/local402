import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { quoteLocalPrice, ReflectorFiatOracle } from "../src/index.js";
import type { OracleRecord } from "../src/oracle.js";

/** What Reflector returns, without the RPC: `call` is the one method that simulates. */

const NOW = 1_800_000_000;
const CONTRACT = "CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC";
const record = (price: bigint, age: number): OracleRecord => ({ price, timestamp: BigInt(NOW - age) });
// Five-minute CLP prints, newest first, as `prices` returns them.
const history = [record(105408496273n, 0), record(105408496043n, 300), record(105408490439n, 600), record(104719706665n, 900), record(105408494990n, 1200)];

type Call = (method: string, ...args: unknown[]) => Promise<unknown>;
function reflector(answers: { prices?: OracleRecord[] | null; lastprice?: OracleRecord | null }) {
  const calls: string[] = [];
  const call = vi.spyOn(ReflectorFiatOracle.prototype as unknown as { call: Call }, "call").mockImplementation(async (method) => {
    calls.push(method);
    if (method === "decimals") return 14;
    return method === "prices" ? answers.prices : answers.lastprice;
  });
  return { oracle: new ReflectorFiatOracle(), calls, call };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ReflectorFiatOracle reads", () => {
  it("prices from the median of the last prints and says it is smoothed", async () => {
    const { oracle } = reflector({ prices: history });
    // The 0.65% outlier print (104719706665) does not set the price.
    expect(await oracle.getRate("CLP")).toEqual({ usdPerUnit: 105408494990n, decimals: 14, timestamp: NOW, source: `reflector:${CONTRACT}` });
  });

  it("drops the prints on the far side of a gap", async () => {
    const gapped = [record(3n, 0), record(1n, 300), record(100n, 2100), record(200n, 2400)];
    const { oracle } = reflector({ prices: gapped });
    expect((await oracle.getRate("CLP")).usdPerUnit).toBe(2n);
  });

  it("labels a rate built from one print, when a gap right after the newest leaves nothing to smooth with", async () => {
    const { oracle } = reflector({ prices: [record(7n, 0), record(1n, 3000), record(1n, 3300), record(1n, 3600)] });
    expect(await oracle.getRate("CLP")).toMatchObject({ usdPerUnit: 7n, source: `reflector:${CONTRACT}#single` });
  });

  it("falls back to the last price when the history has a gap, and labels it a single print", async () => {
    // Reflector's `prices` answers null when any of the requested periods is missing.
    const { oracle, calls } = reflector({ prices: null, lastprice: record(105408496273n, 30) });
    expect(await oracle.getRate("CLP")).toMatchObject({ usdPerUnit: 105408496273n, timestamp: NOW - 30, source: `reflector:${CONTRACT}#single` });
    expect(calls).toEqual(["decimals", "prices", "lastprice"]);
  });

  it("refuses a currency with no prints at all", async () => {
    const { oracle } = reflector({ prices: [], lastprice: null });
    await expect(oracle.getRate("XYZ")).rejects.toMatchObject({ code: "ORACLE_NO_RATE", message: expect.stringMatching(/no rate for XYZ/) });
  });

  it("refuses a feed that reports zero", async () => {
    const { oracle } = reflector({ prices: [record(0n, 0), record(0n, 300), record(0n, 600)] });
    await expect(oracle.getRate("CLP")).rejects.toMatchObject({ code: "ORACLE_INVALID_PRICE" });
  });

  it("answers USD at par without reading a feed, and reads the decimals once", async () => {
    const { oracle, calls } = reflector({ prices: history });
    expect(await oracle.getRate("USD")).toMatchObject({ usdPerUnit: 10n ** 14n, decimals: 14, source: "fixed" });
    await oracle.getRate("CLP");
    expect(calls).toEqual(["decimals", "prices"]);
  });
});

describe("ReflectorFiatOracle when the RPC fails", () => {
  it("serves the last rate read for ten minutes, then gives up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { oracle, call } = reflector({ prices: history });
    const good = await oracle.getRate("CLP");
    call.mockRejectedValue(new Error("rpc down"));
    vi.setSystemTime((NOW + 9 * 60) * 1000);
    expect(await oracle.getRate("CLP")).toBe(good);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CLP unavailable/), "rpc down");
    vi.setSystemTime((NOW + 11 * 60) * 1000);
    await expect(oracle.getRate("CLP")).rejects.toThrow("rpc down");
    // Another currency was never read, so there is nothing to fall back to.
    await expect(oracle.getRate("EUR")).rejects.toThrow("rpc down");
  });

  it("keeps the print's own timestamp on a reused rate, so a quote still refuses it once stale", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const old = [record(105408496273n, 800), record(105408496043n, 1100), record(105408490439n, 1400)];
    const { oracle, call } = reflector({ prices: old });
    await oracle.getRate("CLP");
    call.mockRejectedValue(new Error("rpc down"));
    // The print is 800 s old: fine at the default 900 s limit, refused at 600.
    await expect(quoteLocalPrice("50 CLP", { oracle, now: () => NOW })).resolves.toMatchObject({ oracleTimestamp: NOW - 800 });
    await expect(quoteLocalPrice("50 CLP", { oracle, now: () => NOW, maxOracleAgeSeconds: 600 })).rejects.toMatchObject({ code: "ORACLE_STALE" });
  });

  it("names a failed simulation", async () => {
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({ error: "HostError: contract trapped" } as never);
    await expect(new ReflectorFiatOracle().getRate("CLP")).rejects.toMatchObject({
      code: "ORACLE_UNAVAILABLE",
      message: "Reflector decimals simulation failed: HostError: contract trapped",
    });
  });

  it("stops waiting for a hung RPC after six seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockReturnValue(new Promise(() => {}));
    const refused = expect(new ReflectorFiatOracle().getRate("CLP")).rejects.toMatchObject({ code: "ORACLE_UNAVAILABLE", message: expect.stringMatching(/timed out after 6000ms/) });
    await vi.advanceTimersByTimeAsync(6_000);
    await refused;
  });
});
