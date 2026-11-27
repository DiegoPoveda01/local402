# Paying a 1 USDC invoice with XLM

How much does the buyer spend if their limit is 1 XLM above FxPay’s quote? This test builds FxPay from this checkout and uses [Kanatoko](https://crates.io/crates/kanatoko) to run `quote` and `pay` against the Soroswap XLM/USDC pool at Stellar Protocol 30 mainnet ledger **65,646,122**. FxPay quoted **7.8542879 XLM** for 1 USDC.

| Same invoice and starting balances | Buyer’s limit | Net spend | Refund | Seller received |
| --- | ---: | ---: | ---: | ---: |
| One stroop below the quote | 7.8542878 XLM | 0 XLM | — | 0 USDC |
| One XLM above the quote | 8.8542879 XLM | 7.8542879 XLM | 1 XLM | 1 USDC |

At the lower limit, FxPay returns `ExcessiveInput` and the buyer, seller, FxPay and pool balances stay put. At the higher limit, the XLM transfer events show the buyer paying FxPay the full 8.8542879 XLM, FxPay sending 7.8542879 XLM to the pool, and 1 XLM going back to the buyer. The USDC transfer events show 1 USDC passing from the pool through FxPay to the seller. FxPay finishes with zero of either asset. [Read the payment assertions](tests/payment.rs#L135).

The buyer and seller are funded locally and the seller has a USDC trustline. The local host authorizes the buyer’s `pay` call and its single transfer of the spending limit. Wallet signing, facilitator settlement over HTTP and network fees are outside this contract test.

## Replay locally

Use Rust 1.95.0 with the `wasm32v1-none` target and Stellar CLI. From the repository root, build FxPay and fetch the test dependencies once.

```sh
cargo +1.95.0 build --locked --release --target wasm32v1-none --manifest-path contracts/fx-pay/Cargo.toml --target-dir integration-tests/soroswap/target
cd integration-tests/soroswap
cargo +1.95.0 fetch --locked
```

The [ledger snapshot](fixtures/soroswap.json) stores balances, reserves and three contract code hashes. Fetch those binaries from a public mainnet RPC once. The [fixture reader](tests/support/mod.rs) checks each SHA-256 before restoring the code to the snapshot.

```sh
export STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
export STELLAR_NETWORK_PASSPHRASE='Public Global Stellar Network ; September 2015'
stellar contract fetch --wasm-hash 18051456816b66f12e773a56f77c5794fac1b1fb7ab6e22d4fad5a412770f73e --out-file target/18051456816b66f12e773a56f77c5794fac1b1fb7ab6e22d4fad5a412770f73e.wasm
stellar contract fetch --wasm-hash 4c3db3ebd2d6a2ab23de1f622eaabb39501539b4611b68622ec4e47f76c4ba07 --out-file target/4c3db3ebd2d6a2ab23de1f622eaabb39501539b4611b68622ec4e47f76c4ba07.wasm
stellar contract fetch --wasm-hash aba81900bc82d24a6f5b66a6fee775bc51543f91dc89e824bd96ffcf3879dba1 --out-file target/aba81900bc82d24a6f5b66a6fee775bc51543f91dc89e824bd96ffcf3879dba1.wasm
```

Both payment attempts now run offline in one test.

```sh
cargo +1.95.0 test --locked --offline --test payment -- --nocapture
```
