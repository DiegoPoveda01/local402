import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { BAZAAR, extractDiscoveryInfo, type DiscoveryResource } from "@x402/extensions/bazaar";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { ExactFxFacilitatorScheme, FX_TESTNET } from "@local402/fx";

const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const SECRET = process.env.FACILITATOR_PRIVATE_KEY;
if (!SECRET) {
  throw new Error("FACILITATOR_PRIVATE_KEY (fee-paying Stellar account) is required. See .env.example");
}
const FX_CONTRACT = process.env.FX_CONTRACT ?? FX_TESTNET.fxContract;
const SEND_ASSETS = (process.env.SEND_ASSETS ?? `${FX_TESTNET.xlm},${FX_TESTNET.eurc}`).split(",");

// Bazaar catalog: every resource that settles here and declares discovery info, keyed by URL.
const catalog = new Map<string, DiscoveryResource>();

const signer = createEd25519Signer(SECRET, NETWORK);
const facilitator = new x402Facilitator()
  .register(NETWORK, new ExactStellarScheme([signer]))
  .register(NETWORK, new ExactFxFacilitatorScheme(signer, { fxContract: FX_CONTRACT, sendAssets: SEND_ASSETS }))
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

export const app = express();
app.use(express.json());

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
  const { paymentPayload, paymentRequirements } = req.body ?? {};
  const result = await facilitator.verify(paymentPayload, paymentRequirements);
  console.log(`verify ${paymentRequirements?.scheme}: ${result.isValid ? "valid" : result.invalidReason}`);
  res.json(result);
});

app.post("/settle", async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body ?? {};
  const result = await facilitator.settle(paymentPayload, paymentRequirements);
  console.log(`settle ${paymentRequirements?.scheme}: ${result.success ? result.transaction : result.errorReason}`);
  res.json(result);
});

export const feePayer = signer.address;
