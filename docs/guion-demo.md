# Guion del video de demo (3 min)

Preparación: `npm run demo`, abrir http://localhost:3001, tener stellar.expert en otra pestaña y Claude Code con el servidor MCP `local402` (`.mcp.json`).

## 0:00 – 0:25 · El problema

> "x402 permite que cualquier API cobre por request, y que un agente de IA pague solo. Pero hoy los precios se escriben en dólares y solo se paga con USDC. Una API chilena piensa en pesos y un cliente europeo tiene euros. Cada vendedor termina calculando tipos de cambio a mano, y cada cliente necesita el activo exacto."

## 0:25 – 0:55 · Vendedor: precio en su moneda

Pantalla: sección **Integración** del dashboard.

> "Con Local402 el vendedor escribe `localRoute("50 CLP", { payTo })`. Nada más. El precio se convierte a USDC con el oráculo Reflector on-chain, redondeando a favor del vendedor, y la cotización viaja dentro del 402 estándar."

Mostrar las tres tarjetas: 50 CLP, 0,05 EUR y 0,01 UF, con la tasa y la fuente.

## 0:55 – 1:40 · Cliente: paga con lo que tenga

1. Clic en **USDC** en `/indicadores`. Aparece el recibo en vivo.
2. Clic en **XLM** en `/uf`. Abrir la transacción en stellar.expert.

> "Esto es una sola transacción: el contrato FxPay en Soroban swapea XLM en Soroswap y entrega al vendedor el USDC exacto; el sobrante vuelve al cliente. Si no alcanza, todo se revierte. El vendedor nunca toca XLM."

3. Clic en **EURC** en `/europa`: la ruta pasa por XLM porque no hay pool directo.

## 1:40 – 2:30 · Agentes de IA

Pantalla: Claude Code.

> "Lo mismo sirve para agentes."

Prompt: *"Busca servicios pagados en moneda local y consígueme el valor de la UF pagando con XLM."*

- `local402_discover` los encuentra en el catálogo Bazaar del facilitador, con el precio en UF y un ejemplo de respuesta.
- `local402_pay` verifica la tasa del vendedor contra su propio oráculo antes de firmar.
- Pedir que siga pagando la UF una y otra vez: el presupuesto de sesión (`BUDGET`, 5000 CLP) lo detiene tras unas 12 compras.

> "El agente no confía en la tasa del vendedor y no puede gastar más de lo que le dimos."

Opcional (10 s): `scripts/pay-mcp-tool.ts EURC` — una herramienta MCP cobrada en 20 CLP.

## 2:30 – 3:00 · Cierre

Pantalla: tabla de recibos y botón **Exportar CSV**.

> "Cada venta deja un recibo con precio local, tasa, fuente y transacción: listo para contabilidad. Local402 es un esquema x402 nuevo, `exact-fx`, compatible con el ecosistema existente. Siguiente paso: mainnet con USDC y EURC reales, y llevarlo a HackMeridian en Lisboa."

## Limitaciones a reconocer si preguntan

- Las tasas se leen del Reflector de **mainnet** incluso en testnet, porque el de testnet no tiene CLP.
- El pool de EURC de testnet está mal cotizado (~0,7 USD), así que el cliente paga más EURC de lo que pagaría en mainnet.
