"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { currencyLabel, short, useH } from "./i18n";
import { MAINNET_API, TxLink, useLive } from "./live";
import { Lines, S } from "./probar";
import { DOCS, GITHUB, Logo, ReceiptCard } from "./top";

const PER_PAGE = 5;

// Draws ← 1 2 … → under a table; first, last and the pages around the current one, so the row fits a phone.
function Pager({ id, label, count, page, go, children }: { id: string; label: string; count: number; page: number; go: (page: number) => void; children?: ReactNode }) {
  const pages = Math.ceil(count / PER_PAGE);
  const buttons: ReactNode[] = [];
  const add = (text: string, target: number, current = false) => buttons.push(
    <button key={buttons.length} className={`ghost ${current ? "current" : ""}`} disabled={target < 1 || target > pages} aria-current={current ? "page" : undefined} onClick={() => go(target)}>{text}</button>,
  );
  if (pages > 1) {
    add("←", page - 1);
    let last = 0;
    for (let n = 1; n <= pages; n++) {
      if (n !== 1 && n !== pages && Math.abs(n - page) > 1) continue;
      if (n - last > 1) buttons.push(<span key={buttons.length} className="gap">…</span>);
      add(String(n), n, n === page);
      last = n;
    }
    add("→", page + 1);
  }
  return <nav className="pager" id={id} aria-label={label}>{buttons}{children}</nav>;
}
// The current page, clamped to the last one.
const clamp = (page: number, count: number) => Math.max(1, Math.min(page, Math.ceil(count / PER_PAGE)));
const pageOf = <T,>(rows: T[], page: number) => rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

// The receipts table speaks Spanish in both languages, apart from its header.
export function Recibos() {
  const { tr, time, local, rate, fmt } = useH();
  const { receipts, fresh, symbol } = useLive();
  const [page, setPage] = useState(1);
  const [flash, setFlash] = useState<string>();
  // Newest receipts are first, so a new payment brings the table back to page 1.
  useEffect(() => {
    if (!fresh) return;
    setPage(1);
    setFlash(fresh.id);
  }, [fresh]);
  const current = clamp(page, receipts.length);
  const head: [string, string][] = [["Hora", "Time"], ["Recurso", "Resource"], ["Precio", "Price"], ["Tasa (USD)", "Rate (USD)"], ["Vendedor recibe", "Seller receives"], ["Cliente pagó", "Payer paid"], ["Transacción", "Transaction"]];
  const labels = head.map(([es, en]) => tr(es, en));
  return (
    <section id="recibos">
      <div className="wrap">
      <div className="head row">
        <div>
          <div className="eyebrow mark">{tr("Recibos en vivo", "Live receipts")}</div>
          <h2>{tr(<>Cada venta, lista para <em>contabilidad</em>.</>, <>Every sale, ready for <em>accounting</em>.</>)}</h2>
        </div>
        <a href="/receipts.csv" className="text-link">{tr("Exportar CSV", "Export CSV")}<ArrowRight aria-hidden="true" width={16} height={16} /></a>
      </div>
      <div className="table-wrap">
        <table className="cards">
          <thead><tr>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody id="receipts">
            {!receipts.length ? <tr><td colSpan={7} className="empty">{tr("Aún no hay pagos. Prueba uno arriba.", "No payments yet. Try one above.")}</td></tr> : pageOf(receipts, current).map((r) => {
              // On phones each row is a card; every cell carries its column name from the header.
              const cells: ReactNode[] = [
                <td className="mono">{time(r.paidAt)}</td>,
                <td className="mono">{new URL(r.resource || "http://x/").pathname}</td>,
                <td><b>{local(r.local.amount)} {currencyLabel(r.local.currency)}</b></td>,
                <td className="mono">{rate(r.rate.usdPerUnit)}</td>,
                <td>{fmt(r.settled.amount, r.settled.decimals)} USDC</td>,
                <td>{r.spent
                  ? <><span className={`pill ${symbol(r.spent.asset).toLowerCase()}`}>{symbol(r.spent.asset)}</span> {fmt(r.spent.amount)}</>
                  : <><span className="pill usdc">USDC</span> {fmt(r.settled.amount, r.settled.decimals)}</>}</td>,
                <td><TxLink hash={r.transaction} /></td>,
              ];
              return <tr key={r.transaction} className={r.id === flash ? "new" : ""}>{cells.map((cell, i) => <Labeled key={i} label={labels[i]}>{cell}</Labeled>)}</tr>;
            })}
          </tbody>
        </table>
      </div>
      <Pager id="receipts-pager" label="Páginas de recibos" count={receipts.length} page={current} go={(n) => { setFlash(undefined); setPage(n); }} />
      </div>
    </section>
  );
}

// Adds data-label to a <td> element built above.
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  const td = children as React.ReactElement<{ "data-label"?: string; className?: string; children?: ReactNode }>;
  return <td className={td.props.className} data-label={label}>{td.props.children}</td>;
}

const CLI = `STELLAR_SECRET=S… npx -y local402-client pay ${MAINNET_API}/indicadores --with XLM --max "100 CLP"`;
// Only currencies the oracle publishes are offered, so a settled payment always resolves to a rate.
const CONVERT_CURRENCIES = ["USD", "EUR", "GBP", "CLP", "UF", "MXN", "BRL", "COP", "PEN", "ARS", "CRC", "INR", "JPY", "CNY", "KRW", "PHP", "HKD", "NGN", "KES", "ZAR", "CDF"];
const ASSETS = ["USDC", "XLM", "EURC"];

type Wallet = { connect: () => Promise<string>; pay: (resource: string, address: string, asset: string) => Promise<{ transaction: string; spent?: { amount: string }; price: { amount: string }; fx?: { oracleSend: string; premiumBps: number }; body: unknown }> };
// The wallet client is a separate bundle (scripts/vercel/build.ts), loaded on the first payment only.
const loadWallet = async () => {
  await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/wallet.js" as string);
  return (globalThis as { local402Wallet?: Wallet }).local402Wallet!;
};

// Mainnet: the same API and facilitator, paid from the visitor's own wallet (Freighter); some of its
// messages stay in Spanish, as before.
export function Mainnet() {
  const h = useH();
  const { tr, locale, fmt, local, bps } = h;
  const { mainnet, loadMainnet } = useLive();
  const [mpane, setMpane] = useState<"pay" | "convert">("pay");
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<string>();
  // The idle console follows the language until the visitor pays (or tries to) from it.
  const [lines, setLines] = useState<ReactNode[]>();
  const [monto, setMonto] = useState("100");
  const [de, setDe] = useState("USD");
  const [a, setA] = useState("CLP");
  const [cvStatus, setCvStatus] = useState("");
  const [page, setPage] = useState(1);
  // The latest five, until the visitor asks for the rest; then pages of five.
  const [all, setAll] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    // Newest first, so a new payment brings the table back to page 1.
    if (mainnet.length !== count) { setPage(1); setCount(mainnet.length); }
  }, [mainnet.length, count]);

  const agentLines = (): ReactNode[] => [<S c="c">{tr("# o como agente, con tu clave:", "# or as an agent, with your key:")}</S>, <S c="h">$ {CLI}</S>];
  const idle = [<S c="c">{tr("# desde tu wallet: elige USDC, XLM o EURC", "# from your wallet: pick USDC, XLM or EURC")}</S>, "", ...agentLines()];

  async function payFromWallet(asset: string, resource = `${MAINNET_API}/indicadores`) {
    const out: ReactNode[] = [];
    const show = (...more: ReactNode[]) => { out.push(...more); setLines([...out]); };
    setBusy(true);
    try {
      show(<S c="c">cargando el cliente (≈500 KB)…</S>);
      const wallet = await loadWallet();
      // Asked on every payment, so switching accounts in Freighter needs no reload.
      const walletAddress = await wallet.connect();
      setAddress(walletAddress);
      show(<S c="h">$ GET {resource.replace(MAINNET_API, "")}</S>, <S c="y">HTTP/1.1 402 Payment Required</S>,
        <S c="h">{asset === "USDC" ? "→ Freighter firma una transferencia de USDC (exact)" : `→ Freighter firma FxPay.pay con ${asset} (exact-fx)`}</S>,
        <S c="c">  el cliente revisa la tasa con Reflector y el tope de 200 CLP antes de enviar…</S>,
        <S c="c">  si Freighter dice «Unable to scan site»: Blockaid aún no conoce este contrato nuevo</S>);
      const started = performance.now();
      const data = await wallet.pay(resource, walletAddress, asset);
      const seconds = ((performance.now() - started) / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
      show(
        <S c="g">HTTP/1.1 200 OK{"  ·  "}{seconds} s{"  ·  "}tx <TxLink hash={data.transaction} net="public" /></S>,
        data.spent ? <>{"  "}gastaste <S c="v">{fmt(data.spent.amount)} {asset}</S> · el vendedor recibió {fmt(data.price.amount)} USDC</> : <>{"  "}el vendedor recibió {fmt(data.price.amount)} USDC</>,
        ...(data.spent && data.fx ? [<>{"  "}prima vs Reflector: <S c="g">{bps(Number(((BigInt(data.spent.amount) - BigInt(data.fx.oracleSend)) * 10000n) / BigInt(data.fx.oracleSend)))}</S> (tope firmado {bps(data.fx.premiumBps)})</>] : []),
        JSON.stringify(data.body, null, 2),
      );
      setTimeout(loadMainnet, 1500);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      const hint = {
        no_freighter: <>No se encontró Freighter. Instálala desde <a href="https://www.freighter.app" target="_blank" rel="noopener">freighter.app</a> y recarga la página.</>,
        wrong_network: "Freighter está en otra red. Cámbiala a Mainnet (Public) e inténtalo de nuevo.",
      }[message];
      show(<S c="r">{hint ?? `Error: ${message}`}</S>, "", ...agentLines());
    } finally {
      setBusy(false);
    }
  }

  // Builds a /convertir URL from the visitor's input and pays it from Freighter, real money on mainnet.
  function convert(asset: string) {
    const amount = (monto || "1").trim();
    if (!(Number(amount) > 0)) return setCvStatus(tr("Escribe un monto mayor que cero.", "Enter an amount above zero."));
    if (de === a) return setCvStatus(tr("Elige dos monedas distintas.", "Pick two different currencies."));
    setCvStatus("");
    payFromWallet(asset, `${MAINNET_API}/convertir?monto=${encodeURIComponent(amount)}&de=${de}&a=${a}`);
  }

  const payButtons = (onPay: (asset: string) => void) => (
    <div className="buttons">
      {ASSETS.map((asset) => <button key={asset} className={`pay ${asset.toLowerCase()}`} disabled={busy} aria-label={`${tr("Pagar con", "Pay with")} ${asset}`} onClick={() => onPay(asset)}>{asset}</button>)}
    </div>
  );
  const current = clamp(page, all ? mainnet.length : Math.min(mainnet.length, PER_PAGE));
  const rows = pageOf(all ? mainnet : mainnet.slice(0, PER_PAGE), current);
  const head: [string, string][] = [["Fecha", "Date"], ["Precio", "Price"], ["Vendedor recibe", "Seller receives"], ["Cliente pagó", "Payer paid"], ["Prima vs Reflector", "Premium vs Reflector"], ["Transacción", "Transaction"]];
  const labels = head.map(([es, en]) => tr(es, en));

  return (
    <section id="mainnet">
      <div className="wrap">
      <div className="mainnet-top">
        <div className="head">
          <div className="eyebrow mark">Mainnet</div>
          <h2>{tr(<>Lo mismo, con <em>dinero real</em>.</>, <>The same, with <em>real money</em>.</>)}</h2>
          <p className="sub">{tr("Mismo código en Stellar mainnet: USDC y EURC de Circle, Soroswap y Reflector reales. A la derecha, el último pago real tal como lo escribe /receipts.csv.", "Same code on Stellar mainnet: Circle's USDC and EURC, real Soroswap and Reflector. On the right, the latest real payment as /receipts.csv writes it.")}</p>
        </div>
        <ReceiptCard />
      </div>
      <div className="wallet">
        <div>
          <div className="seg">
            <button type="button" data-mpane="pay" aria-pressed={mpane === "pay"} onClick={() => setMpane("pay")}>{tr("Pagar /indicadores", "Pay /indicadores")}</button>
            <button type="button" data-mpane="convert" aria-pressed={mpane === "convert"} onClick={() => setMpane("convert")}>{tr("Convertir", "Convert")}</button>
          </div>
          <div className="mpane" data-mpane="pay" hidden={mpane !== "pay"}>
            <div className="label">GET /indicadores · 50 CLP · mainnet</div>
            <h3 id="wallet-title">{tr("Paga 50 pesos reales desde tu wallet.", "Pay 50 real pesos from your wallet.")}</h3>
            <p id="wallet-text">{tr(
              <>Con <a href="https://www.freighter.app" target="_blank" rel="noopener">Freighter</a> en Mainnet; basta con tener XLM. Tú firmas, el facilitador paga la red y el cliente rechaza cobros sobre 200 CLP.</>,
              <>With <a href="https://www.freighter.app" target="_blank" rel="noopener">Freighter</a> on Mainnet; XLM alone is enough. You sign, the facilitator pays the network fee and the client refuses charges above 200 CLP.</>,
            )}</p>
            <p id="wallet-agents">{tr("¿Eres un agente? Lo mismo desde la terminal, con tu propia clave y un tope por pago.", "An agent? The same from the terminal, with your own key and a per-payment cap.")}</p>
            {payButtons((asset) => payFromWallet(asset))}
          </div>
          <div className="mpane convert" data-mpane="convert" hidden={mpane !== "convert"}>
            <div className="label">GET /convertir · 100 NGN · mainnet</div>
            <h3 id="convert-title">{tr("Convierte tu monto y paga por tu resultado.", "Convert your amount and pay for your result.")}</h3>
            <p id="convert-text">{tr("Te devuelve la conversión con la tasa de Reflector en ese instante. La respuesta llega a la consola.", "Returns the conversion at the Reflector rate at that instant. The answer prints in the console.")}</p>
            <div className="convert-form">
              <input id="cv-monto" name="amount" autoComplete="off" type="number" min="0" step="any" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto a convertir" />
              <select id="cv-de" aria-label="Moneda de origen" value={de} onChange={(e) => setDe(e.target.value)}>{CONVERT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <span className="convert-arrow">→</span>
              <select id="cv-a" aria-label="Moneda de destino" value={a} onChange={(e) => setA(e.target.value)}>{CONVERT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              {payButtons(convert)}
            </div>
            <div className="meta" id="cv-status" aria-live="polite">{cvStatus}</div>
          </div>
          <div className="meta" id="wallet-status" aria-live="polite">
            {address && <>Conectada: <a target="_blank" rel="noopener" href={`https://stellar.expert/explorer/public/account/${address}`}>{short(address)}</a></>}
          </div>
        </div>
        <div className="window">
          <div className="window-bar"><span>{tr("tu-wallet@mainnet", "your-wallet@mainnet")}</span></div>
          <div className="term" id="wallet-console" ref={(el) => { if (el && lines) el.scrollTop = el.scrollHeight; }}><Lines lines={lines ?? idle} /></div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="cards">
          <thead><tr>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody id="mainnet-payments">
            {rows.map((p) => (
              <tr key={p.transaction}>
                <td className="mono" data-label={labels[0]}>{new Date(p.paidAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</td>
                <td data-label={labels[1]}><b>{local(p.local.amount)} {currencyLabel(p.local.currency)}</b></td>
                <td data-label={labels[2]}>{fmt(p.usdc)} USDC</td>
                <td data-label={labels[3]}><span className={`pill ${p.payWith.toLowerCase()}`}>{p.payWith}</span> {fmt(p.spent)}</td>
                <td className="mono" data-label={labels[4]}>{p.spentPremiumBps !== undefined ? bps(p.spentPremiumBps) : p.fxPremiumBps !== undefined ? `${bps(p.fxPremiumBps)} máx.` : "—"}</td>
                <td data-label={labels[5]}><TxLink hash={p.transaction} net="public" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager id="mainnet-pager" label="Páginas de pagos en mainnet" count={all ? mainnet.length : Math.min(mainnet.length, PER_PAGE)} page={current} go={setPage}>
        {!all && mainnet.length > PER_PAGE && <button className="ghost" onClick={() => setAll(true)}>{tr("Ver todos", "See all")} ({mainnet.length})</button>}
      </Pager>
      </div>
    </section>
  );
}

export function Cta() {
  const { tr } = useH();
  return (
    <section className="dark cta">
      <img className="waves" src="/brand/waves.svg" alt="" width="1440" height="380" loading="lazy" aria-hidden="true" />
      <div className="wrap">
        <div className="eyebrow mark">{tr("Empieza hoy", "Start today")}</div>
        <h2>{tr(<>Construye, cobra y escala con <em>Local402</em>.</>, <>Build, charge and scale with <em>Local402</em>.</>)}</h2>
        <p className="sub">{tr("Gratis en testnet, sin wallet. Cuando estés listo, el mismo código cobra en mainnet.", "Free on testnet, no wallet needed. When you're ready, the same code charges on mainnet.")}</p>
        <div className="cta-row">
          <a className="btn primary" href="/docs#probar">{tr("Probar gratis en testnet", "Try it free on testnet")}<ArrowRight aria-hidden="true" /></a>
          <a className="btn" href={DOCS}>{tr("Leer la documentación", "Read the docs")}</a>
        </div>
        <span className="vtext" aria-hidden="true">{tr("Pagos para una nueva era de agentes", "Payments for a new era of agents")}</span>
      </div>
    </section>
  );
}

// Brand icons from Simple Icons (CC0), drawn in the text color.
const SOCIAL = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  github: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  npm: "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
};

export function Footer() {
  const { tr } = useH();
  const { catalog, mainnetUp } = useLive();
  // Ticks so the age of the rate keeps counting between catalog refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  const out = (href: string, text: string) => <a href={href} target="_blank" rel="noopener">{text} ↗</a>;
  const social = (href: string, name: string, d: string) => <a href={href} target="_blank" rel="noopener" aria-label={name} title={name}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={d} fill="currentColor" /></svg></a>;
  // The newest oracle timestamp among the quotes in the catalog.
  const oracle = catalog?.items.reduce((latest, item) => (item.error ? latest : Math.max(latest, item.quote.oracleTimestamp)), 0);
  const age = oracle ? Math.max(0, Math.round(now / 1000 - oracle)) : undefined;
  const ago = age === undefined ? "—" : age < 120 ? tr(`tasa hace ${age} s`, `rate ${age} s ago`) : tr(`tasa hace ${Math.round(age / 60)} min`, `rate ${Math.round(age / 60)} min ago`);
  const status = mainnetUp === undefined ? tr("Stellar mainnet · comprobando…", "Stellar mainnet · checking…") : mainnetUp ? tr("Stellar mainnet · operativo", "Stellar mainnet · operational") : tr("Stellar mainnet · sin respuesta", "Stellar mainnet · not responding");
  return (
    <footer>
      <img className="foot-flower" src="/brand/pulpo-flor.svg" alt="" aria-hidden="true" />
      <div className="wrap foot-main">
        <div className="foot-brand">
          <Logo />
          <p className="tagline">{tr("Cobra en tu moneda.", "Charge in your currency.")}<em>{tr("Recibe USDC exacto.", "Receive exact USDC.")}</em></p>
          <p className="meta">{tr("Pagos x402 con precios en moneda local, liquidados en USDC sobre Stellar. Para cualquier moneda. Hecho en Chile.", "x402 payments priced in local currency, settled in USDC on Stellar. For any currency. Made in Chile.")}</p>
          <div className="foot-social">
            {social("https://x.com/local402dev", "X", SOCIAL.x)}
            {social(GITHUB, "GitHub", SOCIAL.github)}
            {social("https://www.npmjs.com/package/local402-server", "npm", SOCIAL.npm)}
          </div>
        </div>
        <div className="foot-col">
          <span className="label">{tr("Producto", "Product")}</span>
          <a href="/docs#probar">{tr("Probar", "Try it")}</a>
          <a href="/docs#calculadora">{tr("Calculadora", "Calculator")}</a>
          <a href="#integracion">{tr("Integración", "Integration")}</a>
          <a href="/docs#recibos">{tr("Recibos", "Receipts")}</a>
          <a href="/docs#mainnet">Mainnet</a>
        </div>
        <div className="foot-col">
          <span className="label">{tr("Desarrolladores", "Developers")}</span>
          {out(GITHUB, "GitHub")}
          {out("https://www.npmjs.com/package/local402-server", "npm local402-server")}
          <a href="/docs#mcp">MCP · local402_pay</a>
          {out("/receipts.csv", tr("Exportar CSV", "Export CSV"))}
          {out(`${GITHUB}/blob/main/docs/scheme_exact_fx_stellar.md`, "Spec exact_fx")}
        </div>
        <div className="foot-col">
          <span className="label">{tr("Red", "Network")}</span>
          {out("https://stellar.expert/explorer/public/contract/CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD", "Stellar")}
          {out("https://reflector.network", "Reflector")}
          {out("https://www.x402.org", "x402")}
          {out("https://soroswap.finance", "Soroswap")}
        </div>
      </div>
      <div className="foot-band" aria-hidden="true" />
      <div className="wrap foot-bar">
        <span className={`status${mainnetUp ? " up" : ""}`}>{status}</span>
        <span>Reflector · {ago}</span>
        <span>▲ {tr("24 monedas + UF", "24 currencies + UF")}</span>
        <span className="end">© 2026 Local402 · {tr("Hecho en Chile", "Made in Chile")}</span>
      </div>
      <div className="foot-word" aria-hidden="true" translate="no">Local402</div>
    </footer>
  );
}
