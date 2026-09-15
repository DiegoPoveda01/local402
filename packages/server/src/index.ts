import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ExactFxServerScheme, FX_SCHEME } from "@local402/fx";
import { localPrice, ReflectorFiatOracle, UfRateSource, type FiatRateSource } from "@local402/pricing";

export interface LocalRouteOptions extends Omit<RouteConfig, "accepts"> {
  /** Stellar address that receives the USDC. */
  payTo: string;
  network?: Network;
  /** Defaults to Reflector plus UF. */
  oracle?: FiatRateSource;
}

/**
 * Route priced in local currency, e.g. `"GET /data": localRoute("50 CLP", { payTo })`.
 *
 * Accepts stock `exact` USDC and `exact-fx` (XLM, EURC swapped to USDC) from one shared quote,
 * so every payer is charged the same USDC amount.
 */
export function localRoute(price: string, { payTo, network = "stellar:testnet", oracle, ...route }: LocalRouteOptions): RouteConfig {
  const quote = localPrice(price, { network, oracle: oracle ?? new UfRateSource(new ReflectorFiatOracle()) });
  return {
    mimeType: "application/json",
    ...route,
    accepts: [
      { scheme: "exact", network, payTo, price: quote },
      { scheme: FX_SCHEME, network, payTo, price: quote },
    ],
  };
}

/** Resource server that settles `exact` and `exact-fx` through a Local402 facilitator and publishes Bazaar discovery info. */
export function local402Server(facilitatorUrl = "http://localhost:4022", network: Network = "stellar:testnet") {
  return new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
    .register(network, new ExactStellarScheme())
    .register(network, new ExactFxServerScheme())
    .registerExtension(bazaarResourceServerExtension);
}
