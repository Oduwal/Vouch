use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json};
use near_sdk::{Gas, GasWeight, NearToken, Promise, PromiseError, env, near, require};

use crate::{Challenge, Contract, ContractExt, Ruling, RulingInput, Status, emit};

const MAX_EVIDENCE_LEN: usize = 1000;
const MAX_SUMMARY_LEN: usize = 1000;
/// Gas set aside for `on_ruling`. Its timeout path sends one refund.
const RULING_GAS: Gas = Gas::from_tgas(20);

#[near]
impl Contract {
    /// Dispute an open claim. The attached deposit is the counter-stake. The contract pauses in a
    /// yield until the judge rules; if no ruling arrives in time (about 200 blocks) both sides are
    /// refunded.
    #[payable]
    pub fn challenge(&mut self, claim_id: U64, evidence: String) {
        require!(
            !evidence.trim().is_empty() && evidence.len() <= MAX_EVIDENCE_LEN,
            "Evidence must be 1 to 1000 characters"
        );
        let challenger = env::predecessor_account_id();
        let stake = env::attached_deposit();
        let min_stake = NearToken::from_yoctonear(
            self.claim(claim_id.0).bond.as_yoctonear() / 100
                * u128::from(self.config.challenge_stake_pct),
        );
        let claim = self.claim_mut(claim_id.0);
        require!(
            claim.status == Status::Open,
            "Only an open claim can be challenged"
        );
        require!(
            env::block_timestamp() < claim.challenge_until.0,
            "The challenge window has closed"
        );
        require!(
            challenger != claim.agent,
            "An agent cannot challenge its own call"
        );
        require!(stake >= min_stake, format!("Stake at least {min_stake}"));

        claim.status = Status::Challenged;
        claim.challenge = Some(Challenge {
            challenger,
            stake,
            evidence,
            filed_at: U64(env::block_timestamp()),
        });
        emit("claim_challenged", json!(claim));

        let args = json!({ "claim_id": claim_id }).to_string();
        let (promise, yield_id) = Promise::new_yield("on_ruling", args, RULING_GAS, GasWeight(0));
        self.waiting.insert(claim_id.0, yield_id);
        // Detached, so the challenge transaction finishes now and the ruling lands in a later receipt.
        promise.detach();
    }

    /// The judge answers a paused challenge. This resumes the yield, and `on_ruling` records it.
    pub fn submit_ruling(&mut self, claim_id: U64, ruling: RulingInput) {
        require!(
            env::predecessor_account_id() == self.config.judge,
            "Only the judge can rule"
        );
        require!(
            !ruling.summary.trim().is_empty() && ruling.summary.len() <= MAX_SUMMARY_LEN,
            "Summary must be 1 to 1000 characters"
        );
        require!(
            ruling.model.len() <= 200 && ruling.attestation.len() <= 200,
            "Model and attestation are too long"
        );
        let yield_id = *self.waiting.get(&claim_id.0).unwrap_or_else(|| {
            env::panic_str("No challenge on this claim is waiting for a ruling")
        });
        let data = serde_json::to_vec(&ruling).unwrap();
        if yield_id.resume(data).is_err() {
            env::panic_str("The ruling window has closed");
        }
    }

    /// Runs when the judge resumes the yield, or when it times out. It must not panic: the bond and
    /// the counter-stake are both held until it runs.
    #[private]
    pub fn on_ruling(
        &mut self,
        claim_id: U64,
        #[callback_result] ruling: Result<RulingInput, PromiseError>,
    ) {
        self.waiting.remove(&claim_id.0);
        let now = env::block_timestamp();
        let appeal_window = self.config.appeal_window.0;
        let claim = self.claim_mut(claim_id.0);
        if claim.status != Status::Challenged {
            return;
        }
        match ruling {
            Ok(r) => {
                claim.status = Status::Ruled;
                claim.ruling = Some(Ruling {
                    winner: r.winner,
                    summary: r.summary,
                    model: r.model,
                    attestation: r.attestation,
                    ruled_at: U64(now),
                    appeal_until: U64(now + appeal_window),
                });
                emit("claim_ruled", json!(claim));
            }
            Err(_) => {
                claim.status = Status::Void;
                let bond = claim.bond;
                let agent_id = claim.agent.clone();
                let challenge = claim.challenge.clone().unwrap();
                let agent = self.agents.get_mut(&agent_id).unwrap();
                agent.bond_locked = agent.bond_locked.saturating_sub(bond);
                agent.bond_free = agent.bond_free.saturating_add(bond);
                Promise::new(challenge.challenger)
                    .transfer(challenge.stake)
                    .detach();
                emit(
                    "claim_void",
                    json!({ "claim_id": claim_id, "reason": "The judge did not rule in time" }),
                );
            }
        }
    }
}
