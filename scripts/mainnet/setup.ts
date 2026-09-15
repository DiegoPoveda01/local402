// Prepares the three mainnet accounts for a real Local402 payment, from one account funded with real XLM.
//   local402-mainnet         funded by you; pays fees as the facilitator and creates the other two
//   local402-mainnet-seller  receives USDC (needs the USDC trustline)
//   local402-mainnet-agent   pays with USDC, XLM or EURC (buys a little USDC and EURC on the Stellar DEX)
//
// npx tsx scripts/mainnet/setup.ts          read-only: shows addresses, balances and what is missing
// npx tsx scripts/mainnet/setup.ts --run    creates the seller and agent accounts (spends about 9 XLM, mostly reserves)
import { execFileSync } from "node:child_process";
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { FX_MAINNET } from "@local402/fx";

const horizon = new Horizon.Server(FX_MAINNET.horizonUrl);
const USDC = new Asset(FX_MAINNET.usdc.code, FX_MAINNET.usdc.issuer);
const EURC = new Asset(FX_MAINNET.eurc.code, FX_MAINNET.eurc.issuer);
const IDENTITIES = { facilitator: "local402-mainnet", seller: "local402-mainnet-seller", agent: "local402-mainnet-agent" };

const stellar = (...args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** Keys stay in stellar-cli's store; a missing identity is generated locally, which spends nothing. */
function keypair(identity: string): Keypair {
  try {
    return Keypair.fromSecret(stellar("keys", "secret", identity));
  } catch {
    stellar("keys", "generate", identity);
    console.log(`generated identity ${identity}`);
    return Keypair.fromSecret(stellar("keys", "secret", identity));
  }
}

const loadAccount = (address: string) => horizon.loadAccount(address).catch(() => undefined);

const [facilitator, seller, agent] = [IDENTITIES.facilitator, IDENTITIES.seller, IDENTITIES.agent].map(keypair);

for (const [role, kp] of Object.entries({ facilitator, seller, agent })) {
  const account = await loadAccount(kp.publicKey());
  const balances = account?.balances.map((b) => `${"asset_code" in b ? b.asset_code : "XLM"} ${b.balance}`).join(", ");
  console.log(`${role.padEnd(12)} ${kp.publicKey()}  ${account ? balances : "not created"}`);
}

const funder = await loadAccount(facilitator.publicKey());
if (!funder) {
  console.log(`\nSend at least 15 XLM to ${facilitator.publicKey()} (identity ${IDENTITIES.facilitator}) to continue.`);
  process.exit(0);
}
if (!process.argv.includes("--run")) {
  console.log("\nRead-only. Pass --run to create the seller and agent accounts.");
  process.exit(0);
}

// One transaction: create both accounts, add trustlines, and let the agent buy 0.2 USDC and 0.2 EURC with XLM.
// Direct order-book paths only, capped so a thin book cannot fill far from the market.
const tx = new TransactionBuilder(funder, { fee: "10000", networkPassphrase: Networks.PUBLIC })
  .setTimeout(120)
  .addOperation(Operation.createAccount({ destination: seller.publicKey(), startingBalance: "2" }))
  .addOperation(Operation.createAccount({ destination: agent.publicKey(), startingBalance: "6" }))
  .addOperation(Operation.changeTrust({ asset: USDC, source: seller.publicKey() }))
  .addOperation(Operation.changeTrust({ asset: USDC, source: agent.publicKey() }))
  .addOperation(Operation.changeTrust({ asset: EURC, source: agent.publicKey() }))
  .addOperation(Operation.pathPaymentStrictReceive({ source: agent.publicKey(), sendAsset: Asset.native(), sendMax: "1.5", destination: agent.publicKey(), destAsset: USDC, destAmount: "0.2", path: [] }))
  .addOperation(Operation.pathPaymentStrictReceive({ source: agent.publicKey(), sendAsset: Asset.native(), sendMax: "1.7", destination: agent.publicKey(), destAsset: EURC, destAmount: "0.2", path: [] }))
  .build();
tx.sign(facilitator, seller, agent);
const result = await horizon.submitTransaction(tx);
console.log(`\nAccounts ready: https://stellar.expert/explorer/public/tx/${result.hash}`);
