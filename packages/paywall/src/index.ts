import type { PaywallConfig, PaywallProvider } from "@x402/core/http";
import type { Network, PaymentRequired } from "@x402/core/types";
import { formatUnits, FX_SCHEME, fxNetwork, parseFxExtra } from "@local402/fx";
import type { LocalQuote } from "@local402/pricing";

export const PAYWALL_VERSION = "1.3.0";
/** The browser half of this package, as published on npm. */
export const PAYWALL_SCRIPT = `https://cdn.jsdelivr.net/npm/local402-paywall@${PAYWALL_VERSION}/dist/browser.js`;

export type PayAsset = "USDC" | "XLM" | "EURC";

export interface PaywallOptions {
  /**
   * Most the page lets a visitor pay, as a local price such as "600 CLP": anything above is refused before
   * the wallet is asked to sign. Default: the route's own local price plus 2%, the room oracle rates drift by.
   */
  maxPrice?: string;
  /** Where the browser script is loaded from. Default `PAYWALL_SCRIPT`. */
  scriptUrl?: string;
}

/** What the page hands its script. */
export interface PaywallData {
  url: string;
  network: Network;
  maxPrice?: string;
  /** Each asset the route accepts, with the USDC amount (smallest unit) and token the seller receives. */
  assets: { payWith: PayAsset; asset: string; amount: string }[];
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The assets a 402 can be paid with: USDC through `exact`, XLM and EURC through `exact-fx` when FxPay takes them. */
export function payableAssets(required: PaymentRequired): PaywallData["assets"] {
  const assets: PaywallData["assets"] = [];
  const exact = required.accepts.find((accept) => accept.scheme === "exact");
  if (exact) assets.push({ payWith: "USDC", asset: exact.asset, amount: exact.amount });
  const fx = required.accepts.find((accept) => accept.scheme === FX_SCHEME);
  if (fx) {
    const { xlm, eurc } = fxNetwork(fx.network);
    const { sendAssets } = parseFxExtra(fx.extra);
    if (sendAssets.includes(xlm)) assets.push({ payWith: "XLM", asset: fx.asset, amount: fx.amount });
    if (sendAssets.includes(eurc)) assets.push({ payWith: "EURC", asset: fx.asset, amount: fx.amount });
  }
  return assets;
}

/** The route's local price plus 2%, rounded up to six decimals. */
function defaultMaxPrice(quote: LocalQuote | undefined): string | undefined {
  if (!quote) return undefined;
  return `${Math.ceil(Number(quote.localAmount) * 1.02 * 1e6) / 1e6} ${quote.currency}`;
}

/**
 * An x402 `PaywallProvider` for routes priced with `localRoute`: a browser asking for the route gets a page
 * with its local price, a choice of USDC, XLM or EURC and the amount in each, and pays from Varial with
 * the same client agents use. Agents keep getting the x402 402.
 */
export function local402Paywall(options: PaywallOptions = {}): PaywallProvider {
  return {
    generateHtml(required: PaymentRequired, config?: PaywallConfig): string {
      const first = required.accepts[0];
      const quote = first?.extra?.local402 as LocalQuote | undefined;
      const assets = payableAssets(required);
      const data: PaywallData = {
        url: required.resource?.url || config?.currentUrl || "",
        network: first?.network ?? (config?.testnet === false ? "stellar:pubnet" : "stellar:testnet"),
        maxPrice: options.maxPrice ?? defaultMaxPrice(quote),
        assets,
      };
      const price = quote ? `${quote.localAmount} ${quote.currency}` : first ? `${formatUnits(BigInt(first.amount))} USDC` : "";
      const usdc = assets.find((asset) => asset.payWith === "USDC");
      const choices = assets
        .map(({ payWith }, i) => `<label><input type="radio" name="asset" value="${payWith}"${i === 0 ? " checked" : ""}> ${payWith}</label>`)
        .join("");
      const title = config?.appName ?? required.resource?.description ?? "Payment required";
      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root{color-scheme:light dark;--fg:#16131f;--muted:#6b6577;--line:#e4e0ec;--accent:#6d4ae0;--bg:#fbfaff}
@media (prefers-color-scheme:dark){:root{--fg:#f1eef8;--muted:#a39cb3;--line:#2e2a3a;--accent:#a58bff;--bg:#121019}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:28rem;margin:0 auto;padding:3rem 1rem}
.label,.note,#status{color:var(--muted);font-size:.875rem}
h1{font:600 2.5rem/1.1 Georgia,serif;margin:.25rem 0 1.5rem}
fieldset{border:0;padding:0;margin:0 0 .5rem;display:flex;gap:1rem}
legend{color:var(--muted);font-size:.875rem;margin-bottom:.5rem}
#amount{font-variant-numeric:tabular-nums;margin:0 0 1.5rem}
button{width:100%;padding:.75rem;border:0;border-radius:.5rem;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
pre{white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);border-radius:.5rem;padding:1rem;font-size:.8125rem}
a{color:var(--accent)}
</style>
</head>
<body>
<main>
<p class="label">${escape(title)}</p>
<h1>${escape(price)}</h1>
<fieldset><legend>Pay with</legend>${choices}</fieldset>
<p id="amount">${usdc ? `${formatUnits(BigInt(usdc.amount))} USDC` : ""}</p>
<button id="pay" type="button">Pay with Varial</button>
<p id="status" role="status"></p>
${data.maxPrice ? `<p class="note">Your wallet is never asked to sign above ${escape(data.maxPrice)}.</p>` : ""}
<section id="result" hidden><p><a id="tx" target="_blank" rel="noopener">View the transaction</a></p><pre id="body"></pre></section>
</main>
<script type="application/json" id="local402-paywall">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script type="module" src="${escape(options.scriptUrl ?? PAYWALL_SCRIPT)}"></script>
</body>
</html>`;
    },
  };
}
