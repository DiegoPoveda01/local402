import { app, feePayers } from "./app.js";

const PORT = Number(process.env.PORT ?? 4022);

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`Local402 facilitator on http://localhost:${PORT} (fees paid by ${feePayers.join(", ")})`);
});
