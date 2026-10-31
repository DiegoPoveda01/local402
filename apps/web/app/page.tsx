import { Cta, Footer } from "@/components/landing/bottom";
import { LangProvider } from "@/components/landing/i18n";
import { LiveProvider } from "@/components/landing/live";
import { Integracion } from "@/components/landing/middle";
import { Reveal } from "@/components/landing/reveal";
import { About, Cases, Ecosystem, Hero, Nav } from "@/components/landing/top";

export default function Page() {
  return (
    <LangProvider>
      <LiveProvider>
        <Nav />
        <Hero />
        <main id="contenido">
          <About />
          <Cases />
          <Integracion />
          <Ecosystem />
          <Cta />
        </main>
        <Footer />
        <Reveal />
      </LiveProvider>
    </LangProvider>
  );
}
