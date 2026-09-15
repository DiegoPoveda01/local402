// Builds a Vercel Build Output API bundle in .vercel/output: `npx tsx scripts/vercel/build.ts`,
// then `vercel deploy --prebuilt`. The function is a single ESM file, so no node_modules ship.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const OUT = ".vercel/output";
const FUNC = `${OUT}/functions/index.func`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FUNC, { recursive: true });

await build({
  entryPoints: ["scripts/vercel/entry.ts"],
  outfile: `${FUNC}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // CommonJS dependencies still call require and __dirname inside the ESM bundle.
  banner: {
    js: [
      `import { createRequire as __createRequire } from "node:module";`,
      `import { fileURLToPath as __fileURLToPath } from "node:url";`,
      `const require = __createRequire(import.meta.url);`,
      `const __filename = __fileURLToPath(import.meta.url);`,
      `const __dirname = __filename.slice(0, __filename.lastIndexOf("/"));`,
    ].join("\n"),
  },
  // Optional native speedups; the Stellar SDK falls back to pure JS without them.
  external: ["sodium-native", "require-addon"],
  logLevel: "warning",
});

writeFileSync(
  `${FUNC}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", supportsResponseStreaming: true, maxDuration: 60 }),
);
cpSync("apps/demo-api/public", `${OUT}/static`, { recursive: true });

// The dashboard's "pay from your wallet" button, loaded only when clicked. The Node-only modules it pulls in
// (quote signing, settlement channels) are never called in the browser, so they resolve to empty stubs.
await build({
  entryPoints: ["apps/demo-api/src/wallet/index.ts"],
  outfile: `${OUT}/static/wallet.js`,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  plugins: [
    {
      name: "node-stubs",
      setup(build) {
        build.onResolve({ filter: /^node:(crypto|async_hooks)$/ }, (args) => ({ path: args.path, namespace: "node-stub" }));
        build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
          contents: "export class AsyncLocalStorage {}; export function createHmac() { throw new Error('unavailable in the browser'); }; export function timingSafeEqual() { return false; }",
        }));
      },
    },
  ],
  logLevel: "warning",
});

// DASHBOARD_URL: a deployment that only serves the API (e.g. mainnet) sends its root page to the dashboard.
const home = process.env.DASHBOARD_URL ? { src: "^/$", status: 302, headers: { Location: process.env.DASHBOARD_URL } } : { src: "^/$", dest: "/index.html" };
writeFileSync(`${OUT}/config.json`, JSON.stringify({ version: 3, routes: [home, { handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }));

console.log(`Built ${OUT}`);
