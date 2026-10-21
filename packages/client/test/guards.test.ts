import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import type { FiatRateSource } from "@local402/pricing";
import { Local402Client, SpendingBudget, type Price } from "../src/index.js";

/**
 * The guards in `pay`: what is checked before anything is signed and sent, and what happens to a
 * budget reservation when the payment does not go through. Signing needs a Soroban RPC, so the
 * stock `exact` scheme returns a dummy payload here.
 */

// 1 CLP = 0.00105408590567 USD, so 50 CLP = 527043 USDC units.
const oracle: FiatRateSource = {
  async getRate() {
    return { usdPerUnit: 105408590567n, decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: "test" };
  },
};
const URL = "http://seller.test/data";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const payTo = Keypair.random().publicKey();
const client = (options: { maxPrice?: string; budget?: SpendingBudget; oracle?: FiatRateSource } = {}) =>
  new Local402Client({ secret: Keypair.random().secret(), oracle, ...options });

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
/** A 402 for `amount` USDC units, quoted as 50 CLP unless `local402` is false. */
function required(amount: string, local402: object | false = { localAmount: "50", currency: "CLP", usdPerUnit: "0", oracleSource: "seller" }) {
  const accepted = { scheme: "exact", network: "stellar:testnet", asset: USDC, amount, payTo, maxTimeoutSeconds: 60, extra: local402 ? { local402 } : {} };
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encode({ x402Version: 2, resource: { url: URL }, accepts: [accepted] }) } });
}
const settled = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "PAYMENT-RESPONSE": encode({ success: true, transaction: "ab".repeat(32), network: "stellar:testnet", payer: payTo }) },
  });

/** Serves the responses in order and counts the paid retries. */
function seller(...responses: (Response | Error | (() => Promise<Response>))[]) {
  const paid: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (signature) paid.push(signature);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next!;
  });
  return paid;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function signsDummy() {
  vi.spyOn(ExactStellarScheme.prototype, "createPaymentPayload").mockResolvedValue({ x402Version: 2, payload: { transaction: "AAAA" } });
}

describe("Local402Client.checkPrice without a local quote", () => {
  const plain = (amount: string): Price => ({ url: URL, amount, asset: USDC, scheme: "exact", payTo });

  it("still caps a plain x402 price, naming it in USDC units", async () => {
    // 50 CLP = 527043 units: the cap is the only check a seller without extra.local402 gets.
    await expect(client({ maxPrice: "50 CLP" }).checkPrice(plain("527043"))).resolves.toBeUndefined();
    await expect(client({ maxPrice: "50 CLP" }).checkPrice(plain("527044"))).rejects.toMatchObject({
      code: "REFUSED_MAX_PRICE",
      message: "Refusing to pay 527044 USDC units: above the 50 CLP limit",
    });
  });

  it("refuses to judge a quote when its own oracle is stale, instead of trusting the seller", async () => {
    const stale: FiatRateSource = { getRate: async () => ({ usdPerUnit: 105408590567n, decimals: 14, timestamp: 0, source: "old" }) };
    const price: Price = { ...plain("527043"), local: { amount: "50", currency: "CLP", usdPerUnit: "0", oracleSource: "seller" } };
    await expect(client({ oracle: stale }).checkPrice(price)).rejects.toMatchObject({ code: "ORACLE_STALE" });
  });
});

describe("Local402Client.pay guards", () => {
  it("returns a free resource without paying", async () => {
    seller(new Response(JSON.stringify({ hello: "world" }), { status: 200 }));
    await expect(client().pay(URL)).resolves.toEqual({ free: true, body: { hello: "world" } });
  });

  it("does not read a seller that is down as free", async () => {
    seller(new Response("upstream timeout", { status: 504 }), new Response("", { status: 500 }));
    await expect(client().pay(URL)).rejects.toMatchObject({
      code: "RESOURCE_UNAVAILABLE",
      message: "The resource answered HTTP 504, not a price: upstream timeout",
    });
    await expect(client().quote(URL)).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE", message: expect.stringContaining("HTTP 500") });
  });

  it("pays a fair quote and keeps it on the budget", async () => {
    signsDummy();
    const budget = new SpendingBudget("100 CLP");
    const paid = seller(required("527043"), settled());
    const result = await client({ budget }).pay(URL);
    expect(result).toMatchObject({
      payWith: "USDC",
      transaction: "ab".repeat(32),
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${"ab".repeat(32)}`,
      price: { amount: "527043", local: { amount: "50", currency: "CLP" } },
      body: { ok: true },
    });
    expect(paid).toHaveLength(1);
    expect(budget.spent).toBe(527043n);
  });

  it("sends nothing when the seller overcharges its own quote", async () => {
    signsDummy();
    const paid = seller(required("600000"));
    await expect(client().pay(URL)).rejects.toMatchObject({ code: "REFUSED_OVERCHARGE" });
    expect(paid).toHaveLength(0);
  });

  it("gives the reservation back when the seller refuses the payment, with its reason on one bounded line", async () => {
    signsDummy();
    const budget = new SpendingBudget("100 CLP");
    const reason = `insufficient_funds\n\u001b[31m${"x".repeat(400)}`;
    const refused = new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encode({ x402Version: 2, error: reason, accepts: [] }) } });
    seller(required("527043"), refused);
    const error = (await client({ budget }).pay(URL).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ code: "PAYMENT_FAILED", message: expect.stringMatching(/^Payment failed \(HTTP 402\): insufficient_funds \[31mx+…$/) });
    expect(error.message.length).toBeLessThan(340);
    expect(budget.spent).toBe(0n);
  });

  it("gives the reservation back when the paid request never reaches the seller", async () => {
    signsDummy();
    const budget = new SpendingBudget("100 CLP");
    seller(required("527043"), new TypeError("fetch failed"));
    await expect(client({ budget }).pay(URL)).rejects.toThrow("fetch failed");
    expect(budget.spent).toBe(0n);
  });

  it("lets only as many concurrent payments through as the budget covers", async () => {
    signsDummy();
    // 100 CLP covers one 50 CLP payment and not two at 60 CLP each (632452 units).
    const budget = new SpendingBudget("100 CLP");
    const quote = { localAmount: "60", currency: "CLP", usdPerUnit: "0", oracleSource: "seller" };
    const paid = seller(required("632452", quote), required("632452", quote), settled(), settled());
    const results = await Promise.allSettled([client({ budget }).pay(URL), client({ budget }).pay(URL)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "REFUSED_BUDGET" } });
    expect(paid).toHaveLength(1);
    expect(budget.spent).toBe(632452n);
  });
});
