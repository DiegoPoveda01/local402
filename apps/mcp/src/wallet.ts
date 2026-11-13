import { Local402Client, SpendingBudget, type Local402ClientOptions, type PaidResult, type PayAsset, type Price } from "@local402/client";
import { formatUsdc, PaymentHistory, startOfDay, type Receipt } from "./history.js";
import type { Limits } from "./limits.js";

export const PAY_ASSETS = ["USDC", "XLM", "EURC"] as const satisfies readonly PayAsset[];

type ClientOptions = Omit<Local402ClientOptions, "payWith" | "maxPrice" | "budget">;

/**
 * The agent's paying side: one client per asset, sharing per-payment, daily and total limits in local currency.
 * Spending is read back from the payment history before every check, so the limits survive restarts.
 */
export class AgentWallet {
  readonly daily: SpendingBudget;
  readonly total: SpendingBudget;
  private readonly clients: Record<PayAsset, Local402Client>;
  /** Payments run one at a time, so the history the limits are read from is never stale. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    options: ClientOptions,
    readonly limits: Limits,
    readonly history: PaymentHistory,
    readonly payWith: PayAsset = "USDC",
    private readonly now = () => new Date(),
  ) {
    this.daily = new SpendingBudget(limits.day);
    this.total = new SpendingBudget(limits.total);
    const client = (asset: PayAsset) =>
      new Local402Client({ ...options, payWith: asset, maxPrice: limits.payment, budget: [this.daily, this.total] });
    this.clients = { USDC: client("USDC"), XLM: client("XLM"), EURC: client("EURC") };
  }

  get address(): string {
    return this.clients.USDC.address;
  }

  get network(): string {
    return this.clients.USDC.network;
  }

  private sync(): void {
    this.daily.spent = this.history.spentSince(startOfDay(this.now()));
    this.total.spent = this.history.spentSince(new Date(0));
  }

  /** Checks a price against the seller's rate, the per-payment limit and what is left today and in total. */
  async check(price: Price): Promise<void> {
    this.sync();
    await this.clients[this.payWith].checkPrice(price);
  }

  /** The price of a resource without paying, and whether the limits would let it through. */
  async quote(url: string): Promise<{ free: true } | (Price & { allowed: boolean; refusal?: string })> {
    const price = await this.clients[this.payWith].quote(url);
    if (!price) return { free: true };
    try {
      await this.check(price);
      return { ...price, allowed: true };
    } catch (error) {
      return { ...price, allowed: false, refusal: (error as Error).message };
    }
  }

  async pay(url: string, asset: PayAsset = this.payWith): Promise<(PaidResult & { receipt: Receipt }) | { free: true; body: unknown }> {
    const run = this.queue.then(async () => {
      this.sync();
      const result = await this.clients[asset].pay(url);
      if ("free" in result) return result;
      const receipt: Receipt = {
        at: this.now().toISOString(),
        url,
        network: this.network,
        payWith: asset,
        price: result.price.local,
        usdcUnits: result.price.amount,
        usdc: formatUsdc(result.price.amount),
        spent: result.spent,
        transaction: result.transaction,
        explorerUrl: result.explorerUrl,
      };
      this.history.add(receipt);
      return { ...result, receipt };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Limits and what is left of each, in USDC. */
  status() {
    this.sync();
    return {
      perPayment: this.limits.payment,
      daily: { limit: this.limits.day, spentUsdc: formatUsdc(this.daily.spent) },
      total: { limit: this.limits.total, spentUsdc: formatUsdc(this.total.spent) },
    };
  }
}
