import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network, SettleResponse } from "@x402/core/types";
import { BAZAAR, extractDiscoveryInfo, type DiscoveryResource } from "@x402/extensions/bazaar";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { ChannelPool, ExactFxFacilitatorScheme, fxNetwork } from "@local402/fx";

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

// Bazaar catalog: every resource that settles here and declares discovery info, keyed by URL.
const catalog = new Map<string, DiscoveryResource>();

const signers = SECRETS.map((secret) => createEd25519Signer(secret, NETWORK));
const channels = new ChannelPool(signers.map((signer) => signer.address));
const facilitator = new x402Facilitator()
  .register(NETWORK, new ExactStellarScheme(signers, { rpcConfig, selectSigner: channels.select }))
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
const windows = new Map<string, number>();
function withinLimit(route: keyof typeof LIMITS, client: string | undefined): boolean {
  const key = `${route}:${client}:${Math.floor(Date.now() / 60_000)}`;
  if (windows.size > 10_000) windows.clear();
  const count = (windows.get(key) ?? 0) + 1;
  windows.set(key, count);
  return count <= LIMITS[route];
}

export const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "64kb" }));

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
