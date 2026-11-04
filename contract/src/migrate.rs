//! Moves the deployed contract to the current state layout. The claims, agents and jurors stay where
//! they are, in the same format. Only the top-level struct changes, gaining two empty fields.

use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{AccountId, NearToken, YieldId, env, near};

use crate::{Agent, Claim, Config, Contract, ContractExt, Juror, PendingConfig, StorageKey};

#[near(serializers = [borsh])]
struct OldContract {
    owner: AccountId,
    config: Config,
    agents: IterableMap<AccountId, Agent>,
    claims: Vector<Claim>,
    latest: LookupMap<AccountId, u64>,
    waiting: IterableMap<u64, YieldId>,
    jurors: IterableMap<AccountId, Juror>,
    agent_latest: LookupMap<(AccountId, AccountId), u64>,
    active: IterableSet<u64>,
    late: IterableMap<u64, u64>,
    juror_list: Vector<AccountId>,
    juror_index: LookupMap<AccountId, u32>,
    juror_joined: LookupMap<AccountId, u64>,
    commits: LookupMap<(u64, AccountId), Vec<u8>>,
    owed: LookupMap<AccountId, NearToken>,
    pending_config: Option<PendingConfig>,
}

#[near]
impl Contract {
    /// One-time upgrade. Only the contract itself can call it.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: OldContract = env::state_read().expect("No state to migrate");
        Self {
            owner: old.owner,
            config: old.config,
            agents: old.agents,
            claims: old.claims,
            latest: old.latest,
            waiting: old.waiting,
            jurors: old.jurors,
            agent_latest: old.agent_latest,
            active: old.active,
            late: old.late,
            juror_list: old.juror_list,
            juror_index: old.juror_index,
            juror_joined: old.juror_joined,
            commits: old.commits,
            owed: old.owed,
            pending_config: old.pending_config,
            rounds: LookupMap::new(StorageKey::Rounds),
            pending_upgrade: None,
        }
    }
}
