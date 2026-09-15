import { toScaled } from "./money.js";
import type { FiatRate, FiatRateSource } from "./oracle.js";

const MAX_STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Value of one UF in CLP, e.g. "40934.58". */
export type UfValueSource = () => Promise<{ clp: string; source: string }>;

/** UF values published by Chile's CMF, served by mindicador.cl. Off-chain: no on-chain oracle publishes CLF. */
export const mindicadorUf: UfValueSource = async () => {
  const response = await fetch("https://mindicador.cl/api/uf", { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`mindicador.cl returned HTTP ${response.status}`);
  const body = (await response.json()) as { serie?: { valor: number }[] };
  const value = body.serie?.[0]?.valor;
  if (!value) throw new Error("mindicador.cl returned no UF value");
  return { clp: String(value), source: "mindicador.cl" };
};

/**
 * Adds Unidad de Fomento (ISO 4217 "CLF") to a fiat rate source.
 * USD per UF = UF value in CLP (off-chain, daily) x USD per CLP (from the wrapped oracle).
 * Every other currency goes straight to the wrapped source.
 * If the UF source is down, the last value it returned keeps being used for up to three days (the UF moves about
 * 0.01% a day), and the source is asked again at most once a minute.
 */
export class UfRateSource implements FiatRateSource {
  private cached?: { day: string; clp: string; source: string };
  private retryAt = 0;
  private lastError: unknown;

  constructor(
    private readonly inner: FiatRateSource,
    private readonly ufValue: UfValueSource = mindicadorUf,
  ) {}

  async getRate(currency: string): Promise<FiatRate> {
    if (currency !== "CLF") return this.inner.getRate(currency);
    const [clp, uf] = await Promise.all([this.inner.getRate("CLP"), this.dailyUf()]);
    const scaled = toScaled(uf.clp);
    return {
      usdPerUnit: (clp.usdPerUnit * scaled.value) / 10n ** BigInt(scaled.decimals),
      decimals: clp.decimals,
      // The UF changes once a day and is known in advance, so freshness is the CLP rate's.
      timestamp: clp.timestamp,
      source: `${uf.source}:uf*${clp.source}`,
    };
  }

  private async dailyUf() {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.cached?.day === day) return this.cached;
    const usable = this.cached && now - Date.parse(this.cached.day) < MAX_STALE_MS ? this.cached : undefined;
    if (now < this.retryAt) {
      if (usable) return usable;
      throw this.lastError;
    }
    try {
      this.cached = { day, ...(await this.ufValue()) };
      return this.cached;
    } catch (error) {
      this.retryAt = now + 60_000;
      this.lastError = error;
      if (usable) return usable;
      throw error;
    }
  }
}
