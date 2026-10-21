import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Local402Error } from "@local402/fx";

/** `count` fresh fee-paying accounts for one instance. Each instance gets its own: shared keys collide on sequence numbers. */
export function newKeys(count: number): Keypair[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Local402Error("INVALID_CONFIG", `The number of keys must be a whole number from 1 to 20, got ${count}.`);
  }
  return Array.from({ length: count }, () => Keypair.random());
}

/**
 * Writes `FACILITATOR_PRIVATE_KEYS` into an env file, creating it if needed. It never replaces keys already there,
 * since they may hold funds; an empty `FACILITATOR_PRIVATE_KEYS=` line (as `.env.example` ships it) is filled in.
 */
export function writeKeys(file: string, secrets: string[]): void {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const existing = /^FACILITATOR_PRIVATE_KEYS?=(.*)$/gm;
  for (const [, value] of text.matchAll(existing)) {
    if (value.split(",").some((key) => StrKey.isValidEd25519SecretSeed(key.trim()))) {
      throw new Local402Error("INVALID_CONFIG", `${file} already has facilitator keys. Move them out first: they may hold funds.`);
    }
  }
  const entry = `FACILITATOR_PRIVATE_KEYS=${secrets.join(",")}`;
  const line = /^FACILITATOR_PRIVATE_KEYS=.*$/m;
  const next = line.test(text) ? text.replace(line, entry) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${entry}\n`;
  writeFileSync(file, next, { mode: 0o600 });
}

/** Creates and funds `address` on testnet with friendbot's 10,000 test XLM. An account that already exists is fine. */
export async function fundOnTestnet(address: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const response = await fetchFn(`https://friendbot.stellar.org/?addr=${address}`, { signal: AbortSignal.timeout(30_000) });
  if (response.ok) return;
  const body = await response.text();
  if (/already.?exist/i.test(body)) return;
  throw new Error(`friendbot answered ${response.status} for ${address}`);
}
