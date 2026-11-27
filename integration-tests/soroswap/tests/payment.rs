use kanatoko::soroban_sdk::{
    testutils::{Events, MockAuthInvoke},
    token::TokenClient,
    xdr, Address, Env, FromVal, IntoVal, Symbol, TryFromVal, Val,
};
use kanatoko::{mainnet, ScenarioFork};

mod support;

const ROUTER: &str = "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH";
const XLM: &str = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const USDC: &str = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const UNIT: i128 = 10_000_000;
const FX_PAY_WASM: &[u8] = include_bytes!("../target/wasm32v1-none/release/fx_pay.wasm");

struct Invoice {
    payer: Address,
    seller: Address,
    fx: Address,
    xlm: Address,
    usdc: Address,
    pair: Address,
    deadline: u64,
}

impl Invoice {
    fn setup(fork: &ScenarioFork<'_>) -> Self {
        fork.mock_all_auths(); // Only for local funding and the seller's trustline.
        let router = fork.contract(ROUTER);
        let xlm = fork.contract(XLM);
        let usdc = fork.contract(USDC);
        let pair = fork.invoke(&router, "router_pair_for", (&xlm, &usdc));
        let fx = fork.deploy(FX_PAY_WASM, (&router, &xlm));
        let payer = fork.local_account("local402-payer");
        let seller = fork.local_account("local402-seller");
        fork.fund_local_account(&payer, 1_000_000_000);
        fork.fund_local_account(&seller, 100_000_000);
        fork.invoke::<()>(&usdc, "trust", (&seller,));
        fork.invoke::<()>(&usdc, "set_authorized", (&seller, true));
        Self {
            payer,
            seller,
            fx,
            xlm,
            usdc,
            pair,
            deadline: fork.env().ledger().timestamp() + 300,
        }
    }

    fn balances(&self, env: &Env) -> Balances {
        let xlm = TokenClient::new(env, &self.xlm);
        let usdc = TokenClient::new(env, &self.usdc);
        Balances {
            payer_xlm: xlm.balance(&self.payer),
            seller_usdc: usdc.balance(&self.seller),
            fx_xlm: xlm.balance(&self.fx),
            fx_usdc: usdc.balance(&self.fx),
            pair_xlm: xlm.balance(&self.pair),
            pair_usdc: usdc.balance(&self.pair),
        }
    }

    fn pay(
        &self,
        fork: &ScenarioFork<'_>,
        limit: i128,
    ) -> Result<i128, kanatoko::InvocationFailure> {
        let env = fork.env();
        let args = (
            &self.payer,
            &self.xlm,
            limit,
            &self.usdc,
            UNIT,
            &self.seller,
            self.deadline,
        );
        // Enforce the payer's exact pay + transfer tree on the local Host.
        let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&self.payer) else {
            unreachable!()
        };
        env.host().set_source_account(account).unwrap();
        env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: MockAuthInvoke {
                contract: &self.fx,
                fn_name: "pay",
                args: args.into_val(env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &self.xlm,
                    fn_name: "transfer",
                    args: (&self.payer, &self.fx, limit).into_val(env),
                    sub_invokes: &[],
                }],
            }
            .into(),
        }]);
        fork.try_invoke(&self.fx, "pay", args)
    }
}

#[derive(Debug, PartialEq)]
struct Balances {
    payer_xlm: i128,
    seller_usdc: i128,
    fx_xlm: i128,
    fx_usdc: i128,
    pair_xlm: i128,
    pair_usdc: i128,
}

fn transfers(env: &Env, token: &Address) -> Vec<(Address, Address, i128)> {
    let val = |sc: &xdr::ScVal| Val::try_from_val(env, sc).unwrap();
    env.events()
        .all()
        .filter_by_contract(token)
        .events()
        .iter()
        .filter_map(|event| {
            let xdr::ContractEventBody::V0(body) = &event.body;
            let topics = body.topics.as_slice();
            if Symbol::from_val(env, &val(&topics[0])) != Symbol::new(env, "transfer") {
                return None;
            }
            Some((
                Address::from_val(env, &val(&topics[1])),
                Address::from_val(env, &val(&topics[2])),
                i128::from_val(env, &val(&body.data)),
            ))
        })
        .collect()
}

fn check_invoice(fork: &ScenarioFork<'_>) {
    let p = Invoice::setup(fork);
    let quote: i128 = fork.invoke(&p.fx, "quote", (&p.xlm, &p.usdc, UNIT));
    assert!(quote > 1);
    let before = p.balances(fork.env());
    assert_eq!((before.fx_xlm, before.fx_usdc), (0, 0));

    let failure = p.pay(fork, quote - 1).unwrap_err();
    assert_eq!(failure.error, Some(xdr::ScError::Contract(3))); // FxPay::ExcessiveInput
    assert_eq!(p.balances(fork.env()), before);

    let limit = quote + UNIT;
    let spent = p.pay(fork, limit).unwrap();
    assert_eq!(spent, quote);
    let xlm_transfers = transfers(fork.env(), &p.xlm);
    assert_eq!(
        xlm_transfers,
        [
            (p.payer.clone(), p.fx.clone(), limit),
            (p.fx.clone(), p.pair.clone(), spent),
            (p.fx.clone(), p.payer.clone(), limit - spent),
        ]
    );
    assert_eq!(
        transfers(fork.env(), &p.usdc),
        [
            (p.pair.clone(), p.fx.clone(), UNIT),
            (p.fx.clone(), p.seller.clone(), UNIT),
        ]
    );
    let after = p.balances(fork.env());
    assert_eq!(
        after,
        Balances {
            payer_xlm: before.payer_xlm - spent,
            seller_usdc: before.seller_usdc + UNIT,
            fx_xlm: 0,
            fx_usdc: 0,
            pair_xlm: before.pair_xlm + spent,
            pair_usdc: before.pair_usdc - UNIT,
        }
    );
    println!(
        "XLM (stroops): quote={quote} low_limit={} max_send={limit} net_debit={} refund={}",
        quote - 1,
        before.payer_xlm - after.payer_xlm,
        xlm_transfers[2].2
    );
    println!(
        "seller_credit={} USDC base units; FxPay remaining: {} XLM / {} USDC base units",
        after.seller_usdc - before.seller_usdc,
        after.fx_xlm,
        after.fx_usdc
    );
}

#[test]
fn a_one_usdc_invoice_checks_the_spend_limit_and_returns_change() {
    let snapshot = support::soroswap_snapshot();
    mainnet()
        .cache(snapshot.path())
        .offline()
        .run(check_invoice)
        .unwrap();
}
