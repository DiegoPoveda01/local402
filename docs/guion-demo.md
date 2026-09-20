# Guion del video de demo: Local402 (3:00)

## Qué piden y qué funciona

- **Find Your Way** no publica requisitos del video. Las fechas reales de Stellar Passport: los envíos abren el 21 sep y cierran el **5 oct a las 19:00**; el jurado evalúa hasta el 9 oct y los resultados salen el 12 oct. Confirma en el formulario de envío el largo máximo y el idioma.
- **Estándar de los hackathons de Stellar** (Stellar Hacks en DoraHacks):
  - Video de 2–3 min, con 5 como máximo, mostrando el proyecto funcionando y una explicación técnica clara.
  - Repo público.
  - Links a los contratos en stellar.expert.
  - Suelen pedirlo en inglés.
- **Ganadores de x402 (Cards402, clevercon, TollPay):**
  - Una frase que se entiende sola ("Stripe for MCP").
  - Demo en vivo desplegada.
  - Integración en pocas líneas.
  - Tabla "antes / después".
- **Consejos de Devpost y Colosseum:**
  - Muestra el producto funcionando en los primeros segundos.
  - Una sola historia y un solo camino de demo.
  - Explica por qué elegiste la tecnología (aquí: **por qué Stellar**).
  - Di quién eres.
  - Nada de relleno ni jerga.
  - Audio limpio pesa más que la edición.
  - Nunca pasarse del tiempo.

Regla de este guion: **cada afirmación se ve en pantalla** (una transacción, un número o una línea de código).

## Antes de grabar

- [ ] **Probar un pago real con Freighter** en https://local402.vercel.app/#mainnet. Nunca se probó con la extensión real. Si falla, el gancho se graba con la CLI (plan B abajo).
- [ ] **Freighter:**
  - En Mainnet, con al menos 2 XLM.
  - Una cuenta sin saldos privados que no quieras mostrar.
- [ ] **Saldo del facilitador de mainnet** con más de 1 XLM (paga las comisiones de red).
- [ ] **Navegador:**
  - Zoom al 125%.
  - Barra de marcadores oculta.
  - Pestañas abiertas: el dashboard, stellar.expert y la terminal.
- [ ] **Agentes:**
  - `npm run demo` corriendo.
  - Claude Code con el MCP `local402` usando `BUDGET="1000 CLP"` para que el tope se note en 2–3 compras.
- [ ] **Terminal:**
  - Letra grande.
  - **Nunca escribir ni mostrar una clave secreta.** Usa identidades (`STELLAR_IDENTITY`) o una variable ya exportada fuera de cámara.
- [ ] **Grabación:**
  - OBS a 1080p.
  - Graba cada escena por separado y la voz después, leyendo este texto.
  - Acelera las esperas (×2–×4).
- [ ] **Subtítulos:**
  - En inglés si hablas en español, o al revés.
  - YouTube genera una base que puedes corregir.

## Guion

Unas 400 palabras de voz, a ritmo tranquilo, dan 3:00.

### 0:00 – 0:15 · Gancho: dinero real, primero

**Pantalla:**
1. Sección 08 del dashboard.
2. Clic en **XLM**.
3. Popup de Freighter y **Firmar**.
4. La consola muestra `200 OK`.
5. Corte a stellar.expert: el vendedor recibe 0,0523 USDC.

> "Acabo de pagar 50 pesos chilenos con XLM, en Stellar mainnet. El vendedor recibió exactamente 0,0523 USDC. Una sola transacción, sin cambiar dinero a mano. Esto es Local402."

### 0:15 – 0:35 · Quién y el problema

**Pantalla:**
- Tu cara o nombre en una esquina.
- La tabla **06 — Comparación**, con la fila `"50 CLP"` falla resaltada.

> "Soy Diego, desarrollador en Chile. x402 permite que una API cobre por request y que un agente de IA pague solo. Pero hoy el precio va en dólares y se paga con un único activo. Si escribes 50 pesos, el SDK falla. El comercio real factura en pesos, soles, reales o UF, y el cliente tiene lo que tiene."

### 0:35 – 0:55 · Vendedor: una línea

**Pantalla:**
1. **04 — Vendedores**: el bloque `localRoute("50 CLP", { payTo })`.
2. Sube al ticket del hero con la tasa en vivo.
3. Clic en **Ver el 402** en `/indicadores`.

> "Con Local402 el vendedor escribe su precio en su moneda. El oráculo Reflector, on-chain, lo convierte a USDC redondeando a su favor, y la cotización viaja dentro del 402 estándar. Cualquier cliente x402 lo entiende. Y el cliente elige: USDC, o XLM y EURC con un esquema nuevo, exact-fx."

### 0:55 – 1:35 · Cómo funciona exact-fx (el corazón técnico)

**Pantalla:**
1. **03 — Cómo funciona**, o un diagrama simple:
   `cliente XLM → FxPay (Soroban) → Soroswap → USDC exacto al vendedor · sobrante vuelve`
2. La transacción del gancho en stellar.expert: pestaña de eventos/operaciones.
3. Por último, **02 — Calculadora** escribiendo `0,5 UF`.

> "Cuando pagas con XLM, nuestro contrato FxPay hace el swap en Soroswap y entrega al vendedor el USDC exacto, en la misma transacción. Lo que sobra vuelve al cliente; si no alcanza, se revierte todo. El vendedor nunca toca XLM. Y el cliente no confía a ciegas: compara la tasa del vendedor y la del swap con su propio oráculo antes de firmar. Tú solo firmas: la comisión de red la paga el facilitador."

### 1:35 – 2:05 · Agentes de IA

**Pantalla:** Claude Code, acelerado.

Prompt: *"Busca servicios que cobren en moneda local y consígueme la UF pagando con XLM. Repite hasta que no puedas."*

Resalta tres momentos:
1. `local402_discover` encuentra el servicio en el catálogo Bazaar.
2. `local402_pay` verifica la tasa y paga.
3. El presupuesto lo detiene.

> "Lo mismo sirve para agentes. Con nuestro servidor MCP, el agente descubre servicios, verifica la tasa y paga. Y no puede gastar más del presupuesto que le diste: aquí se detiene solo."

### 2:05 – 2:20 · Recibos

**Pantalla:** **07 — Recibos en vivo** y clic en **Exportar CSV**, que se abre en una planilla.

> "Cada venta deja un recibo con el precio en pesos, la tasa, la fuente y la transacción. Listo para contabilidad."

### 2:20 – 2:40 · Por qué Stellar y pruebas

**Pantalla:** franja del jurado ("Qué es nuevo / Verifícalo"), el repo en GitHub y npm.

> "Esto solo es posible así en Stellar: un oráculo de divisas on-chain con 24 monedas, liquidez en Soroswap, contratos Soroban para el swap atómico y comisiones de fracción de centavo, que hacen viable cobrar 50 pesos. Ya está en mainnet con pagos reales, con cuatro paquetes en npm, una especificación del esquema, 35 tests, y reportamos un bug de comisiones al proyecto x402."

### 2:40 – 3:00 · Modelo, siguiente paso y cierre

**Pantalla:** vuelve al hero, con la URL grande: `local402.vercel.app` y `github.com/DiegoPoveda01/local402`.

> "Integrar es gratis; el facilitador cobra unos puntos básicos solo en pagos con swap. El siguiente paso son APIs y agentes de Latinoamérica, donde pesos mexicanos, colombianos y soles ya cotizan, y llevarlo a HackMeridian en Lisboa. Cobra en pesos, recibe USDC exacto. Pruébalo tú: local402.vercel.app."

## Plan B para el gancho (si Freighter falla)

En la terminal:

```
npx -y local402-client pay https://local402-mainnet.vercel.app/indicadores --with XLM
```

La clave va exportada **antes** de grabar. Muestra la línea `Paid 50 CLP = 0.0523… USDC` y abre el link del explorador. Cambia la voz a "Mi agente acaba de pagar…".

## Si preguntan (no va en el video)

- En testnet las tasas vienen del Reflector de **mainnet**, porque el de testnet no tiene CLP.
- Los pools de testnet están mal cotizados. Por eso los pagos con swap reales se muestran en mainnet, donde el sobreprecio fue de 2,5–3,2%.
- La UF viene del SII, con findic.cl y mindicador.cl de respaldo.

## English narration (for subtitles or an English cut)

**0:00** "I just paid 50 Chilean pesos with XLM, on Stellar mainnet. The seller received exactly 0.0523 USDC. One transaction, no manual currency exchange. This is Local402."

**0:15** "I'm Diego, a developer in Chile. x402 lets an API charge per request and an AI agent pay on its own. But today prices are in dollars and payment is a single asset. Write 50 pesos and the SDK fails. Real commerce invoices in pesos, soles, reais or UF, and customers hold whatever they hold."

**0:35** "With Local402 the seller writes the price in their currency. The on-chain Reflector oracle converts it to USDC, rounding in the seller's favor, and the quote travels inside the standard 402. Any x402 client understands it. And the payer chooses: USDC, or XLM and EURC through a new scheme, exact-fx."

**0:55** "When you pay with XLM, our FxPay contract swaps on Soroswap and delivers the exact USDC to the seller, in the same transaction. Change goes back to the payer; if it's not enough, everything reverts. The seller never touches XLM. And the payer doesn't trust blindly: it checks the seller's rate and the swap rate against its own oracle before signing. You only sign; the facilitator pays the network fee."

**1:35** "The same works for agents. With our MCP server, the agent discovers services, verifies the rate and pays. And it can't spend more than the budget you gave it: here it stops by itself."

**2:05** "Every sale leaves a receipt with the price in pesos, the rate, the source and the transaction. Ready for accounting."

**2:20** "This works this way only on Stellar: an on-chain FX oracle with 24 currencies, Soroswap liquidity, Soroban contracts for the atomic swap, and sub-cent fees that make a 50-peso charge viable. It's live on mainnet with real payments, four npm packages, a scheme spec, 35 tests, and a fee bug we reported upstream to x402."

**2:40** "Integrating is free; the facilitator takes a few basis points only on swap payments. Next: APIs and agents across Latin America, where Mexican and Colombian pesos and soles already quote, and taking it to HackMeridian in Lisbon. Charge in pesos, receive exact USDC. Try it: local402.vercel.app."

## Al subir

- **YouTube:**
  - "No listado".
  - Marcado como "No es para niños", porque si no se bloquea la reproducción embebida.
  - Revisa el link en una ventana privada.
- **Título:** `Local402 — Charge in pesos, receive exact USDC (x402 on Stellar)`.
- **Descripción:** links al dashboard, el repo, el contrato FxPay mainnet en stellar.expert y la transacción del gancho.
- **Plazo:** súbelo con días de margen, no el 30 de septiembre.
