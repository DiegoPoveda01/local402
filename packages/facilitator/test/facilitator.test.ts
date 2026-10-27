import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { FX_MAINNET, FX_TESTNET } from "@local402/fx";
import { createFacilitator, describe as startupLine, facilitatorConfig, newKeys, RateLimiter, refusal, writeKeys, type ReadinessProbe } from "../src/index.js";

/** The deployable facilitator: its environment, its limits and refusals, and what /health and /ready report. */

const code = (code: string) => expect.objectContaining({ code });
const secret = () => Keypair.random().secret();
const seller = Keypair.random().publicKey();
const FX_MAINNET_TEST = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("facilitatorConfig", () => {
  it("runs on testnet with only a key, and says what it defaulted", () => {
    const config = facilitatorConfig({ FACILITATOR_PRIVATE_KEY: secret() });
    expect(config).toMatchObject({
      network: "stellar:testnet",
      fxContract: FX_TESTNET.fxContract,
      sendAssets: [FX_TESTNET.xlm, FX_TESTNET.eurc],
      port: 4022,
      payToAllowlist: [],
      assetAllowlist: [],
      minAmount: 0n,
      limits: { verify: 60, settle: 20 },
      // Clients connect straight to it unless the operator says a proxy is there: trusting one that is not
      // lets every caller write its own X-Forwarded-For and get a fresh rate-limit bucket per request.
      trustProxy: 0,
    });
  });

  it("names the variable and what it accepts", () => {
    const key = secret();
    expect(() => facilitatorConfig({})).toThrow(code("INVALID_CONFIG"));
    expect(() => facilitatorConfig({})).toThrow(/FACILITATOR_PRIVATE_KEYS is required/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: seller })).toThrow(/entry 1 is a public key/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: `${key},${key}` })).toThrow(/repeats a key/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, NETWORK: "stellar:mainnet" })).toThrow(/NETWORK must be/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, MIN_AMOUNT: "0.01" })).toThrow(/MIN_AMOUNT must be a whole number/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, SETTLE_RATE_LIMIT: "0" })).toThrow(/SETTLE_RATE_LIMIT must be a whole number at least 1/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, PORT: "70000" })).toThrow(/PORT must be a whole number from 1 to 65535/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, SEND_ASSETS: "XLM" })).toThrow(/SEND_ASSETS/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, PAY_TO_ALLOWLIST: "kuyfi" })).toThrow(/PAY_TO_ALLOWLIST must list seller addresses/);
    expect(() => facilitatorConfig({ FACILITATOR_PRIVATE_KEY: key, ASSET_ALLOWLIST: "USDC" })).toThrow(/ASSET_ALLOWLIST must list token contract addresses/);
  });

  it("never repeats a secret key or an RPC URL in its messages", () => {
    const key = secret();
    const run = (env: Record<string, string>) => {
      try {
        facilitatorConfig({ FACILITATOR_PRIVATE_KEY: secret(), ...env });
      } catch (error) {
        return String(error);
      }
      return "";
    };
    expect(run({ PAY_TO_ALLOWLIST: key })).toMatch(/a secret key \(not shown\)/);
    expect(run({ PAY_TO_ALLOWLIST: key })).not.toContain(key);
    expect(run({ FX_CONTRACT: key })).not.toContain(key);
    expect(run({ RPC_URL: "ftp://rpc.example/key-123" })).not.toContain("key-123");
  });

  it("only settles for named sellers on mainnet, and above a minimum", () => {
    const mainnet = { FACILITATOR_PRIVATE_KEY: secret(), NETWORK: "stellar:pubnet", FX_CONTRACT: FX_MAINNET_TEST };
    expect(() => facilitatorConfig({ ...mainnet, FX_CONTRACT: "" })).toThrow(/FX_CONTRACT .* is required on stellar:pubnet/);
    expect(() => facilitatorConfig(mainnet)).toThrow(/PAY_TO_ALLOWLIST is required on stellar:pubnet/);
    // An empty allowlist, as .env.example ships it, is unset: it never means "any seller".
    expect(() => facilitatorConfig({ ...mainnet, PAY_TO_ALLOWLIST: "" })).toThrow(/PAY_TO_ALLOWLIST is required/);
    expect(facilitatorConfig({ ...mainnet, PAY_TO: seller })).toMatchObject({ payToAllowlist: [seller], minAmount: 100000n });
    // The minimum counts token units, so on mainnet it only means something for tokens with a price.
    expect(facilitatorConfig({ ...mainnet, PAY_TO: seller }).assetAllowlist).toEqual([FX_MAINNET.usdc.contract, FX_MAINNET.xlm, FX_MAINNET.eurc.contract]);
    expect(facilitatorConfig({ ...mainnet, PAY_TO: seller, ASSET_ALLOWLIST: FX_MAINNET.usdc.contract }).assetAllowlist).toEqual([FX_MAINNET.usdc.contract]);
    expect(facilitatorConfig({ ...mainnet, PAY_TO_ALLOWLIST: ` ${seller} `, MIN_AMOUNT: "500000" })).toMatchObject({
      payToAllowlist: [seller],
      minAmount: 500000n,
    });
  });
});

describe("RateLimiter", () => {
  it("caps verify and settle separately, per client, per minute", () => {
    let now = 0;
    const limiter = new RateLimiter({ verify: 3, settle: 1 }, () => now);
    expect([1, 2, 3, 4].map(() => limiter.allow("verify", "a"))).toEqual([true, true, true, false]);
    expect(limiter.allow("settle", "a")).toBe(true);
    expect(limiter.allow("settle", "a")).toBe(false);
    expect(limiter.allow("settle", "b")).toBe(true);
    now = 60_000;
    expect(limiter.allow("settle", "a")).toBe(true);
  });
});

describe("refusal", () => {
  const config = { network: "stellar:testnet" as const, payToAllowlist: [seller], assetAllowlist: [FX_TESTNET.xlm], minAmount: 100000n };
  const body = (requirements: Record<string, unknown>) => ({
    paymentPayload: {},
    paymentRequirements: { scheme: "exact", network: "stellar:testnet", payTo: seller, asset: FX_TESTNET.xlm, amount: "100000", ...requirements },
  });

  it("refuses before any RPC call what this instance does not settle", () => {
    expect(refusal(body({}), config)).toBeUndefined();
    expect(refusal(body({ payTo: Keypair.random().publicKey() }), config)).toBe("pay_to_not_allowed");
    expect(refusal(body({ amount: "99999" }), config)).toBe("amount_below_minimum");
    // A token anyone can mint meets any minimum, so the token itself has to be one this instance names.
    expect(refusal(body({ asset: FX_TESTNET.eurc, amount: "1000000000" }), config)).toBe("asset_not_allowed");
    expect(refusal(body({ asset: undefined }), config)).toBe("invalid_payment_requirements");
    expect(refusal(body({ network: "stellar:pubnet" }), config)).toBe("unsupported_network");
    expect(refusal(body({ amount: "1e6" }), config)).toBe("invalid_payment_requirements");
    expect(refusal("x", config)).toBe("invalid_request_body");
  });
});

describe("the facilitator app", () => {
  const servers: { close(): void }[] = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  async function start(env: Record<string, string>, probe: ReadinessProbe) {
    const facilitator = createFacilitator(facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: `${secret()},${secret()}`, ...env }), { probe });
    const server = facilitator.app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    return { ...facilitator, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  const healthy: ReadinessProbe = {
    rpcHealthy: async () => true,
    balanceStroops: async () => 100_000_000n,
    contractExists: async () => true,
  };

  it("answers /health without touching the network", async () => {
    const { url } = await start({}, { ...healthy, rpcHealthy: () => Promise.reject(new Error("offline")) });
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", network: "stellar:testnet" });
  });

  it("is ready when the RPC answers, every fee payer is funded and FxPay is on the ledger", async () => {
    const { url, feePayers } = await start({}, healthy);
    const response = await fetch(`${url}/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ready: true,
      rpc: { ok: true },
      feePayers: feePayers.map((address) => ({ address, ok: true, xlm: "10" })),
      fxContract: { address: FX_TESTNET.fxContract, ok: true },
    });
  });

  it("answers 503 and says which check failed and what to do", async () => {
    let calls = 0;
    const { url, feePayers } = await start({ MIN_FEE_BALANCE_XLM: "5" }, {
      rpcHealthy: async () => true,
      balanceStroops: async (address) => (calls++, address === feePayers[0] ? 40_000_000n : undefined),
      contractExists: async () => false,
    });
    const response = await fetch(`${url}/ready`);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ready).toBe(false);
    expect(body.feePayers[0]).toMatchObject({ ok: false, xlm: "4", error: expect.stringMatching(/below the 5 XLM minimum/) });
    expect(body.feePayers[1]).toMatchObject({ ok: false, error: expect.stringMatching(/does not exist/) });
    expect(body.fxContract.error).toMatch(/TTL expired/);
    // A host polling /ready every few seconds reuses the last answer instead of hitting the RPC again.
    await fetch(`${url}/ready`);
    expect(calls).toBe(2);
  });

  it("refuses a seller outside the allowlist, and rate-limits settle on its own cap", async () => {
    const { url } = await start({ PAY_TO_ALLOWLIST: seller, SETTLE_RATE_LIMIT: "1" }, healthy);
    const post = (path: string) =>
      fetch(`${url}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentPayload: {},
          paymentRequirements: { scheme: "exact", network: "stellar:testnet", payTo: Keypair.random().publicKey(), asset: FX_TESTNET.xlm, amount: "1" },
        }),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(await post("verify")).toEqual({ status: 200, body: { isValid: false, invalidReason: "pay_to_not_allowed" } });
    expect((await post("settle")).body.errorReason).toBe("pay_to_not_allowed");
    expect(await post("settle")).toMatchObject({ status: 429, body: { errorReason: "rate_limited" } });
    expect((await post("verify")).status).toBe(200);
  });

  it("answers a payload that makes verification throw with a reason, not an error page", async () => {
    const { url } = await start({}, healthy);
    // x402Facilitator.verify throws for a scheme nothing registered.
    const response = await fetch(`${url}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentPayload: { x402Version: 2 },
        paymentRequirements: { scheme: "upto", network: "stellar:testnet", payTo: seller, asset: FX_TESTNET.xlm, amount: "1" },
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ isValid: false, invalidReason: expect.stringMatching(/No facilitator registered for scheme: upto/) });
  });

  it("says at startup what it restricts, without any key", () => {
    const config = facilitatorConfig({ FACILITATOR_PRIVATE_KEY: secret(), NETWORK: "stellar:pubnet", FX_CONTRACT: FX_MAINNET_TEST, PAY_TO: seller });
    const line = startupLine(config, ["GABC"]);
    expect(line).toMatch(/payTo restricted to 1 seller\(s\), asset restricted to 3 token\(s\), minimum amount 100000/);
    expect(line).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

describe("keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "local402-keys-"));

  it("fills the empty line .env.example ships, and never replaces keys that may hold funds", () => {
    const file = join(dir, ".env");
    writeFileSync(file, "NETWORK=stellar:testnet\nFACILITATOR_PRIVATE_KEYS=\nPORT=4022\n");
    const keys = newKeys(2).map((key) => key.secret());
    writeKeys(file, keys);
    expect(readFileSync(file, "utf8")).toBe(`NETWORK=stellar:testnet\nFACILITATOR_PRIVATE_KEYS=${keys.join(",")}\nPORT=4022\n`);
    expect(() => writeKeys(file, [secret()])).toThrow(/already has facilitator keys/);
    expect(facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: keys.join(",") }).secrets).toEqual(keys);
  });

  it("creates the file when there is none, and bounds the count", () => {
    const file = join(dir, "new.env");
    writeKeys(file, [secret()]);
    expect(readFileSync(file, "utf8")).toMatch(/^FACILITATOR_PRIVATE_KEYS=S[A-Z2-7]{55}\n$/);
    expect(() => newKeys(0)).toThrow(code("INVALID_CONFIG"));
    expect(() => newKeys(21)).toThrow(/from 1 to 20/);
  });
});
