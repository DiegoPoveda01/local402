"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, Bot, Globe, Lock, Menu, Package, Rocket, Search, X, Zap } from "lucide-react";
import { useH } from "@/components/landing/i18n";
import { Mainnet, Recibos } from "@/components/landing/bottom";
import { Calculadora, ComoFunciona, Comparacion } from "@/components/landing/middle";
import { Probar } from "@/components/landing/probar";
import { CopyButton, GITHUB, LangSwitch, Logo } from "@/components/landing/top";

type Entry = [id: string, es: string, en: string];
type Group = [es: string, en: string, entries: Entry[]];

// The index, in page order: every entry is a section further down.
const GROUPS: Group[] = [
  ["Empezar", "Get started", [["intro", "Introducción", "Introduction"], ["que-es", "¿Qué es Local402?", "What is Local402?"], ["como-funciona", "Cómo funciona", "How it works"], ["comparacion", "Comparación", "Comparison"]]],
  ["Guías", "Guides", [["probar", "Prueba en testnet", "Try it on testnet"], ["calculadora", "Calcula un precio", "Price calculator"], ["mainnet", "Paga en mainnet", "Pay on mainnet"], ["despliegue", "Despliega", "Deploy"]]],
  ["Paquetes", "Packages", [["servidor", "local402-server", "local402-server"], ["cliente", "local402-client", "local402-client"], ["mcp", "local402-mcp", "local402-mcp"]]],
  ["Referencia", "Reference", [["cotizacion", "La cotización", "The quote"], ["exact-fx", "Esquema exact-fx", "exact-fx scheme"], ["errores", "Errores", "Errors"], ["recibos", "Recibos y CSV", "Receipts and CSV"], ["limites", "Límites", "Limits"], ["verificar", "Verifícalo", "Verify it"]]],
];
const ORDER = GROUPS.flatMap(([, , entries]) => entries.map(([id]) => id));
const groupOf = (id: string) => GROUPS.findIndex(([, , entries]) => entries.some(([e]) => e === id));
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const REPO = `${GITHUB}/blob/main`;
const FXPAY = "CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD";
const WASM_SHA = "69a12d89059be04ac195f5acf40982d7e9ee93fd08f4df33626789d00ffccbd2";
const out = (href: string, text: ReactNode) => <a href={href} target="_blank" rel="noopener">{text}</a>;

// The section the reader is in: the last one whose top has passed under the bar.
function useActive() {
  const [active, setActive] = useState(ORDER[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ORDER[0];
      for (const id of ORDER) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 140) current = id;
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = ORDER[ORDER.length - 1];
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => { removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, []);
  return active;
}

// A dark code block; lines starting with # or // and trailing "  # …" comments are dimmed.
function Code({ title, lines, copy }: { title: string; lines: string[]; copy?: string }) {
  const { tr } = useH();
  return (
    <div className="code-card doc-code">
      <div className="code-tabs"><span className="path" translate="no">{title}</span><CopyButton text={copy ?? lines.join("\n")} label={tr("Copiar código", "Copy code")} /></div>
      <div className="code-body" translate="no">
        {lines.map((line, i) => {
          const at = /^\s*(#|\/\/)/.test(line) ? 0 : line.search(/\s{2,}(#|\/\/) /);
          return <div className="l" key={i}>{at < 0 ? line || " " : <>{line.slice(0, at)}<span className="c">{line.slice(at)}</span></>}</div>;
        })}
      </div>
    </div>
  );
}

// Below 640px each row stacks; a middle column keeps its heading as a small label.
function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  const label = (j: number, n: number) => j > 0 && j < n - 1 ? <span className="doc-label" aria-hidden="true">{head[j]}</span> : null;
  return (
    <div className="table-wrap doc-table">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{label(j, row.length)}{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="doc-prose">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Hero() {
  const { tr } = useH();
  return (
    <header className="doc-hero" id="intro">
      <img className="waves" src="/brand/waves-docs.svg" alt="" aria-hidden="true" />
      <span className="cross" aria-hidden="true"></span>
      <span className="vtext" aria-hidden="true">{tr("Pagos para una nueva era de agentes", "Payments for a new era of agents")}</span>
      <div className="eyebrow">{tr("Documentación", "Documentation")}</div>
      <h1>{tr(<>Construye, cobra,<br />escala con <em>Local402</em>.</>, <>Build, charge,<br />scale with <em>Local402</em>.</>)}</h1>
      <p className="lead">{tr(
        "Cobra en tu moneda y recibe USDC en Stellar, de personas o agentes de IA. Guías, paquetes, referencia y una demo en testnet.",
        "Charge in your currency and receive USDC on Stellar, from people or AI agents. Guides, packages, reference and a testnet demo.",
      )}</p>
      <div className="cta-row">
        <a className="btn primary small" href="#probar">{tr("Empezar", "Get started")}<ArrowRight aria-hidden="true" /></a>
        <a className="btn small" href="#cotizacion">{tr("Ver la referencia", "View the reference")}</a>
      </div>
    </header>
  );
}

const CARDS: [ReactNode, string, string, string, string, string][] = [
  [<Rocket />, "probar", "Pruébalo", "Try it", "Tu primer 402 → 200, gratis y sin wallet.", "Your first 402 → 200, free and with no wallet."],
  [<Bot />, "mcp", "Agentes", "Agents", "MCP con tope por pago y presupuesto.", "MCP with a per-payment cap and a budget."],
  [<BookOpen />, "cotizacion", "Referencia", "Reference", "La cotización, exact-fx y los errores.", "The quote, exact-fx and the errors."],
  [<Package />, "servidor", "Paquetes", "Packages", "Servidor, cliente y MCP en npm.", "Server, client and MCP on npm."],
];

function Overview() {
  const { tr } = useH();
  const benefit = (icon: ReactNode, title: string, sub: string) => (
    <li><span className="icon" aria-hidden="true">{icon}</span><div><b>{title}</b><span>{sub}</span></div></li>
  );
  return (
    <>
      <div className="doc-cards">
        {CARDS.map(([icon, href, es, en, des, den]) => (
          <a className="doc-card" key={href} href={`#${href}`}>
            <span className="icon" aria-hidden="true">{icon}</span>
            <ArrowUpRight className="go" aria-hidden="true" />
            <h3>{tr(es, en)}</h3>
            <p>{tr(des, den)}</p>
          </a>
        ))}
      </div>
      <section id="que-es" className="doc-prose">
        <div className="eyebrow">{tr("Visión general", "Overview")}</div>
        <h2>{tr(<>¿Qué es <em>Local402</em>?</>, <>What is <em>Local402</em>?</>)}</h2>
        <div className="doc-overview">
          <p>{tr(
            "Local402 extiende x402 en Stellar. Pones el precio en tu moneda (24 monedas del oráculo Reflector, y la UF) y recibes USDC exacto. Quien paga, persona o agente, elige USDC, XLM o EURC; si no es USDC, el contrato FxPay hace el swap en Soroswap dentro de la misma transacción. Cada venta deja un recibo con el precio local, la tasa y su fuente.",
            "Local402 extends x402 on Stellar. You set the price in your currency (24 currencies from the Reflector oracle, plus the UF) and receive exact USDC. The payer, a person or an agent, picks USDC, XLM or EURC; if it isn't USDC, the FxPay contract swaps it on Soroswap inside the same transaction. Every sale leaves a receipt with the local price, the rate and its source.",
          )}</p>
          <div className="card doc-benefits">
            <span className="label">{tr("Ventajas clave", "Key benefits")}</span>
            <ul>
              {benefit(<Zap />, tr("Pagos nativos para agentes", "Native payments for AI agents"), tr("Precio por solicitud sobre HTTP 402.", "Per-request pricing over HTTP 402."))}
              {benefit(<Globe />, tr("Precio en tu moneda", "Priced in your currency"), tr("24 monedas y la UF; recibes USDC en Stellar.", "24 currencies and the UF; you receive USDC on Stellar."))}
              {benefit(<Lock />, tr("Seguro y verificable", "Safe and verifiable"), tr("El agente revisa la tasa antes de firmar; si el swap no alcanza, se revierte todo.", "The agent checks the rate before signing; if the swap falls short, everything reverts."))}
            </ul>
          </div>
        </div>
        <figure className="doc-figure" aria-hidden="true">
          <img src="/brand/roca.webp" alt="" width="1600" height="557" loading="lazy" />
          <figcaption>FIG. 01 — {tr("FUNDAMENTOS", "FOUNDATIONS")} · 33.4489° S</figcaption>
        </figure>
        <a className="doc-next" href="#probar">
          <span>{tr("Siguiente: prueba en testnet, tu primer pago 402 → 200.", "Next: try it on testnet, your first 402 → 200 payment.")}</span>
          <ArrowRight aria-hidden="true" />
        </a>
      </section>
    </>
  );
}

function Despliegue() {
  const { tr } = useH();
  return (
    <Section id="despliegue" eyebrow={tr("Guías", "Guides")} title={tr(<>Despliega en <em>producción</em>.</>, <>Deploy to <em>production</em>.</>)}>
      <p>{tr(
        <>En local, <code>npm run demo</code> no necesita nada: crea y fondea cuentas desechables de testnet y levanta todo en <code>localhost:3001</code>.</>,
        <>Locally, <code>npm run demo</code> needs nothing: it creates and funds throwaway testnet accounts and starts everything on <code>localhost:3001</code>.</>,
      )}</p>
      <Code title={tr("terminal", "terminal")} lines={[
        "git clone https://github.com/DiegoPoveda01/local402 && cd local402",
        "npm install",
        tr("npm run demo          # cuentas de testnet desechables, todo en marcha", "npm run demo          # throwaway testnet accounts, everything running"),
        "",
        tr("# o por partes, copiando antes cada .env.example:", "# or piece by piece, copying each .env.example first:"),
        tr("npm run facilitator   # :4022  liquida exact y exact-fx, paga las comisiones", "npm run facilitator   # :4022  settles exact and exact-fx, pays the fees"),
        tr("npm run api           # :3001  vendedor de demo y panel", "npm run api           # :3001  demo seller and dashboard"),
        tr("npm run agent         #        un cliente que paga", "npm run agent         #        a paying client"),
        tr("npm run mcp           #        servidor MCP", "npm run mcp           #        MCP server"),
      ]} />
      <p>{tr(
        "Un despliegue que sirven varios procesos, o que mueve dinero real, necesita además estas variables. Cada .env.example lista el resto.",
        "A deployment served by more than one process, or one that moves real money, also needs these variables. Each .env.example lists the rest.",
      )}</p>
      <Table head={[tr("Variable", "Variable"), tr("Dónde", "Where"), tr("Para qué", "Why")]} rows={[
        [<code key="v">LOCAL402_QUOTE_SECRET</code>, tr("vendedor", "seller"), tr(<>Firma las cotizaciones. Mismo valor en cada instancia, de al menos 32 caracteres (<code>openssl rand -hex 32</code>). Desde la 1.0 el vendedor no arranca sin ella; <code>quoteSecret: false</code> la desactiva en un vendedor de una sola instancia.</>, <>Signs the quotes. Same value on every instance, at least 32 characters (<code>openssl rand -hex 32</code>). Since 1.0 the seller refuses to start without it; <code>quoteSecret: false</code> opts a single-instance seller out.</>)],
        [<code key="v">KV_REST_API_URL, KV_REST_API_TOKEN</code>, tr("vendedor", "seller"), tr("Recibos, topes de la demo y el último valor de la UF. Sin ellas, cada instancia serverless guarda los suyos y se pierden con ella.", "Receipts, the demo payment caps and the last known UF. Without them each serverless instance keeps its own, and they go with it.")],
        [<code key="v">SELF_URL</code>, tr("vendedor", "seller"), tr("Dónde compra el agente de la demo.", "Where the demo agent buys from.")],
        [<code key="v">CORS_ORIGIN</code>, tr("vendedor", "seller"), tr("Orígenes del panel que pueden pagar desde la wallet del visitante, separados por comas.", "Dashboard origins allowed to pay from the visitor's wallet, comma-separated.")],
        [<code key="v">PAY_TO_ALLOWLIST, MIN_AMOUNT</code>, tr("facilitador", "facilitator"), tr(<>Cada liquidación gasta comisiones del facilitador. En <code>stellar:pubnet</code> valen por defecto <code>PAY_TO</code> y 100000 (0,01 USDC).</>, <>Every settlement spends the facilitator&apos;s own fees. On <code>stellar:pubnet</code> they default to <code>PAY_TO</code> and 100000 (0.01 USDC).</>)],
        [<code key="v">FACILITATOR_PRIVATE_KEYS</code>, tr("facilitador", "facilitator"), tr("Una clave por liquidación simultánea; cada instancia, las suyas.", "One key per concurrent settlement; each instance gets its own.")],
        [<code key="v">FX_CONTRACT</code>, tr("ambos", "both"), tr("Obligatoria en mainnet: el FxPay al que queda atada la autorización del pagador.", "Required on mainnet: the FxPay deployment the payer's authorization is pinned to.")],
      ]} />
    </Section>
  );
}

function Servidor() {
  const { tr } = useH();
  return (
    <Section id="servidor" eyebrow={tr("Paquetes", "Packages")} title={tr(<>Cobra con <em>local402-server</em>.</>, <>Charge with <em>local402-server</em>.</>)}>
      <p>{tr(
        <>Una línea por ruta sobre el middleware de x402. <code>localRoute</code> pone el precio en tu moneda y ofrece <code>exact</code> (USDC) y <code>exact-fx</code> (XLM o EURC) con la misma cotización, así que todos pagan el mismo USDC.</>,
        <>One line per route on top of the x402 middleware. <code>localRoute</code> sets the price in your currency and offers <code>exact</code> (USDC) and <code>exact-fx</code> (XLM or EURC) from the same quote, so every payer is charged the same USDC.</>,
      )}</p>
      <Code title="server.ts" lines={[
        "// npm install local402-server @x402/express express",
        'import express from "express";',
        'import { paymentMiddleware } from "@x402/express";',
        'import { localRoute, local402Server } from "local402-server";',
        "",
        tr('const payTo = "G…";   // tu cuenta de Stellar (G…) o un contrato (C…)', 'const payTo = "G…";   // your Stellar account (G…) or a contract (C…)'),
        "const app = express();",
        "app.use(paymentMiddleware({",
        '  "GET /africa": localRoute("70 NGN", { payTo }),',
        '  "GET /uf": localRoute("0.01 UF", { payTo }),',
        '}, local402Server("https://local402.vercel.app/facilitator")));',
      ]} />
      <Table head={[tr("Opción", "Option"), tr("Por defecto", "Default"), tr("Qué hace", "What it does")]} rows={[
        [<code key="o">price</code>, "—", tr(<>Precio local, como <code>&quot;50 CLP&quot;</code> o <code>&quot;0.01 UF&quot;</code>. Se redondea hacia arriba: el vendedor nunca recibe menos.</>, <>Local price, like <code>&quot;50 CLP&quot;</code> or <code>&quot;0.01 UF&quot;</code>. Rounded up, so the seller never receives less.</>)],
        [<code key="o">payTo</code>, "—", tr("Dirección de Stellar que recibe el USDC, G… o C…. Si le pasas una clave secreta, la rechaza sin mostrarla.", "Stellar address that receives the USDC, G… or C…. Given a secret key, it refuses without printing it.")],
        [<code key="o">network</code>, <code key="d">stellar:testnet</code>, tr(<>O <code>stellar:pubnet</code>.</>, <>Or <code>stellar:pubnet</code>.</>)],
        [<code key="o">oracle</code>, "Reflector + UF", tr("Fuente de tasas para cotizar.", "Rate source used to quote.")],
        [<code key="o">quoteSecret</code>, <code key="d">LOCAL402_QUOTE_SECRET</code>, tr(<>Firma las cotizaciones; <code>false</code> lo desactiva en una sola instancia.</>, <>Signs the quotes; <code>false</code> opts a single instance out.</>)],
      ]} />
      <p>{tr(
        <><code>local402Server(facilitatorUrl, network)</code> crea el servidor de recursos que liquida <code>exact</code> y <code>exact-fx</code> con un facilitador de Local402 y publica la ruta en el catálogo Bazaar. Para cobrar herramientas MCP, <code>local402-server/mcp</code> exporta <code>localToolPayment</code>.</>,
        <><code>local402Server(facilitatorUrl, network)</code> builds the resource server that settles <code>exact</code> and <code>exact-fx</code> through a Local402 facilitator and lists the route in the Bazaar catalog. To charge for MCP tools, <code>local402-server/mcp</code> exports <code>localToolPayment</code>.</>,
      )}</p>
    </Section>
  );
}

function Cliente() {
  const { tr } = useH();
  return (
    <Section id="cliente" eyebrow={tr("Paquetes", "Packages")} title={tr(<>Paga con <em>local402-client</em>.</>, <>Pay with <em>local402-client</em>.</>)}>
      <p>{tr(
        "Lee el 402, vuelve a cotizar con su propio oráculo y solo firma si el precio y el swap están dentro de tus límites.",
        "It reads the 402, re-quotes from its own oracle and only signs if the price and the swap are within your limits.",
      )}</p>
      <Code title="agent.ts" lines={[
        'import { Local402Client } from "local402-client";',
        "",
        "const client = new Local402Client({",
        "  secret: process.env.STELLAR_SECRET,",
        tr('  payWith: "XLM",        // USDC, XLM o EURC', '  payWith: "XLM",        // USDC, XLM or EURC'),
        tr('  maxPrice: "500 CLP",   // rechaza cualquier pago por encima', '  maxPrice: "500 CLP",   // refuses any payment above it'),
        "});",
        tr("const price = await client.quote(url);   // sin pagar", "const price = await client.quote(url);   // without paying"),
        "const paid = await client.pay(url);      // transaction, explorerUrl, body…",
      ]} />
      <Table head={[tr("Opción", "Option"), tr("Por defecto", "Default"), tr("Qué hace", "What it does")]} rows={[
        [<code key="o">secret / signer</code>, "—", tr("Clave del pagador, o un firmante que no la expone (una wallet del navegador).", "The payer's key, or a signer that never exposes it (a browser wallet).")],
        [<code key="o">payWith</code>, <code key="d">USDC</code>, tr(<>USDC usa <code>exact</code>; XLM y EURC usan <code>exact-fx</code> a través de FxPay.</>, <>USDC uses <code>exact</code>; XLM and EURC use <code>exact-fx</code> through FxPay.</>)],
        [<code key="o">maxPrice</code>, "—", tr("Tope por pago, en cualquier moneda soportada.", "Per-payment cap, in any supported currency.")],
        [<code key="o">budget</code>, "—", tr(<>Un <code>SpendingBudget</code>, como <code>&quot;5000 CLP&quot;</code>, compartible entre clientes.</>, <>A <code>SpendingBudget</code>, like <code>&quot;5000 CLP&quot;</code>, shareable across clients.</>)],
        [<code key="o">maxOverchargeBps</code>, "200 (2%)", tr("Rechaza cotizaciones por encima de su propio oráculo.", "Refuses quotes above its own oracle.")],
        [<code key="o">maxFxPremiumBps</code>, "500 (5%)", tr("Rechaza swaps que puedan gastar más que esto sobre el valor del oráculo.", "Refuses swaps that may spend more than this above the oracle value.")],
        [<code key="o">fxSlippageBps</code>, "200 (2%)", tr("Margen que autoriza el swap; lo que no se usa se devuelve.", "Margin the swap authorizes; whatever it doesn't use is refunded.")],
        [<code key="o">network</code>, <code key="d">stellar:testnet</code>, tr(<>En <code>stellar:pubnet</code>, XLM y EURC necesitan además <code>fxContract</code> (<code>FXPAY_MAINNET</code>).</>, <>On <code>stellar:pubnet</code>, XLM and EURC also need <code>fxContract</code> (<code>FXPAY_MAINNET</code>).</>)],
        [<code key="o">oracle / assetOracle</code>, "Reflector + UF", tr("Tasas con que revisa la cotización del vendedor y la del swap.", "Rates it checks the seller's quote and the swap against.")],
      ]} />
      <p>{tr("También como CLI, sin escribir código:", "Also as a CLI, with no code:")}</p>
      <Code title="terminal" lines={[
        "npx -y local402-client quote https://local402-mainnet.vercel.app/africa",
        'STELLAR_SECRET=S… npx -y local402-client pay <url> --with XLM --max "100 NGN"',
      ]} />
    </Section>
  );
}

const MCP_CMD = `claude mcp add local402 -e STELLAR_PRIVATE_KEY=S… -e "MAX_PRICE=500 CLP" -- npx -y local402-mcp`;

function Mcp() {
  const { tr } = useH();
  return (
    <Section id="mcp" eyebrow={tr("Paquetes", "Packages")} title={tr(<>Conecta un <em>agente</em>.</>, <>Connect an <em>agent</em>.</>)}>
      <p>{tr(
        "local402-mcp le da a tu agente cuatro herramientas para descubrir, cotizar y pagar, con un tope por pago y un presupuesto por sesión.",
        "local402-mcp gives your agent four tools to discover, quote and pay, with a per-payment cap and a per-session budget.",
      )}</p>
      <Code title="terminal" copy={MCP_CMD} lines={[
        "claude mcp add local402 \\",
        "  -e STELLAR_PRIVATE_KEY=S… \\",
        '  -e "MAX_PRICE=500 CLP" -- npx -y local402-mcp',
      ]} />
      <Table head={[tr("Herramienta", "Tool"), tr("Qué hace", "What it does")]} rows={[
        [<code key="t">local402_discover</code>, tr("Busca servicios en el catálogo x402 Bazaar del facilitador.", "Finds services in the facilitator's x402 Bazaar catalog.")],
        [<code key="t">local402_quote</code>, tr("Precio local y tasa, sin pagar.", "Local price and rate, without paying.")],
        [<code key="t">local402_pay</code>, tr("Paga con USDC, XLM o EURC.", "Pays with USDC, XLM or EURC.")],
        [<code key="t">local402_wallet</code>, tr("Saldo y presupuesto restante.", "Balance and remaining budget.")],
      ]} />
      <Table head={[tr("Variable", "Variable"), tr("Por defecto", "Default"), tr("Qué hace", "What it does")]} rows={[
        [<code key="v">STELLAR_IDENTITY / STELLAR_PRIVATE_KEY</code>, "—", tr("Cuenta que paga: una identidad de stellar-cli (preferida) o una clave secreta.", "The paying account: a stellar-cli identity (preferred) or a secret key.")],
        [<code key="v">PAY_WITH</code>, "USDC", tr("Activo con que paga: USDC, XLM o EURC.", "Asset it pays with: USDC, XLM or EURC.")],
        [<code key="v">MAX_PRICE</code>, "500 CLP", tr("Rechaza cualquier pago por encima de este precio local.", "Refuses any single payment above this local price.")],
        [<code key="v">BUDGET</code>, "5000 CLP", tr("Deja de pagar cuando la sesión gastó este total.", "Stops paying once the session has spent this much.")],
        [<code key="v">NETWORK</code>, <code key="d">stellar:testnet</code>, tr(<>O <code>stellar:pubnet</code>.</>, <>Or <code>stellar:pubnet</code>.</>)],
        [<code key="v">FACILITATOR_URL</code>, tr("el de Local402", "Local402's"), tr("Facilitador cuyo catálogo lista local402_discover.", "Facilitator whose catalog local402_discover lists.")],
        [<code key="v">FX_CONTRACT</code>, tr("FxPay de Local402 en mainnet", "Local402's FxPay on mainnet"), tr("Contrato FxPay en que confía para XLM y EURC.", "FxPay contract it trusts with XLM and EURC.")],
        [<code key="v">HORIZON_URL</code>, tr("Horizon público", "public Horizon"), tr("Para leer saldos.", "Used to read balances.")],
      ]} />
    </Section>
  );
}

const QUOTE_CMD = "curl -si https://local402-mainnet.vercel.app/africa | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\\r' | base64 -d";

function Cotizacion() {
  const { tr } = useH();
  return (
    <Section id="cotizacion" eyebrow={tr("Referencia", "Reference")} title={tr(<>La <em>cotización</em> del 402.</>, <>The 402&apos;s <em>quote</em>.</>)}>
      <p>{tr(
        <>El 402 ofrece dos opciones con la misma cotización, en <code>extra.local402</code>: <code>exact</code> (USDC, el esquema estándar de x402) y <code>exact-fx</code> (XLM o EURC, que FxPay cambia a USDC). Míralo sin instalar nada:</>,
        <>The 402 offers two options carrying the same quote, in <code>extra.local402</code>: <code>exact</code> (USDC, x402&apos;s stock scheme) and <code>exact-fx</code> (XLM or EURC, which FxPay swaps to USDC). See it with nothing installed:</>,
      )}</p>
      <Code title="terminal" copy={QUOTE_CMD} lines={[
        tr("# el precio está en nairas; el requisito, en USDC", "# the price is in naira; the requirement, in USDC"),
        "curl -si https://local402-mainnet.vercel.app/africa \\",
        "  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\\r' | base64 -d",
      ]} />
      <Table head={[tr("Campo", "Field"), tr("Qué es", "What it is")]} rows={[
        [<code key="f">currency, localAmount</code>, tr("El precio tal como lo puso el vendedor.", "The price as the seller set it.")],
        [<code key="f">usdPerUnit</code>, tr("Valor en USD de una unidad de la moneda.", "USD value of one unit of the currency.")],
        [<code key="f">tokenAmount, tokenDecimals</code>, tr("Lo que hay que pagar, en la unidad mínima del token. Redondeado hacia arriba.", "What has to be paid, in the token's smallest unit. Rounded up.")],
        [<code key="f">oracleSource, oracleTimestamp</code>, tr("De dónde salió la tasa y cuándo.", "Where the rate came from, and when.")],
        [<code key="f">oracleValueDate</code>, tr("Día al que corresponde el valor, cuando difiere del timestamp (la UF).", "Day the value is dated, when it differs from the timestamp (the UF).")],
        [<code key="f">expiresAt</code>, tr("Segundos unix tras los cuales el vendedor ya no la respeta.", "Unix seconds after which the seller no longer honors it.")],
        [<code key="f">signature</code>, tr("HMAC del vendedor, cuando las cotizaciones van firmadas.", "The seller's HMAC, when quotes are signed.")],
      ]} />
    </Section>
  );
}

function ExactFx() {
  const { tr } = useH();
  return (
    <Section id="exact-fx" eyebrow={tr("Referencia", "Reference")} title={tr(<>El esquema <em>exact-fx</em>.</>, <>The <em>exact-fx</em> scheme.</>)}>
      <p>{tr(
        <>Un borrador de esquema x402: el pagador entrega otro activo y el vendedor recibe el monto exacto en USDC. Un cliente x402 estándar paga la opción <code>exact</code> del mismo 402. {out(`${REPO}/docs/scheme_exact_fx_stellar.md`, "Especificación completa")}.</>,
        <>A draft x402 scheme: the payer hands over another asset and the seller receives the exact USDC amount. A stock x402 client pays the <code>exact</code> option of the same 402. {out(`${REPO}/docs/scheme_exact_fx_stellar.md`, "Full specification")}.</>,
      )}</p>
      <Table head={[<code key="h">extra</code>, tr("Tipo", "Type"), tr("Qué es", "What it is")]} rows={[
        [<code key="f">areFeesSponsored</code>, <code key="t">true</code>, tr(<>El facilitador paga las comisiones de red, como en <code>exact</code>.</>, <>The facilitator pays the network fees, as in <code>exact</code>.</>)],
        [<code key="f">fxContract</code>, "string", tr("Dirección de FxPay. El cliente solo firma para un contrato en que ya confía; no la toma del servidor.", "FxPay's address. The client only signs for a contract it already trusts; it is not taken from the server.")],
        [<code key="f">sendAssets</code>, "string[]", tr("Contratos de token que el facilitador acepta como activo del pagador.", "Token contracts the facilitator accepts as the payer's asset.")],
      ]} />
      <p>{tr("El pagador firma una sola autorización:", "The payer signs a single authorization:")}</p>
      <Code title="FxPay" lines={[
        "FxPay.pay(from, send_asset, max_send, dest_asset, dest_amount, pay_to, deadline)",
        "",
        tr("// max_send: FxPay.quote(...) más 2% de margen; lo que no se usa vuelve en la misma llamada", "// max_send: FxPay.quote(...) plus 2% slippage; unused input comes back in the same call"),
        tr("// si la ruta necesita más que max_send: ExcessiveInput, y no se mueve nada", "// if the route needs more than max_send: ExcessiveInput, and nothing moves"),
      ]} />
    </Section>
  );
}

function Errores() {
  const { tr } = useH();
  return (
    <Section id="errores" eyebrow={tr("Referencia", "Reference")} title={tr(<>Cuando algo <em>sale mal</em>.</>, <>When something <em>goes wrong</em>.</>)}>
      <p>{tr("Cada caso falla antes de que se mueva dinero, o revierte la transacción entera.", "Each case fails before any money moves, or reverts the whole transaction.")}</p>
      <Table head={[tr("Situación", "Situation"), tr("Qué pasa", "What happens")]} rows={[
        [tr("La tasa del oráculo tiene más de 15 minutos, viene del futuro o es cero", "The oracle rate is more than 15 minutes old, dated in the future, or zero"), tr("El servidor no cotiza. No hay requisito, así que nadie paga con un precio malo.", "The server won't quote. No requirement is issued, so nobody pays on a bad price.")],
        [tr("El vendedor cotiza más de 2% sobre el oráculo del pagador", "The seller quotes more than 2% above the payer's own oracle"), tr("Local402Client se niega antes de firmar.", "Local402Client refuses before signing.")],
        [tr("El swap podría gastar más de 5% sobre el valor del oráculo", "The swap could spend more than 5% above the oracle value"), tr(<>El cliente se niega antes de firmar (<code>maxFxPremiumBps</code>).</>, <>The client refuses before signing (<code>maxFxPremiumBps</code>).</>)],
        [tr(<>Los pools se movieron y la ruta necesita más que <code>max_send</code></>, <>The pools moved and the route needs more than <code>max_send</code></>), tr(<>FxPay revierte con <code>ExcessiveInput</code>. No se mueve nada.</>, <>FxPay reverts with <code>ExcessiveInput</code>. Nothing moves.</>)],
        [tr("Ningún pool entrega el activo del vendedor", "No pool can deliver the seller's asset"), tr(<>FxPay falla con <code>NoRoute</code>.</>, <>FxPay fails with <code>NoRoute</code>.</>)],
        [tr("Monto, destinatario o activo distintos de los del 402", "Amount, recipient or asset differ from the 402"), tr(<>El facilitador lo rechaza: <code>wrong_amount</code>, <code>wrong_recipient</code>, <code>wrong_asset</code>.</>, <>The facilitator rejects it: <code>wrong_amount</code>, <code>wrong_recipient</code>, <code>wrong_asset</code>.</>)],
        [tr("El plazo vence mientras el pagador aprueba en la wallet", "The deadline passes while the payer approves in the wallet"), tr(<><code>deadline_expired</code>. El cliente ya deja 180 s para firmar.</>, <><code>deadline_expired</code>. The client already allows 180 s of signing time.</>)],
        [tr("Las tres fuentes de la UF están caídas", "All three UF sources are down"), tr("Se usa la última UF conocida hasta por tres días; después solo deja de cotizar la ruta en UF.", "The last known UF is used for up to three days; after that only the UF route stops quoting.")],
      ]} />
    </Section>
  );
}

function Limites() {
  const { tr } = useH();
  const item = (title: string, body: ReactNode) => <li><b>{title}</b> {body}</li>;
  return (
    <Section id="limites" eyebrow={tr("Referencia", "Reference")} title={tr(<>Lo que <em>no</em> hace.</>, <>What it does <em>not</em> do.</>)}>
      <ul className="doc-list">
        {item(tr("No corrige el oráculo.", "It does not make the oracle right."), tr(<>Vendedor y pagador leen el mismo feed de Reflector, así que Local402 atrapa a un vendedor que cotiza mal, no a un feed equivocado. Pasa tu propio <code>oracle</code> al cliente para una lectura independiente.</>, <>Seller and payer read the same Reflector feed, so Local402 catches a seller who misquotes, not a feed that is wrong. Pass your own <code>oracle</code> to the client for an independent reading.</>))}
        {item(tr("No cubre el tipo de cambio.", "It does not hedge."), tr("El vendedor recibe USDC; pasarlo a su moneda sigue siendo cosa suya.", "The seller receives USDC; turning it into their currency is still their job."))}
        {item(tr("No busca en todos los mercados.", "It does not search every venue."), tr("FxPay enruta solo por Soroswap, por el pool directo o pasando por XLM.", "FxPay routes on Soroswap only, through the direct pool or through XLM."))}
        {item(tr("No custodia fondos.", "It does not hold funds."), tr("FxPay no guarda saldo entre pagos y no tiene funciones de admin ni de actualización.", "FxPay keeps no balance between payments and has no admin or upgrade function."))}
        {item(tr("No está auditado.", "It is not audited."), tr("Tiene tests y pagos reales liquidados, pero ninguna auditoría externa. Por eso el facilitador de mainnet solo liquida para el vendedor de la demo y desde 0,01 USDC.", "It has tests and real settled payments, but no external audit. That is why the mainnet facilitator only settles for the demo seller and for at least 0.01 USDC."))}
        {item(tr("exact-fx aún no es parte de x402.", "exact-fx is not part of x402 yet."), tr("Es un borrador.", "It is a draft."))}
      </ul>
    </Section>
  );
}

function Verificar() {
  const { tr } = useH();
  const npm = (name: string) => out(`https://www.npmjs.com/package/${name}`, name);
  return (
    <Section id="verificar" eyebrow={tr("Referencia", "Reference")} title={tr(<>Todo se puede <em>verificar</em>.</>, <>Everything can be <em>verified</em>.</>)}>
      <p>{tr(
        <>El contrato FxPay de mainnet, {out(`https://stellar.expert/explorer/public/contract/${FXPAY}`, <code>CA6Z4E…UGHD</code>)}, es byte a byte el artefacto de un release de GitHub compilado en CI. stellar.expert lo muestra verificado contra el commit <code>268f32c</code> (tag <code>v0.1.1</code>) y Stellar Lab, como Verified Build. Compruébalo sin confiar en esta página:</>,
        <>The mainnet FxPay contract, {out(`https://stellar.expert/explorer/public/contract/${FXPAY}`, <code>CA6Z4E…UGHD</code>)}, is byte for byte a GitHub release artifact built in CI. stellar.expert shows it verified against commit <code>268f32c</code> (tag <code>v0.1.1</code>), and Stellar Lab as a Verified Build. Check it without trusting this page:</>,
      )}</p>
      <Code title="terminal" lines={[
        "curl -fsSL -O https://github.com/DiegoPoveda01/local402/releases/download/v0.1.1_contracts_fx-pay_cli27.0.0/fx-pay_v0.1.1.wasm",
        "sha256sum fx-pay_v0.1.1.wasm",
        `curl -s https://api.stellar.expert/explorer/public/contract/${FXPAY} | jq -r .wasm`,
        tr(`# ambos imprimen ${WASM_SHA}`, `# both print ${WASM_SHA}`),
      ]} />
      <ul className="doc-list">
        <li><b>{tr("Tests.", "Tests.")}</b> {tr(<><code>npm test</code> corre 41 tests de TypeScript y <code>cargo test</code>, 11 del contrato.</>, <><code>npm test</code> runs 41 TypeScript tests and <code>cargo test</code>, 11 contract tests.</>)}</li>
        <li><b>{tr("Escaneo.", "Scan.")}</b> {tr(<>{out("https://github.com/alex0tico/kuyfi", "kuyfi")} probó 37 vectores sobre los cinco puntos de entrada, sin hallazgos. Es un escaneo de superficie, no una auditoría.</>, <>{out("https://github.com/alex0tico/kuyfi", "kuyfi")} ran 37 vectors over the five entry points, with zero findings. A surface scan, not an audit.</>)}</li>
        <li><b>{tr("Upstream.", "Upstream.")}</b> {tr(<>Un bug de comisiones en mainnet, reportado en {out("https://github.com/x402-foundation/x402/issues/3491", "x402#3491")}; el arreglo, {out("https://github.com/x402-foundation/x402/pull/3503", "x402#3503")}, está integrado.</>, <>A mainnet fee bug, reported as {out("https://github.com/x402-foundation/x402/issues/3491", "x402#3491")}; the fix, {out("https://github.com/x402-foundation/x402/pull/3503", "x402#3503")}, is merged.</>)}</li>
        <li><b>npm.</b> {npm("local402-server")}, {npm("local402-client")}, {npm("local402-mcp")}.</li>
        <li><b>{tr("Código.", "Code.")}</b> {out(GITHUB, "github.com/DiegoPoveda01/local402")}</li>
      </ul>
    </Section>
  );
}

export function Docs() {
  const { tr } = useH();
  const active = useActive();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mac, setMac] = useState(false);
  const topSearch = useRef<HTMLInputElement>(null);
  const sideSearch = useRef<HTMLInputElement>(null);
  const group = Math.max(0, groupOf(active));

  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  // Cmd/Ctrl+K focuses whichever search box is on screen; Esc closes the index on small screens.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (topSearch.current?.offsetParent) topSearch.current.focus();
        else { setOpen(true); requestAnimationFrame(() => sideSearch.current?.focus()); }
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("doc-locked", open); }, [open]);

  const q = fold(query.trim());
  const groups = GROUPS.map(([es, en, entries]) => [es, en, entries.filter(([, ies, ien]) => !q || fold(tr(ies, ien)).includes(q))] as Group).filter(([, , entries]) => entries.length);
  const first = groups[0]?.[2][0]?.[0];
  const go = (id: string) => { setOpen(false); setQuery(""); location.hash = id; };
  const search = (ref: typeof topSearch, cls: string) => (
    <label className={`doc-search ${cls}`}>
      <Search aria-hidden="true" />
      <input ref={ref} type="search" value={query} placeholder={tr("Buscar en la doc…", "Search docs…")} aria-label={tr("Buscar en la documentación", "Search the docs")} aria-controls="doc-index"
        onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && first) go(first); }} />
      <kbd aria-hidden="true">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </label>
  );
  const tabs: [string, string, string][] = [["intro", "Documentación", "Documentation"], ["probar", "Guías", "Guides"], ["servidor", "Paquetes", "Packages"], ["cotizacion", "Referencia", "Reference"]];

  return (
    <div className="docs">
      <a className="skip" href="#doc-main">{tr("Saltar al contenido", "Skip to content")}</a>
      <header className="doc-top">
        <Logo href="/" />
        <nav className="doc-tabs" aria-label={tr("Secciones", "Sections")}>
          {tabs.map(([id, es, en], i) => <a key={id} href={`#${id}`} aria-current={group === i ? "true" : undefined}>{tr(es, en)}</a>)}
          <a href={GITHUB} target="_blank" rel="noopener">GitHub<ArrowUpRight aria-hidden="true" /></a>
        </nav>
        {search(topSearch, "top")}
        <a className="btn small primary doc-try" href="#probar">{tr("Probar en testnet", "Try on testnet")}<ArrowRight aria-hidden="true" /></a>
        <button type="button" className="menu-btn doc-menu" aria-expanded={open} aria-controls="doc-index" aria-label={open ? tr("Cerrar índice", "Close index") : tr("Abrir índice", "Open index")} onClick={() => setOpen(!open)}>
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>
      <div className="doc-shell">
        <aside className={`doc-side${open ? " open" : ""}`} id="doc-index" aria-label={tr("Índice", "Index")}>
          {search(sideSearch, "side")}
          {groups.map(([es, en, entries]) => (
            <div className="doc-group" key={es}>
              <span className="label">{tr(es, en)}</span>
              {entries.map(([id, ies, ien]) => <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined} onClick={() => { setOpen(false); setQuery(""); }}>{tr(ies, ien)}</a>)}
            </div>
          ))}
          {!groups.length && <p className="meta doc-empty">{tr("Sin resultados.", "No results.")}</p>}
          <div className="doc-group doc-lang">
            <span className="label">{tr("Idioma", "Language")}</span>
            <LangSwitch />
          </div>
        </aside>
        <main className="doc-main" id="doc-main">
          <Hero />
          <div className="doc-grid">
            <div className="doc-body">
              <Overview />
              <ComoFunciona />
              <Comparacion />
              <Probar />
              <Calculadora />
              <Mainnet />
              <Despliegue />
              <Servidor />
              <Cliente />
              <Mcp />
              <Cotizacion />
              <ExactFx />
              <Errores />
              <Recibos />
              <Limites />
              <Verificar />
            </div>
            <nav className="doc-toc" aria-label={tr("En esta sección", "In this section")}>
              <span className="label">{tr("En esta sección", "In this section")}</span>
              {GROUPS[group][2].map(([id, es, en]) => <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>{tr(es, en)}</a>)}
            </nav>
          </div>
        </main>
      </div>
    </div>
  );
}
