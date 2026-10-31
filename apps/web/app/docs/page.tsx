import type { Metadata } from "next";
import { Docs } from "@/components/docs/docs";
import { LangProvider } from "@/components/landing/i18n";
import { LiveProvider } from "@/components/landing/live";

export const metadata: Metadata = {
  title: "Local402 · Documentación",
  description: "Guías, paquetes de npm, la referencia de exact-fx y una demo en testnet para cobrar en tu moneda y recibir USDC en Stellar.",
};

export default function DocsPage() {
  return (
    <LangProvider>
      <LiveProvider>
        <Docs />
      </LiveProvider>
    </LangProvider>
  );
}
