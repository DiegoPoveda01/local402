import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { ExactFxClientScheme, FX_TESTNET } from "@local402/fx";
import { quoteLocalPrice, ReflectorFiatOracle, UfRateSource, type FiatRateSource, type LocalQuote } from "@local402/pricing";

export type PayAsset = "USDC" | "XLM" | "EURC";

/** Assets paid through `exact-fx`, swapped to the seller's USDC by FxPay. */
const FX_SEND_ASSETS: Record<Exclude<PayAsset, "USDC">, string> = { XLM: FX_TESTNET.xlm, EURC: FX_TESTNET.eurc };

/** A running spending cap in local currency, e.g. "5000 CLP". Share one across clients that pay with different assets. */
export class SpendingBudget {
  /** USDC units spent or reserved by in-flight payments. */
  spent = 0n;
  constructor(readonly limit: string) {}
}

export interface Local402ClientOptions {
  secret: string;
  /** Asset the payer spends. USDC uses stock `exact`; XLM and EURC use `exact-fx` through FxPay. */
  payWith?: PayAsset;
  /** Refuse any single payment worth more than this local price, e.g. "500 CLP", whatever currency it is priced in. */
  maxPrice?: string;
  /** Refuse any payment that would take total spending past this budget. */
  budget?: SpendingBudget;
  /** Refuse quotes charging more than this above the client's own oracle rate. Default 200 (2%). */
  maxOverchargeBps?: number;
  /** Rates used to check the seller's quote. Defaults to Reflector plus UF. */
  oracle?: FiatRateSource;
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
  /** Send-asset amount the FX swap consumed, when paying with XLM or EURC. */
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
  private readonly maxPrice?: string;
  readonly budget?: SpendingBudget;
  private readonly maxOverchargeBps: bigint;
  private readonly oracle: FiatRateSource;

  constructor(options: Local402ClientOptions) {
    const signer = createEd25519Signer(options.secret, NETWORK);
    this.address = signer.address;
    this.payWith = options.payWith ?? "USDC";
    const scheme =
      this.payWith === "USDC"
        ? new ExactStellarScheme(signer)
        : new ExactFxClientScheme(signer, { fxContract: FX_TESTNET.fxContract, sendAsset: FX_SEND_ASSETS[this.payWith] });
    this.http = new x402HTTPClient(new x402Client().register("stellar:*", scheme));
    this.maxPrice = options.maxPrice;
    this.budget = options.budget;
    this.maxOverchargeBps = BigInt(options.maxOverchargeBps ?? 200);
    this.oracle = options.oracle ?? new UfRateSource(new ReflectorFiatOracle());
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
    await this.checkPrice(price);

    // Reserve the amount so concurrent payments cannot overrun the budget together.
    const charged = BigInt(price.amount);
    if (this.budget) this.budget.spent += charged;
    const paid = await fetch(url, { headers: this.http.encodePaymentSignatureHeader(payload) }).catch((error) => {
      if (this.budget) this.budget.spent -= charged;
      throw error;
    });
    if (!paid.ok) {
      if (this.budget) this.budget.spent -= charged;
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
    return this.payWith === "USDC" ? "exact" : "exact-fx";
  }

  /** Checks the charge against the client's own oracle rather than trusting the seller's rate. */
  async checkPrice(price: Price): Promise<void> {
    const charged = BigInt(price.amount);
    const [fair, cap, budget] = await Promise.all([
      price.local && quoteLocalPrice(`${price.local.amount} ${price.local.currency}`, { oracle: this.oracle }),
      this.maxPrice && quoteLocalPrice(this.maxPrice, { oracle: this.oracle }),
      this.budget && quoteLocalPrice(this.budget.limit, { oracle: this.oracle }),
    ]);
    if (fair && charged * 10_000n > BigInt(fair.tokenAmount) * (10_000n + this.maxOverchargeBps)) {
      throw new Error(
        `Refusing to pay: ${fair.localAmount} ${fair.currency} is ${fair.tokenAmount} USDC units by our oracle, but the seller charges ${price.amount}`,
      );
    }
    if (cap && charged > BigInt(cap.tokenAmount)) {
      const label = fair ? `${fair.localAmount} ${fair.currency}` : `${price.amount} USDC units`;
      throw new Error(`Refusing to pay ${label}: above the ${this.maxPrice} limit`);
    }
    if (budget && this.budget && this.budget.spent + charged > BigInt(budget.tokenAmount)) {
      throw new Error(`Refusing to pay: it would exceed the ${this.budget.limit} budget (${this.budget.spent} of ${budget.tokenAmount} USDC units already spent)`);
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
