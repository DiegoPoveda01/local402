import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Operation, scValToNative, Transaction } from "@stellar/stellar-sdk";
import { createEd25519Signer, getNetworkPassphrase, type ClientStellarSigner } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { ExactFxClientScheme, fxNetwork } from "@local402/fx";
import { quoteLocalPrice, REFLECTOR_CEX, ReflectorFiatOracle, UfRateSource, type FiatRate, type FiatRateSource, type LocalQuote } from "@local402/pricing";

/** Local402's FxPay deployment on Stellar mainnet (scripts/mainnet/deploy-fxpay.sh). */
export const FXPAY_MAINNET = "CBMWKVMFEBBSN2VS7VD3AYNDLHAIPW4WYP5ZAOAEXKT4NCG2OPGYRSCV";

export type PayAsset = "USDC" | "XLM" | "EURC";

type FxAsset = Exclude<PayAsset, "USDC">;

/** Oracle symbol that prices each send asset in USD. EURC is valued at the euro rate, being redeemable 1:1 for euros. */
const FX_ORACLE_SYMBOLS: Record<FxAsset, string> = { XLM: "XLM", EURC: "EUR" };

/** A cached copy of an earlier purchase would hide the 402 and look like a free resource. */
const NO_CACHE = { cache: "no-store" } as const;

/** A running spending cap in local currency, e.g. "5000 CLP". Share one across clients that pay with different assets. */
export class SpendingBudget {
  /** USDC units spent or reserved by in-flight payments. */
  spent = 0n;
  constructor(readonly limit: string) {}
}

export interface Local402ClientOptions {
  /** Payer secret key. Give either this or `signer`. */
  secret?: string;
  /** Signs the payer's authorization entries without exposing a key, e.g. a browser wallet. */
  signer?: ClientStellarSigner;
  /** Default `stellar:testnet`. On `stellar:pubnet`, XLM and EURC payments also need `fxContract`. */
  network?: Network;
  /** Soroban RPC. Defaults to the public testnet RPC, or a public mainnet one. */
  rpcUrl?: string;
  /** FxPay contract trusted with XLM and EURC payments. Defaults to the Local402 testnet deployment. */
  fxContract?: string;
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
  /**
   * Refuse XLM or EURC payments whose swap may spend more than this above the oracle value of the price.
   * Covers slippage (2%), pool fees and spread. Default 500 (5%).
   */
  maxFxPremiumBps?: number;
  /**
   * Slippage the swap itself authorizes above its quote, in basis points. Default 200 (2%).
   * Unused input is refunded, so this is a ceiling, not a cost; raise it for thin pools, but keep it
   * under `maxFxPremiumBps` or every FX payment is refused before it is signed.
   */
  fxSlippageBps?: number;
  /** USD rates for the send assets, asked for `XLM` and `EUR`. Defaults to Reflector's exchange feed for XLM and `oracle` for EUR. */
  assetOracle?: FiatRateSource;
}

/** How the FX leg of a payment compares with the oracle. */
export interface FxCheck {
  /** Most send asset the payment can spend (quote plus slippage), in its smallest unit. Unused input is refunded. */
  maxSend: string;
  /** Send asset worth the USDC price at the oracle rate. */
  oracleSend: string;
  /** How far `maxSend` is above `oracleSend`, in basis points; negative when the pool prices the asset above the oracle. */
  premiumBps: number;
  oracleSource: string;
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
  fx?: FxCheck;
  body: unknown;
}

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

/** Pays x402 resources priced in local currency on Stellar, with USDC, XLM or EURC. */
export class Local402Client {
  readonly address: string;
  readonly payWith: PayAsset;
  readonly network: Network;
  private readonly http: x402HTTPClient;
  private readonly maxPrice?: string;
  readonly budget?: SpendingBudget;
  private readonly maxOverchargeBps: bigint;
  private readonly oracle: FiatRateSource;
  private readonly maxFxPremiumBps: number;
  private readonly assetOracle: FiatRateSource;

  constructor(options: Local402ClientOptions) {
    this.network = options.network ?? "stellar:testnet";
    const signer = options.signer ?? (options.secret ? createEd25519Signer(options.secret, this.network) : undefined);
    if (!signer) throw new Error("Local402Client needs a secret or a signer");
    this.address = signer.address;
    this.payWith = options.payWith ?? "USDC";
    const fx = fxNetwork(this.network, options.fxContract);
    const rpcUrl = options.rpcUrl ?? fx.rpcUrl;
    const rpcConfig = rpcUrl ? { url: rpcUrl } : undefined;
    if (this.payWith !== "USDC" && !fx.fxContract) throw new Error(`Paying with ${this.payWith} on ${this.network} needs fxContract`);
    const scheme =
      this.payWith === "USDC"
        ? new ExactStellarScheme(signer, rpcConfig)
        : new ExactFxClientScheme(signer, {
            fxContract: fx.fxContract!,
            sendAsset: this.payWith === "XLM" ? fx.xlm : fx.eurc,
            rpcConfig,
            slippageBps: options.fxSlippageBps,
          });
    this.http = new x402HTTPClient(new x402Client().register("stellar:*", scheme));
    this.maxPrice = options.maxPrice;
    this.budget = options.budget;
    this.maxOverchargeBps = BigInt(options.maxOverchargeBps ?? 200);
    this.oracle = options.oracle ?? new UfRateSource(new ReflectorFiatOracle());
    this.maxFxPremiumBps = options.maxFxPremiumBps ?? 500;
    const exchanges = new ReflectorFiatOracle(REFLECTOR_CEX);
    this.assetOracle = options.assetOracle ?? { getRate: (symbol) => (symbol === "XLM" ? exchanges : this.oracle).getRate(symbol) };
  }

  /** Reads a resource's price without paying. Returns undefined if the resource is free. */
  async quote(url: string): Promise<Price | undefined> {
    const response = await fetch(url, NO_CACHE);
    if (response.status !== 402) return undefined;
    const required = this.http.getPaymentRequiredResponse((name) => response.headers.get(name), await response.json());
    const option = required.accepts.find((accept) => accept.scheme === this.scheme) ?? required.accepts[0];
    return describe(url, option);
  }

  /** Fetches a resource, paying for it if it returns 402. */
  async pay(url: string): Promise<PaidResult | { free: true; body: unknown }> {
    const first = await fetch(url, NO_CACHE);
    if (first.status !== 402) return { free: true, body: await readBody(first) };

    const required = this.http.getPaymentRequiredResponse((name) => first.headers.get(name), await first.json());
    const payload = await this.http.createPaymentPayload(required);
    const price = describe(url, payload.accepted);
    await this.checkPrice(price);
    const fx = this.payWith === "USDC" ? undefined : await this.checkFxLeg(price.amount, fxMaxSend(payload));

    // Reserve the amount so concurrent payments cannot overrun the budget together.
    const charged = BigInt(price.amount);
    if (this.budget) this.budget.spent += charged;
    const paid = await fetch(url, { ...NO_CACHE, headers: this.http.encodePaymentSignatureHeader(payload) }).catch((error) => {
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
      explorerUrl: `https://stellar.expert/explorer/${this.network === "stellar:pubnet" ? "public" : "testnet"}/tx/${settlement.transaction}`,
      spent: extra?.sendAsset && extra.sendAmount ? { asset: extra.sendAsset, amount: extra.sendAmount } : undefined,
      fx,
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

  /**
   * The seller's quote is checked in USDC, but an XLM or EURC payment also trusts the pool's exchange rate.
   * This bounds the swap too: the most it may spend is compared with the oracle value of the USDC price.
   */
  async checkFxLeg(usdcAmount: string, maxSend: bigint): Promise<FxCheck> {
    if (this.payWith === "USDC") throw new Error("USDC payments have no FX leg");
    const symbol = FX_ORACLE_SYMBOLS[this.payWith];
    const rate = await this.assetOracle.getRate(symbol);
    if (Date.now() / 1000 - rate.timestamp > MAX_ORACLE_AGE_SECONDS) {
      throw new Error(`Refusing to pay: the ${symbol} oracle rate is stale`);
    }
    const oracleSend = oracleSendAmount(usdcAmount, rate);
    const premiumBps = Number(((maxSend - oracleSend) * 10_000n) / oracleSend);
    if (premiumBps > this.maxFxPremiumBps) {
      throw new Error(
        `Refusing to pay: the swap may spend ${maxSend} ${this.payWith} units, ${(premiumBps / 100).toFixed(2)}% above the ${oracleSend} the oracle rate implies (limit ${this.maxFxPremiumBps / 100}%)`,
      );
    }
    return { maxSend: maxSend.toString(), oracleSend: oracleSend.toString(), premiumBps, oracleSource: rate.source };
  }
}

const MAX_ORACLE_AGE_SECONDS = 900;

/** Send-asset units worth `usdcAmount` at an oracle rate, rounded up. USDC and the send assets use 7 decimals; USDC counts as one dollar. */
export function oracleSendAmount(usdcAmount: string | bigint, rate: FiatRate): bigint {
  return (BigInt(usdcAmount) * 10n ** BigInt(rate.decimals) + rate.usdPerUnit - 1n) / rate.usdPerUnit;
}

/** Reads the `maxSend` argument of the FxPay `pay` call the payload authorizes. */
export function fxMaxSend(payload: PaymentPayload): bigint {
  const transaction = new Transaction(String((payload.payload as { transaction?: unknown }).transaction), getNetworkPassphrase(payload.accepted.network));
  const operation = transaction.operations[0] as Operation.InvokeHostFunction;
  return scValToNative(operation.func.invokeContract().args()[2]) as bigint;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
