import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network, SettleResponse } from "@x402/core/types";
import { BAZAAR, extractDiscoveryInfo, type DiscoveryResource } from "@x402/extensions/bazaar";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { ChannelPool, ExactFxFacilitatorScheme, feeBumpSigner, fxNetwork } from "@local402/fx";

const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
// Several fee-paying accounts ("channels") let settlements run in parallel without sequence number clashes.
const SECRETS = (process.env.FACILITATOR_PRIVATE_KEYS || process.env.FACILITATOR_PRIVATE_KEY || "").split(",").filter(Boolean);
if (!SECRETS.length) {
  throw new Error("FACILITATOR_PRIVATE_KEY (fee-paying Stellar account) is required. See .env.example");
}
const fx = fxNetwork(NETWORK, process.env.FX_CONTRACT || undefined);
if (!fx.fxContract) {
  throw new Error(`FX_CONTRACT (FxPay deployment) is required on ${NETWORK}. See scripts/mainnet/deploy-fxpay.sh`);
}
const SEND_ASSETS = (process.env.SEND_ASSETS || `${fx.xlm},${fx.eurc}`).split(",");
const rpcUrl = process.env.RPC_URL || fx.rpcUrl;
const rpcConfig = rpcUrl ? { url: rpcUrl } : undefined;
// On a public deployment every settlement spends our fees, so it can be limited to known sellers and a minimum price.
// On mainnet those fees are real, so the safe policy is the default: only this deployment's own seller, and no dust.
// `PAY_TO` is the demo API's seller, which shares this process on the mainnet deployment.
const MAINNET = NETWORK === "stellar:pubnet";
const PAY_TO_ALLOWLIST = (process.env.PAY_TO_ALLOWLIST ?? (MAINNET ? process.env.PAY_TO ?? "" : "")).split(",").map((a) => a.trim()).filter(Boolean);
const MIN_AMOUNT = BigInt(process.env.MIN_AMOUNT || (MAINNET ? "100000" : "0"));

// Bazaar catalog: every resource that settles here and declares discovery info, keyed by URL.
const catalog = new Map<string, DiscoveryResource>();

const signers = SECRETS.map((secret) => createEd25519Signer(secret, NETWORK));
const channels = new ChannelPool(signers.map((signer) => signer.address));
const facilitator = new x402Facilitator()
  .register(NETWORK, new ExactStellarScheme(signers, {
    rpcConfig,
    selectSigner: channels.select,
    feeBumpSigner: feeBumpSigner(signers[0], { network: NETWORK, rpcConfig }),
  }))
  .register(
    NETWORK,
    new ExactFxFacilitatorScheme(signers, { fxContract: fx.fxContract, sendAssets: SEND_ASSETS, rpcConfig, selectSigner: channels.select }),
  )
  .registerExtension(BAZAAR)
  .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
    const discovered = result.success && extractDiscoveryInfo(paymentPayload, requirements);
    if (!discovered) return;
    const { resourceUrl, x402Version, discoveryInfo, ...metadata } = discovered;
    const accepts = (catalog.get(resourceUrl)?.accepts ?? []).filter((a) => a.scheme !== requirements.scheme);
    catalog.set(resourceUrl, {
      ...metadata,
      resource: resourceUrl,
      type: discoveryInfo.input.type,
      x402Version,
      accepts: [...accepts, requirements],
      lastUpdated: new Date().toISOString(),
    });
  });

// Per-client request caps per minute. Verification simulates on RPC and settlement spends fees, so both are bounded.
const LIMITS = { verify: 60, settle: 20 };
const windows = new Map<string, { minute: number; count: number }>();
function withinLimit(route: keyof typeof LIMITS, client: string | undefined): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `${route}:${client}`;
  const window = windows.get(key);
  if (window?.minute === minute) {
    window.count++;
    return window.count <= LIMITS[route];
  }
  // Drop the entries that expired, not the whole map: clearing it handed every client already over the
  // cap a fresh allowance, which is exactly what an attacker filling the map with fake IPs would want.
  if (windows.size > 1_000) {
    for (const [other, seen] of windows) if (seen.minute !== minute) windows.delete(other);
  }
  windows.set(key, { minute, count: 1 });
  return true;
}

/** Why this facilitator refuses to handle the requirements, if it does. */
function refusal(body: unknown): string | undefined {
  // `x402Facilitator.verify/settle` does not validate the body's shape, and neither did this: a payload
  // of the wrong type reached the scheme and came back as an opaque crash instead of a reason.
  if (!body || typeof body !== "object") return "invalid_request_body";
  const { paymentPayload, paymentRequirements } = body as { paymentPayload?: unknown; paymentRequirements?: unknown };
  if (!paymentPayload || typeof paymentPayload !== "object") return "invalid_payment_payload";
  if (!paymentRequirements || typeof paymentRequirements !== "object") return "invalid_payment_requirements";
  const { scheme, network, payTo, amount } = paymentRequirements as Record<string, unknown>;
  if (typeof scheme !== "string" || typeof network !== "string" || typeof payTo !== "string") return "invalid_payment_requirements";
  if (network !== NETWORK) return "unsupported_network";
  if (PAY_TO_ALLOWLIST.length && !PAY_TO_ALLOWLIST.includes(payTo)) return "pay_to_not_allowed";
  if (!/^\d+$/.test(String(amount))) return "invalid_payment_requirements";
  if (MIN_AMOUNT && BigInt(String(amount)) < MIN_AMOUNT) return "amount_below_minimum";
  return undefined;
}

export const app = express();
// Exactly one proxy (Vercel's edge, or nothing in local development). With `true`, express takes the
// leftmost `X-Forwarded-For` entry, which the client writes itself: every caller could pick its own
// `req.ip` and get an unlimited number of rate-limit buckets.
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));

console.log(
  `facilitator on ${NETWORK}: ${signers.length} fee payer(s), ` +
    `payTo ${PAY_TO_ALLOWLIST.length ? `restricted to ${PAY_TO_ALLOWLIST.length} seller(s)` : "unrestricted"}, ` +
    `minimum amount ${MIN_AMOUNT || "none"}`,
);

app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
});

app.get("/discovery/resources", (req, res) => {
  const items = [...catalog.values()].filter((item) => !req.query.type || item.type === req.query.type);
  const limit = Number(req.query.limit ?? 100);
  const offset = Number(req.query.offset ?? 0);
  res.json({ x402Version: 2, items: items.slice(offset, offset + limit), pagination: { limit, offset, total: items.length } });
});

app.post("/verify", async (req, res) => {
  if (!withinLimit("verify", req.ip)) {
    res.status(429).json({ isValid: false, invalidReason: "rate_limited" });
    return;
  }
  const { paymentPayload, paymentRequirements } = req.body ?? {};
  const refused = refusal(req.body);
  if (refused) {
    res.json({ isValid: false, invalidReason: refused });
    return;
  }
  const result = await facilitator.verify(paymentPayload, paymentRequirements);
  console.log(`verify ${paymentRequirements?.scheme}: ${result.isValid ? "valid" : result.invalidReason}`);
  res.json(result);
});

app.post("/settle", async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body ?? {};
  if (!withinLimit("settle", req.ip)) {
    res.status(429).json({ success: false, network: paymentRequirements?.network, transaction: "", errorReason: "rate_limited" });
    return;
  }
  const refused = refusal(req.body);
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

export const feePayers = signers.map((signer) => signer.address);
