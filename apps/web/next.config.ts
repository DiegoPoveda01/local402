import type { NextConfig } from "next";

// The landing is exported as static HTML (out/) and served by Vercel's CDN next to the API function
// (scripts/vercel/build.ts). In development every path Next does not serve itself (the API, /fonts, /logos,
// /wallet.js…) goes to API_URL: a local `npm run api`, or the live deployment by default.
const api = process.env.API_URL ?? "https://local402.vercel.app";

const config: NextConfig =
  process.env.NODE_ENV === "production"
    ? { output: "export", images: { unoptimized: true } }
    : { rewrites: async () => ({ beforeFiles: [], afterFiles: [], fallback: [{ source: "/:path*", destination: `${api}/:path*` }] }) };

export default config;
