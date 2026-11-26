import { readFileSync } from "node:fs";
import { Account, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  APP_DEPENDENCIES,
  appFiles,
  buyerLimit,
  DEFAULT_DIR,
  explorer,
  friendbot,
  newKeys,
  parseArgs,
  step,
  trustUsdc,
  usdcToBuy,
  waitFor402,
  type Ledger,
} from "../src/index.js";

describe("parseArgs", () => {
  it("defaults to local402-app at 50 CLP with install", () => {
    expect(parseArgs([])).toEqual({ dir: DEFAULT_DIR, price: "50 CLP", install: true, help: false });
  });

  it("takes a dir, a price in either form and --no-install", () => {
    expect(parseArgs(["shop", "--price", "1.20 eur", "--no-install"])).toEqual({ dir: "shop", price: "1.20 EUR", install: false, help: false });
    expect(parseArgs(["--price=0.5 UF"]).price).toBe("0.5 CLF");
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("refuses a bad price, a missing value and unknown flags before creating anything", () => {
    expect(() => parseArgs(["--price", "fifty"])).toThrow(/Invalid local price/);
    expect(() => parseArgs(["--price", "0 CLP"])).toThrow(/greater than zero/);
    expect(() => parseArgs(["--price"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--mainnet"])).toThrow(/Unknown option --mainnet/);
  });
});

describe("appFiles", () => {
  const keys = newKeys();
  const files = appFiles("My Shop!", "1.20 EUR", keys, "q".repeat(64));

  it("writes a runnable package with the published dependencies", () => {
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.name).toBe("my-shop");
    expect(pkg.scripts.start).toBe("node --env-file=.env --import tsx server.ts");
    expect(pkg.dependencies).toEqual(APP_DEPENDENCIES);
    expect(appFiles("!!!", "50 CLP", keys)["package.json"]).toContain(`"name": "${DEFAULT_DIR}"`);
  });

  it("prices the route as the seller wrote it and runs its own facilitator", () => {
    expect(files["server.ts"]).toContain('const PRICE = "1.20 EUR";');
    expect(files["server.ts"]).toContain("createFacilitator(facilitatorConfig(");
    expect(files["server.ts"]).toContain('"GET /hello": localRoute(PRICE');
  });

  it("keeps the secrets in a gitignored .env and out of every other file", () => {
    expect(files[".gitignore"]).toContain(".env");
    expect(files[".env"]).toContain(`PAY_TO=${keys.seller.publicKey()}`);
    expect(files[".env"]).toContain(`FACILITATOR_PRIVATE_KEYS=${keys.facilitator.secret()}`);
    expect(files[".env"]).toContain(`BUYER_SECRET=${keys.buyer.secret()}`);
    expect(files[".env"]).toContain(`LOCAL402_QUOTE_SECRET=${"q".repeat(64)}`);
    for (const [name, text] of Object.entries(files)) {
      if (name === ".env") continue;
      for (const key of [keys.seller, keys.facilitator, keys.buyer]) expect(text).not.toContain(key.secret());
    }
  });

  it("installs the versions the workspace publishes", () => {
    for (const name of ["server", "facilitator"]) {
      const { version } = JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8"));
      expect(APP_DEPENDENCIES[`local402-${name}` as keyof typeof APP_DEPENDENCIES]).toBe(`^${version}`);
    }
  });
});

describe("friendbot", () => {
  const address = Keypair.random().publicKey();

  it("funds, and accepts an account that already exists", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    await friendbot(address, ok as unknown as typeof fetch, 0);
    expect(ok).toHaveBeenCalledOnce();
    const exists = vi.fn(async () => new Response("createAccountAlreadyExist", { status: 400 }));
    await friendbot(address, exists as unknown as typeof fetch, 0);
  });

  it("retries, then names Friendbot and the last answer", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(new Response("", { status: 200 }));
    await friendbot(address, flaky as unknown as typeof fetch, 0);
    expect(flaky).toHaveBeenCalledTimes(2);
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    await expect(friendbot(address, down as unknown as typeof fetch, 0)).rejects.toThrow(/Friendbot did not fund .* after 3 attempts \(HTTP 502\)/);
    expect(down).toHaveBeenCalledTimes(3);
  });
});

describe("trustUsdc", () => {
  const account = Keypair.random();
  const ledger = (sent: ReturnType<TransactionBuilder["build"]>[]): Ledger => ({
    loadAccount: async (address) => new Account(address, "1"),
    submitTransaction: async (tx) => {
      sent.push(tx);
      return { hash: "abc" };
    },
  });

  it("adds the trustline, signed by the account", async () => {
    const sent: ReturnType<TransactionBuilder["build"]>[] = [];
    expect(await trustUsdc(ledger(sent), account)).toBe("abc");
    const tx = TransactionBuilder.fromXDR(sent[0].toXDR(), Networks.TESTNET) as ReturnType<TransactionBuilder["build"]>;
    expect(tx.operations.map((op) => op.type)).toEqual(["changeTrust"]);
    expect(tx.signatures).toHaveLength(1);
  });

  it("buys USDC with XLM in the same transaction", async () => {
    const sent: ReturnType<TransactionBuilder["build"]>[] = [];
    await trustUsdc(ledger(sent), account, "0.2");
    expect(sent[0].operations.map((op) => op.type)).toEqual(["changeTrust", "pathPaymentStrictReceive"]);
    expect(sent[0].operations[1]).toMatchObject({ destAmount: "0.2000000", destination: account.publicKey() });
  });
});

describe("helpers", () => {
  it("buys twice the quote plus 0.1 USDC", () => {
    expect(usdcToBuy("481326")).toBe("0.1962652");
    expect(usdcToBuy(45_000_000n)).toBe("9.1");
    expect(usdcToBuy("0")).toBe("0.1");
  });

  it("gives the buyer 5% over the price, rounded up", () => {
    expect(buyerLimit("50 CLP")).toBe("52.5 CLP");
    expect(buyerLimit("1.20 EUR")).toBe("1.26 EUR");
    expect(buyerLimit("0.015 UF")).toBe("0.016 CLF");
  });

  it("links to stellar.expert on testnet", () => {
    expect(explorer("ab")).toBe("https://stellar.expert/explorer/testnet/tx/ab");
  });

  it("step logs ok, or FAIL and the step name in the error", async () => {
    const lines: string[] = [];
    expect(await step("one", async () => 1, (line) => lines.push(line))).toBe(1);
    await expect(step("two", async () => Promise.reject(new Error("boom")), (line) => lines.push(line))).rejects.toThrow("two: boom");
    expect(lines).toEqual(["ok    one", "FAIL  two"]);
  });

  it("waitFor402 waits through errors and gives up with the last answer", async () => {
    const answers = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValueOnce(new Response("", { status: 402 }));
    await waitFor402("http://x/hello", 5_000, answers as unknown as typeof fetch);
    expect(answers).toHaveBeenCalledTimes(2);
    const free = vi.fn(async () => new Response("", { status: 200 }));
    await expect(waitFor402("http://x/hello", 50, free as unknown as typeof fetch)).rejects.toThrow(/did not answer 402 .*HTTP 200/);
  });
});

describe("main --no-install", () => {
  it("funds the three accounts, adds the seller trustline and writes the app, with the secrets only in .env", async () => {
    const { mkdtempSync, readdirSync, readFileSync: read } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { main } = await import("../src/main.js");
    const dir = join(mkdtempSync(join(tmpdir(), "create-local402-")), "shop");
    const funded: string[] = [];
    const sent: ReturnType<TransactionBuilder["build"]>[] = [];
    const ledger: Ledger = { loadAccount: async (a) => new Account(a, "1"), submitTransaction: async (tx) => (sent.push(tx), { hash: "cd" }) };
    vi.spyOn(console, "log").mockImplementation(() => {});
    await main([dir, "--price", "1.20 eur", "--no-install"], { ledger, fund: async (a) => void funded.push(a), interactive: false });
    expect(new Set(funded).size).toBe(3);
    expect(sent).toHaveLength(1);
    expect(readdirSync(dir).sort()).toEqual([".env", ".gitignore", "README.md", "package.json", "server.ts"]);
    expect(read(join(dir, "server.ts"), "utf8")).toContain('const PRICE = "1.20 EUR";');
    await expect(main([dir, "--no-install"], { ledger, fund: async () => {}, interactive: false })).rejects.toThrow(/already exists and is not empty/);
    vi.restoreAllMocks();
  });

  it("installs, starts, quotes, buys USDC and pays with USDC and XLM, stopping the app at the end", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { main } = await import("../src/main.js");
    const dir = join(mkdtempSync(join(tmpdir(), "create-local402-")), "app");
    const sent: ReturnType<TransactionBuilder["build"]>[] = [];
    const ledger: Ledger = { loadAccount: async (a) => new Account(a, "1"), submitTransaction: async (tx) => (sent.push(tx), { hash: "ef" }) };
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    vi.stubGlobal("fetch", async () => new Response("", { status: 402 }));
    const events: string[] = [];
    const paid = { transaction: "ab".repeat(32), explorerUrl: explorer("ab".repeat(32)) };
    await main([dir], {
      ledger,
      fund: async () => {},
      interactive: false,
      install: () => void events.push("install"),
      startApp: () => (events.push("start"), { output: () => "", stop: () => void events.push("stop") }),
      buyer: (payWith) => ({ quote: async () => ({ amount: "527043" }), pay: async () => (events.push(`pay ${payWith}`), paid) }) as never,
    });
    expect(events).toEqual(["install", "start", "pay USDC", "pay XLM", "stop"]);
    expect(sent[1].operations[1]).toMatchObject({ destAmount: "0.2054086" });
    expect(lines).toContain("      0.0527043 USDC");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
