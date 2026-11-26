// The steps of `npm create local402`, with the network parts injectable so tests can run them without testnet.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Local402Client } from "@local402/client";
import {
  appFiles,
  buyerLimit,
  explorer,
  friendbot,
  newKeys,
  parseArgs,
  SELLER_PORT,
  step,
  testnetLedger,
  type Ledger,
  trustUsdc,
  USAGE,
  usdcToBuy,
  waitFor402,
} from "./index.js";

export interface Deps {
  ledger?: Ledger;
  /** Creates and funds an account; Friendbot by default. */
  fund?: (address: string) => Promise<void>;
  /** Whether to ask for the price when none is given; true when stdin is a terminal. */
  interactive?: boolean;
  /** Installs the generated app; npm install by default. */
  install?: (dir: string) => void;
  /** Starts the generated app; returns what it printed so far and a way to stop it. */
  startApp?: (dir: string) => { output: () => string; stop: () => void };
  /** The buyer's client for each payment; Local402Client by default. */
  buyer?: (payWith: "USDC" | "XLM") => Pick<Local402Client, "quote" | "pay">;
}

function npmInstall(dir: string): void {
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`npm install exited with ${result.status}`);
}

function startWithNode(dir: string) {
  const app = spawn(process.execPath, ["--env-file=.env", "--import", "tsx", "server.ts"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  app.stdout.on("data", (chunk) => (log += chunk));
  app.stderr.on("data", (chunk) => (log += chunk));
  return { output: () => log, stop: () => app.kill() };
}

export async function main(args: string[], deps: Deps = {}): Promise<void> {
  const { ledger = testnetLedger(), fund = (address: string) => friendbot(address), interactive = Boolean(process.stdin.isTTY) } = deps;
  const { install = npmInstall, startApp = startWithNode } = deps;
  // Asked only when a person runs it with no price; CI and scripts pass --price or take the default.
  if (interactive && !args.some((arg) => arg.startsWith("--price") || arg === "--help" || arg === "-h")) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question('Price per request, in your currency (e.g. "50 CLP", "1.20 EUR") [50 CLP]: ')).trim();
    prompt.close();
    if (answer) args = [...args, "--price", answer];
  }
  const options = parseArgs(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const dir = resolve(options.dir);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty`);

  console.log(`create-local402: GET /hello for ${options.price}, on Stellar testnet\n`);
  const keys = newKeys();
  await step("Friendbot created the seller, facilitator and buyer accounts", () =>
    Promise.all([keys.seller, keys.facilitator, keys.buyer].map((key) => fund(key.publicKey()))),
  );
  const sellerTrust = await step("seller USDC trustline", () => trustUsdc(ledger, keys.seller));
  console.log(`      ${explorer(sellerTrust)}`);

  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(appFiles(options.dir, options.price, keys))) {
    writeFileSync(join(dir, file), text, file === ".env" ? { mode: 0o600 } : undefined);
  }
  console.log(`ok    wrote ${dir} (testnet secrets in .env, gitignored)`);

  if (!options.install) {
    console.log(`\nNext: cd ${options.dir} && npm install && npm start`);
    return;
  }

  await step("npm install", async () => install(dir));

  const url = `http://localhost:${SELLER_PORT}/hello`;
  const app = startApp(dir);
  try {
    await step(`the app answers 402 at ${url}`, () => waitFor402(url)).catch((error) => {
      throw new Error(`${error.message}\n--- app output ---\n${app.output()}`);
    });

    const pay =
      deps.buyer ?? ((payWith: "USDC" | "XLM") => new Local402Client({ secret: keys.buyer.secret(), payWith, maxPrice: buyerLimit(options.price) }));
    const quote = await step(`quote: ${options.price} in USDC`, async () => {
      const price = await pay("USDC").quote(url);
      if (!price) throw new Error(`${url} did not ask for a payment`);
      return price;
    });
    console.log(`      ${Number(quote.amount) / 1e7} USDC`);
    const bought = usdcToBuy(quote.amount);
    const buyerTrust = await step(`buyer USDC trustline and ${bought} USDC bought with XLM on the testnet DEX`, () =>
      trustUsdc(ledger, keys.buyer, bought),
    );
    console.log(`      ${explorer(buyerTrust)}`);

    const hashes: string[] = [];
    for (const [payWith, scheme] of [["USDC", "exact"], ["XLM", "exact-fx"]] as const) {
      const paid = await step(`paid ${options.price} with ${payWith} (${scheme})`, async () => {
        const result = await pay(payWith).pay(url);
        if ("free" in result) throw new Error(`${url} answered without asking for a payment`);
        return result;
      });
      hashes.push(paid.transaction);
      console.log(`      ${paid.explorerUrl}`);
    }

    console.log(`\nDone. ${options.dir} sells GET /hello for ${options.price}; the seller received USDC twice:`);
    for (const hash of hashes) console.log(`  ${explorer(hash)}`);
    console.log(`\nRun it again: cd ${options.dir} && npm start`);
  } finally {
    app.stop();
  }
}
