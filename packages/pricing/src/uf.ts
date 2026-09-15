import { toScaled } from "./money.js";
import type { FiatRate, FiatRateSource } from "./oracle.js";

/** Value of one UF in CLP, e.g. "40934.58". */
export type UfValueSource = () => Promise<{ clp: string; source: string }>;

/** UF values published by Chile's CMF, served by mindicador.cl. Off-chain: no on-chain oracle publishes CLF. */
export const mindicadorUf: UfValueSource = async () => {
  const response = await fetch("https://mindicador.cl/api/uf");
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
 */
export class UfRateSource implements FiatRateSource {
  private cached?: { day: string; clp: string; source: string };

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
    const day = new Date().toISOString().slice(0, 10);
    if (this.cached?.day !== day) {
      this.cached = { day, ...(await this.ufValue()) };
    }
    return this.cached;
  }
}
