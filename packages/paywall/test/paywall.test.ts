import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { ExactFxClientScheme, FX_SCHEME, FX_TESTNET } from "@local402/fx";
import type { FiatRateSource } from "@local402/pricing";
import { local402Paywall, PAYWALL_SCRIPT, payableAssets, type PaywallData } from "../src/index.js";
import { estimate, payFromWallet, walletSigner, type SignAuthEntry } from "../src/wallet.js";

// 1 CLP = 0.00105408590567 USD, so 500 CLP = 5270430 USDC units.
const oracle: FiatRateSource = {
  async getRate() {
    return { usdPerUnit: 105408590567n, decimals: 14, timestamp: Math.floor(Date.now() / 1000), source: "test" };
  },
};
const URL = "https://local402.xyz/indicadores";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const payTo = Keypair.random().publicKey();
const local402 = { localAmount: "500", currency: "CLP", usdPerUnit: "105408590567", oracleSource: "seller" };
const exact: PaymentRequirements = { scheme: "exact", network: "stellar:testnet", asset: USDC, amount: "5270430", payTo, maxTimeoutSeconds: 60, extra: { local402 } };
const fx: PaymentRequirements = {
  ...exact,
  scheme: FX_SCHEME,
  extra: { local402, areFeesSponsored: true, fxContract: FX_TESTNET.fxContract, sendAssets: [FX_TESTNET.xlm, FX_TESTNET.eurc] },
};
const required = (accepts = [exact, fx]): PaymentRequired => ({ x402Version: 2, resource: { url: URL, description: "Chilean market rates" }, accepts });

/** The JSON the page hands its script. */
const embedded = (html: string) => JSON.parse(/id="local402-paywall">(.*?)<\/script>/s.exec(html)![1]) as PaywallData;

describe("the paywall page", () => {
  it("shows the local price, each asset the route takes, and the USDC amount", () => {
    const html = local402Paywall().generateHtml(required());
    expect(html).toContain("<h1>500 CLP</h1>");
    for (const asset of ["USDC", "XLM", "EURC"]) expect(html).toContain(`value="${asset}"`);
    expect(html).toContain('<p id="amount">0.527043 USDC</p>');
    expect(html).toContain(`src="${PAYWALL_SCRIPT}"`);
    expect(embedded(html)).toEqual({
      url: URL,
      network: "stellar:testnet",
      maxPrice: "510 CLP",
      assets: [
        { payWith: "USDC", asset: USDC, amount: "5270430" },
        { payWith: "XLM", asset: USDC, amount: "5270430" },
        { payWith: "EURC", asset: USDC, amount: "5270430" },
      ],
    });
  });

  it("offers only what the route accepts", () => {
    expect(payableAssets(required([exact])).map(({ payWith }) => payWith)).toEqual(["USDC"]);
    const xlmOnly = { ...fx, extra: { ...fx.extra, sendAssets: [FX_TESTNET.xlm] } };
    expect(payableAssets(required([xlmOnly])).map(({ payWith }) => payWith)).toEqual(["XLM"]);
  });

  it("takes the seller's maximum and script, and keeps the page's data from closing its script tag", () => {
    const html = local402Paywall({ maxPrice: "600 CLP", scriptUrl: "/paywall.js" }).generateHtml({
      ...required(),
      resource: { url: `${URL}?q=</script><script>alert(1)</script>` },
    });
    expect(html).toContain("never asked to sign above 600 CLP");
    expect(html).toContain('src="/paywall.js"');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(embedded(html).url).toBe(`${URL}?q=</script><script>alert(1)</script>`);
  });
});

describe("paying from the wallet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
  /** Answers every request with the 402 and counts the paid retries. */
  function seller() {
    const paid: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
      if (signature) paid.push(signature);
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encode(required()) } });
    });
    return paid;
  }
  const wallet = () => {
    const sign = vi.fn<SignAuthEntry>(async () => ({ signedAuthEntry: "c2lnbmVk" }));
    return { sign, signer: walletSigner(Keypair.random().publicKey(), "stellar:testnet", sign) };
  };

  for (const payWith of ["USDC", "XLM", "EURC"] as const) {
    it(`refuses ${payWith} above the maximum before the wallet is asked to sign`, async () => {
      const paid = seller();
      const { sign, signer } = wallet();
      const usdc = vi.spyOn(ExactStellarScheme.prototype, "createPaymentPayload");
      const swap = vi.spyOn(ExactFxClientScheme.prototype, "createPaymentPayload");
      await expect(payFromWallet(URL, { signer, network: "stellar:testnet", payWith, maxPrice: "400 CLP", oracle })).rejects.toMatchObject({
        code: "REFUSED_MAX_PRICE",
      });
      expect(usdc).not.toHaveBeenCalled();
      expect(swap).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(paid).toHaveLength(0);
    });
  }

  it.each([
    ["USDC", "exact", undefined],
    ["XLM", FX_SCHEME, FX_TESTNET.xlm],
    ["EURC", FX_SCHEME, FX_TESTNET.eurc],
  ] as const)("pays %s within the maximum through %s", async (payWith, scheme, sendAsset) => {
    seller();
    const { signer } = wallet();
    const signing = new Error("signing");
    const usdc = vi.spyOn(ExactStellarScheme.prototype, "createPaymentPayload").mockRejectedValue(signing);
    let spent: string | undefined;
    vi.spyOn(ExactFxClientScheme.prototype, "createPaymentPayload").mockImplementation(async function (this: ExactFxClientScheme) {
      spent = (this as unknown as { options: { sendAsset: string } }).options.sendAsset;
      throw signing;
    });
    await expect(payFromWallet(URL, { signer, network: "stellar:testnet", payWith, maxPrice: "510 CLP", oracle })).rejects.toBe(signing);
    expect(usdc).toHaveBeenCalledTimes(scheme === "exact" ? 1 : 0);
    expect(spent).toBe(sendAsset);
  });

  it("returns the wallet's signature as base64 and names its refusal", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const signer = walletSigner("GABC", "stellar:testnet", async () => ({ signedAuthEntry: bytes }));
    await expect(signer.signAuthEntry("entry")).resolves.toEqual({ signedAuthEntry: "AQID", signerAddress: "GABC" });
    const declined = walletSigner("GABC", "stellar:testnet", async () => ({ error: { message: "User declined access" } }));
    await expect(declined.signAuthEntry("entry")).rejects.toThrow("User declined access");
  });

  it("shows the USDC amount as it is", async () => {
    await expect(estimate("USDC", "stellar:testnet", USDC, "5270430")).resolves.toBe("0.527043");
  });
});
