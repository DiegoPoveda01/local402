// Pays a local-currency MCP tool call from apps/mcp-seller (facilitator must be running):
// SECRET=$(stellar keys secret local402-agent) PAY_TO=$(stellar keys address local402-seller) npx tsx scripts/pay-mcp-tool.ts XLM
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createx402MCPClient } from "@x402/mcp";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { ExactFxClientScheme, FX_SCHEME, FX_TESTNET } from "@local402/fx";

const payWith = (process.argv[2] ?? "USDC").toUpperCase();
const signer = createEd25519Signer(process.env.SECRET!, "stellar:testnet");
const [scheme, schemeName] =
  payWith === "USDC"
    ? [new ExactStellarScheme(signer), "exact"]
    : [new ExactFxClientScheme(signer, { fxContract: FX_TESTNET.fxContract, sendAsset: payWith === "EURC" ? FX_TESTNET.eurc : FX_TESTNET.xlm }), FX_SCHEME];

const client = createx402MCPClient({
  name: "local402-buyer",
  version: "0.1.0",
  autoPayment: true,
  schemes: [{ network: "stellar:testnet", client: scheme }],
  policies: [(_version, requirements) => requirements.filter((r) => r.scheme === schemeName)],
  onPaymentRequested: async ({ paymentRequired }) => {
    const quote = paymentRequired.accepts[0].extra?.local402 as { localAmount: string; currency: string } | undefined;
    console.log(`Tool costs ${quote?.localAmount} ${quote?.currency}, paying with ${payWith}`);
    return true;
  },
});
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "apps/mcp-seller/src/index.ts"], env: process.env as Record<string, string> }));
const result = await client.callTool("convertir_a_clp", { amount: 10, currency: "EUR" });
console.log(result.content, `https://stellar.expert/explorer/testnet/tx/${result.paymentResponse?.transaction}`);
await client.close();
