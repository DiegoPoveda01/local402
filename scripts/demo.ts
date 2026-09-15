// One command to a working dashboard on testnet: `npm run demo`, then open http://localhost:3001.
// First run creates and funds throwaway testnet accounts (saved in .demo-keys.local, gitignored).
// FACILITATOR_PRIVATE_KEY, SELLER_SECRET and DEMO_AGENT_SECRET in the environment take precedence.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const KEYS_FILE = ".demo-keys.local";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

type Keys = { facilitator: string; seller: string; agent: string };

async function friendbot(keypair: Keypair) {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${keypair.publicKey()}`);
  if (!response.ok) throw new Error(`Friendbot failed for ${keypair.publicKey()}: ${response.status}`);
}

// Seller and agent hold USDC, so both need the trustline; the agent also buys some on the testnet DEX.
async function trustUsdc(keypair: Keypair, buy?: string) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const builder = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
    .setTimeout(60)
    .addOperation(Operation.changeTrust({ asset: USDC }));
  if (buy) {
    builder.addOperation(
      Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "5000", destination: keypair.publicKey(), destAsset: USDC, destAmount: buy, path: [] }),
    );
  }
  const tx = builder.build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
}

async function createKeys(): Promise<Keys> {
  const [facilitator, seller, agent] = [Keypair.random(), Keypair.random(), Keypair.random()];
  console.log("Creating and funding testnet accounts (first run only)...");
  await Promise.all([facilitator, seller, agent].map(friendbot));
  await Promise.all([trustUsdc(seller), trustUsdc(agent, "5")]);
  const keys = { facilitator: facilitator.secret(), seller: seller.secret(), agent: agent.secret() };
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

const saved: Partial<Keys> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : {};
const env = { FACILITATOR_PRIVATE_KEY: process.env.FACILITATOR_PRIVATE_KEY, SELLER_SECRET: process.env.SELLER_SECRET, DEMO_AGENT_SECRET: process.env.DEMO_AGENT_SECRET };
const keys: Keys =
  env.FACILITATOR_PRIVATE_KEY && env.SELLER_SECRET && env.DEMO_AGENT_SECRET
    ? { facilitator: env.FACILITATOR_PRIVATE_KEY, seller: env.SELLER_SECRET, agent: env.DEMO_AGENT_SECRET }
    : saved.facilitator && saved.seller && saved.agent
      ? (saved as Keys)
      : await createKeys();

const payTo = Keypair.fromSecret(keys.seller).publicKey();
const run = (name: string, workspace: string, extra: Record<string, string>) =>
  spawn("npm", ["run", "start", "-w", workspace], { stdio: "inherit", shell: true, env: { ...process.env, ...extra } }).on("exit", (code) => {
    console.log(`${name} exited (${code})`);
    process.exit(code ?? 1);
  });

run("facilitator", "@local402/facilitator", { FACILITATOR_PRIVATE_KEY: keys.facilitator });
run("demo API", "@local402/demo-api", { PAY_TO: payTo, DEMO_AGENT_SECRET: keys.agent });
console.log(`Dashboard: http://localhost:${process.env.PORT ?? 3001} (seller ${payTo}, agent ${Keypair.fromSecret(keys.agent).publicKey()})`);
