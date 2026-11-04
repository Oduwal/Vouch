//! A wallet an AI agent can spend from but can't empty. The agent signs with a function-call key,
//! which can't send NEAR by itself, so every payment has to come through `pay` or `call`. Before any
//! NEAR moves, this contract reads Vouch and applies the owner's limits. The checks live here, on-chain,
//! so an agent that has been talked into a bad payment can't skip them. With
//! `first_payment_needs_owner` on, a compromised agent can only pay accounts the owner has already
//! said yes to, up to the daily limit.

use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env,
    ext_contract, near, require,
};

const HOUR: u64 = 3_600_000_000_000;
const DAY: u64 = 24 * HOUR;
/// A payment waiting for the owner lapses after this, and gives its budget back.
const PENDING_TTL: u64 = DAY;
const MAX_PENDING: u32 = 20;
const MAX_LISTED: usize = 64;
const MAX_ARGS_LEN: usize = 1024;
/// NEAR refuses a longer or empty method name, and by then the budget would already be charged.
const MAX_METHOD_LEN: usize = 256;
const MAX_CALL_TGAS: u32 = 100;
/// Room for a Vouch answer: a claim, or at most five reports. Anything bigger is refused.
const MAX_ANSWER_LEN: usize = 64 * 1024;
const VIEW_GAS: Gas = Gas::from_tgas(20);
const ON_DONE_GAS: Gas = Gas::from_tgas(15);
/// For `on_checked` itself, on top of what it passes on to the payment.
const DECIDE_GAS: Gas = Gas::from_tgas(25);
/// Kept back so storage for waiting payments, at most about 1.5 KB each, can always be paid for.
const STORAGE_CUSHION: NearToken = NearToken::from_millinear(300);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Pending,
    Paid,
}

// ---- what Vouch answers. Only the fields used here: the rest are ignored ----

#[near(serializers = [json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Allow,
    Warn,
    Block,
}

#[near(serializers = [json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    Challenged,
    Ruled,
    Appealed,
    Held,
    Overturned,
    Void,
}

#[near(serializers = [json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Agent,
    Challenger,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RulingSeen {
    pub winner: Side,
    pub appeal_until: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Claim {
    pub id: U64,
    pub agent: AccountId,
    pub subject: AccountId,
    pub verdict: Level,
    pub status: Status,
    pub challenge_until: U64,
    pub ruling: Option<RulingSeen>,
}

#[ext_contract(ext_vouch)]
pub trait Vouch {
    fn get_agent_verdict(&self, agent: AccountId, subject: AccountId) -> Option<Claim>;
    fn get_reports(&self, subject: AccountId) -> Vec<Claim>;
}

// ---- the wallet's own types ----

/// Who the agent may pay. `Only` with an empty list sends nothing out.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum Destinations {
    Any,
    Only(Vec<AccountId>),
    Except(Vec<AccountId>),
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    /// The Vouch contract to ask.
    pub vouch: AccountId,
    /// The agent whose bonded call this wallet trusts. Anyone can post a call, so another agent's
    /// `allow` counts for nothing here, and another agent's `block` report always counts.
    pub checker: AccountId,
    pub per_payment: NearToken,
    pub per_day: NearToken,
    pub max_actions_per_hour: u32,
    pub destinations: Destinations,
    /// Whether the first payment to any account needs the owner's yes, even on an `allow`.
    pub first_payment_needs_owner: bool,
    /// Exactly what the agent may call. A verdict covers the contract, not what a call does once
    /// inside it, such as moving tokens, so this names methods and stays empty unless the owner chooses.
    pub callable: Vec<CallableMethod>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallableMethod {
    pub contract: AccountId,
    pub method: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum Action {
    Transfer {
        to: AccountId,
        amount: NearToken,
    },
    Call {
        contract: AccountId,
        method: String,
        args: Base64VecU8,
        deposit: NearToken,
        gas_tgas: u32,
    },
}

impl Action {
    fn receiver(&self) -> &AccountId {
        match self {
            Action::Transfer { to, .. } => to,
            Action::Call { contract, .. } => contract,
        }
    }

    fn amount(&self) -> NearToken {
        match self {
            Action::Transfer { amount, .. } => *amount,
            Action::Call { deposit, .. } => *deposit,
        }
    }

    fn forward_gas(&self) -> Gas {
        match self {
            Action::Transfer { .. } => Gas::from_tgas(0),
            Action::Call { gas_tgas, .. } => Gas::from_tgas(u64::from(*gas_tgas)),
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub id: U64,
    pub action: Action,
    /// The day it was charged to, so giving it back can't free up a later day's budget.
    pub charged_day: U64,
    pub reason: String,
    pub requested_at: U64,
}

/// What became of a request. This is the value `pay` and `call` end with.
#[near(serializers = [json])]
#[serde(tag = "status", rename_all = "lowercase")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Paid { to: AccountId, amount: NearToken },
    Pending { id: U64, reason: String },
    Refused { reason: String },
    Failed { reason: String },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Allow,
    Ask(String),
    Refuse(String),
}

/// Whether a claim still stands behind its call, and hasn't been ruled wrong. An upheld call stops
/// standing when its appeal window ends: nobody can challenge it after that, finalized or not.
fn is_live(claim: &Claim, now: u64) -> bool {
    match claim.status {
        Status::Open => now < claim.challenge_until.0,
        Status::Ruled => claim
            .ruling
            .as_ref()
            .is_some_and(|r| r.winner != Side::Challenger && now < r.appeal_until.0),
        Status::Challenged | Status::Appealed => claim
            .ruling
            .as_ref()
            .is_none_or(|r| r.winner != Side::Challenger),
        Status::Held | Status::Overturned | Status::Void => false,
    }
}

/// The rule at the centre of the wallet. Anything it can't read as safe is refused.
pub(crate) fn decide(
    own: Option<&Claim>,
    reports: &[Claim],
    to: &AccountId,
    policy: &Policy,
    paid_before: bool,
    now: u64,
) -> Decision {
    let checker = &policy.checker;
    let reports: Vec<&Claim> = reports
        .iter()
        .filter(|r| &r.subject == to && &r.agent != checker)
        .collect();
    // A report blocks only while someone can still challenge it and take its bond.
    if let Some(report) = reports.iter().find(|r| is_live(r, now)) {
        return Decision::Refuse(format!(
            "{} reported this account, with a bond at risk, in claim {}",
            report.agent, report.id.0
        ));
    }
    let Some(claim) = own.filter(|c| &c.agent == checker && &c.subject == to) else {
        return Decision::Refuse(format!("{checker} has no bonded call on this account"));
    };
    if !is_live(claim, now) {
        return Decision::Refuse(format!(
            "{checker}'s call on this account is closed or was ruled wrong"
        ));
    }
    if claim.verdict == Level::Block {
        return Decision::Refuse(format!(
            "{checker} blocks this account in claim {}",
            claim.id.0
        ));
    }
    if let Some(report) = reports.first() {
        return Decision::Ask(format!(
            "{} reported this account in claim {}, and nobody challenged it",
            report.agent, report.id.0
        ));
    }
    if claim.verdict == Level::Warn {
        return Decision::Ask(format!(
            "{checker} warns about this account in claim {}",
            claim.id.0
        ));
    }
    if matches!(claim.status, Status::Challenged | Status::Appealed) {
        return Decision::Ask(format!(
            "Someone is disputing the allow in claim {}",
            claim.id.0
        ));
    }
    if policy.first_payment_needs_owner && !paid_before {
        return Decision::Ask("This wallet has never paid this account".into());
    }
    Decision::Allow
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "vouch-wallet", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// A promise's JSON answer. A failed call or one that doesn't parse gives None, so it's refused.
fn answer<T: near_sdk::serde::de::DeserializeOwned>(index: u64) -> Option<T> {
    let bytes = env::promise_result_checked(index, MAX_ANSWER_LEN).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn validate_policy(policy: &Policy) {
    require!(
        !policy.per_payment.is_zero() && policy.per_payment <= policy.per_day,
        "per_payment must be above zero and at most per_day"
    );
    require!(
        policy.max_actions_per_hour > 0,
        "max_actions_per_hour can't be zero"
    );
    let listed = match &policy.destinations {
        Destinations::Any => 0,
        Destinations::Only(list) | Destinations::Except(list) => list.len(),
    };
    require!(
        policy
            .callable
            .iter()
            .all(|c| !c.method.is_empty() && c.method.len() <= MAX_METHOD_LEN),
        "A method name must be 1 to 256 bytes"
    );
    require!(
        listed <= MAX_LISTED && policy.callable.len() <= MAX_LISTED,
        "A list can hold at most 64 accounts"
    );
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Wallet {
    owner: AccountId,
    agent: AccountId,
    policy: Policy,
    frozen: bool,
    day_start: u64,
    spent_today: NearToken,
    hour_start: u64,
    actions_this_hour: u32,
    /// Charged to the budget, but not yet sent or given back.
    reserved: NearToken,
    next_id: u64,
    pending: IterableMap<u64, Pending>,
    /// How many times this wallet has really paid each account. The prior-interaction record: a
    /// transaction someone else sends can't add to it.
    paid: LookupMap<AccountId, u32>,
}

#[near]
impl Wallet {
    #[init]
    #[private]
    pub fn new(owner: AccountId, agent: AccountId, policy: Policy) -> Self {
        validate_policy(&policy);
        Self {
            owner,
            agent,
            policy,
            frozen: false,
            day_start: env::block_timestamp(),
            spent_today: NearToken::from_yoctonear(0),
            hour_start: env::block_timestamp(),
            actions_this_hour: 0,
            reserved: NearToken::from_yoctonear(0),
            next_id: 0,
            pending: IterableMap::new(StorageKey::Pending),
            paid: LookupMap::new(StorageKey::Paid),
        }
    }

    // ---- what the agent can do ----

    /// Send NEAR, if Vouch and the owner's limits allow it.
    pub fn pay(&mut self, to: AccountId, amount: NearToken) -> Promise {
        require!(!amount.is_zero(), "Nothing to pay");
        self.start(Action::Transfer { to, amount })
    }

    /// Call a method the owner listed, if Vouch and the owner's limits allow it.
    pub fn call(
        &mut self,
        target: AccountId,
        method: String,
        args: Base64VecU8,
        deposit: NearToken,
        gas_tgas: u32,
    ) -> Promise {
        require!(
            gas_tgas > 0 && gas_tgas <= MAX_CALL_TGAS,
            "gas_tgas must be 1 to 100"
        );
        require!(args.0.len() <= MAX_ARGS_LEN, "args must be at most 4 KB");
        require!(
            self.policy.callable.contains(&CallableMethod {
                contract: target.clone(),
                method: method.clone(),
            }),
            "The owner hasn't allowed this call"
        );
        self.start(Action::Call {
            contract: target,
            method,
            args,
            deposit,
            gas_tgas,
        })
    }

    /// Vouch has answered. The agent can't reach this: only the wallet itself can call it.
    #[private]
    pub fn on_checked(&mut self, action: Action, charged_day: U64) -> PromiseOrValue<Outcome> {
        let to = action.receiver().clone();
        let own: Option<Option<Claim>> = answer(0);
        let reports: Option<Vec<Claim>> = answer(1);
        let paid_before = self.paid.contains_key(&to);
        let decision = match (own, reports) {
            _ if self.frozen => Decision::Refuse("The owner froze this wallet".into()),
            (Some(own), Some(reports)) => decide(
                own.as_ref(),
                &reports,
                &to,
                &self.policy,
                paid_before,
                env::block_timestamp(),
            ),
            _ => Decision::Refuse("Vouch gave no answer".into()),
        };
        match decision {
            Decision::Allow => PromiseOrValue::Promise(self.send(action, charged_day)),
            Decision::Ask(_) if self.pending.len() >= MAX_PENDING => {
                let reason = "Too many payments are waiting for the owner".to_string();
                self.give_back(action.amount(), charged_day);
                PromiseOrValue::Value(Outcome::Refused { reason })
            }
            Decision::Ask(reason) => {
                let id = self.next_id;
                self.next_id += 1;
                let pending = Pending {
                    id: U64(id),
                    action,
                    charged_day,
                    reason: reason.clone(),
                    requested_at: U64(env::block_timestamp()),
                };
                emit("payment_waiting", json!(pending));
                self.pending.insert(id, pending);
                PromiseOrValue::Value(Outcome::Pending {
                    id: U64(id),
                    reason,
                })
            }
            Decision::Refuse(reason) => {
                self.give_back(action.amount(), charged_day);
                emit("payment_refused", json!({ "to": to, "reason": reason }));
                PromiseOrValue::Value(Outcome::Refused { reason })
            }
        }
    }

    /// The payment has run. A failed transfer comes back by itself, so its budget does too. A failed
    /// call stays charged for the day: a contract can keep the deposit and still report failure.
    #[private]
    pub fn on_done(&mut self, action: Action, charged_day: U64) -> Outcome {
        let to = action.receiver().clone();
        let amount = action.amount();
        self.reserved = self.reserved.saturating_sub(amount);
        if near_sdk::is_promise_success() {
            let times = self.paid.get(&to).copied().unwrap_or(0);
            self.paid.insert(to.clone(), times.saturating_add(1));
            emit("payment_sent", json!({ "to": to, "amount": amount }));
            Outcome::Paid { to, amount }
        } else {
            if matches!(action, Action::Transfer { .. }) {
                self.refund_budget(amount, charged_day);
            }
            emit("payment_failed", json!({ "to": to, "amount": amount }));
            Outcome::Failed {
                reason: "The receiver's side of the payment failed".into(),
            }
        }
    }

    // ---- what the owner can do. Each needs 1 yoctoNEAR, so no function-call key can do it ----

    /// Send a waiting payment. This is the human's yes.
    #[payable]
    pub fn approve(&mut self, id: U64) -> Promise {
        self.require_owner();
        require!(!self.frozen, "This wallet is frozen");
        let pending = self
            .pending
            .remove(&id.0)
            .unwrap_or_else(|| env::panic_str("No payment is waiting with that id"));
        require!(
            env::block_timestamp() < pending.requested_at.0.saturating_add(PENDING_TTL),
            "This payment has lapsed"
        );
        // The limits may have tightened since it was asked for.
        require!(
            self.destination_allowed(pending.action.receiver()),
            "The owner's list doesn't allow this receiver any more"
        );
        require!(
            pending.action.amount() <= self.policy.per_payment,
            "That's over the limit on one payment now"
        );
        emit("payment_approved", json!({ "id": id }));
        self.send(pending.action, pending.charged_day)
    }

    #[payable]
    pub fn reject(&mut self, id: U64) {
        self.require_owner();
        let pending = self
            .pending
            .remove(&id.0)
            .unwrap_or_else(|| env::panic_str("No payment is waiting with that id"));
        self.give_back(pending.action.amount(), pending.charged_day);
        emit("payment_rejected", json!({ "id": id }));
    }

    /// Repair the books if a callback ever failed and left money marked as spoken for. Frozen only, so
    /// nothing is on its way while it runs. What's still spoken for is what's waiting for the owner.
    #[payable]
    pub fn reconcile(&mut self) {
        self.require_owner();
        require!(self.frozen, "Freeze the wallet first");
        self.reserved = NearToken::from_yoctonear(
            self.pending
                .values()
                .map(|p| p.action.amount().as_yoctonear())
                .sum(),
        );
        emit("wallet_reconciled", json!({ "reserved": self.reserved }));
    }

    /// Stop everything at once. Payments already waiting stay waiting.
    #[payable]
    pub fn freeze(&mut self) {
        self.require_owner();
        self.frozen = true;
        emit("wallet_frozen", json!({}));
    }

    #[payable]
    pub fn unfreeze(&mut self) {
        self.require_owner();
        self.frozen = false;
        emit("wallet_unfrozen", json!({}));
    }

    #[payable]
    pub fn set_policy(&mut self, policy: Policy) {
        self.require_owner();
        validate_policy(&policy);
        emit("policy_changed", json!(policy));
        self.policy = policy;
    }

    /// Replace the agent, for instance if its key leaks.
    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) {
        self.require_owner();
        emit("agent_changed", json!({ "agent": agent }));
        self.agent = agent;
    }

    /// Take money out. The owner can always get back whatever isn't waiting on a payment.
    #[payable]
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        self.require_owner();
        require!(
            amount <= self.available(),
            "That's more than the wallet has free"
        );
        Promise::new(self.owner.clone()).transfer(amount)
    }

    // ---- open to anyone ----

    /// Clear a waiting payment nobody answered, and give its budget back.
    pub fn expire(&mut self, id: U64) {
        let pending = self
            .pending
            .get(&id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No payment is waiting with that id"));
        require!(
            env::block_timestamp() >= pending.requested_at.0.saturating_add(PENDING_TTL),
            "This payment can still be approved"
        );
        self.pending.remove(&id.0);
        self.give_back(pending.action.amount(), pending.charged_day);
        emit("payment_lapsed", json!({ "id": id }));
    }

    pub fn get_policy(&self) -> &Policy {
        &self.policy
    }

    /// How many times this wallet has really paid an account.
    pub fn payments_to(&self, account: AccountId) -> u32 {
        self.paid.get(&account).copied().unwrap_or(0)
    }

    pub fn get_pending(&self) -> Vec<&Pending> {
        self.pending.values().collect()
    }

    pub fn get_status(&self) -> Value {
        json!({
            "owner": self.owner,
            "agent": self.agent,
            "frozen": self.frozen,
            "spent_today": self.spent_today,
            "actions_this_hour": self.actions_this_hour,
            "reserved": self.reserved,
            "available": self.available(),
        })
    }
}

impl Wallet {
    fn require_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can do this"
        );
    }

    fn destination_allowed(&self, to: &AccountId) -> bool {
        match &self.policy.destinations {
            Destinations::Any => true,
            Destinations::Only(list) => list.contains(to),
            Destinations::Except(list) => !list.contains(to),
        }
    }

    /// What's spendable: the balance, less storage, a cushion, and what's already spoken for.
    fn available(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
        env::account_balance()
            .saturating_sub(storage)
            .saturating_sub(STORAGE_CUSHION)
            .saturating_sub(self.reserved)
    }

    fn roll_windows(&mut self) {
        let now = env::block_timestamp();
        if now >= self.day_start.saturating_add(DAY) {
            self.day_start = now;
            self.spent_today = NearToken::from_yoctonear(0);
        }
        if now >= self.hour_start.saturating_add(HOUR) {
            self.hour_start = now;
            self.actions_this_hour = 0;
        }
    }

    fn start(&mut self, action: Action) -> Promise {
        require!(
            env::predecessor_account_id() == self.agent,
            "Only the agent can spend from this wallet"
        );
        require!(!self.frozen, "This wallet is frozen");
        let to = action.receiver().clone();
        let amount = action.amount();
        require!(
            to != env::current_account_id(),
            "The wallet can't act on itself"
        );
        require!(
            self.destination_allowed(&to),
            "The owner's list doesn't allow this receiver"
        );
        require!(
            amount <= self.policy.per_payment,
            "That's over the limit on one payment"
        );
        require!(
            self.pending.len() < MAX_PENDING,
            "Too many payments are waiting for the owner"
        );
        self.roll_windows();
        require!(
            self.actions_this_hour < self.policy.max_actions_per_hour,
            "That's over the limit on actions this hour"
        );
        let spent = self.spent_today.saturating_add(amount);
        require!(
            spent <= self.policy.per_day,
            "That's over the limit for today"
        );
        require!(
            amount <= self.available(),
            "The wallet doesn't have enough free"
        );
        self.actions_this_hour += 1;
        self.spent_today = spent;
        self.reserved = self.reserved.saturating_add(amount);

        let decide_gas = DECIDE_GAS
            .saturating_add(action.forward_gas())
            .saturating_add(ON_DONE_GAS);
        ext_vouch::ext(self.policy.vouch.clone())
            .with_static_gas(VIEW_GAS)
            .get_agent_verdict(self.policy.checker.clone(), to.clone())
            .and(
                ext_vouch::ext(self.policy.vouch.clone())
                    .with_static_gas(VIEW_GAS)
                    .get_reports(to),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(decide_gas)
                    .on_checked(action, U64(self.day_start)),
            )
    }

    /// Undo a charge for a payment that won't happen.
    fn give_back(&mut self, amount: NearToken, charged_day: U64) {
        self.reserved = self.reserved.saturating_sub(amount);
        self.refund_budget(amount, charged_day);
    }

    /// Only the day that was charged gets it back. Otherwise an old payment lapsing could free up
    /// today's budget for money that really did go out today.
    fn refund_budget(&mut self, amount: NearToken, charged_day: U64) {
        if charged_day.0 == self.day_start {
            self.spent_today = self.spent_today.saturating_sub(amount);
        }
    }

    fn send(&mut self, action: Action, charged_day: U64) -> Promise {
        let done = Self::ext(env::current_account_id())
            .with_static_gas(ON_DONE_GAS)
            .on_done(action.clone(), charged_day);
        match action {
            Action::Transfer { to, amount } => Promise::new(to).transfer(amount).then(done),
            Action::Call {
                contract,
                method,
                args,
                deposit,
                gas_tgas,
            } => Promise::new(contract)
                .function_call(method, args.0, deposit, Gas::from_tgas(u64::from(gas_tgas)))
                .then(done),
        }
    }
}

#[cfg(test)]
mod tests;
