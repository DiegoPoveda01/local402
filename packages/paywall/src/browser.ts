// The page's script, published as dist/browser.js: reads what generateHtml embedded and pays from Varial.
import "./buffer.js";
import { getNetworkDetails, isConnected, requestAccess, signAuthEntry } from "@stellar/freighter-api";
import { formatUnits } from "@local402/fx";
import type { PayAsset, PaywallData } from "./index.js";
import { estimate, passphrase, payFromWallet, walletSigner } from "./wallet.js";

const data = JSON.parse(document.getElementById("local402-paywall")!.textContent!) as PaywallData;
const element = (id: string) => document.getElementById(id)!;
const picked = () => data.assets.find(({ payWith }) => payWith === document.querySelector<HTMLInputElement>('input[name="asset"]:checked')?.value)!;
const status = (text: string) => (element("status").textContent = text);

let shown = 0;
async function showAmount() {
  const choice = picked();
  const turn = ++shown;
  element("amount").classList.add("quoting");
  const text = await estimate(choice.payWith, data.network, choice.asset, choice.amount).then(
    (amount) => `${amount} ${choice.payWith}`,
    () => `No ${choice.payWith} quote right now`,
  );
  if (turn !== shown) return;
  const amount = element("amount");
  amount.textContent = text;
  amount.classList.remove("tween", "quoting");
  void amount.offsetWidth; // restarts the fade on every change
  amount.classList.add("tween");
  element("refund").hidden = choice.payWith === "USDC";
}

async function connect(): Promise<string> {
  if (!(await isConnected()).isConnected) throw new Error("Install Varial to pay from this page.");
  const access = await requestAccess();
  if (access.error) throw new Error(String(access.error.message ?? access.error));
  if ((await getNetworkDetails()).networkPassphrase !== passphrase(data.network)) {
    throw new Error(`Switch Varial to ${data.network === "stellar:pubnet" ? "Mainnet" : "Testnet"}.`);
  }
  return access.address;
}

async function pay() {
  const button = element("pay") as HTMLButtonElement;
  button.disabled = true;
  try {
    status("Connecting to Varial...");
    const address = await connect();
    status("Checking the price, then asking Varial to sign...");
    const payWith: PayAsset = picked().payWith;
    const paid = await payFromWallet(data.url, {
      signer: walletSigner(address, data.network, signAuthEntry),
      network: data.network,
      payWith,
      maxPrice: data.maxPrice,
    });
    status(`Paid ${formatUnits(BigInt(paid.spent?.amount ?? paid.price.amount))} ${payWith}.`);
    (element("tx") as HTMLAnchorElement).href = paid.explorerUrl;
    element("body").textContent = typeof paid.body === "string" ? paid.body : JSON.stringify(paid.body, null, 2);
    element("result").hidden = false;
    button.hidden = true;
  } catch (error) {
    status(error instanceof Error ? error.message : String(error));
    button.disabled = false;
  }
}

for (const input of document.querySelectorAll('input[name="asset"]')) input.addEventListener("change", showAmount);
element("pay").addEventListener("click", pay);
if (picked()?.payWith !== "USDC") void showAmount();
