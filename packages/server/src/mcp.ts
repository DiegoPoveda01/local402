import type { x402ResourceServer } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import { createPaymentWrapper, type MCPToolCallback, type PaymentWrappedHandler } from "@x402/mcp";
import { localRoute, type LocalRouteOptions } from "./index.js";

export interface LocalToolOptions extends Pick<LocalRouteOptions, "payTo" | "network" | "oracle" | "description"> {
  /** Tool name as registered on the MCP server; identifies the paid resource. */
  toolName: string;
}

/**
 * MCP counterpart of `localRoute`: `paid(handler)` charges each tool call a local-currency price,
 * payable in USDC (`exact`) or XLM/EURC (`exact-fx`).
 */
export function localToolPayment(server: x402ResourceServer, price: string, { toolName, description, ...options }: LocalToolOptions) {
  const { accepts } = localRoute(price, options);
  return <TArgs extends Record<string, unknown>>(handler: PaymentWrappedHandler<TArgs>): MCPToolCallback<TArgs> =>
    async (args, extra) => {
      // Re-quote per call; localPrice keeps a quote for its TTL, so the paid retry sees the same amount.
      const requirements = await server.buildPaymentRequirementsFromOptions(accepts as PaymentOption[], {} as never);
      const paid = createPaymentWrapper(server, { accepts: requirements, resource: { url: `mcp://tool/${toolName}`, description } });
      return paid(handler)(args, extra);
    };
}
