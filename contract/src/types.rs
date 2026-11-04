use near_sdk::json_types::U64;
use near_sdk::{AccountId, NearToken, near};

/// What a checking agent says about a receiver.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Allow,
    Warn,
    Block,
}

impl Level {
    /// Higher is stricter.
    pub(crate) fn strictness(self) -> u8 {
        match self {
            Level::Allow => 0,
            Level::Warn => 1,
            Level::Block => 2,
        }
    }
}

/// The two parties to a dispute.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Agent,
    Challenger,
}

/// Where a claim is in its life. `Held`, `Overturned` and `Void` are final.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// Bond locked, open to challenge until `challenge_until`.
    Open,
    /// Challenged and waiting for the judge, in a yield or its late window after that.
    Challenged,
    /// The judge ruled; the loser can appeal until `ruling.appeal_until`.
    Ruled,
    /// A jury is hearing the appeal.
    Appealed,
    /// The call stood. The agent keeps its bond (and any counter-stake).
    Held,
    /// The call was wrong. The challenger took the bond.
    Overturned,
    /// Neither the judge nor a jury decided. Both sides were refunded.
    Void,
}

// Agent, Claim and everything inside Claim are stored one entry at a time, so a change to their
// layout would corrupt existing claims. New per-claim data goes in its own map on the contract.

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub account: AccountId,
    /// Bond the agent can lock behind new calls or withdraw.
    pub bond_free: NearToken,
    /// Bond locked behind calls that are still open or disputed.
    pub bond_locked: NearToken,
    pub calls_made: u32,
    pub calls_held: u32,
    pub calls_lost: u32,
    pub bond_lost: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Claim {
    pub id: U64,
    pub agent: AccountId,
    pub subject: AccountId,
    pub verdict: Level,
    pub reasons: Vec<String>,
    pub bond: NearToken,
    pub posted_at: U64,
    pub challenge_until: U64,
    pub status: Status,
    pub challenge: Option<Challenge>,
    pub ruling: Option<Ruling>,
    pub appeal: Option<Appeal>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Challenge {
    pub challenger: AccountId,
    /// What is at stake, after the storage fee came off the deposit.
    pub stake: NearToken,
    pub evidence: String,
    pub filed_at: U64,
}

/// What the judge service sends back when it rules on a challenge.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct RulingInput {
    pub winner: Side,
    pub summary: String,
    /// The model that ruled, as named by NEAR AI Cloud.
    pub model: String,
    /// Hash of the TEE attestation report fetched for this ruling.
    pub attestation: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Ruling {
    pub winner: Side,
    pub summary: String,
    pub model: String,
    pub attestation: String,
    pub ruled_at: U64,
    pub appeal_until: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Appeal {
    pub appellant: AccountId,
    /// What the jurors can split, after the storage fee came off the deposit.
    pub fee: NearToken,
    pub jury: Vec<AccountId>,
    /// Revealed votes. Sealed commitments are kept apart until each juror reveals.
    pub votes: Vec<Vote>,
    pub jury_until: U64,
    /// Set once the appeal closes: the side the jury backed, or none if it ran out of time.
    pub decided: Option<Side>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Vote {
    pub juror: AccountId,
    pub side: Side,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Juror {
    pub account: AccountId,
    pub stake: NearToken,
    /// Appeals this juror sits on that have not closed yet.
    pub open_cases: u32,
    pub votes_cast: u32,
    pub votes_with_majority: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    /// The only account allowed to rule on a challenge.
    pub judge: AccountId,
    /// How long a new call stays open to challenge, in nanoseconds.
    pub challenge_window: U64,
    /// How long the loser of a ruling has to appeal, in nanoseconds.
    pub appeal_window: U64,
    /// How long a jury has to commit and reveal, in nanoseconds. Commits take the first half.
    pub jury_window: U64,
    pub min_bond: NearToken,
    /// A challenger must stake at least this percentage of the bond.
    pub challenge_stake_pct: u8,
    pub appeal_fee: NearToken,
    pub juror_stake: NearToken,
    /// After a yield times out, how long the judge can still rule before both sides are refunded.
    pub late_ruling_window: U64,
    /// A new juror can't be drawn until this long after joining, so nobody joins for one case.
    pub juror_warmup: U64,
    /// A juror can't leave until this long after joining.
    pub juror_lockup: U64,
    /// The share of a juror's stake lost for sitting on a case and not voting.
    pub no_show_slash_pct: u8,
    /// How many minimum bonds one agent can have locked at once.
    pub max_locked_bonds: u32,
    /// Storage fees. Claims are kept forever, so whoever adds one pays for its bytes.
    pub register_fee: NearToken,
    pub claim_fee: NearToken,
    pub challenge_fee: NearToken,
    pub appeal_storage_fee: NearToken,
    pub juror_fee: NearToken,
}

/// A challenge the agent won, kept after the call reopens to anyone else with a better case.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub challenge: Challenge,
    /// None if the judge never ruled and a jury took the case.
    pub ruling: Option<Ruling>,
    pub appeal: Option<Appeal>,
}

/// A code change waiting out its delay, so anyone who dislikes it can leave first.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingUpgrade {
    /// sha256 of the new contract's code, as hex.
    pub code_hash: String,
    /// The new code's migration, run in the same step as the deploy.
    pub migrate_method: String,
    pub migrate_args: String,
    pub apply_after: U64,
}

/// A config change waiting out its delay, so it can't change the terms of a case already running.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingConfig {
    pub config: Config,
    pub apply_after: U64,
}
