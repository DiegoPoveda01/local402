#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";
import type { Network } from "@x402/core/types";
import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";
import { FXPAY_MAINNET, type PayAsset } from "@local402/client";
import { quoteLocalPrice, ReflectorFiatOracle, UfRateSource, type LocalQuote } from "@local402/pricing";
import { PaymentHistory } from "./history.js";
import { parseLimits } from "./limits.js";
import { AgentWallet, PAY_ASSETS } from "./wallet.js";

/**
 * Reads a secret from stellar-cli. An MCP host launches this server without a login shell, so the
 * binary is looked for by every name it ships under and in the directory its installer uses, rather
 * than trusting `PATH` to contain it.
 */
function identitySecret(identity: string): string {
  const local = join(homedir(), ".local", "bin");
  const candidates = ["stellar", "stellar.cmd", "stellar.exe", join(local, "stellar"), join(local, "stellar.exe")];
  const tried: string[] = [];
  for (const binary of candidates) {
    try {
      return execFileSync(binary, ["keys", "secret", identity], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (error) {
      // Only "no such binary" is worth trying the next name for; anything else is stellar-cli answering.
      // EINVAL is Node on Windows refusing to execFile a .cmd without a shell, so it means the same.
      if (!["ENOENT", "EINVAL"].includes((error as { code?: string }).code ?? "")) {
        const detail = String((error as { stderr?: unknown }).stderr ?? "").trim() || (error as Error).message;
        throw new Error(`stellar keys secret ${identity} failed: ${detail.split("\n")[0]}`);
      }
      tried.push(binary);
    }
  }
  throw new Error(
    `stellar-cli not found, so STELLAR_IDENTITY "${identity}" cannot be read. Set STELLAR_PRIVATE_KEY instead, ` +
      `or put the binary on the PATH this server is started with. Tried: ${tried.join(", ")}`,
  );
}

// A stellar-cli identity keeps the secret out of MCP config files.
const identity = process.env.STELLAR_IDENTITY;
const SECRET = process.env.STELLAR_PRIVATE_KEY ?? (identity ? identitySecret(identity) : undefined);
if (!SECRET) {
  throw new Error("Set STELLAR_IDENTITY (a stellar-cli identity) or STELLAR_PRIVATE_KEY. See .env.example");
}

// Testnet unless mainnet is asked for by its exact name: a typo must not move real money.
const NETWORK = (process.env.NETWORK || "stellar:testnet") as Network;
if (NETWORK !== "stellar:testnet" && NETWORK !== "stellar:pubnet") {
  throw new Error(`NETWORK must be stellar:testnet (the default) or stellar:pubnet, not "${process.env.NETWORK}"`);
}
const MAINNET = NETWORK === "stellar:pubnet";
const fxContract = process.env.FX_CONTRACT || (MAINNET ? FXPAY_MAINNET : undefined);
const HORIZON_URL = process.env.HORIZON_URL || (MAINNET ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");

const requested = (process.env.PAY_WITH ?? "USDC").toUpperCase();
if (!(PAY_ASSETS as readonly string[]).includes(requested)) {
  throw new Error(`PAY_WITH must be one of ${PAY_ASSETS.join(", ")}, not "${process.env.PAY_WITH}"`);
}
const payWith = requested as PayAsset;
const limits = parseLimits(process.env);
// The oracle sellers price with, so a limit in pesos means what the seller means by pesos.
const oracle = new UfRateSource(new ReflectorFiatOracle());
const address = Keypair.fromSecret(SECRET).publicKey();
// One history per wallet and network, so testnet spending never counts against a mainnet limit.
const historyFile =
  process.env.LOCAL402_HISTORY || join(homedir(), ".local402", `history-${MAINNET ? "pubnet" : "testnet"}-${address}.jsonl`);
const wallet = new AgentWallet({ secret: SECRET, network: NETWORK, fxContract, oracle }, limits, new PaymentHistory(historyFile), payWith);
// An explicit FACILITATOR_URL keeps local overrides working; a stranger with no config gets the hosted
// facilitator for the network they selected.
const bazaar = withBazaar(
  new HTTPFacilitatorClient({
    url: process.env.FACILITATOR_URL ||
      (MAINNET ? "https://local402-mainnet.vercel.app/facilitator" : "https://local402.vercel.app/facilitator"),
  }),
);

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});
const where = MAINNET ? "Stellar mainnet" : "Stellar testnet";

const server = new McpServer({ name: "local402", version: "1.0.0" });

server.registerTool(
  "local402_discover",
  {
    title: "Find x402 resources priced in local currency",
    description:
      "Lists paid HTTP resources catalogued by the Local402 facilitator (x402 Bazaar): URL, description, local price (CLP, EUR, UF...), accepted payment assets and an example response. Can filter by the currency a resource is priced in and by a maximum price in any currency. Call local402_quote or local402_pay next.",
    inputSchema: {
      currency: z.string().optional().describe("Only resources priced in this currency, e.g. CLP or EUR"),
      maxPrice: z.string().optional().describe('Only resources that cost at most this, in any currency, e.g. "1000 CLP"'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ currency, maxPrice }) => {
    try {
      const [{ items }, cap] = await Promise.all([
        bazaar.extensions.bazaar.listResources({ type: "http" }),
        maxPrice ? quoteLocalPrice(maxPrice, { oracle }) : undefined,
      ]);
      const resources = items.map((item) => {
        const quote = item.accepts.find((a) => a.extra?.local402)?.extra?.local402 as LocalQuote | undefined;
        const info = (item.extensions?.bazaar as { info?: { output?: { example?: unknown } } } | undefined)?.info;
        return {
          url: item.resource,
          description: item.description,
          price: quote ? `${quote.localAmount} ${quote.currency}` : undefined,
          currency: quote?.currency,
          usdcUnits: quote?.tokenAmount ?? item.accepts[0]?.amount,
          payWith: item.accepts.some((a) => a.scheme === "exact-fx") ? ["USDC", "XLM", "EURC"] : ["USDC"],
          exampleResponse: info?.output?.example,
        };
      });
      return text(
        resources
          .filter((r) => !currency || r.currency === currency.toUpperCase())
          .filter((r) => !cap || (r.usdcUnits !== undefined && BigInt(r.usdcUnits) <= BigInt(cap.tokenAmount)))
          .map(({ url, description, price, payWith, exampleResponse }) => ({ url, description, price, payWith, exampleResponse })),
      );
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_quote",
  {
    title: "Quote an x402 resource",
    description:
      "Shows what an x402 HTTP resource costs without paying: the price in local currency (CLP, EUR...), the USDC amount, the exchange rate used, and whether the per-payment, daily and total limits would allow it.",
    inputSchema: { url: z.string().url() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      return text(await wallet.quote(url));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_pay",
  {
    title: "Pay for and fetch an x402 resource",
    description: `Fetches an HTTP resource and pays for it on ${where} if it returns 402. Pays with ${payWith} unless payWith says otherwise (XLM or EURC is swapped to the seller's USDC in the same transaction). Refuses prices above ${limits.payment}, and payments past ${limits.day} per day or ${limits.total} in total. Returns the response body, the receipt and the transaction link.`,
    inputSchema: { url: z.string().url(), payWith: z.enum(PAY_ASSETS).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ url, payWith: asset }) => {
    try {
      return text(await wallet.pay(url, asset));
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "local402_history",
  {
    title: "List past payments",
    description: `Lists this wallet's payments on ${where}, newest first: when, what was bought, the local price and its rate, the USDC paid, the asset spent and the transaction link. Also shows how much of each limit is spent.`,
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("How many payments to return. Default 20") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ limit }) => text({ limits: wallet.status(), payments: wallet.history.list(limit) }),
);

server.registerTool(
  "local402_wallet",
  {
    title: "Show the paying wallet",
    description: `Shows the agent's ${where} address, balances, payment asset, and the per-payment, daily and total limits with how much of each is spent.`,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const response = await fetch(`${HORIZON_URL}/accounts/${address}`);
      const account = (await response.json()) as { balances?: { asset_type: string; asset_code?: string; balance: string }[] };
      const balances = Object.fromEntries(
        (account.balances ?? []).map((b) => [b.asset_type === "native" ? "XLM" : b.asset_code, b.balance]),
      );
      return text({ address, network: NETWORK, payWith, limits: wallet.status(), history: historyFile, balances });
    } catch (error) {
      return failure(error);
    }
  },
);

await server.connect(new StdioServerTransport());
