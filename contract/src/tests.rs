use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseError, testing_env};

const CONTRACT: &str = "vouch.near";
const JUDGE: &str = "judge.near";
const AGENT: &str = "sentinel.near";
const CHALLENGER: &str = "alice.near";
const DAY: u64 = 24 * HOUR;

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
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

/// A contract with one agent holding 10 NEAR and one open `block` claim with a 2 NEAR bond.
fn setup() -> Contract {
    as_(CONTRACT, near(0), 0);
    let mut c = Contract::new(JUDGE.parse().unwrap());
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

/// `setup`, then challenged with 1 NEAR and ruled for `winner` at time 10.
fn ruled(winner: Side) -> Contract {
    let mut c = setup();
    as_(CHALLENGER, near(1), 5);
    c.challenge(U64(0), "It is a fresh airdrop drainer.".into());
    as_(CONTRACT, near(0), 10);
    c.on_ruling(U64(0), Ok(ruling(winner)));
    c
}

fn agent(c: &Contract) -> Agent {
    c.get_agent(AGENT.parse().unwrap()).unwrap().clone()
}

fn status(c: &Contract) -> Status {
    c.get_claim(U64(0)).unwrap().status
}

#[test]
fn posting_locks_the_bond() {
    let c = setup();
    let a = agent(&c);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_made),
        (near(8), near(2), 1)
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
        near(9),
    );
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
    as_("anyone.near", near(0), DAY);
    c.release(U64(0));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Held);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_held),
        (near(10), near(0), 1)
    );
}

#[test]
#[should_panic(expected = "Stake at least")]
fn challenge_needs_half_the_bond() {
    let mut c = setup();
    as_(CHALLENGER, NearToken::from_millinear(999), 5);
    c.challenge(U64(0), "evidence".into());
}

#[test]
#[should_panic(expected = "An agent cannot challenge its own call")]
fn agent_cannot_challenge_itself() {
    let mut c = setup();
    as_(AGENT, near(1), 5);
    c.challenge(U64(0), "evidence".into());
}

#[test]
#[should_panic(expected = "The challenge window has closed")]
fn challenge_after_window_fails() {
    let mut c = setup();
    as_(CHALLENGER, near(1), DAY);
    c.challenge(U64(0), "evidence".into());
}

#[test]
fn challenge_pauses_for_the_judge() {
    let mut c = setup();
    as_(CHALLENGER, near(1), 5);
    c.challenge(U64(0), "evidence".into());
    assert_eq!(status(&c), Status::Challenged);
    assert_eq!(c.get_waiting().len(), 1);
}

#[test]
#[should_panic(expected = "Only the judge can rule")]
fn only_the_judge_rules() {
    let mut c = setup();
    as_(CHALLENGER, near(1), 5);
    c.challenge(U64(0), "evidence".into());
    as_(CHALLENGER, near(0), 6);
    c.submit_ruling(U64(0), ruling(Side::Challenger));
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
    assert_eq!((a.bond_free, a.bond_locked), (near(8), near(0)));
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
        (near(11), near(0), 1)
    );
}

#[test]
fn judge_timeout_refunds_both_sides() {
    let mut c = setup();
    as_(CHALLENGER, near(1), 5);
    c.challenge(U64(0), "evidence".into());
    as_(CONTRACT, near(0), 300);
    c.on_ruling(U64(0), Err(PromiseError::Failed));
    let a = agent(&c);
    assert_eq!(status(&c), Status::Void);
    assert_eq!(
        (a.bond_free, a.bond_locked, a.calls_lost),
        (near(10), near(0), 0)
    );
    assert!(c.get_waiting().is_empty());
}

fn with_jurors(mut c: Contract, names: &[&str]) -> Contract {
    for name in names {
        as_(name, near(1), 10);
        c.join_jury();
    }
    c
}

#[test]
#[should_panic(expected = "Only the side that lost can appeal")]
fn only_the_loser_appeals() {
    let mut c = with_jurors(ruled(Side::Challenger), &["j1.near", "j2.near", "j3.near"]);
    as_(CHALLENGER, near(1), 20);
    c.appeal(U64(0));
}

#[test]
#[should_panic(expected = "Not enough jurors")]
fn appeal_needs_a_full_jury() {
    let mut c = with_jurors(ruled(Side::Challenger), &["j1.near", "j2.near"]);
    as_(AGENT, near(1), 20);
    c.appeal(U64(0));
}

#[test]
fn jury_never_includes_the_parties() {
    let names = [
        "j1.near", "j2.near", "j3.near", "j4.near", "j5.near", AGENT, CHALLENGER, JUDGE,
    ];
    let mut c = with_jurors(ruled(Side::Challenger), &names);
    as_(AGENT, near(1), 20);
    let jury = c.appeal(U64(0));
    assert_eq!(jury.len(), 3);
    for party in [AGENT, CHALLENGER, JUDGE] {
        assert!(!jury.iter().any(|j| j.as_str() == party));
    }
    let mut unique = jury.clone();
    unique.dedup();
    assert_eq!(unique.len(), 3);
}

#[test]
fn jury_majority_overturns_the_judge() {
    let mut c = with_jurors(
        ruled(Side::Challenger),
        &["j1.near", "j2.near", "j3.near", "j4.near"],
    );
    as_(AGENT, near(1), 20);
    let jury = c.appeal(U64(0));
    assert_eq!(status(&c), Status::Appealed);

    as_(jury[0].as_str(), near(0), 30);
    c.vote(U64(0), Side::Agent);
    as_(jury[1].as_str(), near(0), 31);
    c.vote(U64(0), Side::Agent);

    let a = agent(&c);
    assert_eq!(status(&c), Status::Held);
    assert_eq!((a.bond_free, a.calls_held, a.calls_lost), (near(11), 1, 0));
    let appeal = c.get_claim(U64(0)).unwrap().appeal.clone().unwrap();
    assert_eq!(appeal.decided, Some(Side::Agent));
    for j in &jury {
        assert_eq!(c.jurors.get(j).unwrap().open_cases, 0);
    }
    assert_eq!(c.jurors.get(&jury[0]).unwrap().votes_with_majority, 1);
}

#[test]
fn jury_timeout_keeps_the_judges_ruling() {
    let mut c = with_jurors(ruled(Side::Challenger), &["j1.near", "j2.near", "j3.near"]);
    as_(AGENT, near(1), 20);
    let jury = c.appeal(U64(0));
    as_(jury[0].as_str(), near(0), 30);
    c.vote(U64(0), Side::Agent);
    as_("anyone.near", near(0), 20 + 2 * DAY);
    c.finalize(U64(0));
    assert_eq!(status(&c), Status::Overturned);
    assert_eq!(
        c.get_claim(U64(0))
            .unwrap()
            .appeal
            .as_ref()
            .unwrap()
            .decided,
        None
    );
}

#[test]
#[should_panic(expected = "You are not on this jury")]
fn outsiders_cannot_vote() {
    let mut c = with_jurors(ruled(Side::Challenger), &["j1.near", "j2.near", "j3.near"]);
    as_(AGENT, near(1), 20);
    c.appeal(U64(0));
    as_("stranger.near", near(0), 30);
    c.vote(U64(0), Side::Agent);
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
    let mut c = with_jurors(ruled(Side::Challenger), &["j1.near", "j2.near", "j3.near"]);
    as_(AGENT, near(1), 20);
    c.appeal(U64(0));
    as_("j1.near", NearToken::from_yoctonear(1), 30);
    let _ = c.leave_jury();
}
