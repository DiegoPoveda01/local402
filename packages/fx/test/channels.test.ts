import { describe, expect, it } from "vitest";
import { ChannelPool } from "../src/index.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("ChannelPool", () => {
  it("gives concurrent settlements different accounts and queues the rest", async () => {
    const pool = new ChannelPool(["A", "B"]);
    const used: string[] = [];
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        pool.run(async () => {
          used.push(pool.select(["A", "B"]));
          peak = Math.max(peak, ++active);
          await tick();
          active--;
        }),
      ),
    );
    expect(used).toHaveLength(5);
    expect(peak).toBe(2);
  });

  it("never hands the same account to two running settlements", async () => {
    const pool = new ChannelPool(["A", "B", "C"]);
    const running = new Set<string>();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.run(async () => {
          const account = pool.select([]);
          expect(running.has(account)).toBe(false);
          running.add(account);
          await tick();
          running.delete(account);
        }),
      ),
    );
  });

  it("refuses work beyond the queue limit", async () => {
    const pool = new ChannelPool(["A"], 1);
    const slow = pool.run(tick);
    const queued = pool.run(tick);
    await expect(pool.run(tick)).rejects.toThrow(/busy/);
    await Promise.all([slow, queued]);
  });
});
