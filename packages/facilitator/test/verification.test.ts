import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { x402Facilitator } from "@x402/core/facilitator";
import { FX_SCHEME, FX_TESTNET } from "@local402/fx";
import { createFacilitator, facilitatorConfig, refusal, type ReadinessProbe } from "../src/index.js";

/**
 * What the facilitator refuses before a scheme sees the request, and how /verify and /settle answer.
 * The schemes' own checks are in `local402-fx`; here `x402Facilitator` is stubbed where it would need RPC.
 */

const secret = () => Keypair.random().secret();
const seller = Keypair.random().publicKey();
const requirements = (overrides: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: "stellar:testnet",
  payTo: seller,
  asset: FX_TESTNET.xlm,
  amount: "100000",
  ...overrides,
});
const body = (overrides: Record<string, unknown> = {}) => ({ paymentPayload: { x402Version: 2 }, paymentRequirements: requirements(overrides) });

describe("refusal: the request's shape", () => {
  const open = { network: "stellar:testnet" as const, payToAllowlist: [], assetAllowlist: [], minAmount: 0n };

  it("names the part of the body that is missing or of the wrong type", () => {
    expect(refusal({ paymentRequirements: requirements() }, open)).toBe("invalid_payment_payload");
    expect(refusal({ paymentPayload: "AAAA", paymentRequirements: requirements() }, open)).toBe("invalid_payment_payload");
    expect(refusal({ paymentPayload: {} }, open)).toBe("invalid_payment_requirements");
    expect(refusal({ paymentPayload: {}, paymentRequirements: [] }, open)).toBe("invalid_payment_requirements");
    for (const field of ["scheme", "network", "payTo", "asset"]) {
      expect(refusal(body({ [field]: 7 }), open), field).toBe("invalid_payment_requirements");
      expect(refusal(body({ [field]: undefined }), open), field).toBe("invalid_payment_requirements");
    }
  });

  it("only takes an amount written as whole token units", () => {
    for (const amount of ["-1", "1.5", "", " 1", "0x10", undefined, null]) {
      expect(refusal(body({ amount }), open), String(amount)).toBe("invalid_payment_requirements");
    }
  });

  it("settles for any seller and token when no allowlist or minimum is set, as on testnet by default", () => {
    expect(refusal(body({ payTo: Keypair.random().publicKey(), asset: FX_TESTNET.eurc, amount: "1" }), open)).toBeUndefined();
    expect(facilitatorConfig({ FACILITATOR_PRIVATE_KEY: secret() })).toMatchObject({ payToAllowlist: [], assetAllowlist: [], minAmount: 0n });
  });

  it("checks the network before the allowlists, so a seller learns what is actually wrong", () => {
    const strict = { ...open, payToAllowlist: [seller], assetAllowlist: [FX_TESTNET.xlm], minAmount: 100000n };
    expect(refusal(body({ network: "stellar:pubnet", payTo: Keypair.random().publicKey() }), strict)).toBe("unsupported_network");
    expect(refusal(body({ payTo: Keypair.random().publicKey(), asset: FX_TESTNET.eurc }), strict)).toBe("pay_to_not_allowed");
    expect(refusal(body({ asset: FX_TESTNET.eurc, amount: "1" }), strict)).toBe("asset_not_allowed");
    expect(refusal(body({ amount: "99999" }), strict)).toBe("amount_below_minimum");
    expect(refusal(body({ amount: "100000" }), strict)).toBeUndefined();
    // The minimum is compared as a bigint, so an amount past Number's precision is still exact.
    expect(refusal(body({ amount: "9007199254740993" }), strict)).toBeUndefined();
  });
});

describe("the facilitator's /verify and /settle", () => {
  const servers: { close(): void }[] = [];
  afterEach(() => {
    servers.splice(0).forEach((server) => server.close());
    vi.restoreAllMocks();
  });

  const healthy: ReadinessProbe = { rpcHealthy: async () => true, balanceStroops: async () => 100_000_000n, contractExists: async () => true };
  async function start(env: Record<string, string> = {}) {
    const { app } = createFacilitator(facilitatorConfig({ FACILITATOR_PRIVATE_KEYS: secret(), ...env }), { probe: healthy });
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: "verify" | "settle", payload: unknown, headers: Record<string, string> = {}) =>
      fetch(`${url}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) }).then(
        async (response) => ({ status: response.status, body: await response.json() }),
      );
    return { url, post };
  }
  const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("refuses an unlisted token and an amount under the minimum before the scheme runs", async () => {
    const verify = vi.spyOn(x402Facilitator.prototype, "verify");
    const settle = vi.spyOn(x402Facilitator.prototype, "settle");
    const { post } = await start({ PAY_TO_ALLOWLIST: seller, ASSET_ALLOWLIST: FX_TESTNET.xlm, MIN_AMOUNT: "100000" });
    expect(await post("verify", body({ asset: FX_TESTNET.eurc }))).toEqual({ status: 200, body: { isValid: false, invalidReason: "asset_not_allowed" } });
    expect(await post("verify", body({ amount: "99999" }))).toEqual({ status: 200, body: { isValid: false, invalidReason: "amount_below_minimum" } });
    expect(await post("settle", body({ amount: "99999" }))).toEqual({
      status: 200,
      body: { success: false, network: "stellar:testnet", transaction: "", errorReason: "amount_below_minimum" },
    });
    expect(await post("verify", { paymentRequirements: requirements() })).toMatchObject({ body: { invalidReason: "invalid_payment_payload" } });
    expect(verify).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("hands an accepted request to the scheme unchanged", async () => {
    quiet();
    const verify = vi.spyOn(x402Facilitator.prototype, "verify").mockResolvedValue({ isValid: true, payer: seller });
    const { post } = await start({ PAY_TO_ALLOWLIST: seller });
    expect(await post("verify", body())).toEqual({ status: 200, body: { isValid: true, payer: seller } });
    expect(verify).toHaveBeenCalledWith({ x402Version: 2 }, requirements());
  });

  it("counts the verify limit apart from settle", async () => {
    quiet();
    vi.spyOn(x402Facilitator.prototype, "verify").mockResolvedValue({ isValid: false, invalidReason: "x" });
    vi.spyOn(x402Facilitator.prototype, "settle").mockResolvedValue({ success: true, transaction: "ab", network: "stellar:testnet" });
    const { post } = await start({ VERIFY_RATE_LIMIT: "1" });
    expect((await post("verify", body())).status).toBe(200);
    expect(await post("verify", body())).toEqual({ status: 429, body: { isValid: false, invalidReason: "rate_limited" } });
    expect(await post("settle", body())).toMatchObject({ status: 200, body: { success: true } });
  });

  it("gives a client that writes its own X-Forwarded-For no new bucket, unless a proxy is trusted", async () => {
    quiet();
    vi.spyOn(x402Facilitator.prototype, "verify").mockResolvedValue({ isValid: false, invalidReason: "x" });
    const direct = await start({ VERIFY_RATE_LIMIT: "1" });
    expect((await direct.post("verify", body(), { "x-forwarded-for": "10.0.0.1" })).status).toBe(200);
    expect((await direct.post("verify", body(), { "x-forwarded-for": "10.0.0.2" })).status).toBe(429);
    // Behind one proxy, the address the proxy appends is the client, and each one is counted on its own.
    const proxied = await start({ VERIFY_RATE_LIMIT: "1", TRUST_PROXY: "1" });
    expect((await proxied.post("verify", body(), { "x-forwarded-for": "10.0.0.1" })).status).toBe(200);
    expect((await proxied.post("verify", body(), { "x-forwarded-for": "10.0.0.2" })).status).toBe(200);
    expect((await proxied.post("verify", body(), { "x-forwarded-for": "10.0.0.2" })).status).toBe(429);
  });

  it("settles once more when the first attempt never reached the ledger", async () => {
    quiet();
    const settle = vi
      .spyOn(x402Facilitator.prototype, "settle")
      .mockResolvedValueOnce({ success: false, transaction: "", network: "stellar:testnet", errorReason: "settle_exact_submission_failed" })
      .mockResolvedValueOnce({ success: true, transaction: "ab".repeat(32), network: "stellar:testnet" });
    const { post } = await start();
    expect(await post("settle", body())).toEqual({ status: 200, body: { success: true, transaction: "ab".repeat(32), network: "stellar:testnet" } });
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("never settles twice once a transaction exists, or for any other failure", async () => {
    quiet();
    const settle = vi.spyOn(x402Facilitator.prototype, "settle");
    const { post } = await start();
    // On the ledger and failed: the fee was spent and the payer's authorization may be used up.
    settle.mockResolvedValueOnce({ success: false, transaction: "cd".repeat(32), network: "stellar:testnet", errorReason: "settle_exact_submission_failed" });
    expect(await post("settle", body())).toMatchObject({ body: { success: false, transaction: "cd".repeat(32) } });
    settle.mockResolvedValueOnce({ success: false, transaction: "", network: "stellar:testnet", errorReason: "invalid_exact_stellar_payload_wrong_amount" });
    expect(await post("settle", body())).toMatchObject({ body: { errorReason: "invalid_exact_stellar_payload_wrong_amount" } });
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("answers a settlement that throws with 503 and the reason", async () => {
    vi.spyOn(x402Facilitator.prototype, "settle").mockRejectedValue(new Error("rpc down"));
    const { post } = await start();
    expect(await post("settle", body())).toEqual({
      status: 503,
      body: { success: false, network: "stellar:testnet", transaction: "", errorReason: "Error: rpc down" },
    });
  });

  it("lists exact and exact-fx on its network, with the contract a payer must call", async () => {
    const { url } = await start();
    const { kinds } = await (await fetch(`${url}/supported`)).json();
    expect(kinds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheme: "exact", network: "stellar:testnet" }),
        expect.objectContaining({ scheme: FX_SCHEME, network: "stellar:testnet", extra: expect.objectContaining({ fxContract: FX_TESTNET.fxContract }) }),
      ]),
    );
  });
});
