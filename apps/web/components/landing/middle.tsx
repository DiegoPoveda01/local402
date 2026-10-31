"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { currencyLabel, useH, type Helpers } from "./i18n";
import { useLive } from "./live";
import { calm, wait } from "./motion";
import { CopyButton, DOCS } from "./top";

type QuoteData = { quote: { currency: string; usdPerUnit: string; oracleSource: string }; pay: Record<string, string>; oracle?: Record<string, string>; mainnet?: Record<string, { soroswap?: string; sdex?: string }> };

// The cheapest read-only mainnet quote for paying with this asset, if any route exists.
const bestMainnet = (data: QuoteData, asset: string) => {
  const main = data.mainnet?.[asset] ?? {};
  return [main.soroswap, main.sdex].filter(Boolean).sort((a, b) => Number(a) - Number(b))[0];
};

// Mainnet routes vs oracle; the testnet pool comes last, since its prices are arbitrary.
function FxLines({ asset, units, data, h }: { asset: string; units: string; data: QuoteData; h: Helpers }) {
  const { tr, fmt, premium } = h;
  const oracle = data.oracle?.[asset];
  if (asset === "USDC" || !oracle) return null;
  const main = data.mainnet?.[asset] ?? {};
  const best = bestMainnet(data, asset);
  const cls = (u: string) => (Number(u) <= Number(oracle) * 1.05 ? "ok" : "warn");
  return (
    <ul className="fx">
      <li>Reflector: <b>{fmt(oracle)}</b>{best ? <> · <span className={cls(best)}>{premium(best, oracle)}</span></> : null}</li>
      {best ? <li>{main.soroswap ? <span>Soroswap {premium(main.soroswap, oracle)}</span> : null}{main.soroswap && main.sdex ? " · " : ""}{main.sdex ? <span>SDEX {premium(main.sdex, oracle)}</span> : null}</li> : <li>mainnet: {tr("sin ruta", "no route")}</li>}
      <li>{tr("pool de testnet", "testnet pool")}: {fmt(units)} ({premium(units, oracle)})</li>
    </ul>
  );
}

const PRESETS = ["30 MXN", "10 BRL", "2 EUR", "100 INR", "800 NGN", "300 KES", "1500 CLP", "0.5 UF"];

export function Calculadora() {
  const h = useH();
  const { tr, rate, sourceLabel, fmt } = h;
  const [input, setInput] = useState("100 INR");
  const [state, setState] = useState<{ status: "idle" | "quoting" } | { status: "error"; message: string } | { status: "done"; data: QuoteData; n: number }>({ status: "idle" });
  const run = useRef(0);

  async function calculate(price: string) {
    setInput(price);
    setState({ status: "quoting" });
    try {
      const response = await fetch(`/demo/quote?price=${encodeURIComponent(price)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState({ status: "done", data, n: ++run.current });
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
    }
  }
  useEffect(() => { calculate(PRESETS[0]); }, []);
  const n = state.status === "done" ? state.n : 0;

  let rateLine: ReactNode = null;
  if (state.status === "quoting") rateLine = tr("Cotizando…", "Quoting…");
  if (state.status === "error") rateLine = <span style={{ color: "var(--err)" }}>[ERR] {state.message}</span>;
  if (state.status === "done") {
    const q = state.data.quote;
    rateLine = <>1 {currencyLabel(q.currency)} = {rate(q.usdPerUnit)} USD · {sourceLabel(q.oracleSource)}. {tr(<>XLM y EURC: la mejor ruta en <b>mainnet ahora</b> (Soroswap o SDEX, solo lectura) frente al valor de Reflector, sin el 2% de slippage. Los pools de prueba de testnet tienen precios arbitrarios.</>, <>XLM and EURC: the best route on <b>mainnet right now</b> (Soroswap or SDEX, read-only) against the Reflector value, before the 2% slippage. The testnet demo pools have arbitrary prices.</>)}</>;
  }

  return (
    <section id="calculadora">
      <div className="wrap">
      <div className="head">
        <div className="eyebrow mark">{tr("Calculadora", "Calculator")}</div>
        <h2>{tr(<>Pon tu precio. Nosotros hacemos <em>el cambio</em>.</>, <>Set your price. We handle <em>the exchange</em>.</>)}</h2>
        <p className="sub">{tr("Cualquier monto en USD, UF o 24 monedas, y lo que cuesta pagarlo con cada activo.", "Any amount in USD, UF or 24 currencies, and what it costs to pay it with each asset.")}</p>
      </div>
      <div className="calc">
        <div className="card">
          <div className="label">{tr("Precio del vendedor", "Seller's price")}</div>
          <form id="calc-form" onSubmit={(event: FormEvent) => { event.preventDefault(); calculate(input); }}>
            <input id="calc-input" name="price" autoComplete="off" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} aria-label={tr("Precio en moneda local", "Price in local currency")} />
            <button className="ghost">{tr("Cotizar", "Quote")}</button>
          </form>
          <div className="presets" id="presets">
            {PRESETS.map((preset) => <button key={preset} className="ghost" onClick={() => calculate(preset)}>{preset.replace(".", ",")}</button>)}
          </div>
          <div className="rate" id="calc-rate">{rateLine}</div>
        </div>
        {/* Keyed by quote, so each new quote fades its figures in. */}
        <div className="amounts" id="calc-amounts" aria-live="polite" key={n}>
          {state.status === "done" && Object.entries(state.data.pay).map(([asset, units]) => {
            const best = asset === "USDC" ? undefined : bestMainnet(state.data, asset);
            return (
            <div key={asset} className={`amount ${asset.toLowerCase()}`}>
              <span className="label">{asset}</span><div className={n > 1 ? "tweening" : undefined}>{fmt(best ?? units)}</div><span className="meta">{asset === "USDC" ? tr("recibe el vendedor", "the seller receives") : best ? tr("gasta el cliente en mainnet", "the client spends on mainnet") : tr("gasta el cliente en testnet", "the client spends on testnet")}</span>
              <FxLines asset={asset} units={units} data={state.data} h={h} />
            </div>
            );
          })}
        </div>
      </div>
      </div>
    </section>
  );
}

const NODES = [25, 275, 525, 775];

// How it works: one payment walks the track and stops at each of the four steps, which lights up below.
// In turns it pays straight in USDC (exact) or in XLM through the FxPay swap (exact-fx). Its label is the
// live quote of GET /africa once the catalog is in: the price, then the USDC the oracle quotes for it.
export function ComoFunciona() {
  const { tr, local, fmt } = useH();
  const { catalog } = useLive();
  const africa = catalog?.items.find((item) => item.path === "/africa" && !item.error);
  const values = useRef<[string, string]>(["70 NGN", "USDC"]);
  if (africa) values.current = [`${local(africa.quote.localAmount)} ${currencyLabel(africa.quote.currency)}`, `${fmt(africa.usdcAmount, africa.quote.tokenDecimals)} USDC`];
  const svg = useRef<SVGSVGElement>(null);
  const [walking, setWalking] = useState(false);
  const [lit, setLit] = useState(-1);

  useEffect(() => {
    if (calm()) return;
    let visible = false;
    let stopped = false;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(svg.current!);
    const token = svg.current!.querySelector(".token")!;
    const [dot, label] = token.children as unknown as [SVGRectElement, SVGTextElement];
    const show = (text: string, color: string) => { label.textContent = text; dot.style.fill = color; };
    // Distance along a path where it reaches x (both tracks only move rightwards).
    const lengthAt = (path: SVGPathElement, x: number) => {
      let lo = 0, hi = path.getTotalLength();
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid; }
      return hi;
    };
    const ease = (t: number) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const walk = (path: SVGPathElement, from: number, to: number, onMove?: (x: number, y: number) => void) => new Promise<void>((done) => {
      const started = performance.now();
      const frame = (now: number) => {
        if (stopped) return done();
        const t = Math.min(1, (now - started) / 1_500);
        const { x, y } = path.getPointAtLength(from + (to - from) * ease(t));
        token.setAttribute("transform", `translate(${x} ${y})`);
        onMove?.(x, y);
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    (async () => {
      for (let n = 0; !stopped; n++) {
        while (!stopped && (!visible || document.hidden)) await wait(500);
        if (stopped) return;
        const fx = n % 2 === 1;
        const path = svg.current!.querySelector<SVGPathElement>(fx ? "#flow-fx" : "#flow-usdc")!;
        const at = NODES.map((x) => lengthAt(path, x));
        const [price, usdc] = values.current;
        token.setAttribute("transform", `translate(${NODES[0]} 30)`);
        show(price, "var(--ink)");
        setWalking(true);
        setLit(0);
        token.classList.add("on");
        await wait(1_300);
        await walk(path, at[0], at[1]);
        show(usdc, "var(--accent)");
        setLit(1);
        await wait(1_300);
        await walk(path, at[1], at[2]);
        if (fx) show("XLM", "var(--ink-2)");
        setLit(2);
        await wait(1_300);
        // exact-fx: XLM goes down into the swap and comes back up as USDC.
        await walk(path, at[2], at[3], fx ? (_x, y) => { if (y > 70) show(usdc, "var(--accent)"); } : undefined);
        setLit(3);
        await wait(2_400);
        token.classList.remove("on");
        setWalking(false);
        setLit(-1);
        await wait(900);
      }
    })();
    return () => { stopped = true; observer.disconnect(); };
  }, []);

  const steps: [string, string, ReactNode, ReactNode][] = [
    ["Precio local", "Local price", <>El vendedor fija <code>&quot;70 NGN&quot;</code> en su ruta.</>, <>The seller sets <code>&quot;70 NGN&quot;</code> on its route.</>],
    ["Oráculo Reflector", "Reflector oracle", "Lo pasa a USDC con la tasa on-chain, a favor del vendedor.", "Converted to USDC at the on-chain rate, in the seller's favor."],
    ["Paga con lo que tengas", "Pay with what you hold", "USDC directo, o XLM y EURC con swap en Soroswap.", "USDC straight, or XLM and EURC with a swap on Soroswap."],
    ["Recibo", "Receipt", "USDC exacto al vendedor; el sobrante vuelve al cliente.", "Exact USDC to the seller; the rest goes back to the payer."],
  ];
  return (
    <section id="como-funciona" className={`how${walking ? " walking" : ""}`}>
      <div className="wrap">
      <div className="head">
        <div className="eyebrow mark">{tr("Cómo funciona", "How it works")}</div>
        <h2>{tr(<>Cuatro pasos y <em>ningún</em> tipo de cambio a mano.</>, <>Four steps and <em>no</em> manual exchange rates.</>)}</h2>
        <p className="sub">{tr("Todo ocurre dentro del flujo x402 estándar. Si algo no cuadra, la transacción entera se revierte.", "It all happens inside the standard x402 flow. If anything doesn't add up, the whole transaction reverts.")}</p>
      </div>
      <svg className="flow-track" id="flow-track" viewBox="0 0 1000 112" aria-hidden="true" ref={svg}>
        <path className="line" id="flow-usdc" d="M25 30 H775" />
        <path className="line" id="flow-fx" d="M25 30 H525 C590 30 600 84 650 84 C700 84 710 30 775 30" />
        <path className="arrow" d="M259 25 L267 30 L259 35 M509 25 L517 30 L509 35 M759 25 L767 30 L759 35" />
        {NODES.map((x) => <rect key={x} className="node" x={x - 4} y="26" width="8" height="8" />)}
        <text x="650" y="52" textAnchor="middle">exact</text>
        <text x="650" y="104" textAnchor="middle">exact-fx · FxPay → Soroswap</text>
        <g className="token"><rect x="-5" y="-5" width="10" height="10" /><text x="-6" y="-13"></text></g>
      </svg>
      <div className="grid4">
        {steps.map(([es, en, pes, pen], i) => (
          <div key={es} className={`step${lit === i ? " on" : ""}`}><span className="n">0{i + 1}</span><h3>{tr(es, en)}</h3><p>{tr(pes, pen)}</p></div>
        ))}
      </div>
      </div>
    </section>
  );
}

const SERVER_LINES: ReactNode[] = [
  <><span className="k">import</span> <span className="p">{"{"}</span> localRoute, local402Server <span className="p">{"}"}</span> <span className="k">from</span> <span className="s">&quot;local402-server&quot;</span><span className="p">;</span></>,
  "",
  <>app.use(paymentMiddleware(<span className="p">{"{"}</span></>,
  <>{"  "}<span className="s">&quot;GET /africa&quot;</span><span className="p">:</span> localRoute(<span className="s">&quot;70 NGN&quot;</span>, <span className="p">{"{"}</span> payTo <span className="p">{"}"}</span>),</>,
  <>{"  "}<span className="s">&quot;GET /uf&quot;</span><span className="p">:</span> localRoute(<span className="s">&quot;0.01 UF&quot;</span>, <span className="p">{"{"}</span> payTo <span className="p">{"}"}</span>),</>,
  <><span className="p">{"}"}</span>, local402Server()))<span className="p">;</span></>,
];
const SERVER_CMD = "npm install local402-server";
const MCP_CMD = `claude mcp add local402 -e STELLAR_PRIVATE_KEY=S… -e "MAX_PRICE=500 CLP" -- npx -y local402-mcp`;

export function Integracion() {
  const { tr, local, fmt } = useH();
  const { catalog } = useLive();
  const [pane, setPane] = useState<"server" | "mcp">("server");
  const africa = catalog?.items.find((item) => item.path === "/africa" && !item.error);
  const tool = (name: string, es: string, en: string) => <div className="l">{name.padEnd(19)}<span className="c">{tr(es, en)}</span></div>;
  const cmd = pane === "server" ? SERVER_CMD : MCP_CMD;
  // Serverless facilitators start with an empty catalog; only show the count once there is something to find.
  const found = catalog?.discovered === 1 ? tr("recurso en el catálogo Bazaar", "resource in the Bazaar catalog") : tr("recursos en el catálogo Bazaar", "resources in the Bazaar catalog");
  return (
    <section id="integracion">
      <div className="wrap split">
        <div>
          <div className="eyebrow mark">{tr("Integración", "Integration")}</div>
          <h2>{tr(<>De unas líneas de código a <em>pagos reales</em>.</>, <>From a few lines of code to <em>real payments</em>.</>)}</h2>
          <p className="sub">{pane === "server"
            ? tr("Una línea por ruta: pones el precio en tu moneda y aceptas USDC, XLM y EURC con la misma cotización.", "One line per route: set the price in your currency and accept USDC, XLM and EURC from the same quote.")
            : tr("Tu agente paga solo: verifica la tasa y respeta un tope por pago y un presupuesto.", "Your agent pays on its own: it checks the rate and keeps to a per-payment cap and a budget.")}</p>
          <a className="btn primary" href={DOCS}>{tr("Leer la documentación", "Read the docs")}<ArrowRight aria-hidden="true" /></a>
          <div className="install" translate="no">
            <code>{pane === "server" ? SERVER_CMD : "npx -y local402-mcp"}</code>
            <CopyButton text={cmd} />
          </div>
          {pane === "mcp" && <div className="discovery" id="discovery-count">{!catalog ? "…" : catalog.discovered ? `${catalog.discovered} ${found}` : ""}</div>}
        </div>
        <div className="code-card">
          <div className="code-tabs" role="tablist" aria-label={tr("Ejemplos", "Examples")}>
            <button type="button" role="tab" id="int-tab-server" aria-controls="int-code" aria-selected={pane === "server"} onClick={() => setPane("server")}>server.ts</button>
            <button type="button" role="tab" id="int-tab-mcp" aria-controls="int-code" aria-selected={pane === "mcp"} onClick={() => setPane("mcp")}>MCP</button>
            <span className="path" translate="no">{pane === "server" ? "local402-server" : "local402-mcp"}</span>
            <CopyButton text={cmd} />
          </div>
          <div className="code-body" id="int-code" role="tabpanel" aria-labelledby={`int-tab-${pane}`} translate="no">
            {pane === "server" ? (
              <div className="pane" key="server">{SERVER_LINES.map((line, i) => <div className="l" key={i}>{line || " "}</div>)}</div>
            ) : (
              <div className="pane" key="mcp">
                <div className="l">$ claude mcp add local402 \</div>
                <div className="l">{"    "}-e <span className="k">STELLAR_PRIVATE_KEY</span><span className="p">=</span>S… \</div>
                <div className="l">{"    "}-e <span className="s">&quot;MAX_PRICE=500 CLP&quot;</span> -- npx -y local402-mcp</div>
                <div className="l"> </div>
                {tool("local402_discover", "busca servicios (x402 Bazaar)", "finds services (x402 Bazaar)")}
                {tool("local402_quote", "precio local y tasa", "local price and rate")}
                {tool("local402_pay", "paga con USDC, XLM o EURC", "pays with USDC, XLM or EURC")}
                {tool("local402_wallet", "saldo y presupuesto", "balance and budget")}
              </div>
            )}
          </div>
          <div className="code-foot">
            <span className="chip c402">402</span>
            <ArrowRight aria-hidden="true" width={14} height={14} />
            <span className="chip c200">200 OK</span>
            <span className="total" translate="no">GET /africa · {africa ? `${local(africa.quote.localAmount)} ${currencyLabel(africa.quote.currency)} = USDC ${fmt(africa.usdcAmount, africa.quote.tokenDecimals)}` : "70 NGN"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const COMPARE: [string, string, ReactNode, ReactNode, ReactNode, ReactNode][] = [
  ["Precio", "Price", <>En dólares; <code>&quot;70 NGN&quot;</code> falla</>, <>In dollars; <code>&quot;70 NGN&quot;</code> fails</>, "MXN, EUR, INR, NGN, CLP… (24 monedas) y UF, vía oráculo on-chain", "MXN, EUR, INR, NGN, CLP… (24 currencies) and UF, via an on-chain oracle"],
  ["El cliente paga con", "The payer pays with", "Solo el activo exacto (USDC)", "Only the exact asset (USDC)", "USDC, XLM o EURC, con swap atómico", "USDC, XLM or EURC, with an atomic swap"],
  ["El vendedor recibe", "The seller receives", "USDC", "USDC", "USDC exacto, sin exposición a XLM", "Exact USDC, no XLM exposure"],
  ["Si el swap no alcanza", "If the swap falls short", "—", "—", "Se revierte todo; el sobrante vuelve", "Everything reverts; unused funds go back"],
  ["Agentes de IA", "AI agents", "Confían en el precio del vendedor", "Trust the seller's price", "Verifican la tasa, con tope por pago y presupuesto", "Check the rate, with a per-payment cap and a budget"],
  ["Contabilidad", "Accounting", "Montos en USDC", "USDC amounts", "Recibo con precio local, tasa y fuente; CSV", "Receipt with local price, rate and source; CSV"],
];

export function Comparacion() {
  const { tr } = useH();
  const today = tr("x402 en Stellar hoy", "x402 on Stellar today");
  const withUs = tr("Con Local402", "With Local402");
  return (
    <section id="comparacion">
      <div className="wrap">
        <div className="head">
          <div className="eyebrow mark">{tr("Comparación", "Comparison")}</div>
          <h2>{tr(<>x402 hoy, y <em>con Local402</em>.</>, <>x402 today, and <em>with Local402</em>.</>)}</h2>
          <p className="sub">{tr("Hoy x402 solo cobra en dólares y en un único activo. Pero el comercio real factura en pesos, reales, rupias, nairas, euros o yenes.", "Today x402 only charges in dollars, in a single asset. But real businesses invoice in pesos, reais, rupees, naira, euros or yen.")}</p>
        </div>
        <div className="table-wrap">
          <table className="compare">
            <thead><tr><th></th><th>{today}</th><th>{withUs}</th></tr></thead>
            <tbody>
              {COMPARE.map(([es, en, nes, nen, yes, yen]) => (
                <tr key={es}><td>{tr(es, en)}</td><td className="no" data-label={today}>{tr(nes, nen)}</td><td className="yes-col" data-label={withUs}>{tr(yes, yen)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
