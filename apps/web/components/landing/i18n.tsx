"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { finishScrambles } from "./motion";

export type Lang = "es" | "en";

// Every helper that prints text or numbers follows the language toggle, like the page copy does.
export function helpers(lang: Lang) {
  const tr = <T,>(es: T, en: T) => (lang === "en" ? en : es);
  const locale = tr("es-CL", "en-US");
  const fmt = (units: string | number, decimals = 7) => (Number(units) / 10 ** decimals).toLocaleString(locale, { maximumFractionDigits: 7 });
  const local = (amount: string | number) => Number(amount).toLocaleString(locale, { maximumFractionDigits: 4 });
  const rate = (usdPerUnit: string | number) => Number(Number(usdPerUnit).toPrecision(6)).toLocaleString(locale, { maximumFractionDigits: 8 });
  // UF sources are named "<site>:uf*reflector:…"; everything else comes straight from Reflector.
  const sourceLabel = (source: string) => (source.includes(":uf*") ? `${tr("UF de", "UF from")} ${source.split(":")[0]} × Reflector` : tr("Oráculo Reflector", "Reflector oracle"));
  // Premium of a send amount over its oracle value, as a signed percentage.
  const premium = (units: string | number, oracle: string | number) => {
    const pct = (Number(units) / Number(oracle) - 1) * 100;
    return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };
  // Swap premium over the oracle: what was spent, or for the first scripted payments the most the swap could spend.
  const bps = (value: number) => `${value >= 0 ? "+" : "−"}${(Math.abs(value) / 100).toLocaleString(locale, { minimumFractionDigits: 2 })}%`;
  const time = (date: string | number | Date) => new Date(date).toLocaleTimeString(locale);
  return { lang, tr, locale, fmt, local, rate, sourceLabel, premium, bps, time };
}
export type Helpers = ReturnType<typeof helpers>;

export const currencyLabel = (code: string) => (code === "CLF" ? "UF" : code);
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

const LangContext = createContext<{ h: Helpers; setLang: (lang: Lang) => void }>({ h: helpers("es"), setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    try { if (localStorage.getItem("lang") === "en") setLang("en"); } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("lang", lang); } catch {}
  }, [lang]);
  // A title still decoding would keep its scrambled text after the switch.
  const value = useMemo(() => ({ h: helpers(lang), setLang: (next: Lang) => { finishScrambles(); setLang(next); } }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
export const useH = () => useContext(LangContext).h;
