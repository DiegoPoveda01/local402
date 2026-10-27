import express, { type Express } from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { SettleResponse, VerifyResponse } from "@x402/core/types";
import { BAZAAR, extractDiscoveryInfo, type DiscoveryResource } from "@x402/extensions/bazaar";
import { createEd25519Signer, getRpcClient } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { ChannelPool, ExactFxFacilitatorScheme, feeBumpSigner } from "@local402/fx";
import type { FacilitatorConfig } from "./config.js";
import { readiness, rpcProbe, type Readiness, type ReadinessProbe } from "./ready.js";

/** How long `/ready` reuses its last answer, so a host polling it every few seconds does not hammer the RPC. */
const READY_CACHE_MS = 15_000;

/** Per-client request caps per minute, counted separately for each route. */
export class RateLimiter<Route extends string> {
  private readonly windows = new Map<string, { minute: number; count: number }>();

  constructor(
    private readonly limits: Record<Route, number>,
    private readonly now = Date.now,
  ) {}

  allow(route: Route, client: string | undefined): boolean {
    const minute = Math.floor(this.now() / 60_000);
    const key = `${route}:${client}`;
    const window = this.windows.get(key);
    if (window?.minute === minute) {
      window.count++;
      return window.count <= this.limits[route];
    }
    // Drop the entries that expired, not the whole map: clearing it handed every client already over the
    // cap a fresh allowance, which is exactly what an attacker filling the map with fake IPs would want.
    if (this.windows.size > 1_000) {
      for (const [other, seen] of this.windows) if (seen.minute !== minute) this.windows.delete(other);
    }
    this.windows.set(key, { minute, count: 1 });
    return true;
  }
}

/** Why this facilitator refuses to handle the requirements, if it does. */
export function refusal(body: unknown, config: Pick<FacilitatorConfig, "network" | "payToAllowlist" | "assetAllowlist" | "minAmount">): string | undefined {
  // `x402Facilitator.verify/settle` does not validate the body's shape, and neither did this: a payload
  // of the wrong type reached the scheme and came back as an opaque crash instead of a reason.
  if (!body || typeof body !== "object") return "invalid_request_body";
  const { paymentPayload, paymentRequirements } = body as { paymentPayload?: unknown; paymentRequirements?: unknown };
  if (!paymentPayload || typeof paymentPayload !== "object") return "invalid_payment_payload";
  if (!paymentRequirements || typeof paymentRequirements !== "object") return "invalid_payment_requirements";
  const { scheme, network, payTo, asset, amount } = paymentRequirements as Record<string, unknown>;
  if (typeof scheme !== "string" || typeof network !== "string" || typeof payTo !== "string" || typeof asset !== "string") {
    return "invalid_payment_requirements";
  }
  if (network !== config.network) return "unsupported_network";
  if (config.payToAllowlist.length && !config.payToAllowlist.includes(payTo)) return "pay_to_not_allowed";
  if (config.assetAllowlist.length && !config.assetAllowlist.includes(asset)) return "asset_not_allowed";
  if (!/^\d+$/.test(String(amount))) return "invalid_payment_requirements";
  if (config.minAmount && BigInt(String(amount)) < config.minAmount) return "amount_below_minimum";
  return undefined;
}

export interface Facilitator {
  app: Express;
  /** The fee-paying accounts' public keys, in the order of `FACILITATOR_PRIVATE_KEYS`. */
  feePayers: string[];
  /** Runs the `/ready` checks now, without the cache. */
  ready(): Promise<Readiness>;
}

/**
 * The Local402 facilitator as an Express app: `exact` and `exact-fx` on one Stellar network, the x402 Bazaar
 * catalog, `/health` and `/ready`. Build the config with `facilitatorConfig`; `probe` replaces the RPC in tests.
 */
export function createFacilitator(config: FacilitatorConfig, options: { probe?: ReadinessProbe } = {}): Facilitator {
  const { network } = config;
  const rpcConfig = config.rpcUrl ? { url: config.rpcUrl } : undefined;

  // Bazaar catalog: every resource that settles here and declares discovery info, keyed by URL. Serverless instances
  // start empty, so with Redis configured the catalog lives there; memory is the fallback.
  const catalog = new Map<string, DiscoveryResource>();
  const catalogKey = `local402:bazaar:${network}`;
  const redisConfig = config.catalogRedis;
  /** One command over Upstash's REST API. */
  const redis = async (...command: string[]): Promise<unknown> => {
    const response = await fetch(redisConfig!.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisConfig!.token}` },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`Redis ${response.status}`);
    return ((await response.json()) as { result: unknown }).result;
  };

  // Several fee-paying accounts ("channels") let settlements run in parallel without sequence number clashes.
  const signers = config.secrets.map((secret) => createEd25519Signer(secret, network));
  const feePayers = signers.map((signer) => signer.address);
  const channels = new ChannelPool(feePayers);
  const facilitator = new x402Facilitator()
    .register(network, new ExactStellarScheme(signers, {
      rpcConfig,
      selectSigner: channels.select,
      feeBumpSigner: feeBumpSigner(signers[0], { network, rpcConfig }),
    }))
    .register(
      network,
      new ExactFxFacilitatorScheme(signers, { fxContract: config.fxContract, sendAssets: config.sendAssets, rpcConfig, selectSigner: channels.select }),
    )
    .registerExtension(BAZAAR)
    .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
      const discovered = result.success && extractDiscoveryInfo(paymentPayload, requirements);
      if (!discovered) return;
      const { resourceUrl, x402Version, discoveryInfo, ...metadata } = discovered;
      // Another instance may have stored the route's other scheme; keep it.
      let previous = catalog.get(resourceUrl);
      if (!previous && redisConfig) {
        previous = await redis("HGET", catalogKey, resourceUrl).then(
          (value) => (typeof value === "string" ? (JSON.parse(value) as DiscoveryResource) : undefined),
          () => undefined,
        );
      }
      const accepts = (previous?.accepts ?? []).filter((a) => a.scheme !== requirements.scheme);
      const entry: DiscoveryResource = {
        ...metadata,
        resource: resourceUrl,
        type: discoveryInfo.input.type,
        x402Version,
        accepts: [...accepts, requirements],
        lastUpdated: new Date().toISOString(),
      };
      catalog.set(resourceUrl, entry);
      // The payment has settled by now: a Redis failure only costs the catalog entry, never the result.
      if (redisConfig) {
        await redis("HSET", catalogKey, resourceUrl, JSON.stringify(entry)).catch(() =>
          console.warn("bazaar: could not save the catalog entry to Redis"),
        );
      }
    });

  // Verification simulates on RPC and settlement spends fees, so both are bounded, each with its own cap.
  const limiter = new RateLimiter(config.limits);
  const probe = options.probe ?? rpcProbe(getRpcClient(network, rpcConfig));
  const ready = () =>
    readiness(probe, { network, feePayers, fxContract: config.fxContract, minFeeBalanceXlm: config.minFeeBalanceXlm });
  let lastReady: { at: number; result: Promise<Readiness> } | undefined;

  const app = express();
  // By default exactly one proxy (Vercel's edge, or a host's load balancer). With `true`, express takes the
  // leftmost `X-Forwarded-For` entry, which the client writes itself: every caller could pick its own
  // `req.ip` and get an unlimited number of rate-limit buckets.
  app.set("trust proxy", config.trustProxy);
  app.use(express.json({ limit: "64kb" }));

  // Liveness: the process is up and its configuration was valid. Says nothing about the network.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", network });
  });

  // Readiness: this instance can settle now. 503 tells the host to stop routing payments here.
  app.get("/ready", async (_req, res) => {
    if (!lastReady || Date.now() - lastReady.at > READY_CACHE_MS) lastReady = { at: Date.now(), result: ready() };
    const result = await lastReady.result;
    res.status(result.ready ? 200 : 503).json(result);
  });

  app.get("/supported", (_req, res) => {
    res.json(facilitator.getSupported());
  });

  app.get("/discovery/resources", async (req, res) => {
    let all = [...catalog.values()];
    if (redisConfig) {
      try {
        all = ((await redis("HVALS", catalogKey)) as string[]).map((value) => JSON.parse(value) as DiscoveryResource);
      } catch {
        console.warn("bazaar: could not read the catalog from Redis, serving this instance's copy");
      }
    }
    const items = all.filter((item) => !req.query.type || item.type === req.query.type);
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    res.json({ x402Version: 2, items: items.slice(offset, offset + limit), pagination: { limit, offset, total: items.length } });
  });

  app.post("/verify", async (req, res) => {
    if (!limiter.allow("verify", req.ip)) {
      res.status(429).json({ isValid: false, invalidReason: "rate_limited" });
      return;
    }
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    const refused = refusal(req.body, config);
    if (refused) {
      res.json({ isValid: false, invalidReason: refused });
      return;
    }
    let result: VerifyResponse;
    try {
      result = await facilitator.verify(paymentPayload, paymentRequirements);
    } catch (error) {
      // Same as settle: a reason the seller can log, not Express's HTML error page with a stack trace.
      res.status(503).json({ isValid: false, invalidReason: String(error) });
      return;
    }
    console.log(`verify ${paymentRequirements?.scheme}: ${result.isValid ? "valid" : result.invalidReason}`);
    res.json(result);
  });

  app.post("/settle", async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    if (!limiter.allow("settle", req.ip)) {
      res.status(429).json({ success: false, network: paymentRequirements?.network, transaction: "", errorReason: "rate_limited" });
      return;
    }
    const refused = refusal(req.body, config);
    if (refused) {
      res.json({ success: false, network: paymentRequirements?.network, transaction: "", errorReason: refused });
      return;
    }
    const settle = () => channels.run(() => facilitator.settle(paymentPayload, paymentRequirements));
    let result: SettleResponse;
    try {
      result = await settle();
      // Rejected before reaching the ledger (e.g. another server instance used the same account's sequence number):
      // nothing was spent, and the payer's authorization is still valid, so try once more on the next account.
      if (!result.success && !result.transaction && /submission_failed/.test(result.errorReason ?? "")) {
        result = await settle();
      }
    } catch (error) {
      res.status(503).json({ success: false, network: paymentRequirements?.network, transaction: "", errorReason: String(error) });
      return;
    }
    console.log(`settle ${paymentRequirements?.scheme}: ${result.success ? result.transaction : result.errorReason}`);
    res.json(result);
  });

  return { app, feePayers, ready };
}

/** The startup line: what this instance settles, without any key. */
export function describe(config: FacilitatorConfig, feePayers: string[]): string {
  const { network, payToAllowlist, assetAllowlist, minAmount, limits } = config;
  return (
    `facilitator on ${network}: ${feePayers.length} fee payer(s), ` +
    `payTo ${payToAllowlist.length ? `restricted to ${payToAllowlist.length} seller(s)` : "unrestricted"}, ` +
    `asset ${assetAllowlist.length ? `restricted to ${assetAllowlist.length} token(s)` : "unrestricted"}, ` +
    `minimum amount ${minAmount || "none"}, ` +
    `limits ${limits.verify} verify and ${limits.settle} settle per client per minute`
  );
}
