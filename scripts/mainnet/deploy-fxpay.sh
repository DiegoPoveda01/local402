#!/usr/bin/env bash
# Deploys FxPay to Stellar mainnet, routing through the Soroswap mainnet router with XLM as the hub asset.
# Spends real XLM: about 7.4 XLM, almost all of it the wasm upload (September 2026). Run scripts/mainnet/setup.ts first.
# The wasm comes from the tagged GitHub release, not a local build: stellar.expert only reports a contract as
# verified when the deployed hash matches the artifact its release workflow produced.
# Usage: SOURCE=local402-mainnet scripts/mainnet/deploy-fxpay.sh
set -euo pipefail

SOURCE="${SOURCE:-local402-mainnet}"
# Mainnet Soroban transactions bidding the 100-stroop default often fail with TxInsufficientFee.
NET=(--rpc-url "${RPC_URL:-https://mainnet.sorobanrpc.com}" --network-passphrase "Public Global Stellar Network ; September 2015" --inclusion-fee "${INCLUSION_FEE:-50000}")

ROUTER=CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH
XLM=CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA

RELEASE="${RELEASE:-v0.1.1_contracts_fx-pay_cli27.0.0}"
WASM_SHA256=69a12d89059be04ac195f5acf40982d7e9ee93fd08f4df33626789d00ffccbd2
WASM="$(mktemp -t fx-pay-XXXXXX.wasm)"
trap 'rm -f "$WASM"' EXIT

curl -fsSL -o "$WASM" "https://github.com/DiegoPoveda01/local402/releases/download/$RELEASE/fx-pay_v0.1.1.wasm"
got="$(sha256sum "$WASM" | cut -d ' ' -f 1)"
if [ "$got" != "$WASM_SHA256" ]; then
  echo "Release wasm hash is $got, expected $WASM_SHA256 — refusing to deploy." >&2
  exit 1
fi

stellar contract deploy "${NET[@]}" --source-account "$SOURCE" \
  --wasm "$WASM" \
  -- --router "$ROUTER" --hub "$XLM"
