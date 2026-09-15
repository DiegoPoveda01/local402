import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import type { Network } from "@x402/core/types";
import { localPrice, ReflectorFiatOracle } from "@local402/pricing";
import { ExactFxServerScheme, FX_SCHEME } from "@local402/fx";

const PORT = Number(process.env.PORT ?? 3001);
const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4022";
const PAY_TO = process.env.PAY_TO;
if (!PAY_TO) {
  throw new Error("PAY_TO (seller Stellar address) is required. See .env.example");
}

const oracle = new ReflectorFiatOracle();
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }))
  .register(NETWORK, new ExactStellarScheme())
  .register(NETWORK, new ExactFxServerScheme());

// One shared quote, so both options charge the same USDC amount for the same 50 CLP.
const price = localPrice("50 CLP", { network: NETWORK, oracle });

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /indicadores": {
        accepts: [
          { scheme: "exact", network: NETWORK, payTo: PAY_TO, price },
          { scheme: FX_SCHEME, network: NETWORK, payTo: PAY_TO, price },
        ],
        description: "Indicadores de mercado para Chile, cobrados en pesos chilenos",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

app.get("/indicadores", async (_req, res) => {
  const [clp, eur, brl] = await Promise.all(["CLP", "EUR", "BRL"].map((c) => oracle.getRate(c)));
  const usd = (rate: typeof clp) => Number(rate.usdPerUnit) / 10 ** rate.decimals;
  res.json({
    dolarObservado: { clpPorUsd: +(1 / usd(clp)).toFixed(2), fuente: clp.source, timestamp: clp.timestamp },
    euro: { clpPorEur: +(usd(eur) / usd(clp)).toFixed(2) },
    real: { clpPorBrl: +(usd(brl) / usd(clp)).toFixed(2) },
  });
});

app.listen(PORT, () => {
  console.log(`Local402 demo API on http://localhost:${PORT} (${NETWORK}, paying to ${PAY_TO})`);
});
