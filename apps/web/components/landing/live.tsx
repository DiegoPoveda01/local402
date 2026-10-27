"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { short } from "./i18n";

export type Quote = { currency: string; localAmount: string; usdPerUnit: string; tokenAmount: string; tokenDecimals: number; oracleSource: string; oracleTimestamp: number; expiresAt: number; signature: string };
export type Item = { path: string; price: string; description: string; error?: string; quote: Quote; usdcAmount: string };
export type Catalog = { network: string; payTo: string; items: Item[]; payAssets: string[]; demoAgent: boolean; assetSymbols?: Record<string, string>; fxContract?: string; discovered?: number };
export type Receipt = {
  id: string; paidAt: string; resource?: string; transaction: string; fxPremiumBps?: number;
  local: { amount: string; currency: string }; rate: { usdPerUnit: string };
  settled: { amount: string; decimals: number }; spent?: { asset: string; amount: string };
};
export type MainnetPayment = { paidAt: string; local: { amount: string; currency: string }; usdc: string; payWith: string; spent: string; spentPremiumBps?: number; fxPremiumBps?: number; transaction: string };

// Mainnet deployment of the same API and facilitator, paid from the visitor's own wallet.
export const MAINNET_API = "https://local402-mainnet.vercel.app";
const MAINNET_SYMBOLS: Record<string, string> = { CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA: "XLM", CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV: "EURC" };
export const symbolMainnet = (asset: string) => MAINNET_SYMBOLS[asset] ?? short(asset);

export const TxLink = ({ hash, net = "testnet" }: { hash: string; net?: string }) => (
  <a className="mono" translate="no" target="_blank" rel="noopener" href={`https://stellar.expert/explorer/${net}/tx/${hash}`}>{short(hash)}</a>
);
// Accounts (G…) and contracts (C…) open in the explorer too.
export const IdLink = ({ id }: { id: string }) => (
  <a translate="no" target="_blank" rel="noopener" href={`https://stellar.expert/explorer/testnet/${id.startsWith("C") ? "contract" : "account"}/${id}`}>{short(id)}</a>
);

type Live = {
  catalog?: Catalog; catalogDown: boolean;
  symbol: (asset: string) => string;
  receipts: Receipt[]; fresh?: { id: string; n: number }; loadReceipts: () => Promise<void>;
  mainnet: MainnetPayment[]; newestLive?: Receipt; loadMainnet: () => Promise<void>;
};
const LiveContext = createContext<Live | null>(null);
export const useLive = () => useContext(LiveContext)!;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogDown, setCatalogDown] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [fresh, setFresh] = useState<{ id: string; n: number }>();
  const [mainnet, setMainnet] = useState<MainnetPayment[]>([]);
  const [newestLive, setNewestLive] = useState<Receipt>();
  const has = useRef({ catalog: false, receipts: [] as Receipt[] });

  const loadCatalog = useCallback(async () => {
    try {
      const response = await fetch("/catalog");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCatalog(await response.json());
      has.current.catalog = true;
      setCatalogDown(false);
    } catch {
      // Keeps the last catalog on screen if there is one; the 30 s refresh retries, sooner on the first load.
      if (!has.current.catalog) {
        setCatalogDown(true);
        setTimeout(loadCatalog, 5_000);
      }
    }
  }, []);

  // Receipts come from the shared list; the stream only makes this instance feel instant.
  const loadReceipts = useCallback(async () => {
    const latest: Receipt[] = await (await fetch("/receipts")).json();
    const current = has.current.receipts;
    const known = new Set(current.map((r) => r.transaction));
    const found = current.length ? latest.find((r) => !known.has(r.transaction)) : undefined;
    has.current.receipts = latest;
    setReceipts(latest);
    if (found) setFresh({ id: found.id, n: Date.now() });
  }, []);

  // scripts/mainnet/pay.ts writes the first payments to a file; visitors' payments are receipts of the mainnet API.
  const loadMainnet = useCallback(async () => {
    const [scripted, live]: [MainnetPayment[], Receipt[]] = await Promise.all([
      fetch("/mainnet-payments.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${MAINNET_API}/receipts`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    const known = new Set(scripted.map((p) => p.transaction));
    const payments = [
      ...scripted,
      ...live.filter((r) => !known.has(r.transaction)).map((r) => ({
        paidAt: r.paidAt,
        local: r.local,
        usdc: r.settled.amount,
        payWith: r.spent ? symbolMainnet(r.spent.asset) : "USDC",
        spent: r.spent ? r.spent.amount : r.settled.amount,
        spentPremiumBps: r.fxPremiumBps,
        transaction: r.transaction,
      })),
    ].sort((a, b) => +new Date(b.paidAt) - +new Date(a.paidAt));
    // The paper receipt in the hero is the newest row of the mainnet /receipts.csv, with its own column names.
    const newest = [...live].sort((a, b) => +new Date(b.paidAt) - +new Date(a.paidAt))[0];
    if (newest) setNewestLive(newest);
    if (payments.length) setMainnet(payments);
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setInterval>[] = [];
    let stream: EventSource | undefined;
    let stopped = false;
    (async () => {
      loadMainnet();
      await loadCatalog();
      if (stopped) return;
      timers.push(setInterval(loadCatalog, 30_000));
      await loadReceipts().catch(() => {});
      if (stopped) return;
      timers.push(setInterval(() => loadReceipts().catch(() => {}), 20_000));
      stream = new EventSource("/receipts/stream");
      stream.onmessage = (event) => {
        const receipt: Receipt = JSON.parse(event.data);
        if (has.current.receipts.some((r) => r.transaction === receipt.transaction)) return;
        has.current.receipts = [receipt, ...has.current.receipts];
        setReceipts(has.current.receipts);
        setFresh({ id: receipt.id, n: Date.now() });
      };
    })();
    return () => { stopped = true; timers.forEach(clearInterval); stream?.close(); };
  }, [loadCatalog, loadReceipts, loadMainnet]);

  const symbol = useCallback((asset: string) => catalog?.assetSymbols?.[asset] ?? short(asset), [catalog]);

  return (
    <LiveContext.Provider value={{ catalog, catalogDown, symbol, receipts, fresh, loadReceipts, mainnet, newestLive, loadMainnet }}>
      {children}
    </LiveContext.Provider>
  );
}
