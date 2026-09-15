import { fileURLToPath } from "node:url";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import type { DynamicPrice, PaymentOption } from "@x402/core/http";
import type { AssetAmount, Network } from "@x402/core/types";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { chileUf, quoteLocalPrice, REFLECTOR_CEX, ReflectorFiatOracle, UfRateSource, type UfValueSource } from "@local402/pricing";
import { fxNetwork, mainnetShadowQuote, quoteFx } from "@local402/fx";
import { local402Server, localRoute } from "@local402/server";
import { Local402Client, oracleSendAmount, type PayAsset } from "@local402/client";
import { ReceiptBook, Redis } from "./receipts.js";

const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4022";
const PAY_TO = process.env.PAY_TO;
if (!PAY_TO) {
  throw new Error("PAY_TO (seller Stellar address) is required. See .env.example");
}
const DEMO_AGENT_SECRET = process.env.DEMO_AGENT_SECRET;
const PAY_ASSETS: PayAsset[] = ["USDC", "XLM", "EURC"];
const fxConfig = fxNetwork(NETWORK, process.env.FX_CONTRACT || undefined);
const rpcUrl = process.env.RPC_URL || fxConfig.rpcUrl;
// Symbols for the assets payers can spend through exact-fx, keyed by contract.
const ASSET_SYMBOLS: Record<string, string> = { [fxConfig.xlm]: "XLM", [fxConfig.eurc]: "EURC" };

const redis = Redis.fromEnv();
// Serverless instances start without the UfRateSource cache, so the last UF value also lives in Redis
// for when every UF source is down. Like the cache, it is used for up to three days.
const UF_KEY = "local402:uf";
const ufValue: UfValueSource = async () => {
  try {
    const uf = await chileUf();
    await redis?.pipeline(["SET", UF_KEY, JSON.stringify({ ...uf, savedAt: Date.now() })]).catch(() => undefined);
    return uf;
  } catch (error) {
    const [saved] = redis ? await redis.pipeline(["GET", UF_KEY]).catch(() => []) : [];
    const last = typeof saved === "string" ? (JSON.parse(saved) as { clp: string; source: string; savedAt: number }) : undefined;
    if (last && Date.now() - last.savedAt < 3 * 24 * 60 * 60 * 1000) return { clp: last.clp, source: last.source };
    throw error;
  }
};
// Reflector on-chain rates, plus UF (CLF) composed from its daily CLP value.
const oracle = new UfRateSource(new ReflectorFiatOracle(), ufValue);
// USD value of the send assets, as the client checks them: XLM from Reflector's exchange feed, EURC at the euro rate.
const exchanges = new ReflectorFiatOracle(REFLECTOR_CEX);
const sendAssetRate = (symbol: string) => (symbol === "XLM" ? exchanges.getRate("XLM") : oracle.getRate("EUR"));
// Receipts record what a swap actually cost against those rates.
const fxPremium = async (spent: { asset: string; amount: string }, settledAmount: string) => {
  const symbol = ASSET_SYMBOLS[spent.asset];
  if (!symbol) return undefined;
  const oracleSend = oracleSendAmount(settledAmount, await sendAssetRate(symbol));
  return Number(((BigInt(spent.amount) - oracleSend) * 10_000n) / oracleSend);
};
const receipts = new ReceiptBook({ redis, key: process.env.RECEIPTS_KEY || undefined, fxPremium, file: process.env.RECEIPTS_FILE ?? fileURLToPath(new URL("../data/receipts.json", import.meta.url)) });
const server = local402Server(FACILITATOR_URL, NETWORK).onAfterSettle(receipts.record);

// The output examples are published through Bazaar so agents can find these routes before paying.
const products = [
  {
    path: "/indicadores",
    price: "50 CLP",
    description: "Indicadores de mercado para Chile, cobrados en pesos chilenos",
    example: { dolarObservado: { clpPorUsd: 951.71, fuente: "reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC", timestamp: 1789450500 }, euro: { clpPorEur: 1098.49 }, real: { clpPorBrl: 175.86 } },
  },
  {
    path: "/europa",
    price: "0.05 EUR",
    description: "Tipos de cambio del euro, cobrados en euros",
    example: { usdPorEur: 1.1542, gbpPorEur: 0.8671, brlPorEur: 6.2464, clpPorEur: 1098.49, fuente: "reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC", timestamp: 1789450500 },
  },
  {
    path: "/uf",
    price: "0.01 UF",
    description: "Valor de la UF en pesos y dólares, cobrado en UF",
    example: { clpPorUf: 40934.18, usdPorUf: 43.0118, fuente: "sii.cl:uf*reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC", timestamp: 1789450500 },
  },
].map(({ path, price, description, example }) => {
  const route = localRoute(price, {
    payTo: PAY_TO,
    network: NETWORK,
    oracle,
    description,
    serviceName: "Local402 demo",
    tags: ["local-currency", "fx", "chile"],
    extensions: declareDiscoveryExtension({ output: { example } }),
  });
  return { path, price, description, route, quote: (route.accepts as PaymentOption[])[0].price as DynamicPrice };
});

export const app = express();
// Behind Vercel or another proxy, so paid resource URLs keep their https scheme.
app.set("trust proxy", true);

// Lets a dashboard on another origin (CORS_ORIGIN) pay here from the visitor's own wallet.
const CORS_ORIGIN = process.env.CORS_ORIGIN;
if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.set({
      "Access-Control-Allow-Origin": CORS_ORIGIN,
      "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, Content-Type",
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
      Vary: "Origin",
    });
    if (req.method === "OPTIONS") res.sendStatus(204);
    else next();
  });
}

app.use(
  paymentMiddleware(
    Object.fromEntries(products.map(({ path, route }) => [`GET ${path}`, route])),
    server,
  ),
);

const usd = async (currency: string) => {
  const rate = await oracle.getRate(currency);
  return { value: Number(rate.usdPerUnit) / 10 ** rate.decimals, rate };
};

app.get("/indicadores", async (_req, res) => {
  const [clp, eur, brl] = await Promise.all(["CLP", "EUR", "BRL"].map(usd));
  res.json({
    dolarObservado: { clpPorUsd: +(1 / clp.value).toFixed(2), fuente: clp.rate.source, timestamp: clp.rate.timestamp },
    euro: { clpPorEur: +(eur.value / clp.value).toFixed(2) },
    real: { clpPorBrl: +(brl.value / clp.value).toFixed(2) },
  });
});

app.get("/europa", async (_req, res) => {
  const [eur, gbp, brl, clp] = await Promise.all(["EUR", "GBP", "BRL", "CLP"].map(usd));
  res.json({
    usdPorEur: +eur.value.toFixed(4),
    gbpPorEur: +(eur.value / gbp.value).toFixed(4),
    brlPorEur: +(eur.value / brl.value).toFixed(4),
    clpPorEur: +(eur.value / clp.value).toFixed(2),
    fuente: eur.rate.source,
    timestamp: eur.rate.timestamp,
  });
});

app.get("/uf", async (_req, res) => {
  const [uf, clp] = await Promise.all(["CLF", "CLP"].map(usd));
  res.json({
    clpPorUf: +(uf.value / clp.value).toFixed(2),
    usdPorUf: +uf.value.toFixed(4),
    fuente: uf.rate.source,
    timestamp: uf.rate.timestamp,
  });
});

// --- Dashboard support: free, read-only views of prices and receipts. ---

app.get("/catalog", async (_req, res) => {
  // One product whose rate source is down (the UF comes from off-chain sites) must not take the others with it.
  const items = await Promise.all(
    products.map(async ({ path, price, description, quote }) => {
      try {
        const { amount, extra } = (await quote({} as never)) as AssetAmount;
        return { path, price, description, usdcAmount: amount, quote: extra?.local402 };
      } catch (error) {
        return { path, price, description, error: (error instanceof Error ? error.message : String(error)).split("\n")[0] };
      }
    }),
  );
  // How many resources agents can already find through the facilitator's Bazaar catalog.
  const discovered = await fetch(`${FACILITATOR_URL}/discovery/resources?limit=1`, { signal: AbortSignal.timeout(5_000) })
    .then(async (r) => ((await r.json()) as { pagination: { total: number } }).pagination.total)
    .catch(() => null);
  res.json({ network: NETWORK, payTo: PAY_TO, fxContract: fxConfig.fxContract, demoAgent: Boolean(DEMO_AGENT_SECRET), payAssets: PAY_ASSETS, assetSymbols: ASSET_SYMBOLS, discovered, items });
});

// Price calculator: what any local price costs in each payment asset right now, without paying.
// Next to the testnet pools it shows the oracle value and a read-only mainnet quote for the same swap.
app.get("/demo/quote", async (req, res) => {
  try {
    const quote = await quoteLocalPrice(String(req.query.price ?? ""), { oracle });
    const { asset } = (await products[0].quote({} as never)) as AssetAmount;
    const fx = await Promise.all(
      Object.entries(ASSET_SYMBOLS).map(async ([contract, symbol]) => {
        const [pay, rate, mainnet] = await Promise.all([
          quoteFx({ fxContract: fxConfig.fxContract!, sendAsset: contract, rpcConfig: rpcUrl ? { url: rpcUrl } : undefined }, NETWORK, asset, quote.tokenAmount),
          sendAssetRate(symbol).catch(() => undefined),
          mainnetShadowQuote(symbol as "XLM" | "EURC", BigInt(quote.tokenAmount)),
        ]);
        return { symbol, pay: pay.toString(), oracle: rate && oracleSendAmount(quote.tokenAmount, rate).toString(), mainnet };
      }),
    );
    res.json({
      quote,
      pay: { USDC: quote.tokenAmount, ...Object.fromEntries(fx.map((f) => [f.symbol, f.pay])) },
      oracle: Object.fromEntries(fx.map((f) => [f.symbol, f.oracle])),
      mainnet: Object.fromEntries(fx.map((f) => [f.symbol, f.mainnet])),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/receipts", async (_req, res) => {
  res.json(await receipts.list());
});

app.get("/receipts.csv", async (_req, res) => {
  const header = "id,fecha,recurso,monto_local,moneda,usd_por_unidad,fuente_tasa,usdc_recibido,activo_pagado,monto_pagado,prima_fx_bps,esquema,pagador,transaccion";
  const rows = (await receipts.list()).map((r) =>
    [
      r.id,
      r.paidAt,
      r.resource,
      r.local.amount,
      r.local.currency,
      r.rate.usdPerUnit,
      r.rate.source,
      Number(r.settled.amount) / 10 ** r.settled.decimals,
      r.spent ? (ASSET_SYMBOLS[r.spent.asset] ?? r.spent.asset) : "USDC",
      r.spent ? Number(r.spent.amount) / 1e7 : Number(r.settled.amount) / 10 ** r.settled.decimals,
      r.fxPremiumBps ?? "",
      r.scheme,
      r.payer ?? "",
      r.transaction,
    ].join(","),
  );
  res.type("text/csv").attachment("local402-recibos.csv").send([header, ...rows].join("\n"));
});

app.get("/receipts/stream", (_req, res) => {
  receipts.subscribe(res);
});

// Demo payments spend a shared testnet wallet, so they are capped per minute, per visitor and overall.
const PAY_LIMITS = { perVisitor: 3, overall: 20 };
const windows = new Map<string, number>();
async function withinLimit(key: string, max: number): Promise<boolean> {
  const bucket = `local402:limit:${key}:${Math.floor(Date.now() / 60_000)}`;
  if (redis) {
    const [count] = await redis.pipeline(["INCR", bucket], ["EXPIRE", bucket, 120]);
    return Number(count) <= max;
  }
  if (windows.size > 10_000) windows.clear();
  const count = (windows.get(bucket) ?? 0) + 1;
  windows.set(bucket, count);
  return count <= max;
}

// Demo only: lets the dashboard trigger a real agent payment against this API.
app.post("/demo/pay", async (req, res) => {
  // A public button must not spend real money: mainnet payments run from scripts/mainnet/pay.ts instead.
  if (!DEMO_AGENT_SECRET || NETWORK !== "stellar:testnet") {
    res.status(404).json({ error: "Demo payments need DEMO_AGENT_SECRET and run on testnet only" });
    return;
  }
  if (!(await withinLimit(`ip:${req.ip}`, PAY_LIMITS.perVisitor)) || !(await withinLimit("all", PAY_LIMITS.overall))) {
    res.status(429).json({ error: "Demasiados pagos de demo por minuto. Espera un momento y vuelve a intentarlo." });
    return;
  }
  const requested = String(req.query.with ?? "USDC").toUpperCase() as PayAsset;
  const payWith = PAY_ASSETS.includes(requested) ? requested : "USDC";
  const path = products.some((p) => p.path === req.query.path) ? String(req.query.path) : products[0].path;
  try {
    // The client refuses swaps more than 5% above the oracle. Testnet pools are seeded with arbitrary prices
    // (tstEURC trades near 0.74 USD), so the demo allows more there and shows the premium next to each payment.
    const client = new Local402Client({ secret: DEMO_AGENT_SECRET, payWith, maxFxPremiumBps: 10_000 });
    // The agent buys from this same API, at the address the dashboard was opened on.
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json(await client.pay(`${origin}${path}`));
  } catch (error) {
    // Soroban simulation errors carry a full event log; the first line is the reason.
    res.status(502).json({ error: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
  }
});

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

// A price that can't be quoted right now (for example, every UF source is down) is a temporary outage, not a bug.
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(503).json({ error: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
});

export const config = { network: NETWORK, payTo: PAY_TO };
