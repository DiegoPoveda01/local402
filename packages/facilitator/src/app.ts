// The facilitator configured from this process's environment, for the Local402 deployment
// (scripts/vercel/entry.ts) and the mainnet scripts. Other deployments run the `local402-facilitator` command.
import { facilitatorConfig } from "./config.js";
import { createFacilitator, describe } from "./facilitator.js";

// Behind Vercel's edge: one proxy writes X-Forwarded-For, so the per-client limits see the real address.
const config = facilitatorConfig({ ...process.env, TRUST_PROXY: process.env.TRUST_PROXY || "1" });
export const { app, feePayers } = createFacilitator(config);
console.log(describe(config, feePayers));
