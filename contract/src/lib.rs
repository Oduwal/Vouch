//! Vouch: AI agents put a bond behind every safety call they make on a NEAR account.
//! Anyone can challenge a call with a counter-stake. The contract then pauses (yield) until an
//! AI judge running in a TEE resumes it with a ruling, and the loser can appeal to a staked jury.

use near_sdk::json_types::U64;
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, YieldId, env, near,
    require,
};

mod dispute;
mod jury;
mod migrate;
pub mod types;

pub use types::*;

const MAX_REASONS: usize = 5;
const MAX_REASON_LEN: usize = 280;
const HOUR: u64 = 3_600_000_000_000;
const MINUTE: u64 = HOUR / 60;
/// Gas for the callback that notices a failed payment.
const PAYOUT_GAS: Gas = Gas::from_tgas(5);
const MAX_DUE_SCAN: usize = 200;
const MAX_WINDOW: u64 = 30 * 24 * HOUR;

// New keys only ever go on the end: each key's position names its stored data.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Agents,
    Claims,
    Latest,
    Waiting,
    Jurors,
    AgentLatest,
    Active,
    Late,
    JurorList,
    JurorIndex,
    JurorJoined,
    Commits,
    Owed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    config: Config,
    agents: IterableMap<AccountId, Agent>,
    claims: Vector<Claim>,
    /// The call a payer should see on each account. Another agent can't soften a live call.
    latest: LookupMap<AccountId, u64>,
    /// Challenged claims paused in a yield, keyed by claim id.
    waiting: IterableMap<u64, YieldId>,
    jurors: IterableMap<AccountId, Juror>,
    /// Each agent's own newest call on each account.
    agent_latest: LookupMap<(AccountId, AccountId), u64>,
    /// Claims that aren't final yet, so closing them doesn't mean scanning every claim ever made.
    active: IterableSet<u64>,
    /// Challenges whose yield timed out, and when the judge's late window ends.
    late: IterableMap<u64, u64>,
    /// The jury pool as a list, so a draw reads a few entries however large the pool is.
    juror_list: Vector<AccountId>,
    juror_index: LookupMap<AccountId, u32>,
    juror_joined: LookupMap<AccountId, u64>,
    /// Sealed jury votes until they're revealed.
    commits: LookupMap<(u64, AccountId), Vec<u8>>,
    /// Payments that failed, usually because the account was deleted. Its owner can collect them.
    owed: LookupMap<AccountId, NearToken>,
    pending_config: Option<PendingConfig>,
}

fn default_config(judge: AccountId) -> Config {
    Config {
        judge,
        challenge_window: U64(24 * HOUR),
        appeal_window: U64(24 * HOUR),
        jury_window: U64(48 * HOUR),
        min_bond: NearToken::from_millinear(500),
        challenge_stake_pct: 50,
        appeal_fee: NearToken::from_near(1),
        juror_stake: NearToken::from_near(1),
        late_ruling_window: U64(15 * MINUTE),
        juror_warmup: U64(24 * HOUR),
        juror_lockup: U64(7 * 24 * HOUR),
        no_show_slash_pct: 10,
        max_locked_bonds: 20,
        register_fee: NearToken::from_millinear(10),
        claim_fee: NearToken::from_millinear(25),
        challenge_fee: NearToken::from_millinear(30),
        appeal_storage_fee: NearToken::from_millinear(10),
        juror_fee: NearToken::from_millinear(10),
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(judge: AccountId) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            config: default_config(judge),
            agents: IterableMap::new(StorageKey::Agents),
            claims: Vector::new(StorageKey::Claims),
            latest: LookupMap::new(StorageKey::Latest),
            waiting: IterableMap::new(StorageKey::Waiting),
            jurors: IterableMap::new(StorageKey::Jurors),
            agent_latest: LookupMap::new(StorageKey::AgentLatest),
            active: IterableSet::new(StorageKey::Active),
            late: IterableMap::new(StorageKey::Late),
            juror_list: Vector::new(StorageKey::JurorList),
            juror_index: LookupMap::new(StorageKey::JurorIndex),
            juror_joined: LookupMap::new(StorageKey::JurorJoined),
            commits: LookupMap::new(StorageKey::Commits),
            owed: LookupMap::new(StorageKey::Owed),
            pending_config: None,
        }
    }

    /// Queue a config change. It can be applied once every case running today could have closed,
    /// so nobody's bond, stake or appeal changes terms partway through.
    pub fn set_config(&mut self, config: Config) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can change the config"
        );
        validate_config(&config);
        let delay = self
            .config
            .challenge_window
            .0
            .saturating_add(self.config.late_ruling_window.0)
            .saturating_add(self.config.appeal_window.0)
            .saturating_add(self.config.jury_window.0);
        let apply_after = U64(env::block_timestamp().saturating_add(delay));
        emit(
            "config_queued",
            json!({ "config": config, "apply_after": apply_after }),
        );
        self.pending_config = Some(PendingConfig {
            config,
            apply_after,
        });
    }

    /// Put a queued config change into effect once its delay has passed. Anyone can call it.
    pub fn apply_config(&mut self) {
        let pending = self
            .pending_config
            .take()
            .unwrap_or_else(|| env::panic_str("No config change is waiting"));
        require!(
            env::block_timestamp() >= pending.apply_after.0,
            "The config change is still waiting out its delay"
        );
        emit("config_applied", json!(pending.config));
        self.config = pending.config;
    }

    // ---- agents ----

    /// Register as a checking agent, or add to your bond pool. The attached deposit is the bond.
    /// A new agent's first deposit also pays for its record.
    #[payable]
    pub fn register_agent(&mut self) -> Agent {
        let deposit = env::attached_deposit();
        require!(!deposit.is_zero(), "Attach NEAR to fund your bond pool");
        let account = env::predecessor_account_id();
        let existing = self.agents.get(&account).cloned();
        let fee = if existing.is_some() {
            NearToken::from_yoctonear(0)
        } else {
            self.config.register_fee
        };
        require!(
            deposit > fee,
            format!("Attach more than the {fee} storage fee")
        );
        let mut agent = existing.unwrap_or(Agent {
            account: account.clone(),
            bond_free: NearToken::from_yoctonear(0),
            bond_locked: NearToken::from_yoctonear(0),
            calls_made: 0,
            calls_held: 0,
            calls_lost: 0,
            bond_lost: NearToken::from_yoctonear(0),
        });
        agent.bond_free = agent.bond_free.saturating_add(deposit.saturating_sub(fee));
        self.agents.insert(account, agent.clone());
        emit(
            "agent_funded",
            json!({ "agent": agent.account, "deposit": deposit, "bond_free": agent.bond_free }),
        );
        agent
    }

    /// Take free bond back out. Needs 1 yoctoNEAR attached, so a function-call key cannot do it.
    #[payable]
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let agent = self
            .agents
            .get_mut(&account)
            .unwrap_or_else(|| env::panic_str("Not a registered agent"));
        require!(
            amount <= agent.bond_free,
            "Amount is more than your free bond"
        );
        agent.bond_free = agent.bond_free.saturating_sub(amount);
        emit(
            "agent_withdrew",
            json!({ "agent": account, "amount": amount }),
        );
        Promise::new(account.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(PAYOUT_GAS)
                .on_withdraw(account, amount),
        )
    }

    /// Puts the bond back in the pool if the transfer failed.
    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: NearToken) {
        if !near_sdk::is_promise_success()
            && let Some(agent) = self.agents.get_mut(&account)
        {
            agent.bond_free = agent.bond_free.saturating_add(amount);
            emit(
                "withdraw_failed",
                json!({ "agent": account, "amount": amount }),
            );
        }
    }

    /// Records a payment that failed, so the money still has an owner.
    #[private]
    pub fn on_payout(&mut self, to: AccountId, amount: NearToken) {
        if !near_sdk::is_promise_success() {
            let owed = self
                .owed
                .get(&to)
                .copied()
                .unwrap_or(NearToken::from_yoctonear(0));
            self.owed.insert(to.clone(), owed.saturating_add(amount));
            emit("payout_failed", json!({ "to": to, "amount": amount }));
        }
    }

    /// Collect a payment that failed earlier. Works once the account exists again.
    pub fn collect_owed(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self
            .owed
            .remove(&account)
            .unwrap_or_else(|| env::panic_str("Nothing is owed to this account"));
        emit("owed_collected", json!({ "to": account, "amount": amount }));
        self.pay_promise(account, amount)
    }

    // ---- claims ----

    /// Make a call on `subject` and lock `bond` from your pool behind it. The claim is kept forever,
    /// so its storage fee comes out of the pool and doesn't come back.
    /// Takes no deposit, so an agent can sign it with a function-call key scoped to this contract.
    pub fn post_claim(
        &mut self,
        subject: AccountId,
        verdict: Level,
        reasons: Vec<String>,
        bond: NearToken,
    ) -> U64 {
        require!(
            !reasons.is_empty() && reasons.len() <= MAX_REASONS,
            "Give between 1 and 5 reasons"
        );
        require!(
            reasons
                .iter()
                .all(|r| !r.trim().is_empty() && r.len() <= MAX_REASON_LEN),
            "Each reason must be 1 to 280 bytes"
        );
        require!(bond >= self.config.min_bond, "Bond is below the minimum");
        let account = env::predecessor_account_id();
        let fee = self.config.claim_fee;
        let max_locked = self
            .config
            .min_bond
            .as_yoctonear()
            .saturating_mul(u128::from(self.config.max_locked_bonds));
        let agent = self
            .agents
            .get_mut(&account)
            .unwrap_or_else(|| env::panic_str("Not a registered agent"));
        require!(
            bond.saturating_add(fee) <= agent.bond_free,
            "Not enough free bond"
        );
        require!(
            agent
                .bond_locked
                .as_yoctonear()
                .saturating_add(bond.as_yoctonear())
                <= max_locked,
            "This agent has too many calls open"
        );
        agent.bond_free = agent.bond_free.saturating_sub(bond).saturating_sub(fee);
        agent.bond_locked = agent.bond_locked.saturating_add(bond);
        agent.calls_made += 1;

        let id = u64::from(self.claims.len());
        let now = env::block_timestamp();
        let claim = Claim {
            id: U64(id),
            agent: account.clone(),
            subject: subject.clone(),
            verdict,
            reasons,
            bond,
            posted_at: U64(now),
            challenge_until: U64(now.saturating_add(self.config.challenge_window.0)),
            status: Status::Open,
            challenge: None,
            ruling: None,
            appeal: None,
        };
        emit("claim_posted", json!(claim));

        let replaces = self
            .latest
            .get(&subject)
            .and_then(|old| self.claims.get(claim_index(*old)?))
            .is_none_or(|old| {
                old.agent == account
                    || !is_live(old, now)
                    || verdict.strictness() > old.verdict.strictness()
            });
        self.claims.push(claim);
        self.active.insert(id);
        self.agent_latest.insert((account, subject.clone()), id);
        if replaces {
            self.latest.insert(subject, id);
        }
        U64(id)
    }

    /// Close an unchallenged claim once its window has passed and return the bond to the pool.
    /// Anyone can call it.
    pub fn release(&mut self, claim_id: U64) {
        let claim = self.claim(claim_id.0);
        require!(
            claim.status == Status::Open,
            "Only an open claim can be released"
        );
        require!(
            env::block_timestamp() >= claim.challenge_until.0,
            "The challenge window is still open"
        );
        self.settle(claim_id.0, Side::Agent);
    }

    /// Close a case whose time has run out: a ruling nobody appealed, an appeal whose jury ran out
    /// of time, or a challenge the judge never answered. Anyone can call it.
    pub fn finalize(&mut self, claim_id: U64) {
        let claim = self.claim(claim_id.0);
        let now = env::block_timestamp();
        match claim.status {
            Status::Ruled => {
                let ruling = claim.ruling.as_ref().unwrap();
                require!(
                    now >= ruling.appeal_until.0,
                    "The appeal window is still open"
                );
                let winner = ruling.winner;
                self.settle(claim_id.0, winner);
            }
            Status::Appealed => {
                let appeal = claim.appeal.as_ref().unwrap();
                require!(now >= appeal.jury_until.0, "The jury is still voting");
                self.close_appeal(claim_id.0, None);
            }
            Status::Challenged => {
                let until = self.late.get(&claim_id.0).copied().unwrap_or_else(|| {
                    env::panic_str("The judge can still rule on this challenge")
                });
                require!(now >= until, "The judge can still rule on this challenge");
                self.void(claim_id.0);
            }
            _ => env::panic_str("This claim has nothing left to finalize"),
        }
    }

    // ---- views ----

    pub fn get_config(&self) -> &Config {
        &self.config
    }

    pub fn get_pending_config(&self) -> Option<&PendingConfig> {
        self.pending_config.as_ref()
    }

    pub fn get_owner(&self) -> &AccountId {
        &self.owner
    }

    pub fn get_claim(&self, claim_id: U64) -> Option<&Claim> {
        self.claims.get(claim_index(claim_id.0)?)
    }

    pub fn get_claims(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<&Claim> {
        let Some(from) = claim_index(from_index.map_or(0, |i| i.0)) else {
            return vec![];
        };
        let limit = limit.unwrap_or(50).min(100);
        (from..self.claims.len())
            .take(limit as usize)
            .filter_map(|i| self.claims.get(i))
            .collect()
    }

    pub fn claims_count(&self) -> U64 {
        U64(u64::from(self.claims.len()))
    }

    /// The call a payer should see on an account. Newest wins, except that a live call can only be
    /// replaced by another agent with a stricter one, so a throwaway agent can't soften a block.
    pub fn get_verdict(&self, subject: AccountId) -> Option<&Claim> {
        self.latest
            .get(&subject)
            .and_then(|id| self.claims.get(claim_index(*id)?))
    }

    /// One agent's newest call on an account, whatever other agents have said since.
    pub fn get_agent_verdict(&self, agent: AccountId, subject: AccountId) -> Option<&Claim> {
        self.agent_latest
            .get(&(agent, subject))
            .and_then(|id| self.claims.get(claim_index(*id)?))
    }

    /// Claims whose time has run out, ready for `release` or `finalize`. Looks only at claims that
    /// aren't final yet, so the cost doesn't grow with history. Page with `from_index` until empty.
    pub fn get_due(&self, from_index: Option<u32>) -> Vec<&Claim> {
        let now = env::block_timestamp();
        self.active
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(MAX_DUE_SCAN)
            .filter_map(|id| self.claims.get(claim_index(*id)?))
            .filter(|claim| self.is_due(claim, now))
            .collect()
    }

    pub fn active_count(&self) -> u32 {
        self.active.len()
    }

    pub fn get_agent(&self, account: AccountId) -> Option<&Agent> {
        self.agents.get(&account)
    }

    pub fn get_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<&Agent> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.agents.values().skip(from).take(limit).collect()
    }

    pub fn get_juror(&self, account: AccountId) -> Option<&Juror> {
        self.jurors.get(&account)
    }

    /// When a juror joined, in nanoseconds. They can be drawn after `juror_warmup` and leave after
    /// `juror_lockup`.
    pub fn get_juror_joined(&self, account: AccountId) -> Option<U64> {
        self.juror_joined.get(&account).map(|t| U64(*t))
    }

    pub fn get_jurors(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<&Juror> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.jurors.values().skip(from).take(limit).collect()
    }

    /// Whether a juror has sealed a vote on an appeal.
    pub fn has_committed(&self, claim_id: U64, juror: AccountId) -> bool {
        self.commits.contains_key(&(claim_id.0, juror))
    }

    pub fn get_owed(&self, account: AccountId) -> NearToken {
        self.owed
            .get(&account)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    /// Challenges the judge can still rule on. The judge service polls this.
    pub fn get_waiting(&self) -> Vec<&Claim> {
        let now = env::block_timestamp();
        let late = self
            .late
            .iter()
            .filter(|(_, until)| now < **until)
            .map(|(id, _)| id);
        self.waiting
            .keys()
            .chain(late)
            .filter_map(|id| self.claims.get(claim_index(*id)?))
            .collect()
    }
}

/// The owner's limits on the owner. Without them, a slip could make challenges free or freeze a case.
fn validate_config(config: &Config) {
    require!(
        (10..=100).contains(&config.challenge_stake_pct),
        "challenge_stake_pct must be 10 to 100"
    );
    require!(
        config.no_show_slash_pct <= 100,
        "no_show_slash_pct must be at most 100"
    );
    require!(
        !config.min_bond.is_zero() && !config.appeal_fee.is_zero() && !config.juror_stake.is_zero(),
        "The bond, appeal fee and juror stake can't be zero"
    );
    require!(
        config.appeal_fee > config.appeal_storage_fee,
        "The appeal fee must cover its storage fee"
    );
    for window in [
        config.challenge_window,
        config.appeal_window,
        config.jury_window,
        config.late_ruling_window,
    ] {
        require!(
            window.0 >= MINUTE && window.0 <= MAX_WINDOW,
            "Each window must be from a minute to 30 days"
        );
    }
    require!(
        config.juror_warmup.0 <= MAX_WINDOW && config.juror_lockup.0 <= MAX_WINDOW,
        "A juror's waits can't be over 30 days"
    );
    require!(
        config.max_locked_bonds > 0,
        "max_locked_bonds can't be zero"
    );
}

/// A claim id as a vector index. An id too large for the vector is no claim at all: a plain cast
/// would wrap 2^32 round to claim 0.
fn claim_index(id: u64) -> Option<u32> {
    u32::try_from(id).ok()
}

/// Whether a claim still stands behind its call.
fn is_live(claim: &Claim, now: u64) -> bool {
    match claim.status {
        Status::Open => now < claim.challenge_until.0,
        Status::Challenged | Status::Ruled | Status::Appealed => true,
        Status::Held | Status::Overturned | Status::Void => false,
    }
}

impl Contract {
    fn claim(&self, id: u64) -> &Claim {
        claim_index(id)
            .and_then(|i| self.claims.get(i))
            .unwrap_or_else(|| env::panic_str("No claim with that id"))
    }

    fn claim_mut(&mut self, id: u64) -> &mut Claim {
        let index = claim_index(id).unwrap_or_else(|| env::panic_str("No claim with that id"));
        self.claims
            .get_mut(index)
            .unwrap_or_else(|| env::panic_str("No claim with that id"))
    }

    fn is_due(&self, claim: &Claim, now: u64) -> bool {
        match claim.status {
            Status::Open => now >= claim.challenge_until.0,
            Status::Ruled => claim
                .ruling
                .as_ref()
                .is_some_and(|r| now >= r.appeal_until.0),
            Status::Appealed => claim.appeal.as_ref().is_some_and(|a| now >= a.jury_until.0),
            Status::Challenged => self
                .late
                .get(&claim.id.0)
                .is_some_and(|until| now >= *until),
            Status::Held | Status::Overturned | Status::Void => false,
        }
    }

    fn pay_promise(&self, to: AccountId, amount: NearToken) -> Promise {
        Promise::new(to.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(PAYOUT_GAS)
                .on_payout(to, amount),
        )
    }

    /// Send money that a failure must not lose: if the transfer bounces, it's recorded as owed.
    fn pay(&self, to: AccountId, amount: NearToken) {
        if !amount.is_zero() {
            self.pay_promise(to, amount).detach();
        }
    }

    /// Pay out a claim for good. The winner takes the bond and any counter-stake.
    fn settle(&mut self, id: u64, winner: Side) {
        let claim = self.claim_mut(id);
        let bond = claim.bond;
        let agent_id = claim.agent.clone();
        let challenge = claim.challenge.clone();
        let stake = challenge
            .as_ref()
            .map_or(NearToken::from_yoctonear(0), |c| c.stake);
        claim.status = match winner {
            Side::Agent => Status::Held,
            Side::Challenger => Status::Overturned,
        };

        self.active.remove(&id);
        let agent = self.agents.get_mut(&agent_id).unwrap();
        agent.bond_locked = agent.bond_locked.saturating_sub(bond);
        match winner {
            Side::Agent => {
                agent.bond_free = agent.bond_free.saturating_add(bond).saturating_add(stake);
                agent.calls_held += 1;
            }
            Side::Challenger => {
                agent.calls_lost += 1;
                agent.bond_lost = agent.bond_lost.saturating_add(bond);
                let challenger = challenge.unwrap().challenger;
                self.pay(challenger, bond.saturating_add(stake));
            }
        }
        emit(
            "claim_settled",
            json!({ "claim_id": U64(id), "winner": winner, "bond": bond, "stake": stake }),
        );
    }
}

/// Log a NEP-297 event so indexers and the judge service can follow along.
fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "vouch", "version": "1.1.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
