// Pays local402.xyz/indicadores (50 CLP) with a 40 CLP maximum, in each asset, through the published
// local402-paywall, with a wallet that counts how often it is asked to sign.
// npm i local402-paywall@1.3.0 @stellar/stellar-sdk@16.4.1 && node d3-refusal.mjs
import { Keypair } from "@stellar/stellar-sdk";
import { payFromWallet, walletSigner } from "local402-paywall/wallet";

const URL = "https://local402.xyz/indicadores";
let asked = 0;
const signer = walletSigner(Keypair.random().publicKey(), "stellar:testnet", async () => {
  asked++;
  throw new Error("the wallet was asked to sign");
});
for (const payWith of ["USDC", "XLM", "EURC"]) {
  try {
    await payFromWallet(URL, { signer, network: "stellar:testnet", payWith, maxPrice: "40 CLP" });
    console.log(payWith, "PAID (unexpected)");
  } catch (e) {
    console.log(payWith, e.code ?? "", e.message);
  }
}
console.log("wallet asked to sign:", asked, "times");
