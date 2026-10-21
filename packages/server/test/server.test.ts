import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { DynamicPrice, PaymentOption } from "@x402/core/http";
import type { FiatRateSource } from "@local402/pricing";
import { local402Server, localRoute } from "../src/index.js";
import { localToolPayment } from "../src/mcp.js";

// 1 CLP = 0.00105408590567 USD, so 50 CLP = 527043 USDC units.
const oracle: FiatRateSource = {
  async getRate() {
    return { usdPerUnit: 105408590567n, decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: "test" };
  },
};
const payTo = Keypair.random().publicKey();
const quoteSecret = "test-secret-that-is-32-chars-long";
const invalid = expect.objectContaining({ code: "INVALID_CONFIG" });

describe("localRoute", () => {
  it("offers exact and exact-fx from one shared quote", async () => {
    const route = localRoute("50 CLP", { payTo, oracle, quoteSecret, description: "data" });
    const [exact, fx] = route.accepts as PaymentOption[];
    expect(route).toMatchObject({ mimeType: "application/json", description: "data" });
    expect([exact.scheme, fx.scheme]).toEqual(["exact", "exact-fx"]);
    expect(exact).toMatchObject({ network: "stellar:testnet", payTo });
    expect(exact.price).toBe(fx.price);
    const price = await (exact.price as DynamicPrice)({} as never);
    expect(price).toMatchObject({ amount: "527043", extra: { local402: { currency: "CLP", signature: expect.any(String) } } });
  });

  it("rejects a route that could not be paid, when it is declared", () => {
    expect(() => localRoute("50 CLP", { payTo: "GABC", oracle, quoteSecret })).toThrow(/payTo must be the Stellar address/);
    expect(() => localRoute("50 CLP", { payTo: Keypair.random().secret(), oracle, quoteSecret })).toThrow(invalid);
    expect(() => localRoute("50 CLP", { payTo, oracle, quoteSecret, network: "stellar:mainnet" as never })).toThrow(invalid);
    expect(() => localRoute("50 pesos", { payTo, oracle, quoteSecret })).toThrow(expect.objectContaining({ code: "INVALID_PRICE" }));
    expect(() => localRoute("50 CLP", { payTo, oracle, quoteSecret: "short" })).toThrow(expect.objectContaining({ code: "QUOTE_SECRET_WEAK" }));
    expect(() => localRoute("50 CLP", { payTo, oracle, quoteSecret: false })).not.toThrow();
  });

  it("never repeats a secret key passed as payTo, since the message ends up in logs", () => {
    const secret = Keypair.random().secret();
    expect(() => localRoute("50 CLP", { payTo: secret, oracle, quoteSecret })).toThrow(/got a secret key \(not shown\)/);
    expect(() => localRoute("50 CLP", { payTo: secret, oracle, quoteSecret })).not.toThrow(secret);
  });
});

describe("local402Server", () => {
  it("rejects a facilitator URL or network it cannot use", () => {
    expect(() => local402Server("localhost:4022")).toThrow(/facilitatorUrl must be an http\(s\) URL/);
    expect(() => local402Server("https://facilitator.test", "stellar:mainnet" as never)).toThrow(invalid);
    expect(() => local402Server("https://facilitator.test", "stellar:pubnet")).not.toThrow();
    // A facilitator URL can carry an API key, so the error does not repeat it.
    expect(() => local402Server("ftp://facilitator.test/?key=hunter2")).toThrow(invalid);
    expect(() => local402Server("ftp://facilitator.test/?key=hunter2")).not.toThrow(/hunter2/);
  });
});

describe("localToolPayment", () => {
  it("rejects a missing server or tool name", () => {
    const server = local402Server();
    expect(() => localToolPayment(undefined as never, "20 CLP", { toolName: "t", payTo, oracle, quoteSecret })).toThrow(/needs the resource server/);
    expect(() => localToolPayment(server, "20 CLP", { toolName: "", payTo, oracle, quoteSecret })).toThrow(/toolName/);
    expect(typeof localToolPayment(server, "20 CLP", { toolName: "t", payTo, oracle, quoteSecret })).toBe("function");
  });
});
