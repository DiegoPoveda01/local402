#!/usr/bin/env bash
# Deploys FxPay to Stellar mainnet, routing through the Soroswap mainnet router with XLM as the hub asset.
# Spends real XLM (a few cents: the wasm is ~5 KB). Run scripts/mainnet/setup.ts --check first.
# Usage: SOURCE=local402-mainnet scripts/mainnet/deploy-fxpay.sh
set -euo pipefail

SOURCE="${SOURCE:-local402-mainnet}"
NET=(--rpc-url "${RPC_URL:-https://mainnet.sorobanrpc.com}" --network-passphrase "Public Global Stellar Network ; September 2015")

ROUTER=CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH
XLM=CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA

cd "$(dirname "$0")/../../contracts"
stellar contract build
stellar contract deploy "${NET[@]}" --source-account "$SOURCE" \
  --wasm target/wasm32v1-none/release/fx_pay.wasm \
  -- --router "$ROUTER" --hub "$XLM"
