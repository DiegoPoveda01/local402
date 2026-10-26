"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { currencyLabel, useH, type Helpers } from "./i18n";
import { IdLink, TxLink, useLive, type Item } from "./live";
import { calm } from "./motion";

type Accept = { scheme: string; amount: string; payTo: string; extra: { local402: Item["quote"]; sendAssets: string[]; fxContract: string } };
type Required = { accepts: Accept[] };

export const S = ({ c, children }: { c: string; children: ReactNode }) => <span className={c}>{children}</span>;
// Terminal output: one line per entry, as the old console wrote them joined by newlines.
export const Lines = ({ lines }: { lines: ReactNode[] }) => <>{lines.map((line, i) => <Fragment key={i}>{i ? "\n" : ""}{line}</Fragment>)}</>;

// Requests the resource without paying and decodes the standard PAYMENT-REQUIRED header.
async function fetch402(path: string, tr: Helpers["tr"]): Promise<Required> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const header = response.headers.get("payment-required");
  if (response.status !== 402 || !header) throw new Error(tr(`Se esperaba 402 y llegó ${response.status}`, `Expected 402, got ${response.status}`));
  const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function describe402(path: string, required: Required, h: Helpers, symbol: (asset: string) => string): ReactNode[] {
  const { tr, local, rate, fmt, sourceLabel, time } = h;
  const exact = required.accepts.find((a) => a.scheme === "exact");
  const fx = required.accepts.find((a) => a.scheme === "exact-fx");
  const q = (exact ?? fx)!.extra.local402;
  const lines: ReactNode[] = [
    <S c="h">$ curl -i {location.origin}{path}</S>,
    <S c="y">HTTP/1.1 402 Payment Required</S>,
    <S c="c">{tr("PAYMENT-REQUIRED (base64, decodificado):", "PAYMENT-REQUIRED (base64, decoded):")}</S>,
    <>{"  "}{tr("precio", "price ")}{"    "}<S c="h">{local(q.localAmount)} {currencyLabel(q.currency)}</S>{"  "}1 {currencyLabel(q.currency)} = {rate(q.usdPerUnit)} USD</>,
    <>{"  "}{tr("fuente", "source")}{"    "}{sourceLabel(q.oracleSource)}, {time(q.oracleTimestamp * 1000)}</>,
  ];
  if (exact) lines.push(<>{"  "}exact{"     "}<S c="h">{fmt(exact.amount)} USDC</S> → <IdLink id={exact.payTo} /></>);
  if (fx) lines.push(<>{"  "}exact-fx{"  "}<S c="v">{fx.extra.sendAssets.map(symbol).join(tr(" o ", " or "))}</S> → FxPay <IdLink id={fx.extra.fxContract} /> → {tr("mismo USDC", "same USDC")}</>);
  lines.push(<>{"  "}{tr("válido    hasta", "valid     until")} {time(q.expiresAt * 1000)}</>);
  return lines;
}

// The API publishes its descriptions in Spanish (they also go to Bazaar); these are for the English page.
const DESCRIPTIONS_ES: Record<string, string> = {
  "/indicadores": "Indicadores de mercado para Chile, cobrados en pesos chilenos",
  "/europa": "Tipos de cambio del euro, cobrados en euros",
  "/uf": "Valor de la UF en pesos y dólares, cobrado en UF",
  "/latam": "Monedas de Latinoamérica por dólar, cobradas en pesos mexicanos",
  "/asia": "Monedas de Asia por dólar, cobradas en rupias indias",
  "/africa": "Monedas de África por dólar, cobradas en nairas nigerianas",
};

// What the console shows: a 402 (redrawn in the page language) or a payment's output as it happened.
type Term = { kind: "loading" } | { kind: "peek"; path: string; required?: Required; error?: string } | { kind: "pay"; lines: ReactNode[] };

// The six routes take turns while the section is on screen: each one opens its card and its 402 in the console.
// Hovering pauses the turn; picking a route or paying hands control to the visitor for good.
export function Probar() {
  const h = useH();
  const { tr, local, fmt, rate, premium, locale } = h;
  const { catalog, symbol, loadReceipts } = useLive();
  const [active, setActive] = useState<string>();
  const [manual, setManual] = useState(false);
  const [offscreen, setOffscreen] = useState(true);
  const [paying, setPaying] = useState(false);
  const [term, setTerm] = useState<Term>({ kind: "loading" });
  const routes = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  // Each peek or payment bumps the run, so a 402 that arrives late never overwrites a newer one.
  const peekRun = useRef(0);

  useEffect(() => { if (calm()) setManual(true); }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    observer.observe(routes.current!);
    return () => observer.disconnect();
  }, []);

  async function peek(path: string) {
    const run = ++peekRun.current;
    setTerm({ kind: "peek", path });
    let next: Term;
    try {
      next = { kind: "peek", path, required: await fetch402(path, tr) };
    } catch (error) {
      next = { kind: "peek", path, error: (error as Error).message };
    }
    if (run === peekRun.current) setTerm(next);
  }
  function select(path: string) {
    setActive(path);
    peek(path);
  }
  function nextRoute() {
    const paths = catalog!.items.filter((item) => !item.error).map((item) => item.path);
    select(paths[(paths.indexOf(active!) + 1) % paths.length]);
  }

  const loaded = !!catalog;
  useEffect(() => {
    if (!catalog?.items.length) return;
    const quoted = catalog.items.find((item) => !item.error);
    select((quoted ?? catalog.items[0]).path);
    // Only the first catalog picks a route; the 30 s refreshes keep the visitor's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // A payment's output follows its last line.
  useEffect(() => {
    if (term.kind === "pay" && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [term]);

  async function pay(path: string, asset: string) {
    setManual(true);
    peekRun.current++;
    setPaying(true);
    consoleRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const lines: ReactNode[] = [];
    const show = (...more: ReactNode[]) => { lines.push(...more); setTerm({ kind: "pay", lines: [...lines] }); };
    try {
      show(...describe402(path, await fetch402(path, tr), h, symbol), "");
      show(asset === "USDC"
        ? <S c="h">{tr("→ el agente firma una transferencia de USDC (exact)", "→ the agent signs a USDC transfer (exact)")}</S>
        : <S c="h">{tr(`→ el agente firma FxPay.pay con ${asset}`, `→ the agent signs FxPay.pay with ${asset}`)} (exact-fx){asset === "EURC" ? tr(", ruta EURC → XLM → USDC", ", route EURC → XLM → USDC") : ""}</S>);
      show(<S c="c">{tr("  reintenta con PAYMENT-SIGNATURE; el facilitador verifica, simula y liquida…", "  retries with PAYMENT-SIGNATURE; the facilitator verifies, simulates and settles…")}</S>);
      const started = performance.now();
      // A settlement takes several seconds; a live counter shows the demo is working.
      const waitingLabel = tr("  esperando confirmación on-chain", "  waiting for on-chain confirmation");
      show(<S c="y">{waitingLabel} · 0 s</S>);
      const waiting = setInterval(() => {
        lines[lines.length - 1] = <S c="y">{waitingLabel} · {Math.floor((performance.now() - started) / 1000)} s</S>;
        setTerm({ kind: "pay", lines: [...lines] });
      }, 1000);
      const response = await fetch(`/demo/pay?with=${asset}&path=${encodeURIComponent(path)}`, { method: "POST" }).finally(() => { clearInterval(waiting); lines.pop(); });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const seconds = ((performance.now() - started) / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
      const high = data.fx?.premiumBps > 500;
      show(
        <S c="g">HTTP/1.1 200 OK{"  ·  "}{seconds} s{"  ·  "}tx <TxLink hash={data.transaction} /></S>,
        data.spent
          ? <>{"  "}{tr("cliente gastó", "client spent")} <S c="v">{fmt(data.spent.amount)} {symbol(data.spent.asset)}</S> · {tr("vendedor recibió", "seller received")} {fmt(data.price.amount)} USDC</>
          : <>{"  "}{tr("vendedor recibió", "seller received")} {fmt(data.price.amount)} USDC</>,
        ...(data.fx ? [<>{"  "}{tr("guardia FX: gasto máx.", "FX guard: max spend")} {fmt(data.fx.maxSend)} {asset} · Reflector {fmt(data.fx.oracleSend)} · {tr("prima", "premium")} <S c={high ? "y" : "g"}>{premium(data.fx.maxSend, data.fx.oracleSend)}</S>{high ? <S c="y">{tr(" (pool de testnet; en mainnet el cliente rechaza > 5%)", " (testnet pool; on mainnet the client refuses > 5%)")}</S> : <S c="g">{tr(" ✓ bajo el límite de 5%", " ✓ under the 5% limit")}</S>}</>] : []),
        JSON.stringify(data.body, null, 2),
      );
      loadReceipts().catch(() => {});
    } catch (error) {
      show(<S c="r">Error: {(error as Error).message}</S>);
    } finally {
      setPaying(false);
    }
  }

  let output: ReactNode = tr("Cargando…", "Loading…");
  if (term.kind === "pay") output = <Lines lines={term.lines} />;
  if (term.kind === "peek") {
    const lines = term.error ? [<S c="r">Error: {term.error}</S>] : term.required ? describe402(term.path, term.required, h, symbol) : null;
    // The response comes in a line at a time, like it would in a terminal.
    output = lines
      ? <Lines lines={lines.map((line, i) => <span className="ln" style={{ animationDelay: `${i * 70}ms` }}>{line}</span>)} />
      : <S c="h">$ curl -i {location.origin}{term.path}</S>;
  }

  return (
    <section id="probar">
      <div className="eyebrow"><span className="n">[01]</span>{tr("Pruébalo", "Try it")}</div>
      <div className="probar-head">
        <h2>{tr(<>Seis APIs, seis monedas. <em>Un solo</em> USDC al otro lado.</>, <>Six APIs, six currencies. <em>One</em> USDC on the other side.</>)}</h2>
        <p className="sub">{tr("Elige una ruta y mira su 402, gratis y sin wallet. Los botones de color pagan de verdad en testnet.", "Pick a route to see its 402, free and with no wallet. The colored buttons really pay on testnet.")}</p>
      </div>
      <div className={`routes${offscreen ? " offscreen" : ""}${manual ? " manual" : ""}`} id="routes" ref={routes}>
        <div className="route-side">
          <div className="route-list" id="route-list">
            {catalog?.items.map((item) => (
              <button key={item.path} className="route" data-path={item.path} aria-pressed={item.path === active} onClick={() => { setManual(true); select(item.path); }}>
                <span>GET {item.path}</span>
                <b>{item.error ? item.price.replace(".", ",") : `${local(item.quote.localAmount)} ${currencyLabel(item.quote.currency)}`}</b>
                <i className="bar" onAnimationEnd={nextRoute}></i>
              </button>
            ))}
          </div>
          <div id="products">
            {catalog?.items.map((item) => {
              const q = item.quote;
              return (
                <div key={item.path} className="card" id={`product-${item.path.slice(1)}`} hidden={item.path !== active}>
                  <h3>GET {item.path}</h3>
                  <div className="meta desc">{tr(DESCRIPTIONS_ES[item.path] ?? item.description, item.description)}</div>
                  {/* A rate source can be down (the UF comes from off-chain sites); the other products keep working. */}
                  {item.error ? <>
                    <div className="price">{item.price.replace(".", ",")}<small>{tr("cotización no disponible", "quote unavailable")}</small></div>
                    <div className="rate">{/UF source|fetch failed|abort/i.test(item.error)
                      ? tr("Las fuentes de la UF (SII, findic.cl, mindicador.cl) no responden ahora. Se reintenta sola.", "The UF sources (SII, findic.cl, mindicador.cl) are not answering right now. It retries on its own.")
                      : `Error: ${item.error}`}</div>
                  </> : <>
                    <div className="price">{local(q.localAmount)} {currencyLabel(q.currency)}<small>≈ {fmt(item.usdcAmount, q.tokenDecimals)} USDC</small></div>
                    <div className="rate">1 {currencyLabel(q.currency)} = {rate(q.usdPerUnit)} USD</div>
                  </>}
                  <div className="label">{tr("Pagar con", "Pay with")}</div>
                  <div className="buttons">
                    {catalog.payAssets.map((asset) => (
                      <button key={asset} className={`pay ${asset.toLowerCase()}`} disabled={paying || !!item.error || !catalog.demoAgent}
                        title={item.error || catalog.demoAgent ? undefined : tr("Define DEMO_AGENT_SECRET en la API para activar pagos de demo", "Set DEMO_AGENT_SECRET on the API to enable demo payments")}
                        onClick={() => pay(item.path, asset)}>{asset}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="window">
          <div className="window-bar"><span>{tr("agente@local402", "agent@local402")}</span></div>
          <div className="term" id="console" aria-live={manual ? "polite" : "off"} ref={consoleRef}>{output}</div>
        </div>
      </div>
    </section>
  );
}
