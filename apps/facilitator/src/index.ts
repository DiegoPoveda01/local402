import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { ExactFxFacilitatorScheme, FX_TESTNET } from "@local402/fx";

const PORT = Number(process.env.PORT ?? 4022);
const NETWORK = (process.env.NETWORK ?? "stellar:testnet") as Network;
const SECRET = process.env.FACILITATOR_PRIVATE_KEY;
if (!SECRET) {
  throw new Error("FACILITATOR_PRIVATE_KEY (fee-paying Stellar account) is required. See .env.example");
}
const FX_CONTRACT = process.env.FX_CONTRACT ?? FX_TESTNET.fxContract;
const SEND_ASSETS = (process.env.SEND_ASSETS ?? FX_TESTNET.xlm).split(",");

const signer = createEd25519Signer(SECRET, NETWORK);
const facilitator = new x402Facilitator()
  .register(NETWORK, new ExactStellarScheme([signer]))
  .register(NETWORK, new ExactFxFacilitatorScheme(signer, { fxContract: FX_CONTRACT, sendAssets: SEND_ASSETS }));

const app = express();
app.use(express.json());

app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
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

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`Local402 facilitator on http://localhost:${PORT} (${NETWORK}, fees paid by ${signer.address})`);
});
