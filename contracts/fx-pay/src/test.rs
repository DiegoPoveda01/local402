extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
};

/// Soroswap-like router with fixed prices: `price` units of the input per unit of output on the
/// direct pool (0 means there is no direct pool, a negative one answers with no amounts at all) and
/// `hub_price` through a hub hop. It acts as its own pair and holds the output liquidity.
#[contract]
struct MockRouter;

#[contractimpl]
impl MockRouter {
    pub fn __constructor(env: Env, price: i128, hub_price: i128) {
        env.storage().instance().set(&symbol_short!("PRICE"), &price);
        env.storage().instance().set(&symbol_short!("HUBPRICE"), &hub_price);
    }

    pub fn router_get_amounts_in(env: Env, amount_out: i128, path: Vec<Address>) -> Vec<i128> {
        let key = if path.len() == 2 { symbol_short!("PRICE") } else { symbol_short!("HUBPRICE") };
        let price: i128 = env.storage().instance().get(&key).unwrap();
        if price == 0 {
            panic!("no pool");
        }
        if price < 0 {
            return vec![&env];
        }
        let mut amounts = vec![&env, amount_out * price];
        for _ in 1..path.len() {
            amounts.push_back(amount_out);
        }
        amounts
    }

    pub fn router_pair_for(env: Env, _token_a: Address, _token_b: Address) -> Address {
        env.current_contract_address()
    }

    pub fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        _deadline: u64,
    ) -> Vec<i128> {
        to.require_auth();
        let amounts = Self::router_get_amounts_in(env.clone(), amount_out, path.clone());
        assert!(amounts.get(0).unwrap() <= amount_in_max);
        let pair = env.current_contract_address();
        TokenClient::new(&env, &path.get(0).unwrap()).transfer(&to, &pair, &amounts.get(0).unwrap());
        TokenClient::new(&env, &path.last().unwrap()).transfer(&pair, &to, &amount_out);
        amounts
    }
}

struct Setup {
    env: Env,
    fx: FxPayClient<'static>,
    router: Address,
    xlm: TokenClient<'static>,
    usdc: TokenClient<'static>,
    payer: Address,
    seller: Address,
}

fn setup() -> Setup {
    setup_with_prices(10, 20)
}

fn setup_with_prices(price: i128, hub_price: i128) -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let xlm = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let usdc = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let hub = env.register_stellar_asset_contract_v2(issuer).address();

    let router = env.register(MockRouter, (price, hub_price));
    let fx = env.register(FxPay, (router.clone(), hub));

    let payer = Address::generate(&env);
    let seller = Address::generate(&env);
    StellarAssetClient::new(&env, &xlm).mint(&payer, &1_000);
    StellarAssetClient::new(&env, &usdc).mint(&router, &1_000);

    Setup {
        fx: FxPayClient::new(&env, &fx),
        xlm: TokenClient::new(&env, &xlm),
        usdc: TokenClient::new(&env, &usdc),
        router,
        payer,
        seller,
        env,
    }
}

/// Authorizes exactly what an x402 client signs: `pay` and the transfer of `max_send` into FxPay.
fn authorize_payer(s: &Setup, max_send: i128, dest_amount: i128) {
    let fx = s.fx.address.clone();
    s.env.mock_auths(&[MockAuth {
        address: &s.payer,
        invoke: &MockAuthInvoke {
            contract: &fx,
            fn_name: "pay",
            args: (
                s.payer.clone(),
                s.xlm.address.clone(),
                max_send,
                s.usdc.address.clone(),
                dest_amount,
                s.seller.clone(),
                100_u64,
            )
                .into_val(&s.env),
            sub_invokes: &[MockAuthInvoke {
                contract: &s.xlm.address,
                fn_name: "transfer",
                args: (s.payer.clone(), fx.clone(), max_send).into_val(&s.env),
                sub_invokes: &[],
            }],
        },
    }]);
}

#[test]
fn delivers_exact_amount_and_refunds_unused_input() {
    let s = setup();
    authorize_payer(&s, 55, 5);

    let spent = s.fx.pay(&s.payer, &s.xlm.address, &55, &s.usdc.address, &5, &s.seller, &100);

    assert_eq!(spent, 50);
    assert_eq!(s.usdc.balance(&s.seller), 5);
    assert_eq!(s.xlm.balance(&s.payer), 950);
    assert_eq!(s.xlm.balance(&s.router), 50);
    assert_eq!(s.xlm.balance(&s.fx.address), 0);
    assert_eq!(s.usdc.balance(&s.fx.address), 0);
}

#[test]
fn quote_matches_amount_spent() {
    let s = setup();
    assert_eq!(s.fx.quote(&s.xlm.address, &s.usdc.address, &5), 50);
}

#[test]
fn rejects_when_swap_needs_more_than_max_send() {
    let s = setup();
    authorize_payer(&s, 40, 5);

    let result = s.fx.try_pay(&s.payer, &s.xlm.address, &40, &s.usdc.address, &5, &s.seller, &100);

    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::ExcessiveInput as u32))));
    assert_eq!(s.xlm.balance(&s.payer), 1_000);
}

#[test]
fn routes_through_hub_when_there_is_no_direct_pool() {
    let s = setup_with_prices(0, 12);
    assert_eq!(s.fx.quote(&s.xlm.address, &s.usdc.address, &5), 60);
    authorize_payer(&s, 66, 5);

    let spent = s.fx.pay(&s.payer, &s.xlm.address, &66, &s.usdc.address, &5, &s.seller, &100);

    assert_eq!(spent, 60);
    assert_eq!(s.usdc.balance(&s.seller), 5);
    assert_eq!(s.xlm.balance(&s.payer), 940);
    assert_eq!(s.xlm.balance(&s.fx.address), 0);
}

#[test]
fn picks_the_cheaper_route() {
    let s = setup_with_prices(10, 8);
    assert_eq!(s.fx.quote(&s.xlm.address, &s.usdc.address, &5), 40);
}

#[test]
fn rejects_when_no_route_exists() {
    let s = setup_with_prices(0, 0);
    let result = s.fx.try_quote(&s.xlm.address, &s.usdc.address, &5);
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::NoRoute as u32))));
}

#[test]
fn rejects_a_router_that_answers_with_no_amounts() {
    let s = setup_with_prices(-1, -1);
    let result = s.fx.try_quote(&s.xlm.address, &s.usdc.address, &5);
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::NoRoute as u32))));
}

/// The direct pool answering with nothing must not hide a hub route that does exist.
#[test]
fn falls_back_to_the_hub_when_the_direct_pool_answers_with_no_amounts() {
    let s = setup_with_prices(-1, 12);
    assert_eq!(s.fx.quote(&s.xlm.address, &s.usdc.address, &5), 60);
}

#[test]
fn rejects_same_asset() {
    let s = setup();
    let result = s.fx.try_pay(&s.payer, &s.usdc.address, &5, &s.usdc.address, &5, &s.seller, &100);
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::SameAsset as u32))));
}

/// The invariants of `pay` over a deterministic spread of pools, amounts and limits: the seller gets
/// exactly `dest_amount`, the payer spends exactly the cheaper route, FxPay keeps nothing, and a
/// `max_send` below that route moves nothing at all.
#[test]
fn invariants_hold_across_prices_amounts_and_limits() {
    let mut seed: u64 = 402;
    let mut next = |bound: i128| -> i128 {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) as i128 % bound
    };
    for _ in 0..200 {
        // A price of 0 means that pool does not exist. Amounts stay within the payer's 1 000.
        let (price, hub_price) = (next(21), next(21));
        let dest_amount = next(45) + 1;
        let slack = next(14) - 3;
        let s = setup_with_prices(price, hub_price);

        let Some(cost) = [price, hub_price].into_iter().filter(|p| *p > 0).map(|p| p * dest_amount).min() else {
            let result = s.fx.try_quote(&s.xlm.address, &s.usdc.address, &dest_amount);
            assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::NoRoute as u32))));
            continue;
        };
        let max_send = cost + slack;
        authorize_payer(&s, max_send, dest_amount);
        let result = s.fx.try_pay(&s.payer, &s.xlm.address, &max_send, &s.usdc.address, &dest_amount, &s.seller, &100);

        let expected_error = if max_send <= 0 {
            Some(Error::InvalidAmount)
        } else if slack < 0 {
            Some(Error::ExcessiveInput)
        } else {
            None
        };
        match expected_error {
            Some(error) => {
                assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(error as u32))));
                assert_eq!(s.xlm.balance(&s.payer), 1_000);
                assert_eq!(s.usdc.balance(&s.seller), 0);
            }
            None => {
                assert_eq!(result, Ok(Ok(cost)));
                assert_eq!(s.usdc.balance(&s.seller), dest_amount);
                assert_eq!(s.xlm.balance(&s.payer), 1_000 - cost);
            }
        }
        assert_eq!(s.xlm.balance(&s.fx.address), 0);
        assert_eq!(s.usdc.balance(&s.fx.address), 0);
    }
}

#[test]
fn requires_payer_authorization() {
    let s = setup();
    s.env.mock_auths(&[]);
    let result = s.fx.try_pay(&s.payer, &s.xlm.address, &55, &s.usdc.address, &5, &s.seller, &100);
    assert!(result.is_err());
    assert_eq!(s.usdc.balance(&s.seller), 0);
}
