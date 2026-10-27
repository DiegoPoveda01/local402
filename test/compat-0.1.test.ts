import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { AssetAmount, PaymentRequirements } from "@x402/core/types";
import { paymentMiddleware } from "@x402/express";
import { Local402Client } from "@local402/client";
import { createFacilitator, facilitatorConfig } from "@local402/facilitator";
import { FX_TESTNET, parseFxExtra } from "@local402/fx";
import { localPrice, type FiatRateSource } from "@local402/pricing";
import { local402Server, localRoute } from "@local402/server";
import { Local402Client as Client01 } from "local402-client-0.1";
import { parseFxExtra as parseFxExtra01 } from "local402-fx-0.1";
import { localPrice as localPrice01 } from "local402-pricing-0.1";
import { local402Server as local402Server01, localRoute as localRoute01 } from "local402-server-0.1";

/**
 * 1.0 against the 0.1 packages as published on npm (aliased devDependencies), with no network:
 * a fleet upgraded one instance at a time, and 0.1 and 1.0 sellers, clients and the 1.0 facilitator
 * mixed. Both versions pin @x402/* 2.25.0, so the x402 wire format is the same code; what is tested
 * here is Local402's part of it: the signed quote in `extra.local402` and the exact-fx `extra`.
 * Building the payment itself needs a Soroban RPC, so the paid retry carries a dummy transaction:
 * it shows the seller matched the payment to its quote and sent it on to /verify.
 */

const rate = (usdPerUnit: bigint): FiatRateSource => ({
  async getRate() {
    return { usdPerUnit, decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: "test" };
  },
});
// 1 CLP = 0.00105408590567 USD, so 50 CLP = 527043 USDC units.
const oracle = rate(105408590567n);
// What another instance reads a moment later: re-quoting would charge 527549.
const moved = rate(105509590567n);
const quoteSecret = "test-secret-that-is-32-chars-long";
const network = "stellar:testnet";
const payTo = Keypair.random().publicKey();

/** The PAYMENT-SIGNATURE header a client sends after accepting `accepted`. */
const paid = (accepted: PaymentRequirements) =>
  encodePaymentSignatureHeader({ x402Version: 2, accepted, payload: { transaction: "AAAA" }, resource: { url: "http://seller.test/data" } });
const offers = async (response: Response) =>
  (JSON.parse(atob(response.headers.get("payment-required")!)) as { accepts: PaymentRequirements[] }).accepts;

// 0.1 reads the quote secret only from the environment; 1.0 also gets it as an option.
beforeAll(() => {
  vi.stubEnv("LOCAL402_QUOTE_SECRET", quoteSecret);
});
afterAll(() => vi.unstubAllEnvs());

describe("rolling upgrade: 0.1 and 1.0 instances behind one load balancer", () => {
  // Both return USDC as an AssetAmount; the DynamicPrice type also allows a string.
  type Quote = (context: unknown) => Promise<AssetAmount>;
  const v01 = (source: FiatRateSource) => localPrice01("50 CLP", { network, oracle: source }) as Quote;
  const v10 = (source: FiatRateSource) => localPrice("50 CLP", { network, oracle: source, quoteSecret }) as Quote;

  it.each([
    ["0.1 quotes, 1.0 takes the paid retry", v01, v10],
    ["1.0 quotes, 0.1 takes the paid retry", v10, v01],
  ])("%s", async (_name, issuer, retry) => {
    const quoted = await issuer(oracle)({});
    expect(quoted).toMatchObject({ amount: "527043", extra: { local402: { signature: expect.any(String) } } });
    const accepted = { scheme: "exact", network, payTo, maxTimeoutSeconds: 60, ...quoted } as PaymentRequirements;
    // The other instance reads a different rate, yet charges what the payer signed for.
    expect(await retry(moved)({ paymentHeader: paid(accepted) })).toEqual(quoted);
    // A quote someone edited is not honored: that instance quotes again at its own rate.
    const local402 = { ...(quoted.extra!.local402 as object), tokenAmount: "1" };
    const forged = await retry(moved)({ paymentHeader: paid({ ...accepted, amount: "1", extra: { local402 } }) });
    expect(forged.amount).not.toBe("1");
    expect(forged.amount).not.toBe(quoted.amount);
  });
});

describe("0.1 and 1.0 sellers on a 1.0 facilitator", () => {
  const servers: Server[] = [];
  const verified: PaymentRequirements[] = [];
  const url = { v01: "", v10: "" };

  async function listen(app: express.Express): Promise<string> {
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    const facilitator = createFacilitator(facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: Keypair.random().secret() }), {
      probe: { rpcHealthy: async () => true, balanceStroops: async () => 100_000_000n, contractExists: async () => true },
    });
    const recorder = express();
    recorder.use(express.json(), (req, _res, next) => {
      if (req.path === "/verify") verified.push(req.body.paymentRequirements);
      next();
    });
    recorder.use(facilitator.app);
    const facilitatorUrl = await listen(recorder);

    // kuyfi's setup: the 0.1 server package, its route helper and the stock x402 middleware.
    const v01 = express();
    v01.use(paymentMiddleware({ "GET /data": localRoute01("50 CLP", { payTo, network, oracle }) }, local402Server01(facilitatorUrl, network)));
    v01.get("/data", (_req, res) => res.json({ ok: true }));
    url.v01 = `${await listen(v01)}/data`;

    const v10 = express();
    v10.use(paymentMiddleware({ "GET /data": localRoute("50 CLP", { payTo, network, oracle, quoteSecret }) }, local402Server(facilitatorUrl, network)));
    v10.get("/data", (_req, res) => res.json({ ok: true }));
    url.v10 = `${await listen(v10)}/data`;
  });
  afterAll(() => servers.forEach((server) => server.close()));

  it.each([
    ["1.0 client, 0.1 seller", () => new Local402Client({ secret: Keypair.random().secret(), oracle }), "v01"],
    ["0.1 client, 1.0 seller", () => new Client01({ secret: Keypair.random().secret(), oracle }), "v10"],
  ] as const)("%s: the client reads and checks the quote", async (_name, client, seller) => {
    const payer = client();
    const price = await payer.quote(url[seller]);
    expect(price).toMatchObject({ amount: "527043", scheme: "exact", payTo, local: { amount: "50", currency: "CLP", oracleSource: "test" } });
    await expect(payer.checkPrice(price!)).resolves.toBeUndefined();
  });

  it("still checks a 0.1 seller's quote against the 1.0 client's own rate", async () => {
    const price = await new Local402Client({ secret: Keypair.random().secret(), oracle }).quote(url.v01);
    // By this client's rate 50 CLP is about 5% less, so the seller's charge is refused.
    const strict = new Local402Client({ secret: Keypair.random().secret(), oracle: rate(100_000_000_000n) });
    await expect(strict.checkPrice(price!)).rejects.toMatchObject({ code: "REFUSED_OVERCHARGE" });
  });

  it.each(["v01", "v10"] as const)("%s seller offers exact-fx with the facilitator's extra, which both versions parse", async (seller) => {
    const fx = (await offers(await fetch(url[seller]))).find((accept) => accept.scheme === "exact-fx")!;
    expect(fx.extra).toMatchObject({ areFeesSponsored: true, fxContract: FX_TESTNET.fxContract, sendAssets: [FX_TESTNET.xlm, FX_TESTNET.eurc] });
    expect(parseFxExtra01(fx.extra)).toEqual(parseFxExtra(fx.extra));
  });

  it.each(["v01", "v10"] as const)("%s seller matches the paid retry to its quote and sends it to the facilitator", async (seller) => {
    const exact = (await offers(await fetch(url[seller]))).find((accept) => accept.scheme === "exact")!;
    const retry = await fetch(url[seller], { headers: { "payment-signature": paid(exact) } });
    // The dummy transaction is refused, but only after the seller found the requirement it quoted.
    expect(retry.status).toBe(402);
    expect(verified.at(-1)).toEqual(exact);
  });
});
