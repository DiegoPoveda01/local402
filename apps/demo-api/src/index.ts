import { fileURLToPath } from "node:url";
import express from "express";
import { paymentMiddleware } from "@x402/express";
import type { DynamicPrice, PaymentOption } from "@x402/core/http";
import type { AssetAmount, Network } from "@x402/core/types";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { quoteLocalPrice, ReflectorFiatOracle, UfRateSource } from "@local402/pricing";
import { FX_TESTNET, quoteFx } from "@local402/fx";
import { local402Server, localRoute } from "@local402/server";
import { Local402Client, type PayAsset } from "@local402/client";
import { ReceiptBook } from "./receipts.js";

const PORT = Number(process.env.PORT ?? 3001);
const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4022";
const PAY_TO = process.env.PAY_TO;
if (!PAY_TO) {
  throw new Error("PAY_TO (seller Stellar address) is required. See .env.example");
}
const DEMO_AGENT_SECRET = process.env.DEMO_AGENT_SECRET;
const PAY_ASSETS: PayAsset[] = ["USDC", "XLM", "EURC"];
// Symbols for the assets payers can spend through exact-fx, keyed by contract.
const ASSET_SYMBOLS: Record<string, string> = { [FX_TESTNET.xlm]: "XLM", [FX_TESTNET.eurc]: "EURC" };

// Reflector on-chain rates, plus UF (CLF) composed from its daily CLP value.
const oracle = new UfRateSource(new ReflectorFiatOracle());
const receipts = new ReceiptBook(process.env.RECEIPTS_FILE ?? fileURLToPath(new URL("../data/receipts.json", import.meta.url)));
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
    example: { clpPorUf: 40934.18, usdPorUf: 43.0118, fuente: "mindicador.cl:uf*reflector:CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC", timestamp: 1789450500 },
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

const app = express();

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
  const items = await Promise.all(
    products.map(async ({ path, price, description, quote }) => {
      const { amount, extra } = (await quote({} as never)) as AssetAmount;
      return { path, price, description, usdcAmount: amount, quote: extra?.local402 };
    }),
  );
  // How many resources agents can already find through the facilitator's Bazaar catalog.
  const discovered = await fetch(`${FACILITATOR_URL}/discovery/resources?limit=1`)
    .then(async (r) => ((await r.json()) as { pagination: { total: number } }).pagination.total)
    .catch(() => null);
  res.json({ network: NETWORK, payTo: PAY_TO, demoAgent: Boolean(DEMO_AGENT_SECRET), payAssets: PAY_ASSETS, assetSymbols: ASSET_SYMBOLS, discovered, items });
});

// Price calculator: what any local price costs in each payment asset right now, without paying.
app.get("/demo/quote", async (req, res) => {
  try {
    const quote = await quoteLocalPrice(String(req.query.price ?? ""), { oracle });
    const { asset } = (await products[0].quote({} as never)) as AssetAmount;
    const pay = Object.fromEntries(
      await Promise.all(
        Object.entries(ASSET_SYMBOLS).map(async ([contract, symbol]) => [
          symbol,
          (await quoteFx({ fxContract: FX_TESTNET.fxContract, sendAsset: contract }, NETWORK, asset, quote.tokenAmount)).toString(),
        ]),
      ),
    );
    res.json({ quote, pay: { USDC: quote.tokenAmount, ...pay } });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/receipts", (_req, res) => {
  res.json(receipts.list());
});

app.get("/receipts.csv", (_req, res) => {
  const header = "id,fecha,recurso,monto_local,moneda,usd_por_unidad,fuente_tasa,usdc_recibido,activo_pagado,monto_pagado,esquema,pagador,transaccion";
  const rows = receipts.list().map((r) =>
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

// Demo only: lets the dashboard trigger a real agent payment against this API.
app.post("/demo/pay", async (req, res) => {
  if (!DEMO_AGENT_SECRET) {
    res.status(404).json({ error: "Set DEMO_AGENT_SECRET to enable demo payments" });
    return;
  }
  const requested = String(req.query.with ?? "USDC").toUpperCase() as PayAsset;
  const payWith = PAY_ASSETS.includes(requested) ? requested : "USDC";
  const path = products.some((p) => p.path === req.query.path) ? String(req.query.path) : products[0].path;
  try {
    const client = new Local402Client({ secret: DEMO_AGENT_SECRET, payWith });
    res.json(await client.pay(`http://localhost:${PORT}${path}`));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`Local402 demo API on http://localhost:${PORT} (${NETWORK}, paying to ${PAY_TO})`);
});
