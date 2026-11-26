// create-local402: a first paid route in one command, on Stellar testnet.
//
// It creates three testnet accounts with Friendbot (the seller, the facilitator that pays the network fees and a
// buyer), gives the seller and the buyer a USDC trustline, writes an Express app that sells one route priced in the
// seller's currency, starts it and pays it twice: with USDC through `exact` and with XLM through `exact-fx`.
// Everything here is testnet: the secrets it writes to `.env` hold no real funds.
import { randomBytes } from "node:crypto";
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { parseLocalPrice } from "@local402/pricing";

/** Circle's testnet USDC, the asset `exact` settles in on stellar:testnet. */
export const TESTNET_USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
export const DEFAULT_PRICE = "50 CLP";
export const DEFAULT_DIR = "local402-app";
export const SELLER_PORT = 4021;
export const FACILITATOR_PORT = 4022;

/** Versions the generated app installs. A test keeps them in step with the workspace. */
export const APP_DEPENDENCIES = {
  "@x402/express": "2.25.0",
  express: "^5.1.0",
  "local402-facilitator": "^1.3.0",
  "local402-server": "^1.3.0",
  tsx: "^4.20.5",
};

export interface Options {
  dir: string;
  /** As the seller writes it, e.g. "50 CLP" or "1.20 EUR". */
  price: string;
  install: boolean;
  help: boolean;
}

export const USAGE = `Usage: npm create local402 [dir] -- [--price "${DEFAULT_PRICE}"] [--no-install]

Creates ${DEFAULT_DIR}/ (or [dir]) with an Express app that sells GET /hello on Stellar testnet,
priced in your currency and paid in USDC, XLM or EURC. Then it starts the app and pays it
with USDC (exact) and with XLM (exact-fx), printing both transaction links.

--price       the price per request in your currency, e.g. "50 CLP", "1.20 EUR", "0.01 UF"
--no-install  write the files only: no npm install, no test payments`;

export function parseArgs(args: string[]): Options {
  const options: Options = { dir: DEFAULT_DIR, price: DEFAULT_PRICE, install: true, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--no-install") options.install = false;
    else if (arg === "--price") {
      const value = args[++i];
      if (!value) throw new Error('--price needs a value, e.g. --price "50 CLP"');
      options.price = value;
    } else if (arg.startsWith("--price=")) options.price = arg.slice("--price=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    else options.dir = arg;
  }
  // Fails here, before any account is created, on a price the seller could not sell at.
  const { amount, currency } = parseLocalPrice(options.price);
  options.price = `${amount} ${currency}`;
  return options;
}

export interface AppKeys {
  seller: Keypair;
  facilitator: Keypair;
  buyer: Keypair;
}

export function newKeys(): AppKeys {
  return { seller: Keypair.random(), facilitator: Keypair.random(), buyer: Keypair.random() };
}

/** The files of the generated app, by path. `.env` holds testnet secrets and is gitignored. */
export function appFiles(name: string, price: string, keys: AppKeys, quoteSecret = randomBytes(32).toString("hex")): Record<string, string> {
  const packageName = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_DIR;
  return {
    "package.json": `${JSON.stringify(
      {
        name: packageName,
        private: true,
        type: "module",
        scripts: { start: "node --env-file=.env --import tsx server.ts" },
        dependencies: APP_DEPENDENCIES,
      },
      null,
      2,
    )}\n`,
    "server.ts": `// One route priced in ${price.split(" ")[1]}, paid on Stellar testnet with USDC (exact) or XLM and EURC (exact-fx).
// The facilitator that verifies and settles payments runs in the same process, paying fees from its own account.
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { createFacilitator, facilitatorConfig } from "local402-facilitator";
import { local402Server, localRoute } from "local402-server";

const PRICE = "${price}";

const facilitator = createFacilitator(facilitatorConfig({ ...process.env, PORT: "${FACILITATOR_PORT}" }));
facilitator.app.listen(${FACILITATOR_PORT}, () => {
  const app = express();
  app.use(
    paymentMiddleware(
      { "GET /hello": localRoute(PRICE, { payTo: process.env.PAY_TO!, description: "Hello, paid in local currency" }) },
      local402Server("http://localhost:${FACILITATOR_PORT}"),
    ),
  );
  app.get("/hello", (_req, res) => res.json({ message: "Paid in local currency on Stellar", price: PRICE }));
  app.listen(${SELLER_PORT}, () => console.log(\`\${PRICE} per call: http://localhost:${SELLER_PORT}/hello\`));
});
`,
    ".env": [
      "# Stellar testnet only. These accounts were created by create-local402 and hold no real funds.",
      `PAY_TO=${keys.seller.publicKey()}`,
      `SELLER_SECRET=${keys.seller.secret()}`,
      `FACILITATOR_PRIVATE_KEYS=${keys.facilitator.secret()}`,
      `BUYER_SECRET=${keys.buyer.secret()}`,
      `LOCAL402_QUOTE_SECRET=${quoteSecret}`,
      "NETWORK=stellar:testnet",
      "",
    ].join("\n"),
    ".gitignore": "node_modules\n.env\n",
    "README.md": `# ${packageName}

\`GET /hello\` costs ${price}, converted to USDC with the Reflector oracle on every request, on Stellar testnet.

\`\`\`sh
npm start
curl -i http://localhost:${SELLER_PORT}/hello   # 402, with the ${price.split(" ")[1]} quote in extra.local402
\`\`\`

Pay it as a buyer, with USDC, XLM or EURC (\`BUYER_SECRET\` is in \`.env\`):

\`\`\`sh
STELLAR_SECRET=<BUYER_SECRET> npx local402-client pay http://localhost:${SELLER_PORT}/hello --with XLM --max "${buyerLimit(price)}"
\`\`\`

- \`PAY_TO\` is the seller account that receives the USDC; \`SELLER_SECRET\` controls it.
- \`FACILITATOR_PRIVATE_KEYS\` pays the network fees of each settlement.
- \`LOCAL402_QUOTE_SECRET\` signs each quote, so a buyer cannot change the price.

Going to mainnet takes your own accounts and a facilitator with a seller allowlist:
https://github.com/DiegoPoveda01/local402/blob/main/docs/integration-guide.md
`,
  };
}

type FetchFn = typeof fetch;

/** Creates and funds `address` with Friendbot, retrying twice: Friendbot is the flakiest part of testnet. */
export async function friendbot(address: string, fetchFn: FetchFn = fetch, waitMs = 3000): Promise<void> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchFn(`https://friendbot.stellar.org/?addr=${address}`, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return;
      const body = await response.text();
      if (/already.?exist/i.test(body)) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
  }
  throw new Error(`Friendbot did not fund ${address} after 3 attempts (${last})`);
}

/** The part of Horizon this needs, so tests can stand in for it. */
export interface Ledger {
  loadAccount(address: string): Promise<ConstructorParameters<typeof TransactionBuilder>[0]>;
  submitTransaction(tx: ReturnType<TransactionBuilder["build"]>): Promise<{ hash: string }>;
}

/**
 * Adds a USDC trustline to `account` and, with `buyUsdc`, buys that much USDC with XLM on the testnet DEX,
 * in one transaction. Returns its hash.
 */
export async function trustUsdc(ledger: Ledger, account: Keypair, buyUsdc?: string): Promise<string> {
  const builder = new TransactionBuilder(await ledger.loadAccount(account.publicKey()), { fee: "1000", networkPassphrase: Networks.TESTNET })
    .setTimeout(60)
    .addOperation(Operation.changeTrust({ asset: TESTNET_USDC }));
  if (buyUsdc) {
    builder.addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: "1000",
        destination: account.publicKey(),
        destAsset: TESTNET_USDC,
        destAmount: buyUsdc,
        path: [],
      }),
    );
  }
  const tx = builder.build();
  tx.sign(account);
  return (await ledger.submitTransaction(tx)).hash;
}

export function testnetLedger(): Ledger {
  return new Horizon.Server(HORIZON_TESTNET) as unknown as Ledger;
}

/** USDC to buy so the `exact` payment is covered twice over: the quote moves with the oracle between now and then. */
export function usdcToBuy(quoteUnits: string | bigint): string {
  const units = BigInt(quoteUnits) * 2n + 1_000_000n; // + 0.1 USDC
  const whole = units / 10_000_000n;
  const fraction = (units % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * The buyer's limit: the price plus 5%. The buyer converts it with its own oracle read, a moment after the seller
 * quoted, so a limit equal to the price can refuse the price itself.
 */
export function buyerLimit(price: string): string {
  const { amount, currency } = parseLocalPrice(price);
  const decimals = Math.max(2, amount.split(".")[1]?.length ?? 0);
  return `${(Math.ceil(Number(amount) * 1.05 * 10 ** decimals) / 10 ** decimals).toString()} ${currency}`;
}

export const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

/** Runs `fn` and, if it fails, says which step failed, so a red CI run names the culprit (Friendbot, Horizon, the app). */
export async function step<T>(label: string, fn: () => Promise<T>, log: (line: string) => void = console.log): Promise<T> {
  try {
    const value = await fn();
    log(`ok    ${label}`);
    return value;
  } catch (error) {
    log(`FAIL  ${label}`);
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** Waits until `url` answers 402, the sign that the app and its facilitator are up. */
export async function waitFor402(url: string, timeoutMs = 60_000, fetchFn: FetchFn = fetch): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url);
      if (response.status === 402) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer 402 within ${timeoutMs / 1000}s (last: ${last})`);
}
