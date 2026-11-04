use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::{PromiseResult, testing_env};

const WALLET: &str = "wallet.near";
const OWNER: &str = "owner.near";
const AGENT: &str = "agent.near";
const CHECKER: &str = "sentinel.near";
const VOUCH: &str = "vouch.near";
const SHOP: &str = "shop.near";
const OTHER: &str = "other-agent.near";

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn milli(n: u128) -> NearToken {
    NearToken::from_millinear(n)
}

fn context(who: &str, deposit: NearToken, now: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(WALLET.parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .signer_account_id(who.parse().unwrap())
        .attached_deposit(deposit)
        .account_balance(near(10))
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn as_(who: &str, deposit: NearToken, now: u64) {
    testing_env!(context(who, deposit, now).build());
}

fn policy() -> Policy {
    Policy {
        vouch: VOUCH.parse().unwrap(),
        checker: CHECKER.parse().unwrap(),
        per_payment: near(1),
        per_day: near(2),
        max_actions_per_hour: 5,
        destinations: Destinations::Any,
        first_payment_needs_owner: false,
        callable: vec![],
    }
}

fn wallet() -> Wallet {
    as_(WALLET, near(0), 0);
    Wallet::new(OWNER.parse().unwrap(), AGENT.parse().unwrap(), policy())
}

fn claim(agent: &str, subject: &str, verdict: Level, status: Status) -> Claim {
    Claim {
        id: U64(7),
        agent: agent.parse().unwrap(),
        subject: subject.parse().unwrap(),
        verdict,
        status,
        challenge_until: U64(1000),
        ruling: None,
    }
}

fn pay(c: &mut Wallet, amount: NearToken, now: u64) {
    as_(AGENT, near(0), now);
    c.pay(SHOP.parse().unwrap(), amount).detach();
}

fn transfer(amount: NearToken) -> Action {
    Action::Transfer {
        to: SHOP.parse().unwrap(),
        amount,
    }
}

/// `on_checked` running, with Vouch's two answers as raw JSON.
fn vouch_says(
    c: &mut Wallet,
    own: &str,
    reports: &str,
    action: Action,
    now: u64,
) -> Option<Outcome> {
    testing_env!(
        context(WALLET, near(0), now).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![
            PromiseResult::Successful(own.as_bytes().to_vec()),
            PromiseResult::Successful(reports.as_bytes().to_vec()),
        ]
    );
    let day = U64(c.day_start);
    match c.on_checked(action, day) {
        PromiseOrValue::Value(outcome) => Some(outcome),
        PromiseOrValue::Promise(p) => {
            p.detach();
            None
        }
    }
}

fn claim_json(verdict: &str, status: &str) -> String {
    format!(
        r#"{{"id":"7","agent":"{CHECKER}","subject":"{SHOP}","verdict":"{verdict}","status":"{status}","challenge_until":"1000","ruling":null,"reasons":["ignored"],"bond":"1"}}"#
    )
}

fn status_of(c: &Wallet) -> Value {
    c.get_status()
}

fn spent(c: &Wallet) -> String {
    status_of(c)["spent_today"].as_str().unwrap().to_string()
}

fn reserved(c: &Wallet) -> String {
    status_of(c)["reserved"].as_str().unwrap().to_string()
}

// ---- the rule ----

fn decide_on(own: Option<Claim>, reports: &[Claim]) -> Decision {
    decide(
        own.as_ref(),
        reports,
        &SHOP.parse().unwrap(),
        &policy(),
        true,
        10,
    )
}

#[test]
fn a_live_allow_pays() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    assert_eq!(decide_on(Some(own), &[]), Decision::Allow);
}

#[test]
fn no_call_means_no_payment() {
    assert!(matches!(decide_on(None, &[]), Decision::Refuse(_)));
}

#[test]
fn another_agents_allow_counts_for_nothing() {
    let own = claim(OTHER, SHOP, Level::Allow, Status::Open);
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn a_call_on_another_account_counts_for_nothing() {
    let own = claim(CHECKER, "elsewhere.near", Level::Allow, Status::Open);
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn a_block_refuses() {
    let own = claim(CHECKER, SHOP, Level::Block, Status::Open);
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn a_warn_asks_the_owner() {
    let own = claim(CHECKER, SHOP, Level::Warn, Status::Open);
    assert!(matches!(decide_on(Some(own), &[]), Decision::Ask(_)));
}

#[test]
fn a_disputed_allow_asks_the_owner() {
    for status in [Status::Challenged, Status::Appealed] {
        let own = claim(CHECKER, SHOP, Level::Allow, status);
        assert!(matches!(decide_on(Some(own), &[]), Decision::Ask(_)));
    }
}

#[test]
fn an_expired_call_refuses() {
    let mut own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    own.challenge_until = U64(10);
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn a_closed_call_refuses() {
    for status in [Status::Held, Status::Overturned, Status::Void] {
        let own = claim(CHECKER, SHOP, Level::Allow, status);
        assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
    }
}

#[test]
fn an_allow_already_ruled_wrong_refuses() {
    let mut own = claim(CHECKER, SHOP, Level::Allow, Status::Ruled);
    own.ruling = Some(RulingSeen {
        winner: Side::Challenger,
        appeal_until: U64(1000),
    });
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn an_allow_the_judge_upheld_pays() {
    let mut own = claim(CHECKER, SHOP, Level::Allow, Status::Ruled);
    own.ruling = Some(RulingSeen {
        winner: Side::Agent,
        appeal_until: U64(1000),
    });
    assert_eq!(decide_on(Some(own), &[]), Decision::Allow);
}

#[test]
fn a_report_with_its_bond_at_risk_beats_an_allow() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    let report = claim(OTHER, SHOP, Level::Block, Status::Open);
    assert!(matches!(
        decide_on(Some(own), &[report]),
        Decision::Refuse(_)
    ));
}

#[test]
fn a_closed_report_asks_the_owner_rather_than_blocking() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    let report = claim(OTHER, SHOP, Level::Block, Status::Held);
    assert!(matches!(decide_on(Some(own), &[report]), Decision::Ask(_)));
}

#[test]
fn a_closed_report_does_not_soften_a_block() {
    let own = claim(CHECKER, SHOP, Level::Block, Status::Open);
    let report = claim(OTHER, SHOP, Level::Block, Status::Held);
    assert!(matches!(
        decide_on(Some(own), &[report]),
        Decision::Refuse(_)
    ));
}

#[test]
fn an_upheld_allow_stops_paying_when_its_appeal_window_ends() {
    let mut own = claim(CHECKER, SHOP, Level::Allow, Status::Ruled);
    own.ruling = Some(RulingSeen {
        winner: Side::Agent,
        appeal_until: U64(10),
    });
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

#[test]
fn an_allow_ruled_wrong_refuses_while_it_is_appealed() {
    let mut own = claim(CHECKER, SHOP, Level::Allow, Status::Appealed);
    own.ruling = Some(RulingSeen {
        winner: Side::Challenger,
        appeal_until: U64(1000),
    });
    assert!(matches!(decide_on(Some(own), &[]), Decision::Refuse(_)));
}

fn first_payment_policy() -> Policy {
    Policy {
        first_payment_needs_owner: true,
        ..policy()
    }
}

#[test]
fn a_first_payment_asks_the_owner_even_on_an_allow() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    let decision = decide(
        Some(&own),
        &[],
        &SHOP.parse().unwrap(),
        &first_payment_policy(),
        false,
        10,
    );
    assert!(matches!(decision, Decision::Ask(_)));
}

#[test]
fn an_account_already_paid_goes_straight_through() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    let decision = decide(
        Some(&own),
        &[],
        &SHOP.parse().unwrap(),
        &first_payment_policy(),
        true,
        10,
    );
    assert_eq!(decision, Decision::Allow);
}

#[test]
fn paying_before_does_not_get_past_a_block() {
    let own = claim(CHECKER, SHOP, Level::Block, Status::Open);
    let decision = decide(
        Some(&own),
        &[],
        &SHOP.parse().unwrap(),
        &first_payment_policy(),
        true,
        10,
    );
    assert!(matches!(decision, Decision::Refuse(_)));
}

#[test]
fn a_report_on_another_account_is_ignored() {
    let own = claim(CHECKER, SHOP, Level::Allow, Status::Open);
    let report = claim(OTHER, "elsewhere.near", Level::Block, Status::Open);
    assert_eq!(decide_on(Some(own), &[report]), Decision::Allow);
}

// ---- only the agent spends, and only within limits ----

#[test]
fn the_agent_pays_and_the_budget_is_charged() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
    assert_eq!(reserved(&c), near(1).as_yoctonear().to_string());
}

#[test]
#[should_panic(expected = "Only the agent can spend")]
fn nobody_else_can_spend() {
    let mut c = wallet();
    as_(OTHER, near(0), 1);
    c.pay(SHOP.parse().unwrap(), near(1)).detach();
}

#[test]
#[should_panic(expected = "Only the agent can spend")]
fn not_even_the_owner_goes_through_the_agents_door() {
    let mut c = wallet();
    as_(OWNER, near(0), 1);
    c.pay(SHOP.parse().unwrap(), near(1)).detach();
}

#[test]
#[should_panic(expected = "over the limit on one payment")]
fn one_payment_has_a_limit() {
    let mut c = wallet();
    pay(&mut c, milli(1001), 1);
}

#[test]
#[should_panic(expected = "over the limit for today")]
fn a_day_has_a_limit() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    pay(&mut c, near(1), 2);
    pay(&mut c, milli(1), 3);
}

#[test]
fn the_daily_limit_resets() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    pay(&mut c, near(1), 2);
    pay(&mut c, near(1), DAY + 1);
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
}

#[test]
#[should_panic(expected = "over the limit on actions this hour")]
fn an_hour_has_a_limit() {
    let mut c = wallet();
    for now in 1..=6 {
        pay(&mut c, milli(1), now);
    }
}

#[test]
#[should_panic(expected = "doesn't have enough free")]
fn it_cannot_spend_what_it_does_not_have() {
    let mut c = wallet();
    let mut p = policy();
    p.per_payment = near(20);
    p.per_day = near(20);
    c.policy = p;
    pay(&mut c, near(11), 1);
}

#[test]
#[should_panic(expected = "Nothing to pay")]
fn an_empty_payment_is_refused() {
    let mut c = wallet();
    pay(&mut c, near(0), 1);
}

#[test]
#[should_panic(expected = "doesn't allow this receiver")]
fn an_empty_only_list_sends_nothing() {
    let mut c = wallet();
    c.policy.destinations = Destinations::Only(vec![]);
    pay(&mut c, near(1), 1);
}

#[test]
#[should_panic(expected = "doesn't allow this receiver")]
fn an_except_list_stops_its_accounts() {
    let mut c = wallet();
    c.policy.destinations = Destinations::Except(vec![SHOP.parse().unwrap()]);
    pay(&mut c, near(1), 1);
}

#[test]
#[should_panic(expected = "can't act on itself")]
fn the_agent_cannot_turn_the_wallet_on_itself() {
    let mut c = wallet();
    as_(AGENT, near(0), 1);
    c.pay(WALLET.parse().unwrap(), near(1)).detach();
}

// ---- calls ----

const METHOD: &str = "do_it";

fn listed() -> CallableMethod {
    CallableMethod {
        contract: SHOP.parse().unwrap(),
        method: METHOD.into(),
    }
}

#[test]
#[should_panic(expected = "hasn't allowed this call")]
fn a_listed_contract_does_not_open_its_other_methods() {
    let mut c = wallet();
    c.policy.callable = vec![listed()];
    as_(AGENT, near(0), 1);
    c.call(
        SHOP.parse().unwrap(),
        "ft_transfer".into(),
        Base64VecU8(vec![]),
        near(0),
        30,
    )
    .detach();
}

#[test]
#[should_panic(expected = "A method name must be 1 to 256 bytes")]
fn a_policy_cannot_list_a_method_near_would_refuse() {
    let mut c = wallet();
    let mut p = policy();
    p.callable = vec![CallableMethod {
        contract: SHOP.parse().unwrap(),
        method: String::new(),
    }];
    as_(OWNER, ONE, 1);
    c.set_policy(p);
}

#[test]
fn a_failed_call_stays_charged_for_the_day() {
    let mut c = wallet();
    c.policy.callable = vec![listed()];
    agent_call(&mut c, SHOP, near(1));
    let action = Action::Call {
        contract: SHOP.parse().unwrap(),
        method: METHOD.into(),
        args: Base64VecU8(vec![]),
        deposit: near(1),
        gas_tgas: 30,
    };
    testing_env!(
        context(WALLET, near(0), 3).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    let day = U64(c.day_start);
    assert!(matches!(c.on_done(action, day), Outcome::Failed { .. }));
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
    assert_eq!(reserved(&c), "0");
}

fn agent_call(c: &mut Wallet, contract: &str, deposit: NearToken) {
    as_(AGENT, near(0), 1);
    c.call(
        contract.parse().unwrap(),
        METHOD.into(),
        Base64VecU8(vec![]),
        deposit,
        30,
    )
    .detach();
}

#[test]
#[should_panic(expected = "hasn't allowed this call")]
fn calls_are_off_until_the_owner_lists_a_contract() {
    let mut c = wallet();
    agent_call(&mut c, SHOP, near(0));
}

#[test]
fn a_listed_contract_can_be_called_and_its_deposit_counts() {
    let mut c = wallet();
    c.policy.callable = vec![listed()];
    agent_call(&mut c, SHOP, near(1));
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
}

#[test]
#[should_panic(expected = "over the limit on one payment")]
fn a_calls_deposit_has_the_same_limit() {
    let mut c = wallet();
    c.policy.callable = vec![listed()];
    agent_call(&mut c, SHOP, near(2));
}

#[test]
#[should_panic(expected = "gas_tgas must be 1 to 100")]
fn a_call_cannot_ask_for_all_the_gas() {
    let mut c = wallet();
    c.policy.callable = vec![listed()];
    as_(AGENT, near(0), 1);
    c.call(
        SHOP.parse().unwrap(),
        METHOD.into(),
        Base64VecU8(vec![]),
        near(0),
        200,
    )
    .detach();
}

// ---- what happens after Vouch answers ----

#[test]
fn a_block_gives_the_budget_back() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let out = vouch_says(
        &mut c,
        &claim_json("block", "open"),
        "[]",
        transfer(near(1)),
        2,
    );
    assert!(matches!(out, Some(Outcome::Refused { .. })));
    assert_eq!((spent(&c).as_str(), reserved(&c).as_str()), ("0", "0"));
}

#[test]
fn a_report_refuses_with_the_reporter_named() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let report = format!(
        r#"[{{"id":"9","agent":"{OTHER}","subject":"{SHOP}","verdict":"block","status":"open","challenge_until":"1000","ruling":null}}]"#
    );
    let out = vouch_says(
        &mut c,
        &claim_json("allow", "open"),
        &report,
        transfer(near(1)),
        2,
    );
    let Some(Outcome::Refused { reason }) = out else {
        panic!("should have refused")
    };
    assert!(reason.contains(OTHER) && reason.contains("claim 9"));
}

#[test]
fn an_allow_sends_and_stays_charged_until_done() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let out = vouch_says(
        &mut c,
        &claim_json("allow", "open"),
        "[]",
        transfer(near(1)),
        2,
    );
    assert!(out.is_none(), "should have gone on to the transfer");
    assert_eq!(reserved(&c), near(1).as_yoctonear().to_string());
}

#[test]
fn a_garbled_answer_refuses_and_gives_the_budget_back() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let out = vouch_says(&mut c, "not json", "[]", transfer(near(1)), 2);
    assert!(matches!(out, Some(Outcome::Refused { .. })));
    assert_eq!(spent(&c), "0");
}

#[test]
fn a_failed_view_refuses_and_gives_the_budget_back() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    testing_env!(
        context(WALLET, near(0), 2).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed, PromiseResult::Failed]
    );
    let day = U64(c.day_start);
    let PromiseOrValue::Value(out) = c.on_checked(transfer(near(1)), day) else {
        panic!("should have refused")
    };
    assert!(matches!(out, Outcome::Refused { .. }));
    assert_eq!(spent(&c), "0");
}

#[test]
fn freezing_stops_a_payment_already_on_its_way() {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    as_(OWNER, NearToken::from_yoctonear(1), 2);
    c.freeze();
    let out = vouch_says(
        &mut c,
        &claim_json("allow", "open"),
        "[]",
        transfer(near(1)),
        3,
    );
    assert!(matches!(out, Some(Outcome::Refused { .. })));
}

fn after_paying(ok: bool) -> Wallet {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let result = if ok {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    testing_env!(
        context(WALLET, near(0), 3).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
    let day = U64(c.day_start);
    let out = c.on_done(transfer(near(1)), day);
    assert_eq!(
        matches!(out, Outcome::Paid { .. }),
        ok,
        "outcome was {out:?}"
    );
    c
}

#[test]
fn a_sent_payment_stays_in_the_days_budget_and_on_the_record() {
    let c = after_paying(true);
    assert_eq!(c.payments_to(SHOP.parse().unwrap()), 1);
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
    assert_eq!(reserved(&c), "0");
}

#[test]
fn a_failed_payment_gives_the_budget_back_and_is_not_on_the_record() {
    let c = after_paying(false);
    assert_eq!(c.payments_to(SHOP.parse().unwrap()), 0);
    assert_eq!((spent(&c).as_str(), reserved(&c).as_str()), ("0", "0"));
}

// ---- the human's yes ----

fn waiting() -> Wallet {
    let mut c = wallet();
    pay(&mut c, near(1), 1);
    let out = vouch_says(
        &mut c,
        &claim_json("warn", "open"),
        "[]",
        transfer(near(1)),
        2,
    );
    assert!(matches!(out, Some(Outcome::Pending { .. })));
    c
}

const ONE: NearToken = NearToken::from_yoctonear(1);

#[test]
fn a_warn_waits_and_stays_charged() {
    let c = waiting();
    assert_eq!(c.get_pending().len(), 1);
    assert_eq!(reserved(&c), near(1).as_yoctonear().to_string());
    assert!(get_logs().iter().any(|l| l.contains("payment_waiting")));
}

#[test]
fn the_owner_can_approve() {
    let mut c = waiting();
    as_(OWNER, ONE, 3);
    c.approve(U64(0)).detach();
    assert!(c.get_pending().is_empty());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn the_agent_cannot_approve_itself() {
    let mut c = waiting();
    as_(AGENT, ONE, 3);
    c.approve(U64(0)).detach();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn approving_needs_a_full_access_key() {
    let mut c = waiting();
    as_(OWNER, near(0), 3);
    c.approve(U64(0)).detach();
}

#[test]
fn rejecting_gives_the_budget_back() {
    let mut c = waiting();
    as_(OWNER, ONE, 3);
    c.reject(U64(0));
    assert!(c.get_pending().is_empty());
    assert_eq!((spent(&c).as_str(), reserved(&c).as_str()), ("0", "0"));
}

#[test]
#[should_panic(expected = "This payment has lapsed")]
fn an_old_yes_is_too_late() {
    let mut c = waiting();
    as_(OWNER, ONE, 2 + PENDING_TTL);
    c.approve(U64(0)).detach();
}

#[test]
#[should_panic(expected = "can still be approved")]
fn a_waiting_payment_cannot_be_cleared_early() {
    let mut c = waiting();
    as_(OTHER, near(0), 3);
    c.expire(U64(0));
}

#[test]
fn anyone_can_clear_a_lapsed_payment() {
    let mut c = waiting();
    as_(OTHER, near(0), 2 + PENDING_TTL);
    c.expire(U64(0));
    assert!(c.get_pending().is_empty());
    assert_eq!(reserved(&c), "0");
}

#[test]
#[should_panic(expected = "Too many payments are waiting")]
fn waiting_payments_are_capped() {
    let mut c = wallet();
    c.policy.max_actions_per_hour = 100;
    c.policy.per_day = near(5);
    for now in 1..=21 {
        pay(&mut c, milli(1), now);
        vouch_says(
            &mut c,
            &claim_json("warn", "open"),
            "[]",
            transfer(milli(1)),
            now,
        );
    }
}

// ---- the owner's other powers ----

#[test]
#[should_panic(expected = "This wallet is frozen")]
fn a_frozen_wallet_refuses_the_agent() {
    let mut c = wallet();
    as_(OWNER, ONE, 1);
    c.freeze();
    pay(&mut c, near(1), 2);
}

#[test]
fn unfreezing_lets_the_agent_pay_again() {
    let mut c = wallet();
    as_(OWNER, ONE, 1);
    c.freeze();
    as_(OWNER, ONE, 2);
    c.unfreeze();
    pay(&mut c, near(1), 3);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn the_agent_cannot_change_its_limits() {
    let mut c = wallet();
    as_(AGENT, ONE, 1);
    c.set_policy(policy());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn the_agent_cannot_withdraw() {
    let mut c = wallet();
    as_(AGENT, ONE, 1);
    c.withdraw(near(1)).detach();
}

#[test]
#[should_panic(expected = "Only the owner")]
fn the_agent_cannot_unfreeze() {
    let mut c = wallet();
    as_(OWNER, ONE, 1);
    c.freeze();
    as_(AGENT, ONE, 2);
    c.unfreeze();
}

#[test]
#[should_panic(expected = "more than the wallet has free")]
fn the_owner_cannot_withdraw_what_a_payment_is_waiting_on() {
    let mut c = waiting();
    as_(OWNER, ONE, 3);
    c.withdraw(near(10)).detach();
}

#[test]
#[should_panic(expected = "Only the agent can spend")]
fn a_replaced_agent_can_no_longer_spend() {
    let mut c = wallet();
    as_(OWNER, ONE, 1);
    c.set_agent("new-agent.near".parse().unwrap());
    pay(&mut c, near(1), 2);
}

#[test]
#[should_panic(expected = "per_payment must be above zero")]
fn a_policy_cannot_be_nonsense() {
    let mut c = wallet();
    let mut p = policy();
    p.per_payment = near(3);
    as_(OWNER, ONE, 1);
    c.set_policy(p);
}

// ---- fixes from the audit ----

#[test]
fn an_old_payment_lapsing_cannot_free_up_todays_budget() {
    let mut c = waiting();
    pay(&mut c, near(1), DAY + 1);
    assert_eq!(spent(&c), near(1).as_yoctonear().to_string());
    as_(OTHER, near(0), 2 + PENDING_TTL + 10);
    c.expire(U64(0));
    assert_eq!(
        spent(&c),
        near(1).as_yoctonear().to_string(),
        "today's spending still counts"
    );
    assert_eq!(
        reserved(&c),
        near(1).as_yoctonear().to_string(),
        "only today's payment is still out"
    );
}

#[test]
fn rejecting_on_the_same_day_still_frees_the_budget() {
    let mut c = waiting();
    as_(OWNER, ONE, 3);
    c.reject(U64(0));
    assert_eq!(spent(&c), "0");
}

#[test]
#[should_panic(expected = "doesn't allow this receiver any more")]
fn approving_respects_a_list_tightened_since() {
    let mut c = waiting();
    c.policy.destinations = Destinations::Only(vec![]);
    as_(OWNER, ONE, 3);
    c.approve(U64(0)).detach();
}

#[test]
#[should_panic(expected = "over the limit on one payment now")]
fn approving_respects_a_limit_lowered_since() {
    let mut c = waiting();
    c.policy.per_payment = milli(1);
    as_(OWNER, ONE, 3);
    c.approve(U64(0)).detach();
}

#[test]
fn a_burst_cannot_pass_the_cap_on_waiting_payments() {
    let mut c = wallet();
    c.policy.max_actions_per_hour = 100;
    c.policy.per_day = near(5);
    for now in 1..=25 {
        pay(&mut c, milli(1), now);
    }
    for now in 26..=50 {
        vouch_says(
            &mut c,
            &claim_json("warn", "open"),
            "[]",
            transfer(milli(1)),
            now,
        );
    }
    assert_eq!(c.get_pending().len(), 20);
    assert_eq!(reserved(&c), milli(20).as_yoctonear().to_string());
}

#[test]
fn reconciling_repairs_stranded_books() {
    let mut c = waiting();
    c.reserved = near(5);
    as_(OWNER, ONE, 3);
    c.freeze();
    as_(OWNER, ONE, 4);
    c.reconcile();
    assert_eq!(reserved(&c), near(1).as_yoctonear().to_string());
}

#[test]
#[should_panic(expected = "Freeze the wallet first")]
fn reconciling_needs_a_frozen_wallet() {
    let mut c = waiting();
    as_(OWNER, ONE, 3);
    c.reconcile();
}
