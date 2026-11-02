import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// ?v=2 so X, LinkedIn and others drop the old cached Spanish card.
const OG = "https://local402.xyz/og.png?v=2";

export const metadata: Metadata = {
  title: "Local402 · Cobra en tu moneda",
  description: "x402 en Stellar con precios en moneda local (24 monedas: MXN, BRL, EUR, INR, NGN, JPY, CLP y la UF…) vía el oráculo Reflector. El cliente paga con USDC, XLM o EURC y el vendedor recibe USDC exacto.",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
  openGraph: {
    type: "website",
    url: "https://local402.xyz/",
    title: "Local402 · Charge in your currency, receive exact USDC",
    description: "x402 payments on Stellar priced in 24 local currencies + UF via the Reflector oracle. People or AI agents pay with USDC, XLM or EURC; an atomic Soroswap swap settles exact USDC. Live demo on testnet.",
    images: [{ url: OG, width: 1200, height: 630, alt: "Local402: Charge in your currency. Receive exact USDC. People or AI agents pay with USDC, XLM or EURC. A 402 receipt: price 50 CLP, paid USDC 0.0512658, status Paid." }],
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", site: "@local402dev", title: "Local402 · Charge in your currency, receive exact USDC", description: "x402 on Stellar priced in 24 local currencies + UF. Pay with USDC, XLM or EURC; the seller gets exact USDC.", images: [OG] },
};
export const viewport: Viewport = { themeColor: "#f4f4f2" };

// The page (and its animations) waits for the web fonts, at most 2 s, so a first visit never paints in a fallback font.
const FONTS_WAIT = `document.documentElement.classList.add("fonts-wait");
window.fontsReady = Promise.race([
  Promise.all(["400 1em Inter", "500 1em Inter", "400 1em 'Instrument Serif'", "italic 1em 'Instrument Serif'", "400 1em 'Geist Mono'"].map((font) => document.fonts.load(font))).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 2000)),
]).then(() => document.documentElement.classList.remove("fonts-wait"));`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The fonts-wait script and the saved language change <html> before React hydrates.
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/instrument-serif-latin-italic.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: FONTS_WAIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
