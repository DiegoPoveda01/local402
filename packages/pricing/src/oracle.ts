import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export interface FiatRate {
  /** USD value of one unit of the currency, scaled by 10^decimals. */
  usdPerUnit: bigint;
  decimals: number;
  /** Unix seconds when the oracle recorded the price. */
  timestamp: number;
  source: string;
}

export interface FiatRateSource {
  getRate(currency: string): Promise<FiatRate>;
}

/** Reflector "Fiat exchange rates" feeds (SEP-40, base USD). */
export const REFLECTOR_FIAT = {
  mainnet: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: Networks.PUBLIC,
    contractId: "CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC",
  },
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    contractId: "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W",
  },
} as const;

/** Reflector "Centralized exchanges" feed on mainnet (base USD, 14 decimals); publishes crypto such as `XLM`. */
export const REFLECTOR_CEX = {
  rpcUrl: REFLECTOR_FIAT.mainnet.rpcUrl,
  networkPassphrase: Networks.PUBLIC,
  contractId: "CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN",
} as const;

// Any valid account works for read-only simulation; it never signs or submits.
const SIMULATION_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/** Median price of oracle records; the latest timestamp is kept for staleness checks. */
export function medianRecord(records: { price: bigint; timestamp: bigint }[]): { price: bigint; timestamp: number } {
  const prices = records.map((r) => r.price).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = prices.length >> 1;
  const price = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2n;
  return { price, timestamp: Math.max(...records.map((r) => Number(r.timestamp))) };
}

/**
 * Reads fiat rates from a Reflector oracle through read-only simulation.
 * Defaults to the mainnet feed: it is the only one publishing CLP, PEN and COP,
 * and reading it is free regardless of the network payments settle on.
 *
 * Quotes use the median of the last `records` updates, so one outlier tick cannot set the price
 * (the CLP feed has shown single 5-minute prints 0.65% off its neighbours).
 */
export class ReflectorFiatOracle implements FiatRateSource {
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly records: number;
  private decimals?: number;

  constructor(
    private readonly config: { rpcUrl: string; networkPassphrase: string; contractId: string } = REFLECTOR_FIAT.mainnet,
    options: { records?: number } = {},
  ) {
    this.server = new rpc.Server(config.rpcUrl);
    this.contract = new Contract(config.contractId);
    this.records = options.records ?? 5;
  }

  async getRate(currency: string): Promise<FiatRate> {
    const decimals = (this.decimals ??= Number(await this.call("decimals")));
    if (currency === "USD") {
      return { usdPerUnit: 10n ** BigInt(decimals), decimals, timestamp: Math.floor(Date.now() / 1000), source: "fixed" };
    }
    const asset = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol(currency)]);
    // `prices` returns the last updates newest first, but null if the history has a gap; fall back to the last price.
    type OracleRecord = { price: bigint; timestamp: bigint };
    const history = (await this.call("prices", asset, nativeToScVal(this.records, { type: "u32" }))) as OracleRecord[] | undefined;
    const last = history?.length ? undefined : ((await this.call("lastprice", asset)) as OracleRecord | undefined);
    const records = history?.length ? history : last ? [last] : [];
    if (!records.length) {
      throw new Error(`Reflector oracle ${this.config.contractId} has no rate for ${currency}`);
    }
    const { price, timestamp } = medianRecord(records);
    return {
      usdPerUnit: price,
      decimals,
      timestamp,
      source: `reflector:${this.config.contractId}`,
    };
  }

  private async call(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
      fee: "100",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const result = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(result) || !result.result) {
      throw new Error(`Reflector ${method} simulation failed: ${"error" in result ? result.error : "no result"}`);
    }
    return scValToNative(result.result.retval);
  }
}
