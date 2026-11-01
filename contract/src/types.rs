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
    /// Challenged; the contract is paused in a yield, waiting for the judge.
    Challenged,
    /// The judge ruled; the loser can appeal until `ruling.appeal_until`.
    Ruled,
    /// A jury is hearing the appeal.
    Appealed,
    /// The call stood. The agent keeps its bond (and any counter-stake).
    Held,
    /// The call was wrong. The challenger took the bond.
    Overturned,
    /// The judge never answered. Both sides were refunded.
    Void,
}

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
    pub stake: NearToken,
    pub evidence: String,
    pub filed_at: U64,
}

/// What the judge service sends back when it resumes a paused challenge.
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
    pub fee: NearToken,
    pub jury: Vec<AccountId>,
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
    /// The only account allowed to resume a paused challenge with a ruling.
    pub judge: AccountId,
    /// How long a new call stays open to challenge, in nanoseconds.
    pub challenge_window: U64,
    /// How long the loser of a ruling has to appeal, in nanoseconds.
    pub appeal_window: U64,
    /// How long a jury has to vote, in nanoseconds.
    pub jury_window: U64,
    pub min_bond: NearToken,
    /// A challenger must stake at least this percentage of the bond.
    pub challenge_stake_pct: u8,
    pub appeal_fee: NearToken,
    pub juror_stake: NearToken,
}
