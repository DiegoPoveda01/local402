// Builds the publishable packages into .npm/<package>: compiled JavaScript, type declarations and a package.json
// pointing at them. The workspace keeps importing the TypeScript sources, so development is unchanged.
//
// npx tsx scripts/npm/pack.ts
// then, logged in to npm: npm publish .npm/<package>
//
// The @local402 npm scope belongs to someone else, so packages publish as local402-<name> and the compiled imports
// of @local402/<name> are rewritten to match.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(".npm");
// Dependency order: each package compiles against the declarations of the ones before it.
const PACKAGES = ["pricing", "fx", "client", "server"];
const DESCRIPTIONS: Record<string, string> = {
  pricing: "Price x402 routes in local currency (CLP, UF, EUR, BRL…) with the Reflector oracle on Stellar",
  fx: "exact-fx: x402 payments on Stellar where the payer spends XLM or EURC and the seller receives exact USDC",
  client: "x402 client for Stellar that checks local-currency quotes against its own oracle and pays with USDC, XLM or EURC",
  server: "One-line local-currency x402 routes and paid MCP tools on Stellar",
};

const published = (workspaceName: string) => workspaceName.replace(/^@local402\//, "local402-");

rmSync(OUT, { recursive: true, force: true });

for (const name of PACKAGES) {
  const source = JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8"));
  const dir = join(OUT, name);
  const tsconfig = join(OUT, `tsconfig.${name}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: resolve("tsconfig.json"),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        rootDir: resolve(`packages/${name}/src`),
        outDir: join(dir, "dist"),
        paths: Object.fromEntries(PACKAGES.map((p) => [`@local402/${p}`, [join(OUT, p, "dist/index.d.ts")]])),
      },
      include: [resolve(`packages/${name}/src`)],
    }),
  );
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", tsconfig], { stdio: "inherit" });
  for (const file of readdirSync(join(dir, "dist"))) {
    const path = join(dir, "dist", file);
    writeFileSync(path, readFileSync(path, "utf8").replace(/(["'])@local402\/([a-z]+)(["'\/])/g, "$1local402-$2$3"));
  }

  const exports = Object.fromEntries(
    Object.entries(source.exports as Record<string, string>).map(([key, file]) => {
      const js = file.replace("./src/", "./dist/").replace(/\.ts$/, ".js");
      return [key, { types: js.replace(/\.js$/, ".d.ts"), import: js }];
    }),
  );
  const dependencies = Object.fromEntries(
    Object.entries(source.dependencies as Record<string, string>).map(([dep, range]) => dep.startsWith("@local402/") ? [published(dep), `^${JSON.parse(readFileSync(`packages/${dep.slice(10)}/package.json`, "utf8")).version}`] : [dep, range]),
  );
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: published(source.name),
        version: source.version,
        description: DESCRIPTIONS[name],
        keywords: ["x402", "stellar", "soroban", "payments", "usdc", "oracle", "mcp"],
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/DiegoPoveda01/local402.git", directory: `packages/${name}` },
        type: "module",
        exports,
        types: exports["."].types,
        bin: source.bin && Object.fromEntries(Object.entries(source.bin as Record<string, string>).map(([cmd, file]) => [cmd, file.replace("./src/", "./dist/").replace(/\.ts$/, ".js")])),
        files: ["dist"],
        engines: { node: ">=20" },
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  copyFileSync("LICENSE", join(dir, "LICENSE"));
  console.log(`${published(source.name)}@${source.version} → ${dir}`);
}
