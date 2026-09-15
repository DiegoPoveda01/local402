// Vercel function: the facilitator (under /facilitator) and the demo API in one Express app.
// Static files (the dashboard) are served by Vercel's CDN, everything else lands here.
import express from "express";

// Serverless instances only have /tmp; receipts there last as long as the instance.
process.env.RECEIPTS_FILE ??= "/tmp/local402-receipts.json";

const [{ app: facilitator }, { app: api }] = await Promise.all([
  import("../../apps/facilitator/src/app.js"),
  import("../../apps/demo-api/src/app.js"),
]);

const app = express();
app.use("/facilitator", facilitator);
app.use(api);

export default app;
