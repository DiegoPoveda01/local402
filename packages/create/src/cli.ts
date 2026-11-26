#!/usr/bin/env node
// npm create local402 [dir] -- [--price "50 CLP"] [--no-install]
import { main } from "./main.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`
create-local402 failed. ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
