# local402-mcp

MCP server that lets an AI agent find, quote and pay x402 APIs priced in local currency on Stellar. The
agent spends within limits you set in your own currency, such as `2000 CLP/day` or `5000 NGN/payment`.
They are converted with the same Reflector oracle rate the seller prices with, and they survive restarts.

It runs on testnet unless you ask for mainnet by name.

## Tools

| Tool | What it does |
| --- | --- |
| `local402_discover` | Lists paid resources in the Local402 facilitator's x402 Bazaar. Filters by the currency a resource is priced in and by a maximum price in any currency. |
| `local402_quote` | Shows a resource's price in local currency and USDC, and whether your limits allow it. It does not pay. |
| `local402_pay` | Fetches a resource and pays its 402 with USDC, or with XLM or EURC swapped to USDC in the same transaction. Returns the body, the receipt and the transaction link. |
| `local402_history` | Lists past payments, newest first, with the local price, the USDC paid and the transaction link, plus how much of each limit is spent. |
| `local402_wallet` | Shows the paying address, its balances, the limits and where the history is kept. |

## Setup

Create a testnet identity with [stellar-cli](https://developers.stellar.org/docs/tools/cli) and fund it:

```sh
stellar keys generate local402-agent --network testnet --fund
```

The server reads the secret from that identity, so it never appears in a config file. `STELLAR_PRIVATE_KEY`
works too.

### Claude Code

```sh
claude mcp add local402 -e STELLAR_IDENTITY=local402-agent -e PAY_WITH=XLM -- npx -y local402-mcp
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "local402": {
      "command": "npx",
      "args": ["-y", "local402-mcp"],
      "env": { "STELLAR_IDENTITY": "local402-agent", "PAY_WITH": "XLM" }
    }
  }
}
```

### Cursor

The same block goes in `~/.cursor/mcp.json`, or in `.cursor/mcp.json` for one project.

On Windows, if the host cannot start `npx`, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "local402-mcp"]`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `STELLAR_IDENTITY` or `STELLAR_PRIVATE_KEY` | required | The paying account. |
| `NETWORK` | `stellar:testnet` | `stellar:pubnet` is mainnet. Any other value is an error, so a typo never moves real money. |
| `PAY_WITH` | `USDC` | `USDC`, `XLM` or `EURC`. XLM and EURC are swapped to USDC by the FxPay contract. |
| `LIMITS` | `500 CLP/payment, 2000 CLP/day, 5000 CLP/total` | Comma-separated limits, each in any supported currency, e.g. `5000 NGN/payment, 20 EUR/day`. Periods left out keep their default. |
| `LOCAL402_HISTORY` | `~/.local402/history-<network>-<address>.jsonl` | The payment history the daily and total limits are counted from. |
| `FACILITATOR_URL` | the public Local402 facilitator for `NETWORK` | Where `local402_discover` reads the Bazaar catalog. |
| `FX_CONTRACT`, `HORIZON_URL` | the network's defaults | Overrides for the FxPay contract and Horizon. |

`MAX_PRICE` and `BUDGET` from 0.1 still work, as the per-payment and total limits.

A day starts at local midnight. Testnet and mainnet keep separate histories, so testnet payments never count
against a mainnet limit.
