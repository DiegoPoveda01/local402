#!/usr/bin/env bash
# Keeps every testnet contract on the payment path alive: FxPay (instance + code), the token SACs,
# and the Soroswap router, factory and pairs it routes through. Anyone can pay for a TTL extension.
# Usage: SOURCE=local402-facilitator scripts/extend-ttl.sh
set -euo pipefail

SOURCE="${SOURCE:-local402-facilitator}"
LEDGERS="${LEDGERS:-2000000}" # ~115 days at 5 s per ledger
NET=(--network testnet)

FXPAY=CD6PUDBJNDYWLTQPHYU26OCEH4GWR7WN3UIXAEKUP3DQIS3DKJQIF7DL
XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
USDC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
EURC=CDHCVLBJWUA62CYRTTG46MBTPTXQ4VHKPTUTG6UNUPN4OTMK3FFJ77CE
ROUTER=CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD
FACTORY=CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY

pair() {
  stellar contract invoke "${NET[@]}" --id "$FACTORY" --source-account "$SOURCE" --send no -- get_pair --token_a "$1" --token_b "$2" | tr -d '"'
}

extend() {
  printf '%-10s %s -> ledger ' "$1" "$2"
  stellar contract extend "${NET[@]}" --id "$2" --ledgers-to-extend "$LEDGERS" --source-account "$SOURCE" --ttl-ledger-only 2>/dev/null | tail -1
}

# Wasm contracts also keep their code in a separate entry with its own TTL.
extend_code() {
  local wasm
  wasm="$(mktemp)"
  stellar contract fetch "${NET[@]}" --id "$2" -o "$wasm"
  printf '%-10s code -> ledger ' "$1"
  stellar contract extend "${NET[@]}" --wasm "$wasm" --ledgers-to-extend "$LEDGERS" --source-account "$SOURCE" --ttl-ledger-only 2>/dev/null | tail -1
  rm -f "$wasm"
}

XLM_USDC="$(pair "$XLM" "$USDC")"
EURC_XLM="$(pair "$EURC" "$XLM")"

extend fxpay "$FXPAY"
extend xlm "$XLM"
extend usdc "$USDC"
extend eurc "$EURC"
extend router "$ROUTER"
extend factory "$FACTORY"
extend xlm-usdc "$XLM_USDC"
extend eurc-xlm "$EURC_XLM"

extend_code fxpay "$FXPAY"
extend_code router "$ROUTER"
extend_code factory "$FACTORY"
extend_code pair "$XLM_USDC" # both pairs share the pair wasm
