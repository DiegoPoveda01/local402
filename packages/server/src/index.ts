import { StrKey } from "@stellar/stellar-sdk";
import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { ExactFxServerScheme, FX_SCHEME } from "@local402/fx";
import { Local402Error, localPrice, ReflectorFiatOracle, UfRateSource, type FiatRateSource, type LocalPriceOptions } from "@local402/pricing";

export { Local402Error, type Local402ErrorCode } from "@local402/pricing";

export interface LocalRouteOptions extends Omit<RouteConfig, "accepts"> {
  /** Stellar address that receives the USDC. */
  payTo: string;
  network?: Network;
  /** Defaults to Reflector plus UF. */
  oracle?: FiatRateSource;
  /** Defaults to `LOCAL402_QUOTE_SECRET`; see `LocalPriceOptions.quoteSecret`. */
  quoteSecret?: LocalPriceOptions["quoteSecret"];
}

const NETWORKS: readonly string[] = ["stellar:pubnet", "stellar:testnet"];
/** Shape of a Stellar secret key, checksum or not: one mistyped character is still a key to keep out of logs. */
const SECRET_KEY_SHAPE = /^S[A-Z2-7]{55}$/;

function checkNetwork(network: unknown): void {
  if (!NETWORKS.includes(network as string)) {
    throw new Local402Error("INVALID_CONFIG", `network must be one of ${NETWORKS.join(", ")}, got ${network}.`);
  }
}

/**
 * Route priced in local currency, e.g. `"GET /data": localRoute("50 CLP", { payTo })`.
 *
 * Accepts stock `exact` USDC and `exact-fx` (XLM, EURC swapped to USDC) from one shared quote,
 * so every payer is charged the same USDC amount.
 */
export function localRoute(price: string, { payTo, network = "stellar:testnet", oracle, quoteSecret, ...route }: LocalRouteOptions): RouteConfig {
  if (typeof payTo !== "string" || !(StrKey.isValidEd25519PublicKey(payTo) || StrKey.isValidContract(payTo))) {
    // A secret key here is an easy slip, and this message ends up in logs: never repeat one.
    const got = SECRET_KEY_SHAPE.test(String(payTo)) ? "got a secret key (not shown); use its public key" : `got ${payTo}`;
    throw new Local402Error("INVALID_CONFIG", `payTo must be the Stellar address that receives the USDC (G… or C…), ${got}.`);
  }
  checkNetwork(network);
  const quote = localPrice(price, { network, oracle: oracle ?? new UfRateSource(new ReflectorFiatOracle()), quoteSecret });
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
  if (typeof facilitatorUrl !== "string" || !/^https?:\/\/\S+$/.test(facilitatorUrl)) {
    throw new Local402Error("INVALID_CONFIG", "facilitatorUrl must be an http(s) URL, e.g. https://facilitator.example.com.");
  }
  checkNetwork(network);
  return new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
    .register(network, new ExactStellarScheme())
    .register(network, new ExactFxServerScheme())
    .registerExtension(bazaarResourceServerExtension);
}
