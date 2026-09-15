#!/usr/bin/env node
// local402-client quote <url>
// STELLAR_SECRET=S… local402-client pay <url> [--with USDC|XLM|EURC] [--max "1000 CLP"]
//
// The network comes from the seller's 402 response; on mainnet XLM and EURC go through the Local402 FxPay deployment.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { Keypair } from "@stellar/stellar-sdk";
import { FXPAY_MAINNET, Local402Client, type PayAsset } from "./index.js";
const DEFAULT_MAX = "1000 CLP";
const USAGE = `Usage:
  local402-client quote <url>
  STELLAR_SECRET=S... local402-client pay <url> [--with USDC|XLM|EURC] [--max "${DEFAULT_MAX}"]

--max refuses any payment worth more than that local price (default ${DEFAULT_MAX}).
The secret is read from STELLAR_SECRET only, never from arguments.`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args: string[]): Promise<void> {
  const [command, url] = args;
  if ((command !== "quote" && command !== "pay") || !url) {
    console.log(USAGE);
    process.exitCode = command === "help" || command === "--help" ? 0 : 1;
    return;
  }
  const payWith = (flag(args, "with") ?? "USDC").toUpperCase() as PayAsset;
  if (!["USDC", "XLM", "EURC"].includes(payWith)) throw new Error(`--with must be USDC, XLM or EURC, not ${payWith}`);
  const maxPrice = flag(args, "max") ?? DEFAULT_MAX;

  const probe = await fetch(url);
  const header = probe.headers.get("PAYMENT-REQUIRED");
  if (probe.status !== 402 || !header) {
    console.log(`${url} is free (HTTP ${probe.status})`);
    return;
  }
  const required = decodePaymentRequiredHeader(header);
  const network = required.accepts[0].network as Network;
  const secret = process.env.STELLAR_SECRET;
  if (command === "pay" && !secret) throw new Error("Set STELLAR_SECRET to the payer's secret key");

  const client = new Local402Client({
    // Quoting signs nothing, so a throwaway key will do.
    secret: secret ?? Keypair.random().secret(),
    network,
    payWith,
    maxPrice,
    fxContract: network === "stellar:pubnet" ? FXPAY_MAINNET : undefined,
  });

  if (command === "quote") {
    const price = await client.quote(url);
    console.log(JSON.stringify({ network, ...price }, null, 2));
    return;
  }

  console.log(`Paying ${url} on ${network} from ${client.address} with ${payWith} (limit ${maxPrice})…`);
  const result = await client.pay(url);
  if ("free" in result) {
    console.log(JSON.stringify(result.body, null, 2));
    return;
  }
  const local = result.price.local ? `${result.price.local.amount} ${result.price.local.currency}` : `${result.price.amount} units`;
  console.log(`Paid ${local} = ${Number(result.price.amount) / 1e7} USDC to ${result.price.payTo}`);
  if (result.spent) console.log(`Spent ${Number(result.spent.amount) / 1e7} ${payWith} (swap premium vs oracle ≤ ${(result.fx!.premiumBps / 100).toFixed(2)}%)`);
  console.log(result.explorerUrl);
  console.log(JSON.stringify(result.body, null, 2));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
