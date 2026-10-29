"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AsciiDitherMedia } from "@/components/background-ascii-dither";
import { LoaderTerminalDecode } from "@/components/loader-terminal-decode";
import BentoItem from "@/components/ui/terminal-bento-grid";
import { GlyphMatrix } from "@/components/ui/glyph-matrix";
import { ScrambleText } from "@/components/ui/scramble-text";
import { useH, useLang } from "./i18n";
import { IdLink, TxLink, symbolMainnet, useLive, type Item } from "./live";
import { calm, fontsReady, onceVisible, scramble, wait } from "./motion";

export function Nav() {
  const { h, setLang } = useLang();
  const { tr } = h;
  const links: [string, string, string][] = [["#probar", "Probar", "Try it"], ["#calculadora", "Calculadora", "Calculator"], ["#integracion", "Integración", "Integrate"], ["#recibos", "Recibos", "Receipts"], ["#mainnet", "Mainnet", "Mainnet"]];
  return (
    <>
      <a className="skip" href="#contenido">{tr("Saltar al contenido", "Skip to content")}</a>
      <nav>
        <div className="wrap">
          <a className="logo" href="#" translate="no"><img src="/logo.svg" alt="" /><span>Local<i>402</i></span></a>
          <div className="links">{links.map(([href, es, en]) => <a key={href} href={href}>{tr(es, en)}</a>)}</div>
          <button className="badge lang" id="lang" type="button" aria-label={tr("Switch to English", "Cambiar a español")} onClick={() => setLang(h.lang === "en" ? "es" : "en")}>{tr("EN", "ES")}</button>
          <Network />
        </div>
      </nav>
    </>
  );
}

// The live demo pays with testnet funds; real mainnet payments, when there are any, are listed further down.
function Network() {
  const { tr } = useH();
  const { catalog, catalogDown, mainnet } = useLive();
  const ref = useRef<HTMLDivElement>(null);
  const shown = !!catalog;
  useEffect(() => { if (shown) scramble(ref.current, 400); }, [shown]);
  if (!catalog) {
    return (
      <div className="badge" id="network" ref={ref}>
        {catalogDown ? <><span className="err">[ERR]</span>{tr("API no disponible · reintentando", "API unavailable · retrying")}</> : <><span className="pend">[...]</span><LoaderTerminalDecode text="Conectando…" loop={false} /></>}
      </div>
    );
  }
  const net = catalog.network === "stellar:testnet" ? tr("demo en testnet", "testnet demo") : catalog.network;
  return (
    <div className="badge" id="network" ref={ref}>
      <span className="dot"></span>{net}
      <span className="net-extra">
        {mainnet.length ? <> · <a href="#mainnet">{mainnet.length} {tr("pagos en mainnet", "mainnet payments")}</a></> : null} · {tr("vendedor", "seller")} <IdLink id={catalog.payTo} />
      </span>
    </div>
  );
}

const TICKET_FIELDS = ["currency", "localAmount", "usdPerUnit", "tokenAmount", "tokenDecimals", "oracleSource", "oracleTimestamp", "expiresAt", "signature"] as const;
const TICKET_LINES = 4 + TICKET_FIELDS.length + 1;

// Hero ticket: a terminal session, one product at a time. The curl types on and the 402 comes back line by
// line, exactly as curl shows it, with the quote decoded from the Payment-Required header (the catalog carries
// the same quote the 402 does). After a pause the screen clears softly for the next currency.
function Ticket() {
  const { tr, fmt } = useH();
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
          await wait(450);
        }
        if (stopped) return;
        setItem(next);
        setVisible(0);
        setTyped(0);
        setPhase("typing");
        await wait(n ? 500 : 1_100);
        const length = `curl -i ${location.host}${next.path}`.length;
        for (let i = 1; i <= length && !stopped; i++) {
          setTyped(i);
          await wait(45);
        }
        await wait(600);
        setPhase("");
        for (let i = 1; i <= TICKET_LINES && !stopped; i++) {
          setVisible(i);
          await wait(160);
        }
        await wait(6_000);
      }
    })();
    return () => { stopped = true; };
  }, [ready]);

  const cmd = item ? `curl -i ${location.host}${item.path}` : "curl -i local402.xyz/indicadores";
  const q = item?.quote;
  const line = (i: number) => (i >= visible ? "pending" : undefined);
  return (
    <div className={`ticket ${phase}`.trim()}>
      <div className="window-bar"><span>{tr("agente@local402", "agent@local402")}</span></div>
      <div className="t-body">
        <div className="t-cmd">$ <span id="ticket-cmd" translate="no">{typed === undefined ? cmd : cmd.slice(0, typed)}</span><span className="caret"></span></div>
        <div className="t-out">
          <div className={`status ${line(0) ?? ""}`.trim()} translate="no">HTTP/1.1 402 Payment Required</div>
          <div className={line(1)} translate="no">Payment-Required: <span className="v">eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2Ui</span></div>
          <div className={`t-note ${line(2) ?? ""}`.trim()}>{tr("# Payment-Required en base64, decodificado:", "# Payment-Required in base64, decoded:")}</div>
          <div className={line(3)} translate="no">accepts[0].extra.local402 = {"{"}</div>
          <div id="ticket-json" translate="no">
            {q && TICKET_FIELDS.map((key, i) => (
              <div key={key} className={line(4 + i)}>
                {"  "}&quot;{key}&quot;: <span className="v">{JSON.stringify(q[key])}</span>{i < TICKET_FIELDS.length - 1 ? "," : ""}
                {key === "tokenAmount" && <>{"  "}<span className="c"># {fmt(q.tokenAmount, q.tokenDecimals)} USDC</span></>}
              </div>
            ))}
          </div>
          <div className={line(TICKET_LINES - 1)} translate="no">{"}"}</div>
        </div>
      </div>
    </div>
  );
}

// Values as the CSV writes them: decimals with a point, whatever the page language.
const csv = (units: string, decimals: number) => (Number(units) / 10 ** decimals).toFixed(decimals).replace(/\.?0+$/, "");

function ReceiptCard() {
  const { tr } = useH();
  const r = useLive().newestLive;
  return (
    <div className="receipt-card" translate="no">
      <div className="r-row"><span className="r-title">receipts.csv · <span id="rc-id">{r ? r.id : "000004"}</span></span><span id="rc-date">{r ? r.paidAt.slice(0, 10) : "2026-10-07"}</span></div>
      <div className="r-rule"></div>
      <div className="r-row"><span>monto_local, moneda</span><b id="rc-local">{r ? `${r.local.amount} ${r.local.currency}` : "50 CLP"}</b></div>
      <div className="r-row"><span>activo_pagado, monto_pagado</span><b id="rc-paid">{r ? (r.spent ? `${symbolMainnet(r.spent.asset)} ${csv(r.spent.amount, 7)}` : `USDC ${csv(r.settled.amount, r.settled.decimals)}`) : "USDC 0.0512658"}</b></div>
      <div className="r-row"><span>usdc_recibido</span></div>
      <div className="r-big" id="rc-usdc"><ScrambleText characters="0123456789" speed={35}>{r ? csv(r.settled.amount, r.settled.decimals) : "0.0512658"}</ScrambleText></div>
      <div className="r-row"><span>transaccion</span><span id="rc-tx">{r ? <TxLink hash={r.transaction} net="public" /> : "c5977d…6bb350"}</span></div>
      <div className="stamp" translate="yes">{tr("Pagado", "Paid")}</div>
    </div>
  );
}

// The hero backdrop: a big 402 and a soft glow behind the terminal, drawn as an image the size of the hero
// for the ASCII dither to sample.
function art402(width: number, height: number) {
  const canvas = document.createElement("canvas");
  const w = (canvas.width = Math.ceil(width / 4));
  const h = (canvas.height = Math.ceil(height / 4));
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * .72, h * .45, 0, w * .72, h * .45, w * .5);
  glow.addColorStop(0, "rgba(255,255,255,.45)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  // Geist Mono glyphs are .6 as wide as they are tall: three of them fill .95 of the width at most.
  g.font = `500 ${Math.min(h * .8, w * .95 / 1.8)}px "Geist Mono", monospace`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText("402", w * .99, h * .5);
  return canvas.toDataURL();
}

export function Hero() {
  const { tr } = useH();
  const hero = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [art, setArt] = useState<string>();
  useEffect(() => {
    fontsReady().then(() => {
      scramble(title.current, 600);
      const { width, height } = hero.current!.getBoundingClientRect();
      setArt(art402(width, height));
    });
  }, []);
  return (
    <header className="hero" ref={hero}>
      {art && <AsciiDitherMedia src={art} className="field text-primary" />}
      <div className="wrap">
        <div>
          <div className="eyebrow"><span className="prompt">&gt;</span>{tr("x402 en Stellar · precios en moneda local", "x402 on Stellar · local-currency prices")}</div>
          <h1 ref={title}>{tr(<>Cobra en tu <em>moneda</em>.<br />Recibe USDC <em>exacto</em>.</>, <>Charge in your <em>currency</em>.<br />Receive <em>exact</em> USDC.</>)}</h1>
          <p className="lead">{tr("Personas o agentes de IA pagan con USDC, XLM o EURC.", "People or AI agents pay with USDC, XLM or EURC.")}</p>
          <div className="cta">
            <a className="btn primary" href="#probar">{tr("Probar gratis en testnet →", "Try it free on testnet →")}</a>
            <a className="btn" href="#mainnet">{tr("Pagar en mainnet con tu wallet", "Pay on mainnet with your wallet")}</a>
          </div>
        </div>
        <div className="deck">
          <Ticket />
          <ReceiptCard />
        </div>
      </div>
    </header>
  );
}

export function Logos() {
  const { tr } = useH();
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (calm()) return;
    setPending(true);
    return onceVisible(ref.current!, () => requestAnimationFrame(() => setPending(false)));
  }, []);
  const logo = (src: string, i: number): CSSProperties => ({ "--src": `url(/logos/${src}.svg)`, "--i": i } as CSSProperties);
  return (
    <div className={`wrap logos${pending ? " pending" : ""}`} ref={ref}>
      <span className="label">{tr("Construido sobre", "Built on")}</span>
      <ul>
        <li><i style={logo("stellar", 0)}></i>Stellar</li>
        <li><i style={logo("circle", 1)}></i>Circle</li>
        <li><i className="wide" style={logo("soroswap", 2)} role="img" aria-label="Soroswap"></i></li>
        <li><i style={logo("reflector", 3)}></i>Reflector</li>
        <li><i className="wide x402" style={logo("x402", 4)} role="img" aria-label="x402"></i></li>
      </ul>
    </div>
  );
}

// Mostly blank cells, so the glyph matrix behind the stats stays faint.
const SPARSE = ".:+01" + " ".repeat(45);

// The stats count up once, one after another, the first time they are on screen with data in them.
export function Stats() {
  const { tr, locale } = useH();
  const { receipts } = useLive();
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [eased, setEased] = useState<[number, number, number]>();
  const counted = useRef(false);
  useEffect(() => onceVisible(ref.current!, () => setSeen(true)), []);
  const has = receipts.length > 0;
  useEffect(() => {
    if (counted.current || !seen || !has || calm()) return;
    counted.current = true;
    const started = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const e = (delay: number) => 1 - (1 - Math.min(1, Math.max(0, (now - started - delay) / 600))) ** 3;
      if (now - started < 1_000) {
        setEased([e(0), e(150), e(300)]);
        raf = requestAnimationFrame(frame);
      } else setEased(undefined);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seen, has]);

  const usdcStat = (usdc: number) => `${usdc.toLocaleString(locale, { maximumFractionDigits: 4 })} USDC`;
  const byCurrency: Record<string, number> = {};
  let usdc = 0;
  for (const r of receipts) {
    byCurrency[r.local.currency] = (byCurrency[r.local.currency] ?? 0) + Number(r.local.amount);
    usdc += Number(r.settled.amount) / 10 ** r.settled.decimals;
  }
  const swaps = receipts.filter((r) => r.spent).length;
  // Two currencies fit as amounts; more are counted, with the amounts underneath.
  const sold = Object.entries(byCurrency).map(([c, v]) => `${v.toLocaleString(locale, { maximumFractionDigits: 4 })} ${c === "CLF" ? "UF" : c}`);
  const many = sold.length > 2;
  const [a, b, c] = eased ?? [1, 1, 1];
  return (
    <div className="wrap">
      <div className="stats" ref={ref}>
        <GlyphMatrix className="field" glyphs={SPARSE} color="currentColor" fadeBottom={0} />
        <BentoItem className="stat"><div className="label">{tr("Pagos", "Payments")}</div><div className="value" id="stat-count">{Math.round(receipts.length * a)}</div><div className="note">{tr("en testnet, on-chain", "on testnet, on-chain")}</div></BentoItem>
        <BentoItem className="stat"><div className="label">{tr("Vendido", "Sold")}</div><div className="value" id="stat-local">{!has ? "—" : many ? `${sold.length} ${tr("monedas", "currencies")}` : sold.join(" · ")}</div><div className="note" id="stat-local-note">{has && many ? sold.join(" · ") : tr("en moneda local", "in local currency")}</div></BentoItem>
        <BentoItem className="stat"><div className="label">{tr("Recibido", "Received")}</div><div className="value" id="stat-usdc">{usdcStat(usdc * b)}</div><div className="note">{tr("por el vendedor", "by the seller")}</div></BentoItem>
        <BentoItem className="stat"><div className="label">{tr("Con swap", "Swapped")}</div><div className="value" id="stat-xlm">{Math.round(swaps * c)}</div><div className="note">{tr("pagados con XLM o EURC", "paid with XLM or EURC")}</div></BentoItem>
      </div>
    </div>
  );
}

