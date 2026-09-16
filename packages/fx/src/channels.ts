import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Hands each settlement its own facilitator account, so concurrent settlements never race for one
 * sequence number. Settlements queue while every account is busy.
 *
 * Schemes pick their signer through `select`, which returns the account reserved by the enclosing `run`.
 */
export class ChannelPool {
  private readonly busy = new Set<string>();
  private readonly waiters: ((address: string) => void)[] = [];
  private readonly slot = new AsyncLocalStorage<string>();
  // Separate server instances start at different accounts, making cross-instance collisions less likely.
  private next: number;

  constructor(
    readonly addresses: string[],
    private readonly maxQueued = 50,
  ) {
    if (!addresses.length) throw new Error("ChannelPool needs at least one account");
    this.next = Math.floor(Math.random() * addresses.length);
  }

  /** Runs `fn` with an account reserved for it. Throws when too many settlements are already waiting. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const address = await this.acquire();
    try {
      return await this.slot.run(address, fn);
    } finally {
      // Hand the account straight to the longest-waiting settlement instead of releasing it: freeing it
      // first would let a caller that arrives in the same tick take it and send that one to the back
      // of the queue again, which under sustained load starves it.
      const waiter = this.waiters.shift();
      if (waiter) waiter(address);
      else this.busy.delete(address);
    }
  }

  /** Signer selector for the schemes: the reserved account inside `run`, round-robin outside it. */
  readonly select = (addresses: readonly string[]): string =>
    this.slot.getStore() ?? addresses[this.next++ % addresses.length];

  private async acquire(): Promise<string> {
    for (let i = 0; i < this.addresses.length; i++) {
      const address = this.addresses[(this.next + i) % this.addresses.length];
      if (!this.busy.has(address)) {
        this.next += i + 1;
        this.busy.add(address);
        return address;
      }
    }
    if (this.waiters.length >= this.maxQueued) throw new Error("All facilitator accounts are busy");
    // The account arrives already reserved for this caller, so there is nothing to retry.
    return new Promise<string>((resolve) => this.waiters.push(resolve));
  }
}
