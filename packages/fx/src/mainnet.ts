import { Account, Contract, Networks, rpc, scValToNative, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";

/** Mainnet contracts and classic assets the same payment would route through. Read-only: nothing here signs or submits. */
export const FX_MAINNET = {
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
  soroswapRouter: "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH",
  xlm: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  usdc: { contract: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
  eurc: { contract: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV", code: "EURC", issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2" },
} as const;

export interface ShadowQuote {
  /** Send-asset units (7 decimals) Soroswap's best route needs to deliver the USDC amount, if it has one. */
  soroswap?: string;
  /** Same through the Stellar DEX order book against USDC (Horizon strict-receive). */
  sdex?: string;
}

const SIMULATION_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/** What paying `usdcAmount` with XLM or EURC would cost on mainnet right now, through Soroswap and the SDEX. */
export async function mainnetShadowQuote(sendAsset: "XLM" | "EURC", usdcAmount: bigint): Promise<ShadowQuote> {
  const [soroswap, sdex] = await Promise.all([soroswapAmountIn(sendAsset, usdcAmount), sdexAmountIn(sendAsset, usdcAmount)]);
  return { soroswap: soroswap?.toString(), sdex: sdex?.toString() };
}

async function soroswapAmountIn(sendAsset: "XLM" | "EURC", amount: bigint): Promise<bigint | undefined> {
  const { soroswapRouter, xlm, usdc, eurc } = FX_MAINNET;
  const paths = sendAsset === "XLM" ? [[xlm, usdc.contract]] : [[eurc.contract, usdc.contract], [eurc.contract, xlm, usdc.contract]];
  const server = new rpc.Server(FX_MAINNET.rpcUrl);
  const quotes = await Promise.all(
    paths.map(async (path) => {
      const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), { fee: "100", networkPassphrase: Networks.PUBLIC })
        .addOperation(
          new Contract(soroswapRouter).call(
            "router_get_amounts_in",
            nativeToScVal(amount, { type: "i128" }),
            xdr.ScVal.scvVec(path.map((address) => nativeToScVal(address, { type: "address" }))),
          ),
        )
        .setTimeout(30)
        .build();
      const result = await server.simulateTransaction(tx).catch(() => undefined);
      if (!result || !rpc.Api.isSimulationSuccess(result) || !result.result) return undefined;
      return (scValToNative(result.result.retval) as bigint[])[0];
    }),
  );
  return min(quotes);
}

async function sdexAmountIn(sendAsset: "XLM" | "EURC", amount: bigint): Promise<bigint | undefined> {
  const { horizonUrl, usdc, eurc } = FX_MAINNET;
  const query = new URLSearchParams({
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: usdc.code,
    destination_asset_issuer: usdc.issuer,
    destination_amount: `${amount / 10_000_000n}.${(amount % 10_000_000n).toString().padStart(7, "0")}`,
    source_assets: sendAsset === "XLM" ? "native" : `${eurc.code}:${eurc.issuer}`,
  });
  type Paths = { _embedded: { records: { source_amount: string; path: unknown[] }[] } };
  const body = await fetch(`${horizonUrl}/paths/strict-receive?${query}`, { signal: AbortSignal.timeout(8_000) })
    .then((response) => (response.ok ? (response.json() as Promise<Paths>) : undefined))
    .catch(() => undefined);
  // Only the direct order book: multi-hop paths through thin assets can quote far off the market for small amounts.
  const direct = (body?._embedded.records ?? []).filter((record) => record.path.length === 0);
  return min(direct.map((record) => toUnits(record.source_amount)));
}

/** Horizon amounts are decimal strings with up to 7 decimals. */
function toUnits(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

function min(values: (bigint | undefined)[]): bigint | undefined {
  return values.reduce<bigint | undefined>((best, value) => (value !== undefined && (best === undefined || value < best) ? value : best), undefined);
}
