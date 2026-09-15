import type {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  SupportedKind,
} from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { FX_SCHEME } from "./extra.js";

/** Resource-server side of `exact-fx`: prices like `exact`, plus the facilitator's FX settings in `extra`. */
export class ExactFxServerScheme implements SchemeNetworkServer {
  readonly scheme = FX_SCHEME;
  readonly defaultAssetTransferMethod = "default";
  readonly paymentFlows = {
    default: { supported: ["authorization", "upfront"], default: "authorization" },
  } as const;

  private readonly exact = new ExactStellarScheme();

  parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    return this.exact.parsePrice(price, network);
  }

  getAssetDecimals(asset: string, network: Network): number | undefined {
    return this.exact.getAssetDecimals(asset, network);
  }

  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: SupportedKind,
  ): Promise<PaymentRequirements> {
    return Promise.resolve({
      ...paymentRequirements,
      extra: { ...paymentRequirements.extra, ...supportedKind.extra },
    });
  }
}
