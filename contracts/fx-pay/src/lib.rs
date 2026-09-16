#![no_std]
//! FxPay: settles an x402 payment in the seller's asset while the payer spends a different one.
//!
//! The payer signs `pay` plus one deterministic transfer of `max_send` into this contract.
//! The contract swaps on Soroswap for exactly `dest_amount` (directly or through a hub asset),
//! delivers it to `pay_to`, and refunds whatever part of `max_send` the swap did not use.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractevent, contractimpl, panic_with_error, symbol_short,
    token::TokenClient, vec, Address, Env, IntoVal, Symbol, Vec,
};

#[contractclient(name = "SoroswapRouterClient")]
pub trait SoroswapRouter {
    fn router_get_amounts_in(e: Env, amount_out: i128, path: Vec<Address>) -> Vec<i128>;
    fn router_pair_for(e: Env, token_a: Address, token_b: Address) -> Address;
    fn swap_tokens_for_exact_tokens(
        e: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    SameAsset = 2,
    ExcessiveInput = 3,
    NoRoute = 4,
}

#[contractevent]
pub struct FxPaid {
    #[topic]
    pub pay_to: Address,
    #[topic]
    pub from: Address,
    pub send_asset: Address,
    pub amount_in: i128,
    pub dest_asset: Address,
    pub amount_out: i128,
}

const ROUTER: Symbol = symbol_short!("ROUTER");
const HUB: Symbol = symbol_short!("HUB");

#[contract]
pub struct FxPay;

impl FxPay {
    /// Cheapest Soroswap path from `send_asset` to `dest_amount` of `dest_asset`: the direct pool
    /// or a hop through the hub asset (XLM), so assets without a pool against the seller's still pay.
    fn route(env: &Env, send_asset: &Address, dest_asset: &Address, dest_amount: i128) -> (Vec<Address>, i128) {
        let router = SoroswapRouterClient::new(env, &Self::router(env.clone()));
        let hub = Self::hub(env.clone());
        let mut candidates = vec![env, vec![env, send_asset.clone(), dest_asset.clone()]];
        if hub != *send_asset && hub != *dest_asset {
            candidates.push_back(vec![env, send_asset.clone(), hub, dest_asset.clone()]);
        }
        let mut best: Option<(Vec<Address>, i128)> = None;
        for path in candidates.iter() {
            if let Ok(Ok(amounts)) = router.try_router_get_amounts_in(&dest_amount, &path) {
                // A router that answers without amounts has no route on this path. Skipping it lets
                // the other candidate win, or `NoRoute` below say so — an error the payer can read,
                // rather than a trap from inside the contract.
                if let Some(amount_in) = amounts.get(0) {
                    if best.as_ref().map_or(true, |(_, current)| amount_in < *current) {
                        best = Some((path, amount_in));
                    }
                }
            }
        }
        best.unwrap_or_else(|| panic_with_error!(env, Error::NoRoute))
    }
}

#[contractimpl]
impl FxPay {
    pub fn __constructor(env: Env, router: Address, hub: Address) {
        env.storage().instance().set(&ROUTER, &router);
        env.storage().instance().set(&HUB, &hub);
    }

    pub fn router(env: Env) -> Address {
        env.storage().instance().get(&ROUTER).unwrap()
    }

    /// Intermediate asset tried when it gives a cheaper route than the direct pool.
    pub fn hub(env: Env) -> Address {
        env.storage().instance().get(&HUB).unwrap()
    }

    /// Amount of `send_asset` a `pay` for `dest_amount` of `dest_asset` would currently spend.
    pub fn quote(env: Env, send_asset: Address, dest_asset: Address, dest_amount: i128) -> i128 {
        Self::route(&env, &send_asset, &dest_asset, dest_amount).1
    }

    /// Pays `dest_amount` of `dest_asset` to `pay_to`, spending at most `max_send` of `send_asset`.
    /// Returns the amount of `send_asset` actually spent.
    pub fn pay(
        env: Env,
        from: Address,
        send_asset: Address,
        max_send: i128,
        dest_asset: Address,
        dest_amount: i128,
        pay_to: Address,
        deadline: u64,
    ) -> i128 {
        from.require_auth();
        if max_send <= 0 || dest_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if send_asset == dest_asset {
            panic_with_error!(&env, Error::SameAsset);
        }

        let this = env.current_contract_address();
        let router = SoroswapRouterClient::new(&env, &Self::router(env.clone()));
        let (path, amount_in) = Self::route(&env, &send_asset, &dest_asset, dest_amount);
        if amount_in > max_send {
            panic_with_error!(&env, Error::ExcessiveInput);
        }

        let send = TokenClient::new(&env, &send_asset);
        send.transfer(&from, &this, &max_send);

        // The router pulls the input from `to` (this contract) into the path's first pool through a
        // nested token call, which the contract must authorize explicitly.
        let pair = router.router_pair_for(&send_asset, &path.get(1).unwrap());
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: send_asset.clone(),
                    fn_name: symbol_short!("transfer"),
                    args: (this.clone(), pair, amount_in).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);
        router.swap_tokens_for_exact_tokens(&dest_amount, &amount_in, &path, &this, &deadline);

        TokenClient::new(&env, &dest_asset).transfer(&this, &pay_to, &dest_amount);
        if max_send > amount_in {
            send.transfer(&this, &from, &(max_send - amount_in));
        }

        FxPaid { pay_to, from, send_asset, amount_in, dest_asset, amount_out: dest_amount }.publish(&env);
        amount_in
    }
}

#[cfg(test)]
mod test;
