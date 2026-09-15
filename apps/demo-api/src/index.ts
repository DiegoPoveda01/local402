import { app, config } from "./app.js";

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`Local402 demo API on http://localhost:${PORT} (${config.network}, paying to ${config.payTo})`);
});
