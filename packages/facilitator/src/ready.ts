import { rpc, xdr } from "@stellar/stellar-sdk";

/** What `/ready` asks the network. `rpcProbe` answers it over Soroban RPC; tests pass their own. */
export interface ReadinessProbe {
  rpcHealthy(): Promise<boolean>;
  /** Native balance in stroops, or undefined when the account does not exist on the network. */
  balanceStroops(address: string): Promise<bigint | undefined>;
  contractExists(contract: string): Promise<boolean>;
}

export interface Check {
  ok: boolean;
  error?: string;
}

export interface Readiness {
  ready: boolean;
  network: string;
  rpc: Check;
  feePayers: (Check & { address: string; xlm?: string })[];
  fxContract: Check & { address: string };
}

export function rpcProbe(server: rpc.Server): ReadinessProbe {
  return {
    rpcHealthy: async () => (await server.getHealth()).status === "healthy",
    async balanceStroops(address) {
      try {
        return BigInt((await server.getAccountEntry(address)).balance().toString());
      } catch (error) {
        if (/not found/i.test(String(error))) return undefined;
        throw error;
      }
    },
    async contractExists(contract) {
      try {
        await server.getContractData(contract, xdr.ScVal.scvLedgerKeyContractInstance(), rpc.Durability.Persistent);
        return true;
      } catch (error) {
        if (/not found/i.test(String(error))) return false;
        throw error;
      }
    },
  };
}

const STROOPS_PER_XLM = 10_000_000n;
const xlm = (stroops: bigint) => `${stroops / STROOPS_PER_XLM}.${String(stroops % STROOPS_PER_XLM).padStart(7, "0")}`.replace(/\.?0+$/, "");
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);

/**
 * Whether this instance can settle right now: the RPC answers, every fee payer exists and holds at least
 * `minFeeBalanceXlm`, and the FxPay contract is still on the ledger (its instance expires unless its TTL is extended).
 */
export async function readiness(
  probe: ReadinessProbe,
  options: { network: string; feePayers: string[]; fxContract: string; minFeeBalanceXlm: number },
): Promise<Readiness> {
  const min = BigInt(Math.round(options.minFeeBalanceXlm * 1e7));
  const [rpcCheck, feePayers, fxContract] = await Promise.all([
    probe.rpcHealthy().then((ok): Check => (ok ? { ok } : { ok, error: "RPC reports it is not healthy" }), (error) => ({ ok: false, error: reason(error) })),
    Promise.all(
      options.feePayers.map(async (address) => {
        try {
          const balance = await probe.balanceStroops(address);
          if (balance === undefined) return { address, ok: false, error: "account does not exist: fund it with XLM" };
          const ok = balance >= min;
          return { address, ok, xlm: xlm(balance), ...(ok ? {} : { error: `below the ${options.minFeeBalanceXlm} XLM minimum: top it up` }) };
        } catch (error) {
          return { address, ok: false, error: reason(error) };
        }
      }),
    ),
    probe.contractExists(options.fxContract).then(
      (ok) => ({ address: options.fxContract, ok, ...(ok ? {} : { error: "FxPay contract not found: wrong FX_CONTRACT or its TTL expired" }) }),
      (error) => ({ address: options.fxContract, ok: false, error: reason(error) }),
    ),
  ]);
  return {
    ready: rpcCheck.ok && feePayers.every((payer) => payer.ok) && fxContract.ok,
    network: options.network,
    rpc: rpcCheck,
    feePayers,
    fxContract,
  };
}
