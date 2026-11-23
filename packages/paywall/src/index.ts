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

// Local402's look: paper background, charcoal ink, one indigo accent, Instrument Serif, Inter and Geist Mono.
const FONTS = ["instrument-serif@5.3.0/400.css", "instrument-serif@5.3.0/400-italic.css", "inter@5.3.0/400.css", "inter@5.3.0/500.css", "geist-mono@5.3.0/400.css"];
const STYLE = `
:root{color-scheme:light;--bg:#f4f4f2;--ink:#1a1a1a;--ink-2:#5f5f5b;--line:#e2e2de;--surface:#fff;--accent:#5a5ac2;--ease:cubic-bezier(.23,1,.32,1);
--serif:"Instrument Serif","Iowan Old Style",Georgia,serif;--sans:"Inter",-apple-system,"Segoe UI",system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,"Cascadia Code",Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
::selection{background:var(--accent);color:var(--surface)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
[hidden]{display:none!important}
p{margin:0}
main{max-width:30rem;margin:0 auto;padding:72px 16px 40px;animation:rise .3s var(--ease) both}
.eyebrow,footer{display:flex;align-items:center;gap:12px;font:400 12px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2)}
.eyebrow{margin-bottom:24px}
.eyebrow::after{content:"";width:24px;height:1px;background:currentColor}
h1{font:400 72px/.96 var(--serif);letter-spacing:-.015em;margin:0 0 32px;font-variant-numeric:tabular-nums}
h1 em{font-style:italic;color:var(--accent)}
.seg{display:inline-flex;border:1px solid var(--ink-2);border-radius:999px;overflow:hidden;padding:0;margin:0 0 16px}
.seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.seg label{position:relative;padding:8px 18px;font:500 13px/1.2 var(--sans);cursor:pointer;transition:background-color .15s var(--ease),color .15s var(--ease)}
.seg input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
.seg label:has(input:checked){background:var(--ink);color:var(--surface)}
.seg label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:-4px}
.card,.receipt{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px;margin:0 0 24px}
#amount{font:400 36px/1.05 var(--serif);color:var(--accent);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
#amount{transition:opacity .15s var(--ease)}
#amount.quoting{opacity:.35}
#amount.tween{animation:tween .3s var(--ease)}
#refund{font:400 11.5px/1.7 var(--mono);color:var(--ink-2);margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
button{display:flex;width:100%;min-height:48px;align-items:center;justify-content:center;border:1px solid var(--ink);border-radius:999px;background:var(--ink);color:var(--surface);font:500 15px/1.2 var(--sans);cursor:pointer;transition:transform .15s var(--ease)}
button:hover{transform:translateY(-1px)}
button:active{transform:scale(.97)}
button:disabled{opacity:.6;cursor:wait;transform:none}
#status,.note{font-size:13px;color:var(--ink-2);margin-top:12px}
#status:empty{display:none}
.receipt{margin-top:24px;font:400 13px/1.6 var(--mono);animation:rise .3s var(--ease) both}
.receipt a{color:var(--accent)}
pre{margin:14px 0 0;padding-top:14px;border-top:1px solid var(--line);white-space:pre-wrap;word-break:break-word;max-height:24rem;overflow:auto;font:inherit;font-size:12px}
footer{max-width:30rem;margin:0 auto;padding:0 16px 48px}
footer a{color:inherit;text-decoration:none}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@keyframes tween{from{opacity:.6}}
@media (max-width:480px){h1{font-size:56px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

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
      const [amount, currency] = quote ? [quote.localAmount, quote.currency] : first ? [formatUnits(BigInt(first.amount)), "USDC"] : ["", ""];
      const usdc = assets.find((asset) => asset.payWith === "USDC");
      const choices = assets
        .map(({ payWith }, i) => `<label><input type="radio" name="asset" value="${payWith}"${i === 0 ? " checked" : ""}>${payWith}</label>`)
        .join("");
      const title = config?.appName ?? required.resource?.description ?? "Payment required";
      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${FONTS.map((font) => `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/${font}">`).join("\n")}
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="eyebrow">${escape(title)}</p>
<h1>${escape(amount)} <em>${escape(currency)}</em></h1>
<fieldset class="seg"><legend>Pay with</legend>${choices}</fieldset>
<div class="card"><p id="amount">${usdc ? `${formatUnits(BigInt(usdc.amount))} USDC` : ""}</p><p id="refund" hidden>Unused input is refunded.</p></div>
<button id="pay" type="button">Pay with Varial</button>
<p id="status" role="status"></p>
${data.maxPrice ? `<p class="note">Your wallet is never asked to sign above ${escape(data.maxPrice)}.</p>` : ""}
<section id="result" class="receipt" hidden><a id="tx" target="_blank" rel="noopener">View the transaction</a><pre id="body"></pre></section>
</main>
<footer><a href="https://local402.xyz" target="_blank" rel="noopener">Local402</a></footer>
<script type="application/json" id="local402-paywall">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script type="module" src="${escape(options.scriptUrl ?? PAYWALL_SCRIPT)}"></script>
</body>
</html>`;
    },
  };
}
