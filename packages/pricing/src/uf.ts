import { toScaled } from "./money.js";
import type { FiatRate, FiatRateSource } from "./oracle.js";

const MAX_STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Value of one UF in CLP, e.g. "40934.58". */
export type UfValueSource = () => Promise<{ clp: string; source: string }>;

const TIMEOUT_MS = 4_000;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** The UF is defined per calendar day in Chile, e.g. "2026-09-15". */
export const chileDate = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(now);

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  return response;
}

/** Finds a day's value in the yearly UF page of Chile's tax service: one table per month, "40.934,58" per day. */
export function parseSiiUf(html: string, date: string): string | undefined {
  const [, month, day] = date.split("-").map(Number);
  const start = html.indexOf(`id='mes_${MONTHS[month - 1]}'`);
  if (start < 0) return undefined;
  const end = html.indexOf("class='meses'", start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const cell = new RegExp(`<strong>${day}</strong></th>\\s*<td[^>]*>([\\d.]+,\\d+)</td>`).exec(table);
  return cell?.[1].replaceAll(".", "").replace(",", ".");
}

/** Official UF values from the SII (Servicio de Impuestos Internos), published up to the 9th of the next month. */
export const siiUf: UfValueSource = async () => {
  const date = chileDate();
  const html = await (await get(`https://www.sii.cl/valores_y_fechas/uf/uf${date.slice(0, 4)}.htm`)).text();
  const clp = parseSiiUf(html, date);
  if (!clp) throw new Error(`sii.cl has no UF value for ${date}`);
  return { clp, source: "sii.cl" };
};

/** mindicador.cl and findic.cl serve the same JSON shape: a series of { fecha, valor }, newest first. */
const seriesUf = (host: string): UfValueSource => async () => {
  const date = chileDate();
  const body = (await (await get(`https://${host}/api/uf`)).json()) as { serie?: { fecha: string; valor: number }[] };
  const value = body.serie?.find((entry) => entry.fecha.startsWith(date))?.valor;
  if (!value) throw new Error(`${host} has no UF value for ${date}`);
  return { clp: String(value), source: host };
};
export const mindicadorUf = seriesUf("mindicador.cl");
export const findicUf = seriesUf("findic.cl");

/** Tries each source in order and returns the first value; fails only if all of them do. */
export function firstUf(...sources: UfValueSource[]): UfValueSource {
  return async () => {
    const errors: string[] = [];
    for (const source of sources) {
      try {
        return await source();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(`No UF source available: ${errors.join("; ")}`);
  };
}

/** Off-chain, since no on-chain oracle publishes CLF: the SII first, then two public mirrors. */
export const chileUf = firstUf(siiUf, findicUf, mindicadorUf);

/**
 * Adds Unidad de Fomento (ISO 4217 "CLF") to a fiat rate source.
 * USD per UF = UF value in CLP (off-chain, daily) x USD per CLP (from the wrapped oracle).
 * Every other currency goes straight to the wrapped source.
 * If every UF source is down, the last value it returned keeps being used for up to three days (the UF moves about
 * 0.01% a day), and the source is asked again at most once a minute.
 */
export class UfRateSource implements FiatRateSource {
  private cached?: { day: string; clp: string; source: string };
  private retryAt = 0;
  private lastError: unknown;

  constructor(
    private readonly inner: FiatRateSource,
    private readonly ufValue: UfValueSource = chileUf,
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
    const day = chileDate(now);
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
