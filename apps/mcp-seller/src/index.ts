import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ReflectorFiatOracle, UfRateSource } from "@local402/pricing";
import { local402Server } from "@local402/server";
import { localToolPayment } from "@local402/server/mcp";

// An MCP server whose tool costs 20 CLP per call, payable in USDC, XLM or EURC.
const PAY_TO = process.env.PAY_TO;
if (!PAY_TO) {
  throw new Error("PAY_TO (seller Stellar address) is required. See .env.example");
}
const oracle = new UfRateSource(new ReflectorFiatOracle());
const resourceServer = local402Server(process.env.FACILITATOR_URL);
await resourceServer.initialize();

const mcp = new McpServer({ name: "local402-indicadores", version: "0.1.0" });
const paid = localToolPayment(resourceServer, "20 CLP", {
  toolName: "convertir_a_clp",
  description: "Converts an amount to Chilean pesos at the Reflector rate",
  payTo: PAY_TO,
  oracle,
});

mcp.registerTool(
  "convertir_a_clp",
  {
    description: "Converts an amount in USD, EUR, BRL or UF to Chilean pesos at the on-chain Reflector rate. Costs 20 CLP per call.",
    inputSchema: { amount: z.number().positive(), currency: z.enum(["USD", "EUR", "BRL", "UF"]) },
  },
  paid(async ({ amount, currency }) => {
    const usdPer = async (code: string) => {
      if (code === "USD") return 1;
      const rate = await oracle.getRate(code === "UF" ? "CLF" : code);
      return Number(rate.usdPerUnit) / 10 ** rate.decimals;
    };
    const [from, clp] = await Promise.all([usdPer(currency), usdPer("CLP")]);
    const result = { amount, currency, clp: +((amount * from) / clp).toFixed(2) };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }),
);

await mcp.connect(new StdioServerTransport());
