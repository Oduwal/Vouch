use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

use crate::{Appeal, Contract, ContractExt, Juror, Side, Status, Vote, emit};

pub const JURY_SIZE: usize = 3;
const MAJORITY: usize = JURY_SIZE / 2 + 1;
/// A pool this small is scanned in full, so a draw that can succeed always does.
const SCAN_ALL_UP_TO: u32 = 64;
const MAX_DRAW_TRIES: u32 = 256;
const MAX_SALT_LEN: usize = 128;

/// What a juror seals when committing, and shows when revealing. It names the case and the juror,
/// so one juror can't copy another's commitment.
pub fn commitment(claim_id: u64, juror: &AccountId, side: Side, salt: &str) -> Vec<u8> {
    let side = match side {
        Side::Agent => "agent",
        Side::Challenger => "challenger",
    };
    env::sha256(format!("{claim_id}:{juror}:{side}:{salt}").as_bytes())
}

#[near]
impl Contract {
    /// Join the pool appeals draw jurors from, or add to your stake. The deposit is your stake, and
    /// a new juror's first deposit also pays for their place in the pool. A new juror can't be drawn
    /// until `juror_warmup` has passed, or leave until `juror_lockup` has.
    #[payable]
    pub fn join_jury(&mut self) -> Juror {
        let deposit = env::attached_deposit();
        require!(!deposit.is_zero(), "Attach NEAR to stake");
        let account = env::predecessor_account_id();
        let is_new = !self.jurors.contains_key(&account);
        let fee = if is_new {
            self.config.juror_fee
        } else {
            NearToken::from_yoctonear(0)
        };
        let juror = self.jurors.entry(account.clone()).or_insert(Juror {
            account: account.clone(),
            stake: NearToken::from_yoctonear(0),
            open_cases: 0,
            votes_cast: 0,
            votes_with_majority: 0,
        });
        juror.stake = juror.stake.saturating_add(deposit.saturating_sub(fee));
        require!(
            juror.stake >= self.config.juror_stake,
            "Stake is below the juror minimum"
        );
        let stake = juror.stake;
        if is_new {
            self.juror_index
                .insert(account.clone(), self.juror_list.len());
            self.juror_list.push(account.clone());
            self.juror_joined
                .insert(account.clone(), env::block_timestamp());
        }
        emit("juror_joined", json!({ "juror": account, "stake": stake }));
        self.jurors.get(&account).unwrap().clone()
    }

    /// Leave the jury pool and take your stake back. Not allowed while you sit on an open appeal, or
    /// until `juror_lockup` has passed since you joined.
    #[payable]
    pub fn leave_jury(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let juror = self
            .jurors
            .get(&account)
            .unwrap_or_else(|| env::panic_str("Not a juror"));
        require!(
            juror.open_cases == 0,
            "You sit on an appeal that has not closed"
        );
        let joined = self.juror_joined.get(&account).copied().unwrap_or(0);
        require!(
            env::block_timestamp() >= joined.saturating_add(self.config.juror_lockup.0),
            "Your juror stake is still locked"
        );
        let stake = juror.stake;
        self.jurors.remove(&account);
        self.juror_joined.remove(&account);
        self.remove_from_list(&account);
        emit("juror_left", json!({ "juror": account }));
        self.pay_promise(account, stake)
    }

    /// The loser of a ruling sends it to a jury of three, drawn at random from the jury pool.
    /// The deposit must equal the appeal fee, which goes to the jurors who vote with the majority,
    /// after its storage fee. Only an account signing for itself can appeal: a contract could read
    /// the block's seed first and appeal only when the draw suited it.
    #[payable]
    pub fn appeal(&mut self, claim_id: U64) -> Vec<AccountId> {
        require!(
            env::predecessor_account_id() == env::signer_account_id(),
            "Appeal directly from your own account"
        );
        let appellant = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(
            deposit == self.config.appeal_fee,
            format!("Attach exactly {}", self.config.appeal_fee)
        );
        let fee = deposit.saturating_sub(self.config.appeal_storage_fee);
        let claim = self.claim(claim_id.0);
        require!(
            claim.status == Status::Ruled,
            "Only a ruled claim can be appealed"
        );
        let ruling = claim.ruling.as_ref().unwrap();
        require!(
            env::block_timestamp() < ruling.appeal_until.0,
            "The appeal window has closed"
        );
        let challenger = claim.challenge.as_ref().unwrap().challenger.clone();
        let loser = match ruling.winner {
            Side::Agent => &challenger,
            Side::Challenger => &claim.agent,
        };
        require!(&appellant == loser, "Only the side that lost can appeal");

        let agent = claim.agent.clone();
        // The account the call is about has a stake in the outcome too.
        let subject = claim.subject.clone();
        let jury = self.draw_jury(
            claim_id.0,
            &[&agent, &challenger, &subject, &self.config.judge],
        );
        for juror in &jury {
            self.jurors.get_mut(juror).unwrap().open_cases += 1;
        }
        let jury_until = U64(env::block_timestamp().saturating_add(self.config.jury_window.0));
        let claim = self.claim_mut(claim_id.0);
        claim.status = Status::Appealed;
        claim.appeal = Some(Appeal {
            appellant,
            fee,
            jury: jury.clone(),
            votes: vec![],
            jury_until,
            decided: None,
        });
        emit("claim_appealed", json!(claim));
        jury
    }

    /// A drawn juror seals a vote: sha256 of `claim_id:juror:side:salt`, as hex. Nobody can see how
    /// anyone voted until voting is over, so there's nothing to copy.
    pub fn commit_vote(&mut self, claim_id: U64, commitment: String) {
        let juror = env::predecessor_account_id();
        let hash = hex_decode(&commitment)
            .filter(|h| h.len() == 32)
            .unwrap_or_else(|| env::panic_str("A commitment is 32 bytes of hex"));
        let claim = self.claim(claim_id.0);
        require!(
            claim.status == Status::Appealed,
            "This claim is not under appeal"
        );
        let appeal = claim.appeal.as_ref().unwrap();
        require!(appeal.jury.contains(&juror), "You are not on this jury");
        // Not in the draw's own block: bundling a seal with the draw would undo the draw unless it
        // seated you, so a juror could retry until it did.
        require!(
            env::block_timestamp()
                > appeal
                    .jury_until
                    .0
                    .saturating_sub(self.config.jury_window.0),
            "The jury was only just drawn"
        );
        require!(
            env::block_timestamp() < self.commit_deadline(appeal.jury_until.0),
            "The time to seal a vote has passed"
        );
        let key = (claim_id.0, juror.clone());
        require!(
            !self.commits.contains_key(&key),
            "You already sealed a vote"
        );
        self.commits.insert(key, hash);
        emit(
            "jury_commit",
            json!({ "claim_id": claim_id, "juror": juror }),
        );
    }

    /// A juror shows the vote they sealed. Opens once all three have sealed, or the time to seal has
    /// passed. The appeal closes as soon as one side has a majority.
    pub fn reveal_vote(&mut self, claim_id: U64, side: Side, salt: String) {
        require!(salt.len() <= MAX_SALT_LEN, "Salt is too long");
        let juror = env::predecessor_account_id();
        let claim = self.claim(claim_id.0);
        require!(
            claim.status == Status::Appealed,
            "This claim is not under appeal"
        );
        let appeal = claim.appeal.as_ref().unwrap();
        require!(
            env::block_timestamp() < appeal.jury_until.0,
            "Voting has closed"
        );
        require!(appeal.jury.contains(&juror), "You are not on this jury");
        require!(
            appeal.votes.iter().all(|v| v.juror != juror),
            "You already voted"
        );
        let all_sealed = appeal
            .jury
            .iter()
            .all(|j| self.commits.contains_key(&(claim_id.0, j.clone())));
        require!(
            all_sealed || env::block_timestamp() >= self.commit_deadline(appeal.jury_until.0),
            "Votes can be revealed once all three are sealed"
        );
        let sealed = self
            .commits
            .get(&(claim_id.0, juror.clone()))
            .unwrap_or_else(|| env::panic_str("You did not seal a vote"));
        require!(
            *sealed == commitment(claim_id.0, &juror, side, &salt),
            "This doesn't match the vote you sealed"
        );
        // The commitment stays until the case closes: the next juror's reveal counts it as sealed.
        let appeal = self.claim_mut(claim_id.0).appeal.as_mut().unwrap();
        appeal.votes.push(Vote {
            juror: juror.clone(),
            side,
        });
        let backing = appeal.votes.iter().filter(|v| v.side == side).count();
        emit(
            "jury_vote",
            json!({ "claim_id": claim_id, "juror": juror, "side": side }),
        );
        if backing >= MAJORITY {
            self.close_appeal(claim_id.0, Some(side));
        }
    }
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

impl Contract {
    fn commit_deadline(&self, jury_until: u64) -> u64 {
        jury_until.saturating_sub(self.config.jury_window.0 / 2)
    }

    fn remove_from_list(&mut self, account: &AccountId) {
        if let Some(index) = self.juror_index.remove(account) {
            self.juror_list.swap_remove(index);
            if let Some(moved) = self.juror_list.get(index).cloned() {
                self.juror_index.insert(moved, index);
            }
        }
    }

    pub(crate) fn can_sit(
        &self,
        account: &AccountId,
        exclude: &[&AccountId],
        picked: &[AccountId],
        now: u64,
    ) -> bool {
        !exclude.contains(&account)
            && !picked.contains(account)
            && self
                .juror_joined
                .get(account)
                .is_some_and(|t| now >= t.saturating_add(self.config.juror_warmup.0))
            && self
                .jurors
                .get(account)
                .is_some_and(|j| j.stake >= self.config.juror_stake)
    }

    /// Pick `JURY_SIZE` distinct jurors. Reads a few list entries however large the pool is. The seed
    /// mixes in the claim, so two appeals in one block don't draw the same people.
    pub(crate) fn draw_jury(&self, claim_id: u64, exclude: &[&AccountId]) -> Vec<AccountId> {
        self.try_draw_jury(claim_id, exclude)
            .unwrap_or_else(|| env::panic_str("Not enough jurors to hear an appeal"))
    }

    pub(crate) fn try_draw_jury(
        &self,
        claim_id: u64,
        exclude: &[&AccountId],
    ) -> Option<Vec<AccountId>> {
        let now = env::block_timestamp();
        let total = self.juror_list.len();
        let mut seed = env::random_seed();
        seed.extend_from_slice(&claim_id.to_le_bytes());
        let mut hash = env::sha256(&seed);
        let next = |hash: &mut Vec<u8>| -> u64 {
            *hash = env::sha256(&hash[..]);
            u64::from_le_bytes(hash[..8].try_into().unwrap())
        };

        let mut picked: Vec<AccountId> = Vec::with_capacity(JURY_SIZE);
        if total <= SCAN_ALL_UP_TO {
            let mut pool: Vec<AccountId> = self
                .juror_list
                .iter()
                .filter(|a| self.can_sit(a, exclude, &[], now))
                .cloned()
                .collect();
            if pool.len() < JURY_SIZE {
                return None;
            }
            for i in 0..JURY_SIZE {
                let span = (pool.len() - i) as u64;
                pool.swap(i, i + (next(&mut hash) % span) as usize);
            }
            pool.truncate(JURY_SIZE);
            return Some(pool);
        }
        for _ in 0..MAX_DRAW_TRIES {
            if picked.len() == JURY_SIZE {
                break;
            }
            let index = (next(&mut hash) % u64::from(total)) as u32;
            if let Some(account) = self.juror_list.get(index)
                && self.can_sit(account, exclude, &picked, now)
            {
                picked.push(account.clone());
            }
        }
        (picked.len() == JURY_SIZE).then_some(picked)
    }

    /// Close an appeal. With a majority, the jury's side wins and its voters split the fee.
    /// Without one (time ran out), the judge's ruling stands and the fee goes back to the appellant.
    /// If the jury was standing in for a silent judge, there's no ruling, so both sides are refunded.
    /// A juror who was drawn and let the case down loses part of their stake: for not sealing a
    /// vote, or, once time has run out, for not revealing it. The winners or appellant receive it.
    pub(crate) fn close_appeal(&mut self, id: u64, majority: Option<Side>) {
        let claim = self.claim_mut(id);
        let judge_winner = claim.ruling.as_ref().map(|r| r.winner);
        let appeal = claim.appeal.as_mut().unwrap();
        appeal.decided = majority;
        let appeal = appeal.clone();
        let slash_pct = u128::from(self.config.no_show_slash_pct);
        let timed_out = majority.is_none();
        let mut pot = appeal.fee;

        for juror in &appeal.jury {
            let key = (id, juror.clone());
            let sealed = self.commits.contains_key(&key);
            self.commits.remove(&key);
            let voted = appeal.votes.iter().find(|v| &v.juror == juror);
            let no_show = if timed_out {
                voted.is_none()
            } else {
                voted.is_none() && !sealed
            };
            if let Some(j) = self.jurors.get_mut(juror) {
                j.open_cases = j.open_cases.saturating_sub(1);
                if let Some(vote) = voted {
                    j.votes_cast += 1;
                    if Some(vote.side) == majority {
                        j.votes_with_majority += 1;
                    }
                }
                if no_show {
                    let slash = NearToken::from_yoctonear(j.stake.as_yoctonear() / 100 * slash_pct);
                    j.stake = j.stake.saturating_sub(slash);
                    pot = pot.saturating_add(slash);
                    emit(
                        "juror_slashed",
                        json!({ "juror": juror, "amount": slash, "claim_id": U64(id) }),
                    );
                }
            }
        }

        match majority {
            Some(side) => {
                let winners: Vec<AccountId> = appeal
                    .votes
                    .iter()
                    .filter(|v| v.side == side)
                    .map(|v| v.juror.clone())
                    .collect();
                let count = winners.len() as u128;
                let share = pot.as_yoctonear() / count;
                // Integer division leaves a remainder. The first juror gets it, so none is stranded.
                let remainder = pot.as_yoctonear() - share * count;
                for (i, juror) in winners.into_iter().enumerate() {
                    let extra = if i == 0 { remainder } else { 0 };
                    self.pay(juror, NearToken::from_yoctonear(share + extra));
                }
                self.settle(id, side);
            }
            None => {
                self.pay(appeal.appellant.clone(), pot);
                match judge_winner {
                    Some(winner) => self.settle(id, winner),
                    None => self.void(id),
                }
            }
        }
    }
}
