extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
};

/// Soroswap-like router with a fixed price: `price` units of path[0] per unit of path[1].
/// It acts as its own pair and holds the output liquidity.
#[contract]
struct MockRouter;

#[contractimpl]
impl MockRouter {
    pub fn __constructor(env: Env, price: i128) {
        env.storage().instance().set(&symbol_short!("PRICE"), &price);
    }

    pub fn router_get_amounts_in(env: Env, amount_out: i128, _path: Vec<Address>) -> Vec<i128> {
        let price: i128 = env.storage().instance().get(&symbol_short!("PRICE")).unwrap();
        vec![&env, amount_out * price, amount_out]
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
        TokenClient::new(&env, &path.get(1).unwrap()).transfer(&pair, &to, &amount_out);
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
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let xlm = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let usdc = env.register_stellar_asset_contract_v2(issuer).address();

    let router = env.register(MockRouter, (10_i128,));
    let fx = env.register(FxPay, (router.clone(),));

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
fn rejects_when_swap_needs_more_than_max_send() {
    let s = setup();
    authorize_payer(&s, 40, 5);

    let result = s.fx.try_pay(&s.payer, &s.xlm.address, &40, &s.usdc.address, &5, &s.seller, &100);

    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::ExcessiveInput as u32))));
    assert_eq!(s.xlm.balance(&s.payer), 1_000);
}

#[test]
fn rejects_same_asset() {
    let s = setup();
    let result = s.fx.try_pay(&s.payer, &s.usdc.address, &5, &s.usdc.address, &5, &s.seller, &100);
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::SameAsset as u32))));
}

#[test]
fn requires_payer_authorization() {
    let s = setup();
    s.env.mock_auths(&[]);
    let result = s.fx.try_pay(&s.payer, &s.xlm.address, &55, &s.usdc.address, &5, &s.seller, &100);
    assert!(result.is_err());
    assert_eq!(s.usdc.balance(&s.seller), 0);
}
