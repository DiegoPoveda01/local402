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
writeFileSync(`${OUT}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "^/$", dest: "/index.html" }, { handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }));

console.log(`Built ${OUT}`);
