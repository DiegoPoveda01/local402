// A route priced in Chilean pesos, paid in USDC on Stellar testnet. See README.md here to run it.
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { local402Server, localRoute } from "local402-server";

const app = express();
app.use(
  paymentMiddleware(
    { "GET /weather": localRoute("50 CLP", { payTo: process.env.PAY_TO! }) },
    local402Server(process.env.FACILITATOR_URL),
  ),
);
app.get("/weather", (_req, res) => res.json({ city: "Santiago", celsius: 18 }));
app.listen(4021, () => console.log("50 CLP per call: http://localhost:4021/weather"));
