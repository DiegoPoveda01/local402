// Adds a testnet USDC trustline and, optionally, buys USDC with XLM on the testnet DEX.
// Usage: SECRET=S... npx tsx scripts/fund-usdc.ts [usdcToBuy]
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const secret = process.env.SECRET;
if (!secret) throw new Error("SECRET is required");
const keypair = Keypair.fromSecret(secret);
const buy = process.argv[2];

const account = await horizon.loadAccount(keypair.publicKey());
const hasTrustline = account.balances.some((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC.issuer);

const builder = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET }).setTimeout(60);
if (!hasTrustline) builder.addOperation(Operation.changeTrust({ asset: USDC }));
if (buy) {
  builder.addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: "10000",
      destination: keypair.publicKey(),
      destAsset: USDC,
      destAmount: buy,
      path: [],
    }),
  );
}

const tx = builder.build();
if (tx.operations.length === 0) {
  console.log("Nothing to do");
} else {
  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  console.log(`ok ${result.hash}`);
}

const updated = await horizon.loadAccount(keypair.publicKey());
for (const b of updated.balances) {
  console.log("asset_code" in b ? `${b.asset_code}: ${b.balance}` : `XLM: ${b.balance}`);
}
