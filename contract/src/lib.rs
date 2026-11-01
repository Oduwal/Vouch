//! Vouch: AI agents put a bond behind every safety call they make on a NEAR account.
//! Anyone can challenge a call with a counter-stake. The contract then pauses (yield) until an
//! AI judge running in a TEE resumes it with a ruling, and the loser can appeal to a staked jury.

use near_sdk::json_types::U64;
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, YieldId, env, near, require,
};

mod dispute;
mod jury;
pub mod types;

pub use types::*;

const MAX_REASONS: usize = 5;
const MAX_REASON_LEN: usize = 280;
const HOUR: u64 = 3_600_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Agents,
    Claims,
    Latest,
    Waiting,
    Jurors,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    config: Config,
    agents: IterableMap<AccountId, Agent>,
    claims: Vector<Claim>,
    /// The newest claim made about each account.
    latest: LookupMap<AccountId, u64>,
    /// Challenged claims paused in a yield, keyed by claim id.
    waiting: IterableMap<u64, YieldId>,
    jurors: IterableMap<AccountId, Juror>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(judge: AccountId) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            config: Config {
                judge,
                challenge_window: U64(24 * HOUR),
                appeal_window: U64(24 * HOUR),
                jury_window: U64(48 * HOUR),
                min_bond: NearToken::from_millinear(500),
                challenge_stake_pct: 50,
                appeal_fee: NearToken::from_near(1),
                juror_stake: NearToken::from_near(1),
            },
            agents: IterableMap::new(StorageKey::Agents),
            claims: Vector::new(StorageKey::Claims),
            latest: LookupMap::new(StorageKey::Latest),
            waiting: IterableMap::new(StorageKey::Waiting),
            jurors: IterableMap::new(StorageKey::Jurors),
        }
    }

    pub fn set_config(&mut self, config: Config) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can change the config"
        );
        require!(
            config.challenge_stake_pct <= 100,
            "challenge_stake_pct is a percentage"
        );
        self.config = config;
    }

    // ---- agents ----

    /// Register as a checking agent, or add to your bond pool. The attached deposit is the bond.
    #[payable]
    pub fn register_agent(&mut self) -> Agent {
        let deposit = env::attached_deposit();
        require!(!deposit.is_zero(), "Attach NEAR to fund your bond pool");
        let account = env::predecessor_account_id();
        let mut agent = self.agents.get(&account).cloned().unwrap_or(Agent {
            account: account.clone(),
            bond_free: NearToken::from_yoctonear(0),
            bond_locked: NearToken::from_yoctonear(0),
            calls_made: 0,
            calls_held: 0,
            calls_lost: 0,
            bond_lost: NearToken::from_yoctonear(0),
        });
        agent.bond_free = agent.bond_free.saturating_add(deposit);
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
        Promise::new(account).transfer(amount)
    }

    // ---- claims ----

    /// Make a call on `subject` and lock `bond` from your pool behind it.
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
            "Each reason must be 1 to 280 characters"
        );
        require!(bond >= self.config.min_bond, "Bond is below the minimum");
        let account = env::predecessor_account_id();
        let agent = self
            .agents
            .get_mut(&account)
            .unwrap_or_else(|| env::panic_str("Not a registered agent"));
        require!(bond <= agent.bond_free, "Not enough free bond");
        agent.bond_free = agent.bond_free.saturating_sub(bond);
        agent.bond_locked = agent.bond_locked.saturating_add(bond);
        agent.calls_made += 1;

        let id = self.claims.len() as u64;
        let now = env::block_timestamp();
        let claim = Claim {
            id: U64(id),
            agent: account,
            subject: subject.clone(),
            verdict,
            reasons,
            bond,
            posted_at: U64(now),
            challenge_until: U64(now + self.config.challenge_window.0),
            status: Status::Open,
            challenge: None,
            ruling: None,
            appeal: None,
        };
        emit("claim_posted", json!(claim));
        self.claims.push(claim);
        self.latest.insert(subject, id);
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

    /// Settle a ruling nobody appealed, or an appeal whose jury ran out of time. Anyone can call it.
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
                self.settle(claim_id.0, ruling.winner);
            }
            Status::Appealed => {
                let appeal = claim.appeal.as_ref().unwrap();
                require!(now >= appeal.jury_until.0, "The jury is still voting");
                self.close_appeal(claim_id.0, None);
            }
            _ => env::panic_str("Only a ruled or appealed claim can be finalized"),
        }
    }

    // ---- views ----

    pub fn get_config(&self) -> &Config {
        &self.config
    }

    pub fn get_owner(&self) -> &AccountId {
        &self.owner
    }

    pub fn get_claim(&self, claim_id: U64) -> Option<&Claim> {
        self.claims.get(claim_id.0 as u32)
    }

    pub fn get_claims(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<&Claim> {
        let from = from_index.map_or(0, |i| i.0 as u32);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.claims.len())
            .take(limit as usize)
            .filter_map(|i| self.claims.get(i))
            .collect()
    }

    pub fn claims_count(&self) -> U64 {
        U64(self.claims.len() as u64)
    }

    /// The newest call on an account. This is what a paying agent checks before it signs.
    pub fn get_verdict(&self, subject: AccountId) -> Option<&Claim> {
        self.latest
            .get(&subject)
            .and_then(|id| self.claims.get(*id as u32))
    }

    pub fn get_agent(&self, account: AccountId) -> Option<&Agent> {
        self.agents.get(&account)
    }

    pub fn get_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<&Agent> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.agents.values().skip(from).take(limit).collect()
    }

    /// Challenged claims waiting for the judge. The judge service polls this.
    pub fn get_waiting(&self) -> Vec<&Claim> {
        self.waiting
            .keys()
            .filter_map(|id| self.claims.get(*id as u32))
            .collect()
    }
}

impl Contract {
    fn claim(&self, id: u64) -> &Claim {
        self.claims
            .get(id as u32)
            .unwrap_or_else(|| env::panic_str("No claim with that id"))
    }

    fn claim_mut(&mut self, id: u64) -> &mut Claim {
        self.claims
            .get_mut(id as u32)
            .unwrap_or_else(|| env::panic_str("No claim with that id"))
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
                Promise::new(challenger)
                    .transfer(bond.saturating_add(stake))
                    .detach();
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
        json!({ "standard": "vouch", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
