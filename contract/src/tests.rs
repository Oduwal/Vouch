use super::*;
use crate::jury::commitment;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseResult, testing_env};

const CONTRACT: &str = "vouch.near";
const JUDGE: &str = "judge.near";
const AGENT: &str = "sentinel.near";
const CHALLENGER: &str = "alice.near";
const DAY: u64 = 24 * HOUR;
const SALT: &str = "test-salt";

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

fn milli(n: u128) -> NearToken {
    NearToken::from_millinear(n)
}

fn as_(who: &str, deposit: NearToken, now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .signer_account_id(who.parse().unwrap())
        .attached_deposit(deposit)
        .block_timestamp(now)
        .random_seed([7; 32]);
    testing_env!(b.build());
}

fn ruling(winner: Side) -> RulingInput {
    RulingInput {
        winner,
        summary: "The owner key minted tokens to itself after the call.".into(),
        model: "test-model".into(),
        attestation: "sha256:00".into(),
    }
}

/// 1 NEAR at stake, plus the storage fee.
fn stake_deposit() -> NearToken {
    milli(1030)
}

/// A contract with one agent holding 10 NEAR and one open `block` claim with a 2 NEAR bond. Jurors
/// can sit and leave straight away unless a test says otherwise.
fn setup() -> Contract {
    as_(CONTRACT, near(0), 0);
    let mut c = Contract::new(JUDGE.parse().unwrap());
    c.config.juror_warmup = U64(0);
    c.config.juror_lockup = U64(0);
    as_(AGENT, near(10), 0);
    c.register_agent();
    as_(AGENT, near(0), 0);
    c.post_claim(
        "free-airdrop-claim.near".parse().unwrap(),
        Level::Block,
        vec!["Created an hour ago".into()],
        near(2),
    );
    c
}

/// `setup`, then challenged with 1 NEAR and ruled for `winner` at time 10. The test VM can't resume a
/// real yield, so this takes the step after it. The testnet rehearsal runs the whole path.
fn ruled(winner: Side) -> Contract {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "It is a fresh airdrop drainer.".into());
    as_(JUDGE, near(0), 10);
    c.waiting.remove(&0);
    c.record_ruling(0, ruling(winner));
    c
}

fn agent(c: &Contract) -> Agent {
    c.get_agent(AGENT.parse().unwrap()).unwrap().clone()
}

fn status(c: &Contract) -> Status {
    c.get_claim(U64(0)).unwrap().status
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn commit(c: &mut Contract, juror: &AccountId, side: Side, now: u64) {
    as_(juror.as_str(), near(0), now);
    let sealed = hex(&commitment(0, juror, side, SALT));
    c.commit_vote(U64(0), sealed);
}

fn reveal(c: &mut Contract, juror: &AccountId, side: Side, now: u64) {
    as_(juror.as_str(), near(0), now);
    c.reveal_vote(U64(0), side, SALT.into());
}

#[test]
fn posting_locks_the_bond_and_charges_for_storage() {
    let c = setup();
    let a = agent(&c);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_made),
        (milli(7965), near(2), 1)
    );
    let latest = c
        .get_verdict("free-airdrop-claim.near".parse().unwrap())
        .unwrap();
    assert_eq!(
        (latest.verdict, latest.status),
        (Level::Block, Status::Open)
    );
}

#[test]
#[should_panic(expected = "Not enough free bond")]
fn cannot_bond_more_than_the_pool() {
    let mut c = setup();
    c.post_claim(
        "x.near".parse().unwrap(),
        Level::Allow,
        vec!["ok".into()],
        near(8),
    );
}

#[test]
fn storage_fee_is_not_refunded_when_the_bond_comes_back() {
    let mut c = setup();
    as_("anyone.near", near(0), DAY);
    c.release(U64(0));
    assert_eq!(agent(&c).bond_free, milli(9965));
}

#[test]
#[should_panic(expected = "too many calls open")]
fn one_agent_cannot_flood_the_contract() {
    let mut c = setup();
    as_(AGENT, near(100), 0);
    c.register_agent();
    for i in 0..40 {
        as_(AGENT, near(0), 0);
        c.post_claim(
            format!("a{i}.near").parse().unwrap(),
            Level::Warn,
            vec!["ok".into()],
            milli(500),
        );
    }
}

#[test]
#[should_panic(expected = "The challenge window is still open")]
fn release_waits_for_the_window() {
    let mut c = setup();
    as_(AGENT, near(0), DAY - 1);
    c.release(U64(0));
}

#[test]
fn unchallenged_claim_releases_the_bond() {
    let mut c = setup();
    assert_eq!(c.active_count(), 1);
    as_("anyone.near", near(0), DAY);
    c.release(U64(0));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Held);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_held),
        (milli(9965), near(0), 1)
    );
    assert_eq!(c.active_count(), 0);
}

#[test]
#[should_panic(expected = "Stake at least")]
fn challenge_needs_half_the_bond_after_the_fee() {
    let mut c = setup();
    as_(CHALLENGER, milli(1029), 5);
    c.challenge(U64(0), "evidence".into());
}

#[test]
fn the_stake_excludes_the_storage_fee() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    let claim = c.get_claim(U64(0)).unwrap();
    assert_eq!(claim.challenge.as_ref().unwrap().stake, near(1));
}

#[test]
#[should_panic(expected = "An agent cannot challenge its own call")]
fn agent_cannot_challenge_itself() {
    let mut c = setup();
    as_(AGENT, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
}

#[test]
#[should_panic(expected = "The challenge window has closed")]
fn challenge_after_window_fails() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), DAY);
    c.challenge(U64(0), "evidence".into());
}

#[test]
fn challenge_pauses_for_the_judge() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    assert_eq!(status(&c), Status::Challenged);
    assert_eq!(c.get_waiting().len(), 1);
}

#[test]
#[should_panic(expected = "Only the judge can rule")]
fn only_the_judge_rules() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    as_(CHALLENGER, near(0), 6);
    c.submit_ruling(U64(0), ruling(Side::Challenger), None);
}

#[test]
fn ruling_waits_out_the_appeal_window() {
    let c = ruled(Side::Challenger);
    let claim = c.get_claim(U64(0)).unwrap();
    assert_eq!(claim.status, Status::Ruled);
    assert_eq!(claim.ruling.as_ref().unwrap().appeal_until, U64(10 + DAY));
    assert!(c.get_waiting().is_empty());
}

#[test]
#[should_panic(expected = "The appeal window is still open")]
fn finalize_waits_for_appeals() {
    let mut c = ruled(Side::Challenger);
    as_("anyone.near", near(0), DAY);
    c.finalize(U64(0));
}

#[test]
fn challenger_win_takes_the_bond() {
    let mut c = ruled(Side::Challenger);
    as_("anyone.near", near(0), 10 + DAY);
    c.finalize(U64(0));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Overturned);
    assert_eq!((a.bond_free, a.bond_locked), (milli(7965), near(0)));
    assert_eq!((a.calls_lost, a.bond_lost), (1, near(2)));
}

#[test]
fn agent_win_takes_the_counter_stake() {
    let mut c = ruled(Side::Agent);
    as_("anyone.near", near(0), 10 + DAY);
    c.finalize(U64(0));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Held);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_held),
        (milli(10965), near(0), 1)
    );
}

#[test]
fn a_long_ruling_is_recorded_whole() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    let mut long = ruling(Side::Agent);
    long.summary = "s".repeat(1000);
    long.model = "m".repeat(200);
    long.attestation = "a".repeat(200);
    as_(CONTRACT, near(0), 300);
    c.on_ruling(U64(0));
    as_(JUDGE, near(0), 400);
    c.submit_ruling(U64(0), long, None);
    let claim = c.get_claim(U64(0)).unwrap();
    assert_eq!(claim.ruling.as_ref().unwrap().summary.len(), 1000);
    assert!(c.get_waiting().is_empty());
}

#[test]
#[should_panic(expected = "No challenge on this claim is waiting")]
fn a_second_ruling_is_refused() {
    let mut c = ruled(Side::Agent);
    as_(JUDGE, near(0), 11);
    c.submit_ruling(U64(0), ruling(Side::Challenger), None);
}

#[test]
fn the_yield_callback_leaves_a_recorded_ruling_alone() {
    let mut c = ruled(Side::Agent);
    as_(CONTRACT, near(0), 12);
    c.on_ruling(U64(0));
    assert_eq!(status(&c), Status::Ruled);
    assert!(c.get_waiting().is_empty());
}

// ---- the judge's late window ----

/// Challenged at 5, and the yield timed out at 300.
fn timed_out() -> Contract {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    as_(CONTRACT, near(0), 300);
    c.on_ruling(U64(0));
    c
}

#[test]
fn a_yield_timeout_does_not_let_a_bad_call_off_free() {
    let c = timed_out();
    assert_eq!(status(&c), Status::Challenged);
    assert_eq!(c.get_waiting().len(), 1);
    assert_eq!(agent(&c).bond_locked, near(2));
}

#[test]
fn the_judge_can_still_rule_in_the_late_window() {
    let mut c = timed_out();
    as_(JUDGE, near(0), 400);
    c.submit_ruling(U64(0), ruling(Side::Challenger), None);
    assert_eq!(status(&c), Status::Ruled);
    assert!(c.get_waiting().is_empty());
}

#[test]
#[should_panic(expected = "The judge can still rule on this challenge")]
fn a_challenge_cannot_be_voided_during_the_late_window() {
    let mut c = timed_out();
    as_("anyone.near", near(0), 400);
    c.finalize(U64(0));
}

#[test]
#[should_panic(expected = "The judge can still rule on this challenge")]
fn a_challenge_cannot_be_voided_while_its_yield_runs() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    as_("anyone.near", near(0), 6);
    c.finalize(U64(0));
}

#[test]
fn after_the_late_window_both_sides_are_refunded() {
    let mut c = timed_out();
    let end = 300 + c.config.late_ruling_window.0;
    as_("anyone.near", near(0), end);
    assert!(c.get_waiting().is_empty());
    assert_eq!(c.get_due(None).len(), 1);
    c.finalize(U64(0));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Void);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_lost),
        (milli(9965), near(0), 0)
    );
    assert_eq!(c.active_count(), 0);
}

#[test]
#[should_panic(expected = "late window has closed")]
fn a_ruling_after_the_late_window_is_refused() {
    let mut c = timed_out();
    let end = 300 + c.config.late_ruling_window.0;
    as_(JUDGE, near(0), end);
    c.submit_ruling(U64(0), ruling(Side::Challenger), None);
}

// ---- ids that don't fit ----

#[test]
fn a_huge_id_is_no_claim_rather_than_claim_zero() {
    let c = setup();
    assert!(c.get_claim(U64(1 << 32)).is_none());
    assert!(c.get_claims(Some(U64(1 << 32)), None).is_empty());
}

#[test]
#[should_panic(expected = "No claim with that id")]
fn a_huge_id_cannot_release_claim_zero() {
    let mut c = setup();
    as_("anyone.near", near(0), DAY);
    c.release(U64(1 << 32));
}

#[test]
#[should_panic(expected = "No claim with that id")]
fn a_huge_id_cannot_be_challenged() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(1 << 32), "evidence".into());
}

// ---- who gets to set the verdict a payer sees ----

fn second_agent_posts(c: &mut Contract, verdict: Level, now: u64) {
    as_("scammer.near", near(5), now);
    c.register_agent();
    as_("scammer.near", near(0), now);
    c.post_claim(
        "free-airdrop-claim.near".parse().unwrap(),
        verdict,
        vec!["Looks fine".into()],
        milli(500),
    );
}

#[test]
fn another_agent_cannot_soften_a_live_call() {
    let mut c = setup();
    second_agent_posts(&mut c, Level::Allow, 1);
    let shown = c
        .get_verdict("free-airdrop-claim.near".parse().unwrap())
        .unwrap();
    assert_eq!((shown.verdict, shown.agent.as_str()), (Level::Block, AGENT));
}

#[test]
fn a_stricter_call_replaces_a_softer_one() {
    let mut c = setup();
    as_(AGENT, near(0), 1);
    c.post_claim(
        "new.near".parse().unwrap(),
        Level::Allow,
        vec!["ok".into()],
        milli(500),
    );
    as_("watcher.near", near(5), 2);
    c.register_agent();
    as_("watcher.near", near(0), 2);
    c.post_claim(
        "new.near".parse().unwrap(),
        Level::Block,
        vec!["It drained someone".into()],
        milli(500),
    );
    let shown = c.get_verdict("new.near".parse().unwrap()).unwrap();
    assert_eq!(shown.verdict, Level::Block);
}

#[test]
fn a_softer_call_replaces_one_that_has_expired() {
    let mut c = setup();
    second_agent_posts(&mut c, Level::Allow, DAY);
    let shown = c
        .get_verdict("free-airdrop-claim.near".parse().unwrap())
        .unwrap();
    assert_eq!(shown.verdict, Level::Allow);
}

#[test]
fn each_agent_keeps_its_own_verdict() {
    let mut c = setup();
    second_agent_posts(&mut c, Level::Allow, 1);
    let mine = c
        .get_agent_verdict(
            AGENT.parse().unwrap(),
            "free-airdrop-claim.near".parse().unwrap(),
        )
        .unwrap();
    assert_eq!(mine.verdict, Level::Block);
    let theirs = c
        .get_agent_verdict(
            "scammer.near".parse().unwrap(),
            "free-airdrop-claim.near".parse().unwrap(),
        )
        .unwrap();
    assert_eq!(theirs.verdict, Level::Allow);
}

// ---- finding what's due ----

#[test]
fn only_due_claims_are_returned_and_history_drops_out() {
    let mut c = setup();
    assert!(c.get_due(None).is_empty());
    as_("anyone.near", near(0), DAY);
    assert_eq!(c.get_due(None).len(), 1);
    c.release(U64(0));
    assert!(c.get_due(None).is_empty());
}

// ---- changing the rules ----

#[test]
#[should_panic(expected = "still waiting out its delay")]
fn a_config_change_cannot_take_effect_mid_case() {
    let mut c = setup();
    let mut next = c.config.clone();
    next.appeal_fee = near(100);
    as_(CONTRACT, near(0), 100);
    c.set_config(next);
    assert_eq!(c.config.appeal_fee, near(1));
    as_("anyone.near", near(0), 200);
    c.apply_config();
}

#[test]
fn a_config_change_applies_after_its_delay() {
    let mut c = setup();
    let mut next = c.config.clone();
    next.appeal_fee = near(2);
    as_(CONTRACT, near(0), 100);
    c.set_config(next);
    let after = c.get_pending_config().unwrap().apply_after.0;
    as_("anyone.near", near(0), after);
    c.apply_config();
    assert_eq!(c.config.appeal_fee, near(2));
    assert!(c.get_pending_config().is_none());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn only_the_owner_queues_config() {
    let mut c = setup();
    let next = c.config.clone();
    as_("anyone.near", near(0), 100);
    c.set_config(next);
}

fn queue(change: impl FnOnce(&mut Config)) {
    let mut c = setup();
    let mut next = c.config.clone();
    change(&mut next);
    as_(CONTRACT, near(0), 100);
    c.set_config(next);
}

#[test]
#[should_panic(expected = "challenge_stake_pct must be 10 to 100")]
fn challenges_cannot_be_made_free() {
    queue(|c| c.challenge_stake_pct = 0);
}

#[test]
#[should_panic(expected = "can't be zero")]
fn the_bond_cannot_be_zero() {
    queue(|c| c.min_bond = near(0));
}

#[test]
#[should_panic(expected = "Each window must be from a minute to 30 days")]
fn a_huge_window_is_refused() {
    queue(|c| c.appeal_window = U64(u64::MAX));
}

#[test]
fn deadlines_saturate_rather_than_panic() {
    let mut c = setup();
    as_(CHALLENGER, stake_deposit(), 5);
    c.challenge(U64(0), "evidence".into());
    c.config.late_ruling_window = U64(u64::MAX);
    c.config.appeal_window = U64(u64::MAX);
    as_(CONTRACT, near(0), 300);
    c.on_ruling(U64(0));
    assert_eq!(c.late.get(&0), Some(&u64::MAX));
    as_(JUDGE, near(0), 400);
    c.submit_ruling(U64(0), ruling(Side::Agent), None);
    assert_eq!(status(&c), Status::Ruled);
}

// ---- payments that fail ----

fn callback_failed(now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(CONTRACT.parse().unwrap())
        .block_timestamp(now);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed],
    );
}

#[test]
fn a_failed_withdrawal_goes_back_in_the_pool() {
    let mut c = setup();
    as_(AGENT, NearToken::from_yoctonear(1), 1);
    let _ = c.withdraw(near(1));
    assert_eq!(agent(&c).bond_free, milli(6965));
    callback_failed(2);
    c.on_withdraw(AGENT.parse().unwrap(), near(1));
    assert_eq!(agent(&c).bond_free, milli(7965));
}

#[test]
fn a_failed_payout_stays_owed_and_can_be_collected() {
    let mut c = setup();
    callback_failed(2);
    c.on_payout(CHALLENGER.parse().unwrap(), near(3));
    assert_eq!(c.get_owed(CHALLENGER.parse().unwrap()), near(3));
    as_(CHALLENGER, near(0), 3);
    let _ = c.collect_owed();
    assert_eq!(c.get_owed(CHALLENGER.parse().unwrap()), near(0));
}

#[test]
#[should_panic(expected = "Nothing is owed")]
fn nothing_owed_nothing_collected() {
    let mut c = setup();
    as_(CHALLENGER, near(0), 3);
    let _ = c.collect_owed();
}

// ---- the jury ----

fn with_jurors(mut c: Contract, names: &[&str]) -> Contract {
    for name in names {
        as_(name, milli(1010), 10);
        c.join_jury();
    }
    c
}

/// Ruled for the challenger, a pool of three, and the agent appealing at time 20.
fn appealed(names: &[&str]) -> (Contract, Vec<AccountId>) {
    let mut c = with_jurors(ruled(Side::Challenger), names);
    as_(AGENT, near(1), 20);
    let jury = c.appeal(U64(0));
    (c, jury)
}

const THREE: [&str; 3] = ["j1.near", "j2.near", "j3.near"];

#[test]
fn jury_pool_can_be_read() {
    let c = with_jurors(setup(), &["j1.near", "j2.near"]);
    assert_eq!(c.get_jurors(None, None).len(), 2);
    assert_eq!(c.get_jurors(Some(1), Some(5)).len(), 1);
    assert!(c.get_juror("j1.near".parse().unwrap()).is_some());
    assert!(c.get_juror("nobody.near".parse().unwrap()).is_none());
    assert_eq!(c.juror_list.len(), 2);
}

#[test]
fn the_juror_fee_comes_off_the_first_deposit_only() {
    let mut c = with_jurors(setup(), &["j1.near"]);
    assert_eq!(
        c.get_juror("j1.near".parse().unwrap()).unwrap().stake,
        near(1)
    );
    as_("j1.near", near(1), 11);
    c.join_jury();
    assert_eq!(
        c.get_juror("j1.near".parse().unwrap()).unwrap().stake,
        near(2)
    );
    assert_eq!(c.juror_list.len(), 1);
}

#[test]
#[should_panic(expected = "Attach NEAR to stake")]
fn an_empty_deposit_cannot_rejoin_the_jury() {
    let mut c = with_jurors(setup(), &["j1.near"]);
    as_("j1.near", near(0), 11);
    c.join_jury();
}

#[test]
#[should_panic(expected = "Only the side that lost can appeal")]
fn only_the_loser_appeals() {
    let mut c = with_jurors(ruled(Side::Challenger), &THREE);
    as_(CHALLENGER, near(1), 20);
    c.appeal(U64(0));
}

#[test]
#[should_panic(expected = "Appeal directly from your own account")]
fn a_contract_cannot_appeal_after_previewing_the_seed() {
    let mut c = with_jurors(ruled(Side::Challenger), &THREE);
    let mut b = VMContextBuilder::new();
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(AGENT.parse().unwrap())
        .signer_account_id("attacker.near".parse().unwrap())
        .attached_deposit(near(1))
        .block_timestamp(20);
    testing_env!(b.build());
    c.appeal(U64(0));
}

#[test]
#[should_panic(expected = "Not enough jurors")]
fn appeal_needs_a_full_jury() {
    appealed(&["j1.near", "j2.near"]);
}

#[test]
#[should_panic(expected = "Not enough jurors")]
fn a_juror_who_just_joined_cannot_be_drawn() {
    let mut c = with_jurors(ruled(Side::Challenger), &THREE);
    c.config.juror_warmup = U64(1000);
    as_(AGENT, near(1), 20);
    c.appeal(U64(0));
}

#[test]
fn jury_never_includes_the_parties() {
    let (_, jury) = appealed(&[
        "j1.near", "j2.near", "j3.near", "j4.near", "j5.near", AGENT, CHALLENGER, JUDGE,
    ]);
    assert_eq!(jury.len(), 3);
    for party in [AGENT, CHALLENGER, JUDGE] {
        assert!(!jury.iter().any(|j| j.as_str() == party));
    }
    let mut unique = jury.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3);
}

#[test]
fn a_large_pool_draws_without_reading_all_of_it() {
    let names: Vec<String> = (0..300).map(|i| format!("j{i}.near")).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let (_, jury) = appealed(&refs);
    let mut unique = jury.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 3);
}

#[test]
fn two_claims_in_one_block_draw_different_juries() {
    let names: Vec<String> = (0..300).map(|i| format!("j{i}.near")).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let c = with_jurors(setup(), &refs);
    as_("anyone.near", near(0), 20);
    let first = c.draw_jury(0, &[]);
    let second = c.draw_jury(1, &[]);
    assert_ne!(first, second);
}

#[test]
fn sealed_votes_decide_and_the_majority_is_paid() {
    let (mut c, jury) = appealed(&["j1.near", "j2.near", "j3.near", "j4.near"]);
    assert_eq!(status(&c), Status::Appealed);
    commit(&mut c, &jury[0], Side::Agent, 30);
    commit(&mut c, &jury[1], Side::Agent, 31);
    commit(&mut c, &jury[2], Side::Challenger, 32);
    assert!(c.has_committed(U64(0), jury[0].clone()));

    // Nothing about the vote shows until it's revealed.
    assert!(
        c.get_claim(U64(0))
            .unwrap()
            .appeal
            .as_ref()
            .unwrap()
            .votes
            .is_empty()
    );

    reveal(&mut c, &jury[0], Side::Agent, 40);
    reveal(&mut c, &jury[1], Side::Agent, 41);

    let a = agent(&c);
    assert_eq!(status(&c), Status::Held);
    assert_eq!(
        (a.bond_free, a.calls_held, a.calls_lost),
        (milli(10965), 1, 0)
    );
    let appeal = c.get_claim(U64(0)).unwrap().appeal.clone().unwrap();
    assert_eq!(appeal.decided, Some(Side::Agent));
    assert_eq!(appeal.fee, milli(990));
    for j in &jury {
        assert_eq!(c.jurors.get(j).unwrap().open_cases, 0);
    }
    assert_eq!(c.jurors.get(&jury[0]).unwrap().votes_with_majority, 1);
}

#[test]
#[should_panic(expected = "Votes can be revealed once all three are sealed")]
fn nobody_reveals_before_all_have_sealed() {
    let (mut c, jury) = appealed(&THREE);
    commit(&mut c, &jury[0], Side::Agent, 30);
    reveal(&mut c, &jury[0], Side::Agent, 31);
}

#[test]
fn revealing_opens_when_the_time_to_seal_has_passed() {
    let (mut c, jury) = appealed(&THREE);
    commit(&mut c, &jury[0], Side::Agent, 30);
    let opens = 20 + c.config.jury_window.0 / 2;
    reveal(&mut c, &jury[0], Side::Agent, opens);
    assert_eq!(
        c.get_claim(U64(0))
            .unwrap()
            .appeal
            .as_ref()
            .unwrap()
            .votes
            .len(),
        1
    );
}

#[test]
#[should_panic(expected = "doesn't match the vote you sealed")]
fn a_juror_cannot_change_their_vote_at_reveal() {
    let (mut c, jury) = appealed(&THREE);
    for j in &jury {
        commit(&mut c, j, Side::Agent, 30);
    }
    reveal(&mut c, &jury[0], Side::Challenger, 40);
}

#[test]
#[should_panic(expected = "doesn't match the vote you sealed")]
fn a_juror_cannot_copy_another_jurors_commitment() {
    let (mut c, jury) = appealed(&THREE);
    let copied = hex(&commitment(0, &jury[0], Side::Agent, SALT));
    commit(&mut c, &jury[0], Side::Agent, 30);
    as_(jury[1].as_str(), near(0), 31);
    c.commit_vote(U64(0), copied);
    commit(&mut c, &jury[2], Side::Agent, 32);
    reveal(&mut c, &jury[1], Side::Agent, 40);
}

#[test]
#[should_panic(expected = "You already sealed a vote")]
fn a_juror_seals_once() {
    let (mut c, jury) = appealed(&THREE);
    commit(&mut c, &jury[0], Side::Agent, 30);
    commit(&mut c, &jury[0], Side::Challenger, 31);
}

#[test]
#[should_panic(expected = "The time to seal a vote has passed")]
fn sealing_closes_halfway() {
    let (mut c, jury) = appealed(&THREE);
    let closed = 20 + c.config.jury_window.0 / 2;
    commit(&mut c, &jury[0], Side::Agent, closed);
}

#[test]
#[should_panic(expected = "A commitment is 32 bytes of hex")]
fn a_commitment_must_be_a_hash() {
    let (mut c, jury) = appealed(&THREE);
    as_(jury[0].as_str(), near(0), 30);
    c.commit_vote(U64(0), "not hex".into());
}

#[test]
#[should_panic(expected = "You are not on this jury")]
fn outsiders_cannot_seal() {
    let (mut c, _) = appealed(&THREE);
    as_("stranger.near", near(0), 30);
    c.commit_vote(U64(0), hex(&[0; 32]));
}

#[test]
fn a_timed_out_jury_keeps_the_ruling_and_no_shows_lose_stake() {
    let (mut c, jury) = appealed(&THREE);
    commit(&mut c, &jury[0], Side::Agent, 30);
    commit(&mut c, &jury[1], Side::Agent, 31);
    let opens = 20 + c.config.jury_window.0 / 2;
    reveal(&mut c, &jury[0], Side::Agent, opens);
    as_("anyone.near", near(0), 20 + 2 * DAY);
    c.finalize(U64(0));
    assert_eq!(status(&c), Status::Overturned);
    let appeal = c.get_claim(U64(0)).unwrap().appeal.clone().unwrap();
    assert_eq!(appeal.decided, None);
    // Revealed: untouched. Sealed but never revealed, and never sealed: 10% gone.
    assert_eq!(c.jurors.get(&jury[0]).unwrap().stake, near(1));
    assert_eq!(c.jurors.get(&jury[1]).unwrap().stake, milli(900));
    assert_eq!(c.jurors.get(&jury[2]).unwrap().stake, milli(900));
}

#[test]
fn a_juror_slashed_below_the_minimum_is_not_drawn_again() {
    let (mut c, jury) = appealed(&THREE);
    as_("anyone.near", near(0), 20 + 2 * DAY);
    c.finalize(U64(0));
    assert!(!c.can_sit(&jury[0], &[], &[], 20 + 2 * DAY));
}

#[test]
fn a_fair_minority_juror_is_not_slashed_when_the_majority_closes_early() {
    let (mut c, jury) = appealed(&THREE);
    for j in &jury {
        commit(&mut c, j, Side::Agent, 30);
    }
    reveal(&mut c, &jury[0], Side::Agent, 40);
    reveal(&mut c, &jury[1], Side::Agent, 41);
    assert_eq!(status(&c), Status::Held);
    assert_eq!(c.jurors.get(&jury[2]).unwrap().stake, near(1));
}

#[test]
fn an_odd_split_strands_nothing() {
    let (mut c, jury) = appealed(&THREE);
    let claim = c.claim_mut(0);
    claim.appeal.as_mut().unwrap().fee =
        NearToken::from_yoctonear(1_000_000_000_000_000_000_000_001);
    for j in &jury {
        commit(&mut c, j, Side::Agent, 30);
    }
    reveal(&mut c, &jury[0], Side::Agent, 40);
    reveal(&mut c, &jury[1], Side::Agent, 41);
    // Two winners and an odd amount: settling didn't panic, and the winners get the whole pot. The
    // payment amounts are checked on the testnet rehearsal.
    assert_eq!(status(&c), Status::Held);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_needs_a_full_access_key() {
    let mut c = setup();
    let _ = c.withdraw(near(1));
}

#[test]
#[should_panic(expected = "You sit on an appeal that has not closed")]
fn jurors_cannot_leave_mid_case() {
    let (mut c, _) = appealed(&THREE);
    as_("j1.near", NearToken::from_yoctonear(1), 30);
    let _ = c.leave_jury();
}

#[test]
#[should_panic(expected = "Your juror stake is still locked")]
fn jurors_cannot_leave_during_the_lockup() {
    let mut c = with_jurors(setup(), &["j1.near"]);
    c.config.juror_lockup = U64(1000);
    as_("j1.near", NearToken::from_yoctonear(1), 11);
    let _ = c.leave_jury();
}

#[test]
fn leaving_keeps_the_draw_list_consistent() {
    let mut c = with_jurors(setup(), &THREE);
    as_("j1.near", NearToken::from_yoctonear(1), 11);
    let _ = c.leave_jury();
    assert_eq!(c.juror_list.len(), 2);
    assert!(c.get_juror("j1.near".parse().unwrap()).is_none());
    let moved: AccountId = "j3.near".parse().unwrap();
    let index = *c.juror_index.get(&moved).unwrap();
    assert_eq!(c.juror_list.get(index), Some(&moved));
    as_("j3.near", NearToken::from_yoctonear(1), 12);
    let _ = c.leave_jury();
    assert_eq!(c.juror_list.len(), 1);
}
