import { fileURLToPath } from "node:url";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import type { AssetAmount, Network } from "@x402/core/types";
import { localPrice, ReflectorFiatOracle } from "@local402/pricing";
import { ExactFxServerScheme, FX_SCHEME } from "@local402/fx";
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

const oracle = new ReflectorFiatOracle();
const receipts = new ReceiptBook(process.env.RECEIPTS_FILE ?? fileURLToPath(new URL("../data/receipts.json", import.meta.url)));
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }))
  .register(NETWORK, new ExactStellarScheme())
  .register(NETWORK, new ExactFxServerScheme())
  .onAfterSettle(receipts.record);

// Each product shares one quote across both options, so USDC and XLM payers are charged the same USDC amount.
const products = [
  { path: "/indicadores", price: "50 CLP", description: "Indicadores de mercado para Chile, cobrados en pesos chilenos" },
  { path: "/europa", price: "0.05 EUR", description: "Tipos de cambio del euro, cobrados en euros" },
].map((product) => ({ ...product, quote: localPrice(product.price, { network: NETWORK, oracle }) }));

const app = express();

app.use(
  paymentMiddleware(
    Object.fromEntries(
      products.map(({ path, quote, description }) => [
        `GET ${path}`,
        {
          accepts: [
            { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: quote },
            { scheme: FX_SCHEME, network: NETWORK, payTo: PAY_TO, price: quote },
          ],
          description,
          mimeType: "application/json",
        },
      ]),
    ),
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

// --- Dashboard support: free, read-only views of prices and receipts. ---

app.get("/catalog", async (_req, res) => {
  const items = await Promise.all(
    products.map(async ({ path, price, description, quote }) => {
      const { amount, extra } = (await quote({} as never)) as AssetAmount;
      return { path, price, description, usdcAmount: amount, quote: extra?.local402 };
    }),
  );
  res.json({ network: NETWORK, payTo: PAY_TO, demoAgent: Boolean(DEMO_AGENT_SECRET), items });
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
      r.spent ? "XLM" : "USDC",
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
  const payWith = (String(req.query.with ?? "USDC").toUpperCase() === "XLM" ? "XLM" : "USDC") as PayAsset;
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
