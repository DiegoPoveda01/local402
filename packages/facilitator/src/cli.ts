#!/usr/bin/env node
// local402-facilitator: run a Local402 facilitator from environment variables (or a .env file in the
// current directory). See docs/facilitator.md for every variable.
//
//   local402-facilitator                       start it
//   local402-facilitator check                 check the config and the network, then exit (0 = ready)
//   local402-facilitator keys [n] [--out f]    make n fee-paying accounts (default 2) into f (default .env),
//                                              funded with friendbot on testnet. Prints only public keys.
import { existsSync } from "node:fs";
import { facilitatorConfig, type FacilitatorConfig } from "./config.js";
import { createFacilitator, describe } from "./facilitator.js";
import { fundOnTestnet, newKeys, writeKeys } from "./keys.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const [command = "start", ...args] = process.argv.slice(2);

function config(): FacilitatorConfig {
  try {
    return facilitatorConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (command === "start") {
  const settings = config();
  const { app, feePayers } = createFacilitator(settings);
  console.log(describe(settings, feePayers));
  const server = app.listen(settings.port, (error) => {
    if (error) throw error;
    console.log(`Local402 facilitator on http://localhost:${settings.port} (fees paid by ${feePayers.join(", ")})`);
  });
  // Hosts stop an instance with SIGTERM: stop taking requests and let settlements in flight finish.
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
} else if (command === "check") {
  const settings = config();
  const { feePayers, ready } = createFacilitator(settings);
  console.log(describe(settings, feePayers));
  const result = await ready();
  const mark = (ok: boolean) => (ok ? "ok  " : "FAIL");
  console.log(`${mark(result.rpc.ok)} RPC${result.rpc.error ? `: ${result.rpc.error}` : ""}`);
  for (const payer of result.feePayers) {
    console.log(`${mark(payer.ok)} fee payer ${payer.address}${payer.xlm ? ` ${payer.xlm} XLM` : ""}${payer.error ? `: ${payer.error}` : ""}`);
  }
  console.log(`${mark(result.fxContract.ok)} FxPay ${result.fxContract.address}${result.fxContract.error ? `: ${result.fxContract.error}` : ""}`);
  console.log(result.ready ? "ready" : "not ready");
  process.exit(result.ready ? 0 : 1);
} else if (command === "keys") {
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : ".env";
  if (!out || out.startsWith("-")) {
    console.error("--out needs a file name, e.g. local402-facilitator keys 2 --out .env");
    process.exit(1);
  }
  const count = Number(args.find((arg, i) => /^\d+$/.test(arg) && args[i - 1] !== "--out") ?? 2);
  const network = process.env.NETWORK?.trim() || "stellar:testnet";
  try {
    const keys = newKeys(count);
    writeKeys(out, keys.map((key) => key.secret()));
    console.log(`Wrote ${count} fee-paying key(s) to ${out} as FACILITATOR_PRIVATE_KEYS (secrets are not printed).`);
    for (const key of keys) {
      if (network === "stellar:testnet") {
        await fundOnTestnet(key.publicKey());
        console.log(`${key.publicKey()} funded with friendbot`);
      } else {
        console.log(`${key.publicKey()} send it XLM to create it (see the runbook for how much)`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else {
  console.error(`Unknown command ${command}. Use start, check or keys.`);
  process.exit(1);
}
