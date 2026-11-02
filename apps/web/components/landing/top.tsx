"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, ArrowUpRight, Bot, ChartLine, Check, Copy, Cpu, Film, Globe, Menu, Receipt, Search, X } from "lucide-react";
import { useH, useLang, type Lang } from "./i18n";
import { symbolMainnet, TxLink, useLive, type Item } from "./live";
import { calm, fontsReady, wait } from "./motion";

export const DOCS = "/docs";
export const GITHUB = "https://github.com/DiegoPoveda01/local402";

export const Logo = ({ href = "#" }: { href?: string }) => <a className="logo" href={href} translate="no" aria-label="Local402"><i aria-hidden="true"></i><span>Local402</span></a>;
export const mask = (src: string): CSSProperties => ({ "--src": `url(${src})` } as CSSProperties);

// Copies a command; the check and "Copied" stay for a moment.
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { tr } = useH();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1_500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button type="button" className="copy" aria-label={label ?? tr("Copiar comando", "Copy command")} onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}>
      {done ? <Check className="check" aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{done ? tr("Copiado", "Copied") : tr("Copiar", "Copy")}</span>
    </button>
  );
}

export function LangSwitch() {
  const { h, setLang } = useLang();
  const option = (lang: Lang, text: string) => (
    <button type="button" aria-pressed={h.lang === lang} onClick={() => setLang(lang)}>{h.lang === lang && <Check aria-hidden="true" />}{text}</button>
  );
  return <div className="seg" role="group" aria-label={h.tr("Idioma", "Language")}>{option("es", "ES")}{option("en", "EN")}</div>;
}

const NAV: [string, string, string][] = [["#producto", "Producto", "Product"], [DOCS, "Desarrolladores", "Developers"], ["#integracion", "Integración", "Integration"], ["/docs#recibos", "Recibos", "Receipts"], ["/docs#mainnet", "Mainnet", "Mainnet"]];

export function Nav() {
  const { tr } = useH();
  const { mainnetUp } = useLive();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Esc or a click outside closes the menu; Esc hands the focus back to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [open]);
  const close = () => setOpen(false);
  const status = mainnetUp === undefined ? tr("comprobando…", "checking…") : mainnetUp ? tr("operativo", "operational") : tr("sin respuesta", "not responding");
  return (
    <>
      <a className="skip" href="#contenido">{tr("Saltar al contenido", "Skip to content")}</a>
      <nav className="nav" aria-label={tr("Principal", "Main")}>
        <div className="wrap">
          <Logo />
          <div className="links">{NAV.map(([href, es, en]) => <a key={href} href={href}>{tr(es, en)}</a>)}</div>
          <div className="nav-end">
            <a className="btn small" href="/docs#probar">{tr("Probar en testnet", "Try on testnet")}<ArrowRight aria-hidden="true" /></a>
            <button type="button" className="menu-btn" ref={button} aria-expanded={open} aria-controls="menu" aria-label={open ? tr("Cerrar menú", "Close menu") : tr("Abrir menú", "Open menu")} onClick={() => setOpen(!open)}>
              {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
            {open && (
              <div className="menu" id="menu" ref={panel}>
                <div className="menu-group menu-nav">
                  <span className="label">{tr("Navegación", "Navigation")}</span>
                  {NAV.map(([href, es, en]) => <a key={href} href={href} onClick={close}>{tr(es, en)}<ArrowRight aria-hidden="true" /></a>)}
                </div>
                <div className="menu-group">
                  <span className="label">{tr("Idioma", "Language")}</span>
                  <LangSwitch />
                </div>
                <div className="menu-group">
                  <span className="label">{tr("Recursos", "Resources")}</span>
                  <a className="menu-row" href={DOCS} onClick={close}>{tr("Documentación", "Docs")}<ArrowRight aria-hidden="true" /></a>
                  <a className="menu-row" href={GITHUB} target="_blank" rel="noopener">GitHub<ArrowUpRight aria-hidden="true" /></a>
                  <a className="menu-row" href="/docs#mainnet" onClick={close}>{tr("Estado de mainnet", "Mainnet status")}<span className={`status${mainnetUp ? " up" : ""}`}>{status}</span></a>
                </div>
                <div className="menu-group menu-cta">
                  <a className="btn primary" href="/docs#probar" onClick={close}>{tr("Probar en testnet", "Try on testnet")}<ArrowRight aria-hidden="true" /></a>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

const TICKET_FIELDS = ["currency", "localAmount", "usdPerUnit", "tokenAmount", "tokenDecimals", "oracleSource", "oracleTimestamp", "expiresAt", "signature"] as const;
const TICKET_LINES = 4 + TICKET_FIELDS.length + 1;

// cURL tab: one product at a time. The curl types on and the 402 comes back line by line, exactly as curl shows
// it, with the quote decoded from the Payment-Required header (the catalog carries the same quote the 402 does).
// After a pause the lines fade out for the next currency.
function useTicket() {
  const { catalog } = useLive();
  const latest = useRef(catalog);
  latest.current = catalog;
  const [item, setItem] = useState<Item>();
  const [typed, setTyped] = useState<number>();
  const [visible, setVisible] = useState(TICKET_LINES);
  const [phase, setPhase] = useState("");
  const ready = !!catalog;
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    (async () => {
      await fontsReady();
      for (let n = 0; !stopped; n++) {
        const quoted = latest.current!.items.filter((i) => !i.error);
        const next = quoted[n % quoted.length];
        // Without motion, or in a background tab, the next product just replaces the last one.
        if (!next || calm() || document.hidden) {
          if (next) { setItem(next); setTyped(undefined); setVisible(TICKET_LINES); }
          await wait(7_000);
          continue;
        }
        if (n) {
          setPhase("clearing");
          await wait(350);
        }
        if (stopped) return;
        setItem(next);
        setVisible(0);
        setTyped(0);
        setPhase("");
        await wait(n ? 400 : 900);
        const length = `curl -i ${location.host}${next.path}`.length;
        for (let i = 1; i <= length && !stopped; i++) {
          setTyped(i);
          await wait(40);
        }
        await wait(500);
        for (let i = 1; i <= TICKET_LINES && !stopped; i++) {
          setVisible(i);
          await wait(120);
        }
        await wait(6_000);
      }
    })();
    return () => { stopped = true; };
  }, [ready]);
  return { item, typed, visible, phase };
}

type Tab = "curl" | "cli" | "mcp";
const CLI_URL = "https://local402.xyz/indicadores";
const CLI_CMD = `STELLAR_SECRET=S… npx -y local402-client pay ${CLI_URL} --with XLM --max "100 CLP"`;
const MCP_CMD = `claude mcp add local402 -e STELLAR_PRIVATE_KEY=S… -e "MAX_PRICE=500 CLP" -- npx -y local402-mcp`;

function HeroCode() {
  const { tr, fmt } = useH();
  const [tab, setTab] = useState<Tab>("curl");
  const { item, typed, visible, phase } = useTicket();
  const host = typeof location === "undefined" ? "local402.xyz" : location.host;
  const cmd = `curl -i ${host}${item?.path ?? "/indicadores"}`;
  const q = item?.quote;
  const l = (i: number, extra = "") => `l${i >= visible ? " pending" : ""}${extra}`;
  const tabs: [Tab, string][] = [["curl", "cURL"], ["cli", "CLI"], ["mcp", "MCP"]];
  const copy = { curl: `curl -i https://${host}${item?.path ?? "/indicadores"}`, cli: CLI_CMD, mcp: MCP_CMD }[tab];
  const path = { curl: `GET ${item?.path ?? "/indicadores"}`, cli: "local402-client", mcp: "local402-mcp" }[tab];
  return (
    <div className={`code-card ticket ${phase}`.trim()}>
      <div className="code-tabs" role="tablist" aria-label={tr("Ejemplos", "Examples")}>
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`hero-tab-${id}`} aria-controls="hero-code" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        <span className="path" translate="no">{path}</span>
        <CopyButton text={copy} />
      </div>
      <div className="code-body" id="hero-code" role="tabpanel" aria-labelledby={`hero-tab-${tab}`} translate="no">
        {tab === "curl" && (
          <div className="pane" key="curl">
            <div className="l">$ <span id="ticket-cmd">{typed === undefined ? cmd : cmd.slice(0, typed)}</span>{visible === 0 && <span className="caret"></span>}</div>
            <div className={l(0)}><span className="r">HTTP/1.1 402 Payment Required</span></div>
            <div className={l(1)}>Payment-Required: <span className="s">eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2Ui</span></div>
            <div className={l(2)}><span className="c" translate="yes">{tr("# Payment-Required en base64, decodificado:", "# Payment-Required in base64, decoded:")}</span></div>
            <div className={l(3)}>accepts[0].extra.local402 <span className="p">=</span> <span className="p">{"{"}</span></div>
            {TICKET_FIELDS.map((key, i) => (
              <div key={key} className={l(4 + i)}>
                {"  "}<span className="k">&quot;{key}&quot;</span><span className="p">:</span> <span className="s">{q ? JSON.stringify(q[key]) : "…"}</span>{i < TICKET_FIELDS.length - 1 ? <span className="p">,</span> : ""}
                {key === "tokenAmount" && q && <>{"  "}<span className="c"># {fmt(q.tokenAmount, q.tokenDecimals)} USDC</span></>}
              </div>
            ))}
            <div className={l(TICKET_LINES - 1)}><span className="p">{"}"}</span></div>
          </div>
        )}
        {tab === "cli" && (
          <div className="pane" key="cli">
            <div className="l"><span className="c" translate="yes">{tr("# paga como agente, con tu clave de Stellar", "# pay as an agent, with your Stellar key")}</span></div>
            <div className="l">$ <span className="k">STELLAR_SECRET</span><span className="p">=</span>S… npx -y local402-client pay \</div>
            <div className="l">{"    "}<span className="s">{CLI_URL}</span> \</div>
            <div className="l">{"    "}--with XLM --max <span className="s">&quot;100 CLP&quot;</span></div>
            <div className="l"> </div>
            <div className="l"><span className="c" translate="yes">{tr("# lee el 402, revisa la tasa y paga;", "# reads the 402, checks the rate and pays;")}</span></div>
            <div className="l"><span className="c" translate="yes">{tr("# la red sale del propio 402", "# the network comes from the 402 itself")}</span></div>
          </div>
        )}
        {tab === "mcp" && (
          <div className="pane" key="mcp">
            <div className="l"><span className="c" translate="yes">{tr("# tu agente paga solo, con tope por pago", "# your agent pays on its own, with a per-payment cap")}</span></div>
            <div className="l">$ claude mcp add local402 \</div>
            <div className="l">{"    "}-e <span className="k">STELLAR_PRIVATE_KEY</span><span className="p">=</span>S… \</div>
            <div className="l">{"    "}-e <span className="s">&quot;MAX_PRICE=500 CLP&quot;</span> \</div>
            <div className="l">{"    "}-- npx -y local402-mcp</div>
            <div className="l"> </div>
            <div className="l"><span className="c">local402_discover · local402_quote</span></div>
            <div className="l"><span className="c">local402_pay · local402_wallet</span></div>
          </div>
        )}
      </div>
      <div className="code-foot">
        <span className="chip c402">402 Payment Required</span>
        <ArrowRight aria-hidden="true" width={14} height={14} />
        <span className="chip c200">200 OK · {tr("recibo", "receipt")}</span>
        {tab === "curl" && q && item && <span className="total">≈ USDC {fmt(item.usdcAmount, q.tokenDecimals)}</span>}
      </div>
    </div>
  );
}

export function Hero() {
  const { tr } = useH();
  return (
    <header className="hero">
      <div className="wrap">
        <div className="hero-copy">
          <div className="eyebrow">{tr("Pagos en Stellar", "Payments on Stellar")}</div>
          <h1>{tr(<>Cobra<br />en tu moneda.<br /><em>Recibe</em> USDC <em>exacto</em>.</>, <>Get paid<br />in your currency.<br /><em>Receive</em> <em>exact</em> USDC.</>)}</h1>
          <p className="lead">{tr("Personas o agentes de IA pagan con USDC, XLM o EURC. Tú pones el precio en tu moneda y recibes USDC en Stellar.", "People or AI agents pay with USDC, XLM or EURC. You set the price in your currency and receive USDC on Stellar.")}</p>
          <div className="cta-row">
            <a className="btn primary" href="/docs#probar">{tr("Probar gratis en testnet", "Try it free on testnet")}<ArrowRight aria-hidden="true" /></a>
            <a className="btn" href={DOCS}>{tr("Leer la documentación", "Read the docs")}</a>
          </div>
          <div className="made">
            <div className="avatars" aria-hidden="true">
              <img src="/brand/avatar-diego.webp" alt="" width="36" height="36" />
              <img src="/brand/avatar-stellar-chile.webp" alt="" width="36" height="36" />
              <img src="/brand/avatar-tellus.webp" alt="" width="36" height="36" />
            </div>
            <span>{tr("Hecho en Chile para el mundo.", "Built in Chile for the world.")}</span>
          </div>
        </div>
        <div className="hero-art">
          <div aria-hidden="true">
            <img className="photo" src="/brand/coliseo.webp" alt="" width="1400" height="933" fetchPriority="high" />
            <img className="arc" src="/brand/arc.svg" alt="" />
            <span className="plus" style={{ left: 64, top: 128 }}>+</span>
            <span className="plus" style={{ left: 600, top: 40 }}>+</span>
            <span className="vtext">{tr("Pagos para la economía de agentes", "Payments for the agent economy")}</span>
            <span className="coords">-33.4489° S<br />-70.6693° W</span>
          </div>
        </div>
        <HeroCode />
      </div>
    </header>
  );
}

export function About() {
  const { tr } = useH();
  const chip = (icon: ReactNode, text: string) => <div><span className="round" aria-hidden="true">{icon}</span>{text}</div>;
  return (
    <section className="about" id="producto">
      <div className="wrap">
        <div>
          <div className="eyebrow mark">{tr("Qué es Local402", "What is Local402")}</div>
          <h2>{tr(<>Pagos x402 para la <em>economía de agentes</em>.</>, <>Payment infrastructure for the <em>agent economy</em>.</>)}</h2>
        </div>
        <div className="rule" aria-hidden="true"></div>
        <div className="about-body">
          <div>
            <p>{tr(
              "Local402 extiende x402 en Stellar. Pones el precio en tu moneda (24 monedas del oráculo Reflector, y la UF) y recibes USDC exacto. Quien paga elige USDC, XLM o EURC; si no es USDC, un swap atómico en Soroswap hace el cambio en la misma transacción.",
              "Local402 extends x402 on Stellar. You set the price in your currency (24 currencies from the Reflector oracle, plus the UF) and receive exact USDC. The payer picks USDC, XLM or EURC; if it isn't USDC, an atomic swap on Soroswap converts it in the same transaction.",
            )}</p>
            <a className="btn small" href="/docs#como-funciona">{tr("Saber más", "Learn more")}</a>
          </div>
          <div className="photos" aria-hidden="true">
            <img src="/brand/santiago.webp" alt="" width="232" height="280" loading="lazy" />
            <img src="/brand/pago-movil.webp" alt="" width="232" height="280" loading="lazy" />
          </div>
          <div className="chips">
            {chip(<Bot />, tr("Agentes", "Agents"))}
            {chip(<ArrowLeftRight />, tr("Pagos", "Payments"))}
            {chip(<i style={mask("/logos/stellar.svg")}></i>, "Stellar")}
          </div>
        </div>
      </div>
    </section>
  );
}

const CASES: [ReactNode, string, string, string, string][] = [
  [<Receipt />, "Pago por uso", "Pay per use", "Cada llamada a tu API, cobrada en tu moneda. Sin cuentas ni suscripciones.", "Every call to your API, charged in your currency. No accounts or subscriptions."],
  [<Film />, "Contenido y medios", "Content and media", "Artículos, datos o archivos a centavos, en pesos, reales o rupias.", "Articles, data or files for cents, in pesos, reais or rupees."],
  [<Search />, "Agentes de investigación", "Research agents", "Agentes que pagan solos cada fuente que consultan, con un tope por pago.", "Agents that pay for each source they query on their own, with a per-payment cap."],
  [<Cpu />, "Infraestructura de IA", "AI infrastructure", "Inferencia, cómputo o herramientas MCP cobradas por solicitud.", "Inference, compute or MCP tools charged per request."],
  [<ChartLine />, "Análisis de datos", "Data analytics", "Indicadores y series de mercado vendidos por consulta, como /indicadores.", "Market indicators and series sold per query, like /indicadores."],
  [<Globe />, "Cualquier servicio digital", "Any digital service", "Cualquier ruta HTTP: una línea por ruta con local402-server.", "Any HTTP route: one line per route with local402-server."],
];

export function Cases() {
  const { tr } = useH();
  const col = (items: typeof CASES) => (
    <div className="cases-col">
      {items.map(([icon, es, en, pes, pen]) => (
        <div className="case" key={es}>
          <span className="box" aria-hidden="true">{icon}</span>
          <div><h3>{tr(es, en)}</h3><p>{tr(pes, pen)}</p></div>
        </div>
      ))}
    </div>
  );
  return (
    <section className="dark cases">
      <img className="rock" src="/brand/roca.webp" alt="" width="1600" height="557" loading="lazy" aria-hidden="true" />
      <div className="wrap">
        <div className="cases-title">
          <div className="eyebrow mark">{tr("Casos de uso", "Use cases")}</div>
          <h2>{tr(<>Para todo lo que se cobra <em>por uso</em>.</>, <>For everything that is paid <em>per use</em>.</>)}</h2>
        </div>
        <div className="cases-grid">{col(CASES.slice(0, 3))}{col(CASES.slice(3))}</div>
      </div>
    </section>
  );
}

const ECO: [string, string][] = [["stellar", "Stellar"], ["circle", "Circle"], ["soroswap", "Soroswap"], ["reflector", "Reflector"], ["x402", "x402"]];
// These two files are wordmarks, not symbols; the name alone stands in for them.
const WORDMARKS = ["soroswap", "x402"];

// The partners scroll by on a loop (the list twice, moved by half its width). It never stops;
// only reduced motion keeps it still.
export function Ecosystem() {
  const { tr, locale } = useH();
  const { receipts, mainnet } = useLive();
  const usdc = receipts.reduce((sum, r) => sum + Number(r.settled.amount) / 10 ** r.settled.decimals, 0);
  const count = (n: number) => n.toLocaleString(locale);
  const stat = (n: string, value: ReactNode, meta: ReactNode) => (
    <div className="stat"><span className="n">{n}</span><div><div className="stat-value">{value}</div><div className="meta">{meta}</div></div></div>
  );
  const list = (hidden: boolean) => ECO.map(([src, name]) => <li key={src + hidden} aria-hidden={hidden || undefined}>{!WORDMARKS.includes(src) && <i style={mask(`/logos/${src}.svg`)} aria-hidden="true"></i>}{name}</li>);
  return (
    <section className="eco">
      <img className="map" src="/brand/sudamerica.webp" alt="" width="860" height="1198" loading="lazy" aria-hidden="true" />
      <div className="wrap">
        <div className="map-spacer" aria-hidden="true"></div>
        <div>
          <div className="eyebrow mark">{tr("Ecosistema", "Ecosystem")}</div>
          <h2>{tr(<>Construido con <em>los mejores</em>.</>, <>Built with <em>the best</em>.</>)}</h2>
          <p className="sub">{tr("Stellar para liquidar, USDC de Circle para cobrar, Soroswap para el swap, Reflector para la tasa y x402 como protocolo.", "Stellar to settle, Circle's USDC to get paid, Soroswap for the swap, Reflector for the rate and x402 as the protocol.")}</p>
        </div>
        <div className="rule" aria-hidden="true"></div>
        <div className="stats">
          {stat("01", receipts.length ? count(receipts.length) : "—", <>{tr("pagos en testnet", "payments on testnet")}{receipts.length > 0 && ` · ${usdc.toLocaleString(locale, { maximumFractionDigits: 4 })} USDC ${tr("recibidos", "received")}`}</>)}
          {stat("02", mainnet.length ? count(mainnet.length) : "—", tr("pagos reales en mainnet", "real payments on mainnet"))}
          {stat("03", "24 + UF", tr("monedas, con la tasa del oráculo Reflector", "currencies, at the Reflector oracle rate"))}
        </div>
        <div className="marquee">
          <div className="track-wrap"><ul>{list(false)}{list(true)}</ul></div>
        </div>
      </div>
    </section>
  );
}

// Values as the CSV writes them: decimals with a point, whatever the page language.
const csv = (units: string, decimals: number) => (Number(units) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, "");

// The newest row of the mainnet /receipts.csv, with its own column names, as a paper receipt.
export function ReceiptCard() {
  const { tr } = useH();
  const r = useLive().newestLive;
  const row = (i: number, name: string, value: ReactNode) => <div style={{ "--i": i } as CSSProperties}><span className="meta">{name}</span><br /><b>{value}</b></div>;
  return (
    <div className="receipt" translate="no" key={r?.transaction}>
      <div style={{ "--i": 0 } as CSSProperties}>receipts.csv · {r ? r.id : "000004"} · {r ? r.paidAt.slice(0, 10) : "2026-10-07"}</div>
      {row(1, "monto_local, moneda", r ? `${r.local.amount} ${r.local.currency}` : "50 CLP")}
      {row(2, "activo_pagado, monto_pagado", r ? (r.spent ? `${symbolMainnet(r.spent.asset)} ${csv(r.spent.amount, 7)}` : `USDC ${csv(r.settled.amount, r.settled.decimals)}`) : "USDC 0.0512658")}
      <div style={{ "--i": 3 } as CSSProperties}><span className="meta">usdc_recibido</span><div className="big ok">{r ? csv(r.settled.amount, r.settled.decimals) : "0.0512658"}</div></div>
      {row(4, "transaccion", r ? <TxLink hash={r.transaction} net="public" /> : "c5977d…6bb350")}
      <span className="watermark" aria-hidden="true"></span>
      <span className="stamp" translate="yes">{tr("Pagado", "Paid")}</span>
    </div>
  );
}
