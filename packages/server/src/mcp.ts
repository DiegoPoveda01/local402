import type { x402ResourceServer } from "@x402/core/server";
import { encodePaymentSignatureHeader, type PaymentOption } from "@x402/core/http";
import { createPaymentWrapper, extractPaymentFromMeta, type MCPToolCallback, type PaymentWrappedHandler } from "@x402/mcp";
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
      // Over MCP the paid retry carries its payload in the call's `_meta` instead of a header, so the
      // header is rebuilt here: without it `localPrice` never sees the quote the payer signed, and a
      // second server instance (or an expired TTL) re-quotes and rejects a payment that was correct.
      const { _meta } = (extra ?? {}) as { _meta?: Record<string, unknown> };
      const payload = extractPaymentFromMeta({ name: toolName, _meta } as never);
      const context = payload ? { paymentHeader: encodePaymentSignatureHeader(payload) } : {};
      const requirements = await server.buildPaymentRequirementsFromOptions(accepts as PaymentOption[], context as never);
      const paid = createPaymentWrapper(server, { accepts: requirements, resource: { url: `mcp://tool/${toolName}`, description } });
      return paid(handler)(args, extra);
    };
}
