use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{Gas, GasWeight, NearToken, Promise, env, near, require};

use crate::{
    Appeal, Challenge, Contract, ContractExt, Ruling, RulingInput, Status, emit, hex_encode,
};

const MAX_EVIDENCE_LEN: usize = 1000;
const MAX_SUMMARY_LEN: usize = 1000;
const MAX_PROOF_LEN: usize = 32 * 1024;
/// Gas set aside for `on_ruling`, which only records state.
const RULING_GAS: Gas = Gas::from_tgas(20);
/// When a jury has to replace a silent judge, this share of the stake pays it.
const SILENT_JUDGE_JURY_PCT: u128 = 20;

#[near]
impl Contract {
    /// Dispute an open claim. The deposit is the counter-stake plus the storage fee. The contract
    /// pauses in a yield until the judge rules. If that times out (about 200 blocks), the judge
    /// still has `late_ruling_window`, so jamming it for two minutes can't get a bad call off free.
    /// After that a jury takes the case, or both sides are refunded if there aren't enough jurors.
    #[payable]
    pub fn challenge(&mut self, claim_id: U64, evidence: String) {
        require!(
            !evidence.trim().is_empty() && evidence.len() <= MAX_EVIDENCE_LEN,
            "Evidence must be 1 to 1000 bytes"
        );
        let challenger = env::predecessor_account_id();
        let fee = self.config.challenge_fee;
        let deposit = env::attached_deposit();
        let stake = deposit.saturating_sub(fee);
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
        require!(
            stake >= min_stake,
            format!("Stake at least {min_stake}, plus the {fee} storage fee")
        );

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

    /// The judge rules on a challenge, in its yield or in the late window after it times out.
    ///
    /// `proof` is not stored. It stays in this transaction's arguments, so anyone can read the exact
    /// model request, response, signature and attestation checks behind the ruling, and
    /// `ruling.attestation` must be its hash. A ruling can't exist without published evidence, so even
    /// a stolen judge key leaves something the verifier can catch.
    pub fn submit_ruling(&mut self, claim_id: U64, ruling: RulingInput, proof: String) {
        require!(
            env::predecessor_account_id() == self.config.judge,
            "Only the judge can rule"
        );
        require!(
            !proof.is_empty() && proof.len() <= MAX_PROOF_LEN,
            "Proof must be 1 byte to 32 KB"
        );
        require!(
            ruling.attestation == format!("sha256:{}", hex_encode(&env::sha256(proof.as_bytes()))),
            "The attestation must be the proof's hash"
        );
        require!(
            !ruling.summary.trim().is_empty() && ruling.summary.len() <= MAX_SUMMARY_LEN,
            "Summary must be 1 to 1000 bytes"
        );
        require!(
            ruling.model.len() <= 200 && ruling.attestation.len() <= 200,
            "Model and attestation are too long"
        );
        if let Some(until) = self.late.get(&claim_id.0).copied() {
            require!(
                env::block_timestamp() < until,
                "The judge's late window has closed"
            );
            self.late.remove(&claim_id.0);
        } else {
            let yield_id = self.waiting.remove(&claim_id.0).unwrap_or_else(|| {
                env::panic_str("No challenge on this claim is waiting for a ruling")
            });
            // Only a signal: NEAR limits a resume's payload to 1024 bytes, and a ruling can be longer.
            if yield_id.resume(vec![]).is_err() {
                env::panic_str("The ruling window has closed");
            }
        }
        self.record_ruling(claim_id.0, ruling);
    }

    /// Runs when the judge resumes the yield, or when it times out. By then a ruling has already been
    /// recorded, so a challenge still waiting here means the yield timed out. It must not panic: the
    /// bond and the counter-stake are both held until the case closes.
    #[private]
    pub fn on_ruling(&mut self, claim_id: U64) {
        self.waiting.remove(&claim_id.0);
        if self.claim(claim_id.0).status != Status::Challenged {
            return;
        }
        let until = env::block_timestamp().saturating_add(self.config.late_ruling_window.0);
        self.late.insert(claim_id.0, until);
        emit(
            "ruling_late",
            json!({ "claim_id": claim_id, "until": U64(until) }),
        );
    }
}

impl Contract {
    pub(crate) fn record_ruling(&mut self, id: u64, r: RulingInput) {
        let now = env::block_timestamp();
        let appeal_window = self.config.appeal_window.0;
        let claim = self.claim_mut(id);
        claim.status = Status::Ruled;
        claim.ruling = Some(Ruling {
            winner: r.winner,
            summary: r.summary,
            model: r.model,
            attestation: r.attestation,
            ruled_at: U64(now),
            appeal_until: U64(now.saturating_add(appeal_window)),
        });
        emit("claim_ruled", json!(claim));
    }

    /// The judge's time ran out. A jury takes the case in its place, paid from the stake, so a bad
    /// call doesn't get off free. Only without enough jurors are both sides refunded.
    pub(crate) fn judge_was_silent(&mut self, id: u64) {
        // As with an appeal: a contract could read the block's seed first and call only when it suited.
        require!(
            env::predecessor_account_id() == env::signer_account_id(),
            "Close this case directly from your own account"
        );
        self.waiting.remove(&id);
        let claim = self.claim(id);
        let (agent, subject) = (claim.agent.clone(), claim.subject.clone());
        let challenger = claim.challenge.as_ref().unwrap().challenger.clone();
        let exclude = [&agent, &challenger, &subject, &self.config.judge];
        let Some(jury) = self.try_draw_jury(id, &exclude) else {
            return self.void(id);
        };
        self.late.remove(&id);
        for juror in &jury {
            self.jurors.get_mut(juror).unwrap().open_cases += 1;
        }
        let jury_until = U64(env::block_timestamp().saturating_add(self.config.jury_window.0));
        let claim = self.claim_mut(id);
        let challenge = claim.challenge.as_mut().unwrap();
        let fee =
            NearToken::from_yoctonear(challenge.stake.as_yoctonear() / 100 * SILENT_JUDGE_JURY_PCT);
        challenge.stake = challenge.stake.saturating_sub(fee);
        claim.status = Status::Appealed;
        claim.appeal = Some(Appeal {
            appellant: challenger,
            fee,
            jury,
            votes: vec![],
            jury_until,
            decided: None,
        });
        emit("claim_sent_to_jury", json!(claim));
    }

    /// Nobody decided: refund both sides.
    pub(crate) fn void(&mut self, id: u64) {
        self.late.remove(&id);
        self.active.remove(&id);
        let claim = self.claim_mut(id);
        claim.status = Status::Void;
        let bond = claim.bond;
        let agent_id = claim.agent.clone();
        let challenge = claim.challenge.clone().unwrap();
        let agent = self.agents.get_mut(&agent_id).unwrap();
        agent.bond_locked = agent.bond_locked.saturating_sub(bond);
        agent.bond_free = agent.bond_free.saturating_add(bond);
        self.pay(challenge.challenger, challenge.stake);
        emit(
            "claim_void",
            json!({ "claim_id": U64(id), "reason": "Neither a judge nor a jury decided in time" }),
        );
    }
}
