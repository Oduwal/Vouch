//! Moves the deployed contract to the current state layout. The claims, agents and jurors stay where
//! they are, in the same format. Only the top-level struct changes, and the new indexes are built here.

use near_sdk::json_types::U64;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{AccountId, NearToken, YieldId, env, near, require};

use crate::{Agent, Claim, Contract, ContractExt, Juror, Status, StorageKey};

#[near(serializers = [borsh])]
struct OldConfig {
    judge: AccountId,
    challenge_window: U64,
    appeal_window: U64,
    jury_window: U64,
    min_bond: NearToken,
    challenge_stake_pct: u8,
    appeal_fee: NearToken,
    juror_stake: NearToken,
}

#[near(serializers = [borsh])]
struct OldContract {
    owner: AccountId,
    config: OldConfig,
    agents: IterableMap<AccountId, Agent>,
    claims: Vector<Claim>,
    latest: LookupMap<AccountId, u64>,
    waiting: IterableMap<u64, YieldId>,
    jurors: IterableMap<AccountId, Juror>,
}

#[near]
impl Contract {
    /// One-time upgrade. Only the contract's own key can call it. It reads every claim, so it runs
    /// while the claim list is still small enough to fit in one transaction.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(warmup: U64, lockup: U64) -> Self {
        let old: OldContract = env::state_read().expect("No state to migrate");
        require!(
            old.waiting.is_empty(),
            "A challenge is waiting for the judge"
        );
        require!(old.jurors.is_empty(), "The jury pool must be empty");

        let mut config = crate::default_config(old.config.judge);
        config.challenge_window = old.config.challenge_window;
        config.appeal_window = old.config.appeal_window;
        config.jury_window = old.config.jury_window;
        config.min_bond = old.config.min_bond;
        config.challenge_stake_pct = old.config.challenge_stake_pct;
        config.appeal_fee = old.config.appeal_fee;
        config.juror_stake = old.config.juror_stake;
        config.juror_warmup = warmup;
        config.juror_lockup = lockup;

        let mut agent_latest = LookupMap::new(StorageKey::AgentLatest);
        let mut active = IterableSet::new(StorageKey::Active);
        for claim in old.claims.iter() {
            agent_latest.insert((claim.agent.clone(), claim.subject.clone()), claim.id.0);
            if matches!(
                claim.status,
                Status::Open | Status::Ruled | Status::Appealed
            ) {
                active.insert(claim.id.0);
            }
        }

        Self {
            owner: old.owner,
            config,
            agents: old.agents,
            claims: old.claims,
            latest: old.latest,
            waiting: old.waiting,
            jurors: old.jurors,
            agent_latest,
            active,
            late: IterableMap::new(StorageKey::Late),
            juror_list: Vector::new(StorageKey::JurorList),
            juror_index: LookupMap::new(StorageKey::JurorIndex),
            juror_joined: LookupMap::new(StorageKey::JurorJoined),
            commits: LookupMap::new(StorageKey::Commits),
            owed: LookupMap::new(StorageKey::Owed),
            pending_config: None,
        }
    }
}
