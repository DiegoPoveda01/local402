"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AmberDusk } from "@/components/amber-dusk";
import { AsciiArt } from "@/components/code-rain";
import { DataStream } from "@/components/data-stream";
import BentoItem from "@/components/ui/terminal-bento-grid";
import { currencyLabel, short, useH } from "./i18n";
import { IdLink, MAINNET_API, TxLink, useLive } from "./live";
import { Lines, S } from "./probar";

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
      <div className="eyebrow"><span className="n">[06]</span>{tr("Recibos en vivo", "Live receipts")}</div>
      <div className="row-head">
        <h2>{tr(<>Cada venta, lista para <em>contabilidad</em>.</>, <>Every sale, ready for <em>accounting</em>.</>)}</h2>
        <a href="/receipts.csv" className="link">{tr("Exportar CSV →", "Export CSV →")}</a>
      </div>
      <DataStream title="GET /receipts/stream">
      <div className="table-wrap">
        <table className="cards">
          <thead><tr>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody id="receipts">
            {!receipts.length ? <tr><td colSpan={7} className="empty">Aún no hay pagos. Prueba uno arriba.</td></tr> : pageOf(receipts, current).map((r) => {
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
      </DataStream>
      <Pager id="receipts-pager" label="Páginas de recibos" count={receipts.length} page={current} go={(n) => { setFlash(undefined); setPage(n); }} />
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
      <AsciiArt className="rain h-[480px]" />
      <div className="eyebrow"><span className="n">[07]</span>Mainnet</div>
      <h2>{tr(<>Lo mismo, con <em>dinero real</em>.</>, <>The same, with <em>real money</em>.</>)}</h2>
      <p className="sub">{tr("Mismo código en Stellar mainnet: USDC y EURC de Circle, Soroswap y Reflector reales.", "Same code on Stellar mainnet: Circle's USDC and EURC, real Soroswap and Reflector.")}</p>
      <div className="split wallet">
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
    </section>
  );
}

export function Jurado() {
  const { tr } = useH();
  const { catalog, receipts } = useLive();
  const a = (href: string, text: ReactNode, cls?: string) => <a className={cls} href={href} target="_blank" rel="noopener">{text}</a>;
  const spec = "https://github.com/DiegoPoveda01/local402/blob/main/docs/scheme_exact_fx_stellar.md";
  const fxpay = "https://stellar.expert/explorer/public/contract/CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD";
  const issue = "https://github.com/x402-foundation/x402/issues/3491";
  const npm = "https://www.npmjs.com/package/local402-server";
  return (
    <section className="wrap" id="jurado">
      <div className="eyebrow">{tr("Para el jurado", "For the judges")}</div>
      <div className="judges">
        <BentoItem>
          <div className="label">{tr("Qué es nuevo", "What's new")}</div>
          <ul>
            <li>{tr(<><b>exact-fx</b>: un esquema x402 nuevo, con {a(spec, "especificación")} y contrato Soroban propio (FxPay)</>, <><b>exact-fx</b>: a new x402 scheme, with a {a(spec, "spec")} and its own Soroban contract (FxPay)</>)}</li>
            <li>{tr(<><b>24 monedas</b> del oráculo Reflector, y UF</>, <><b>24 currencies</b> from the Reflector oracle, and UF</>)}</li>
            <li>{tr(<>El agente <b>verifica</b> la tasa del vendedor y la del swap antes de firmar</>, <>The agent <b>checks</b> the seller&apos;s rate and the swap&apos;s before signing</>)}</li>
          </ul>
        </BentoItem>
        <BentoItem>
          <div className="label">{tr("Verifícalo", "Verify it")}</div>
          <ul>
            <li><span className="k">{tr("Contrato FxPay:", "FxPay contract:")}</span> <span className="mono" id="judges-fxpay">{catalog?.fxContract ? <IdLink id={catalog.fxContract} /> : "—"}</span></li>
            <li><span className="k">{tr("Último pago:", "Latest payment:")}</span> <span className="mono" id="judges-tx">{receipts.length ? <TxLink hash={receipts[0].transaction} /> : tr("haz uno arriba", "make one above")}</span></li>
            <li>{tr(
              <><a href="#mainnet">Pagos reales en mainnet</a>, también desde tu wallet, con FxPay {a(fxpay, "CA6Z4E…UGHD", "mono")}; bug de comisión reportado a {a(issue, "x402")}</>,
              <><a href="#mainnet">Real mainnet payments</a>, also from your own wallet, through FxPay {a(fxpay, "CA6Z4E…UGHD", "mono")}; fee bug reported to {a(issue, "x402")}</>,
            )}</li>
            <li>{tr(<><b>41</b> tests TypeScript y <b>11</b> del contrato; paquetes en {a(npm, "npm")}</>, <><b>41</b> TypeScript tests and <b>11</b> contract tests; packages on {a(npm, "npm")}</>)}</li>
          </ul>
        </BentoItem>
        <BentoItem>
          <div className="label">{tr("Modelo de negocio (propuesta)", "Business model (proposal)")}</div>
          <ul>
            <li>{tr("Integrar es gratis: una línea por ruta, sin cambiar el USDC que recibe el vendedor", "Integrating is free: one line per route, and the seller still receives USDC")}</li>
            <li>{tr(<>El facilitador cobra unos <b>puntos básicos</b> <span className="tbd">[POR CONFIRMAR]</span> solo en pagos con swap</>, <>The facilitator charges a few <b>basis points</b> <span className="tbd">[TO BE CONFIRMED]</span>, only on swap payments</>)}</li>
          </ul>
        </BentoItem>
      </div>
    </section>
  );
}

const BANNER: [string, string][] = [
  ["██╗      ██████╗  ██████╗ █████╗ ██╗", "██╗  ██╗ ██████╗ ██████╗"],
  ["██║     ██╔═══██╗██╔════╝██╔══██╗██║", "██║  ██║██╔═████╗╚════██╗"],
  ["██║     ██║   ██║██║     ███████║██║", "███████║██║██╔██║ █████╔╝"],
  ["██║     ██║   ██║██║     ██╔══██║██║", "╚════██║████╔╝██║██╔═══╝"],
  ["███████╗╚██████╔╝╚██████╗██║  ██║███████╗", "██║╚██████╔╝███████╗"],
  ["╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝", "╚═╝ ╚═════╝ ╚══════╝"],
];

export function Footer() {
  const { tr } = useH();
  const out = (href: string, text: string) => <a href={href} target="_blank" rel="noopener">{text}</a>;
  return (
    <footer>
      <div className="wrap" aria-hidden="true"></div>
      <div className="wrap">
        <div className="dusk">
          <AmberDusk className="h-[calc(100%+64px)]" />
          <pre className="banner" aria-hidden="true" translate="no">{BANNER.map(([local, n], i) => <span key={i}>{i ? "\n" : ""}{local}<i>{n}</i></span>)}</pre>
        </div>
        <div className="cols-row">
          <div>
            <a className="logo" href="#" translate="no"><img src="/logo.svg" alt="" /><span>Local<i>402</i></span></a>
            <p>{tr("Pagos x402 con precios en moneda local, liquidados en USDC sobre Stellar. Para cualquier moneda. Hecho en Chile.", "x402 payments priced in local currency, settled in USDC on Stellar. For any currency. Made in Chile.")}</p>
          </div>
          <div className="cols">
            <div><span className="label">{tr("Proyecto", "Project")}</span>{out("https://github.com/DiegoPoveda01/local402", "GitHub")}{out("https://www.npmjs.com/package/local402-server", "npm")}<a href="/receipts.csv">{tr("Recibos CSV", "Receipts CSV")}</a></div>
            <div><span className="label">{tr("Construido con", "Built with")}</span>{out("https://www.x402.org", "x402")}{out("https://reflector.network", "Reflector")}{out("https://soroswap.finance", "Soroswap")}</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
