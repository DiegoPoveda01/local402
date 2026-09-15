// A real Local402 payment on Stellar mainnet: runs the facilitator and the demo API locally on pubnet,
// then the agent buys /indicadores (50 CLP) with each asset given. Spends real funds (cents).
// Needs the accounts from scripts/mainnet/setup.ts and FX_CONTRACT from scripts/mainnet/deploy-fxpay.sh.
//
// FX_CONTRACT=C... npx tsx scripts/mainnet/pay.ts USDC XLM EURC
//
// Each payment is appended to apps/demo-api/public/mainnet-payments.json (public data only) for the dashboard.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { Local402Client, type PayAsset } from "@local402/client";

const OUT = "apps/demo-api/public/mainnet-payments.json";
const assets = process.argv.slice(2).map((a) => a.toUpperCase() as PayAsset);
if (!process.env.FX_CONTRACT || !assets.length || assets.some((a) => !["USDC", "XLM", "EURC"].includes(a))) {
  console.error("Usage: FX_CONTRACT=C... npx tsx scripts/mainnet/pay.ts USDC [XLM] [EURC]");
  process.exit(1);
}

const secret = (identity: string) => execFileSync("stellar", ["keys", "secret", identity], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const listen = (app: Express) => new Promise<number>((resolve) => {
  const server = app.listen(0, () => resolve((server.address() as AddressInfo).port));
});

// Both apps read their configuration from the environment when imported.
Object.assign(process.env, {
  NETWORK: "stellar:pubnet",
  FACILITATOR_PRIVATE_KEY: secret("local402-mainnet"),
  FACILITATOR_PRIVATE_KEYS: "",
  PAY_TO: Keypair.fromSecret(secret("local402-mainnet-seller")).publicKey(),
  RECEIPTS_FILE: join(tmpdir(), "local402-mainnet-receipts.json"),
  KV_REST_API_URL: "",
  UPSTASH_REDIS_REST_URL: "",
});
const facilitatorPort = await listen((await import("../../apps/facilitator/src/app.js")).app);
process.env.FACILITATOR_URL = `http://localhost:${facilitatorPort}`;
const apiPort = await listen((await import("../../apps/demo-api/src/app.js")).app);

const agentSecret = secret("local402-mainnet-agent");
const log: unknown[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
let failed = false;
for (const payWith of assets) {
  // Mainnet keeps the client's default guards: at most 2% over its own oracle, and swaps at most 5% over Reflector.
  const client = new Local402Client({ secret: agentSecret, network: "stellar:pubnet", payWith, fxContract: process.env.FX_CONTRACT, maxPrice: "100 CLP" });
  try {
    const paid = await client.pay(`http://localhost:${apiPort}/indicadores`);
    if ("free" in paid) throw new Error("resource was not paywalled");
    console.log(`${payWith}: ${paid.explorerUrl}${paid.fx ? ` (swap premium ${paid.fx.premiumBps / 100}% vs Reflector)` : ""}`);
    log.push({
      paidAt: new Date().toISOString(),
      resource: "/indicadores",
      local: paid.price.local && { amount: paid.price.local.amount, currency: paid.price.local.currency },
      usdc: paid.price.amount,
      payWith,
      spent: paid.spent?.amount ?? paid.price.amount,
      fxPremiumBps: paid.fx?.premiumBps,
      payer: client.address,
      payTo: process.env.PAY_TO,
      transaction: paid.transaction,
    });
    writeFileSync(OUT, `${JSON.stringify(log, null, 2)}\n`);
  } catch (error) {
    failed = true;
    console.error(`${payWith}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
  }
}
process.exit(failed ? 1 : 0);
