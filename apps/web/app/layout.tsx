import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const OG = "https://local402.vercel.app/og.png";

export const metadata: Metadata = {
  title: "Local402 · Cobra en tu moneda",
  description: "x402 en Stellar con precios en moneda local (24 monedas: MXN, BRL, EUR, INR, NGN, JPY, CLP y la UF…) vía el oráculo Reflector. El cliente paga con USDC, XLM o EURC y el vendedor recibe USDC exacto.",
  icons: { icon: { url: "/logo.svg", type: "image/svg+xml" } },
  openGraph: {
    type: "website",
    url: "https://local402.vercel.app/",
    title: "Local402 · Cobra en tu moneda, recibe USDC exacto",
    description: "Pagos x402 en Stellar con precios en moneda local y swap atómico en Soroswap. Demo en vivo en testnet.",
    images: [{ url: OG, width: 1200, height: 630, alt: "Local402: cobra en tu moneda, recibe USDC exacto. 50 CLP = 0.0522984 USDC vía el oráculo Reflector." }],
  },
  twitter: { card: "summary_large_image", images: [OG] },
};
export const viewport: Viewport = { themeColor: "#0a0908" };

// The page (and its animations) waits for the web fonts, at most 2 s, so a first visit never paints in a fallback font.
const FONTS_WAIT = `document.documentElement.classList.add("fonts-wait");
window.fontsReady = Promise.race([
  Promise.all(["400 1em Geist", "500 1em Geist", "italic 1em 'Instrument Serif'", "400 1em 'Geist Mono'", "500 1em 'Geist Mono'"].map((font) => document.fonts.load(font))).catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, 2000)),
]).then(() => document.documentElement.classList.remove("fonts-wait"));`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The fonts-wait script and the saved language change <html> before React hydrates.
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/instrument-serif-latin-italic.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: FONTS_WAIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
