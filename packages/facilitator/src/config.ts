import { StrKey } from "@stellar/stellar-sdk";
import type { Network } from "@x402/core/types";
import { FX_MAINNET, fxNetwork, Local402Error } from "@local402/fx";

/** Everything a facilitator instance runs on, read once from the environment by `facilitatorConfig`. */
export interface FacilitatorConfig {
  network: Network;
  /** Fee-paying accounts ("channels"), one per concurrent settlement. Never shared with another instance. */
  secrets: string[];
  fxContract: string;
  sendAssets: string[];
  rpcUrl?: string;
  port: number;
  /** Sellers this instance settles for. Empty means any seller, which only testnet allows. */
  payToAllowlist: string[];
  /** Tokens (C…) a seller may be paid in. Empty means any token, which only testnet allows. */
  assetAllowlist: string[];
  /** Smallest payment it settles, in token units (7 decimals: 100000 is 0.01 USDC). */
  minAmount: bigint;
  /** Requests per client per minute. Verify simulates on RPC; settle spends this instance's fees. */
  limits: { verify: number; settle: number };
  /** Below this many XLM a fee payer makes `/ready` fail, so the host stops routing to it before it runs dry. */
  minFeeBalanceXlm: number;
  /** Proxies in front of the instance whose `X-Forwarded-For` it believes, for per-client limits. */
  trustProxy: number;
  /** Upstash Redis over REST, where the Bazaar catalog survives restarts. Without it the catalog lives in memory. */
  catalogRedis?: { url: string; token: string };
}

type Env = Record<string, string | undefined>;

const SECRET_KEY_SHAPE = /^S[A-Z2-7]{55}$/;

function invalid(message: string): never {
  throw new Local402Error("INVALID_CONFIG", message);
}

/** A value for an error message, never a secret key: these messages end up in logs. */
const shown = (value: string) => (SECRET_KEY_SHAPE.test(value) ? "a secret key (not shown)" : value);

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function whole(env: Env, name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
    invalid(`${name} must be a whole number ${range}, got ${shown(raw)}.`);
  }
  return value;
}

/**
 * Reads and checks a facilitator's environment. Every mistake throws `INVALID_CONFIG` naming the variable and what
 * it accepts, so a bad deploy fails at startup instead of on the first payment. Secret keys are never repeated.
 */
export function facilitatorConfig(env: Env = process.env): FacilitatorConfig {
  const network = (env.NETWORK?.trim() || "stellar:testnet") as Network;
  if (network !== "stellar:testnet" && network !== "stellar:pubnet") {
    invalid(`NETWORK must be stellar:testnet or stellar:pubnet, got ${shown(network)}.`);
  }
  const mainnet = network === "stellar:pubnet";

  const secrets = list(env.FACILITATOR_PRIVATE_KEYS || env.FACILITATOR_PRIVATE_KEY);
  if (!secrets.length) {
    invalid("FACILITATOR_PRIVATE_KEYS is required: one or more fee-paying Stellar secret keys (S…), comma-separated. `local402-facilitator keys` makes them.");
  }
  secrets.forEach((secret, i) => {
    if (!StrKey.isValidEd25519SecretSeed(secret)) {
      const what = StrKey.isValidEd25519PublicKey(secret) ? "a public key; it needs the secret (S…)" : "not a Stellar secret key (S…)";
      invalid(`FACILITATOR_PRIVATE_KEYS entry ${i + 1} is ${what}.`);
    }
  });
  if (new Set(secrets).size !== secrets.length) {
    invalid("FACILITATOR_PRIVATE_KEYS repeats a key: two channels on one account race for its sequence number.");
  }

  const fxContract = env.FX_CONTRACT?.trim() || undefined;
  if (fxContract && !StrKey.isValidContract(fxContract)) invalid(`FX_CONTRACT must be a contract address (C…), got ${shown(fxContract)}.`);
  const fx = fxNetwork(network, fxContract);
  if (!fx.fxContract) {
    invalid(`FX_CONTRACT (the FxPay deployment) is required on ${network}: Local402's verified one is CA6Z4E55YN6LZEXBQPFCWUIMUJGAV42RLHYWWZ6SNIP4E73R2I2PUGHD, or deploy your own (docs/facilitator.md).`);
  }

  const sendAssets = list(env.SEND_ASSETS);
  for (const asset of sendAssets) {
    if (!StrKey.isValidContract(asset)) invalid(`SEND_ASSETS must list token contract addresses (C…), got ${shown(asset)}.`);
  }

  const rpcUrl = env.RPC_URL?.trim() || fx.rpcUrl;
  // Not repeated: an RPC URL can carry an API key.
  if (rpcUrl && !/^https?:\/\/[^\s]+$/.test(rpcUrl)) invalid("RPC_URL must be an http(s) URL.");

  // On mainnet every settlement spends real fees, so this instance only settles for sellers it names.
  // `PAY_TO` is the demo seller that shares one process with the facilitator on the Local402 deployment.
  // An empty PAY_TO_ALLOWLIST (as `.env.example` ships it) counts as unset, not as "any seller".
  const payToAllowlist = list(env.PAY_TO_ALLOWLIST?.trim() || (mainnet ? env.PAY_TO : ""));
  for (const payTo of payToAllowlist) {
    if (!StrKey.isValidEd25519PublicKey(payTo) && !StrKey.isValidContract(payTo)) {
      invalid(`PAY_TO_ALLOWLIST must list seller addresses (G… or C…), got ${shown(payTo)}.`);
    }
  }
  if (mainnet && !payToAllowlist.length) {
    invalid("PAY_TO_ALLOWLIST is required on stellar:pubnet: every settlement spends this facilitator's XLM, so it only settles for the sellers you list (G…, comma-separated).");
  }

  // The caller writes the requirements, token included, so without this list a token anyone can mint for free
  // would meet MIN_AMOUNT and an allowlisted seller's "payments" in it would spend this instance's fees.
  const assetAllowlist = list(env.ASSET_ALLOWLIST?.trim() || (mainnet ? [FX_MAINNET.usdc.contract, FX_MAINNET.xlm, FX_MAINNET.eurc.contract].join(",") : ""));
  for (const asset of assetAllowlist) {
    if (!StrKey.isValidContract(asset)) invalid(`ASSET_ALLOWLIST must list token contract addresses (C…), got ${shown(asset)}.`);
  }

  const minAmountRaw = env.MIN_AMOUNT?.trim() || (mainnet ? "100000" : "0");
  if (!/^\d+$/.test(minAmountRaw)) invalid(`MIN_AMOUNT must be a whole number of token units (100000 is 0.01 USDC), got ${shown(minAmountRaw)}.`);

  const minFeeBalanceXlm = Number(env.MIN_FEE_BALANCE_XLM?.trim() || "2");
  if (!Number.isFinite(minFeeBalanceXlm) || minFeeBalanceXlm < 0) invalid(`MIN_FEE_BALANCE_XLM must be a number of XLM, got ${shown(env.MIN_FEE_BALANCE_XLM ?? "")}.`);
  // Vercel's Upstash integration names them KV_REST_API_*; Upstash itself, UPSTASH_REDIS_REST_*.
  const redisUrl = env.KV_REST_API_URL?.trim() || env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = env.KV_REST_API_TOKEN?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim();

  return {
    network,
    secrets,
    fxContract: fx.fxContract,
    sendAssets: sendAssets.length ? sendAssets : [fx.xlm, fx.eurc],
    rpcUrl,
    port: whole(env, "PORT", 4022, 1, 65_535),
    payToAllowlist,
    assetAllowlist,
    minAmount: BigInt(minAmountRaw),
    limits: { verify: whole(env, "VERIFY_RATE_LIMIT", 60, 1), settle: whole(env, "SETTLE_RATE_LIMIT", 20, 1) },
    minFeeBalanceXlm,
    trustProxy: whole(env, "TRUST_PROXY", 0, 0, 10),
    catalogRedis: redisUrl && redisToken ? { url: redisUrl, token: redisToken } : undefined,
  };
}
