import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { ExactFxClientScheme, FX_TESTNET } from "@local402/fx";
import { parseLocalPrice, type LocalQuote } from "@local402/pricing";

export type PayAsset = "USDC" | "XLM";

export interface Local402ClientOptions {
  secret: string;
  /** Asset the payer spends. USDC uses stock `exact`; XLM uses `exact-fx` through FxPay. */
  payWith?: PayAsset;
  /** Refuse any single payment above this local price, e.g. "500 CLP". */
  maxPrice?: string;
}

export interface Price {
  url: string;
  local?: { amount: string; currency: string; usdPerUnit: string; oracleSource: string };
  /** Settlement token amount in its smallest unit and the token contract. */
  amount: string;
  asset: string;
  scheme: string;
  payTo: string;
}

export interface PaidResult {
  price: Price;
  payWith: PayAsset;
  transaction: string;
  explorerUrl: string;
  /** Send-asset amount the FX swap consumed, when paying with XLM. */
  spent?: { asset: string; amount: string };
  body: unknown;
}

const NETWORK = "stellar:testnet";

function describe(url: string, option: PaymentRequirements): Price {
  const quote = option.extra?.local402 as LocalQuote | undefined;
  return {
    url,
    local: quote && {
      amount: quote.localAmount,
      currency: quote.currency,
      usdPerUnit: quote.usdPerUnit,
      oracleSource: quote.oracleSource,
    },
    amount: option.amount,
    asset: option.asset,
    scheme: option.scheme,
    payTo: option.payTo,
  };
}

/** Pays x402 resources priced in local currency on Stellar testnet, with USDC or XLM. */
export class Local402Client {
  readonly address: string;
  readonly payWith: PayAsset;
  private readonly http: x402HTTPClient;
  private readonly maxPrice?: { amount: number; currency: string };

  constructor(options: Local402ClientOptions) {
    const signer = createEd25519Signer(options.secret, NETWORK);
    this.address = signer.address;
    this.payWith = options.payWith ?? "USDC";
    const scheme =
      this.payWith === "XLM"
        ? new ExactFxClientScheme(signer, { fxContract: FX_TESTNET.fxContract, sendAsset: FX_TESTNET.xlm })
        : new ExactStellarScheme(signer);
    this.http = new x402HTTPClient(new x402Client().register("stellar:*", scheme));
    if (options.maxPrice) {
      const cap = parseLocalPrice(options.maxPrice);
      this.maxPrice = { amount: Number(cap.amount), currency: cap.currency };
    }
  }

  /** Reads a resource's price without paying. Returns undefined if the resource is free. */
  async quote(url: string): Promise<Price | undefined> {
    const response = await fetch(url);
    if (response.status !== 402) return undefined;
    const required = this.http.getPaymentRequiredResponse((name) => response.headers.get(name), await response.json());
    const option = required.accepts.find((accept) => accept.scheme === this.scheme) ?? required.accepts[0];
    return describe(url, option);
  }

  /** Fetches a resource, paying for it if it returns 402. */
  async pay(url: string): Promise<PaidResult | { free: true; body: unknown }> {
    const first = await fetch(url);
    if (first.status !== 402) return { free: true, body: await readBody(first) };

    const required = this.http.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
    const payload = await this.http.createPaymentPayload(required);
    const price = describe(url, payload.accepted);
    this.enforceBudget(price);

    const paid = await fetch(url, { headers: this.http.encodePaymentSignatureHeader(payload) });
    if (!paid.ok) {
      throw new Error(`Payment failed (HTTP ${paid.status}): ${await paid.text()}`);
    }
    const settlement = this.http.getPaymentSettleResponse((name) => paid.headers.get(name));
    const extra = settlement.extra as { sendAsset?: string; sendAmount?: string } | undefined;
    return {
      price,
      payWith: this.payWith,
      transaction: settlement.transaction,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${settlement.transaction}`,
      spent: extra?.sendAsset && extra.sendAmount ? { asset: extra.sendAsset, amount: extra.sendAmount } : undefined,
      body: await readBody(paid),
    };
  }

  private get scheme(): string {
    return this.payWith === "XLM" ? "exact-fx" : "exact";
  }

  private enforceBudget(price: Price): void {
    if (!this.maxPrice) return;
    if (!price.local || price.local.currency !== this.maxPrice.currency) {
      throw new Error(`Refusing to pay: price is not in ${this.maxPrice.currency}`);
    }
    if (Number(price.local.amount) > this.maxPrice.amount) {
      throw new Error(
        `Refusing to pay ${price.local.amount} ${price.local.currency}: above the ${this.maxPrice.amount} ${this.maxPrice.currency} limit`,
      );
    }
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
