import { Footer, Jurado, Mainnet, Recibos } from "@/components/landing/bottom";
import { LangProvider } from "@/components/landing/i18n";
import { LiveProvider } from "@/components/landing/live";
import { Calculadora, ComoFunciona, Comparacion, Integracion } from "@/components/landing/middle";
import { Probar } from "@/components/landing/probar";
import { Reveal } from "@/components/landing/reveal";
import { Hero, Logos, Nav, Stats } from "@/components/landing/top";

export default function Page() {
  return (
    <LangProvider>
      <LiveProvider>
        <Nav />
        <Hero />
        <Logos />
        <Stats />
        <main className="wrap" id="contenido">
          <Probar />
          <Calculadora />
          <ComoFunciona />
          <Integracion />
          <Comparacion />
          <Recibos />
          <Mainnet />
        </main>
        <Jurado />
        <Footer />
        <Reveal />
      </LiveProvider>
    </LangProvider>
  );
}
