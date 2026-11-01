use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

use crate::{Appeal, Contract, ContractExt, Juror, Side, Status, Vote, emit};

pub const JURY_SIZE: usize = 3;
const MAJORITY: usize = JURY_SIZE / 2 + 1;

#[near]
impl Contract {
    /// Join the pool appeals draw jurors from. The attached deposit is your juror stake.
    #[payable]
    pub fn join_jury(&mut self) -> Juror {
        let deposit = env::attached_deposit();
        let account = env::predecessor_account_id();
        let juror = self.jurors.entry(account.clone()).or_insert(Juror {
            account: account.clone(),
            stake: NearToken::from_yoctonear(0),
            open_cases: 0,
            votes_cast: 0,
            votes_with_majority: 0,
        });
        juror.stake = juror.stake.saturating_add(deposit);
        require!(
            juror.stake >= self.config.juror_stake,
            "Stake is below the juror minimum"
        );
        emit(
            "juror_joined",
            json!({ "juror": account, "stake": juror.stake }),
        );
        self.jurors.get(&account).unwrap().clone()
    }

    /// Leave the jury pool and take your stake back. Not allowed while you sit on an open appeal.
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
        let stake = juror.stake;
        self.jurors.remove(&account);
        emit("juror_left", json!({ "juror": account }));
        Promise::new(account).transfer(stake)
    }

    /// The loser of a ruling sends it to a jury of three, drawn at random from the jury pool.
    /// The attached deposit must equal the appeal fee, which goes to the jurors who vote with the
    /// majority.
    #[payable]
    pub fn appeal(&mut self, claim_id: U64) -> Vec<AccountId> {
        let appellant = env::predecessor_account_id();
        let fee = env::attached_deposit();
        require!(
            fee == self.config.appeal_fee,
            format!("Attach exactly {}", self.config.appeal_fee)
        );
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

        let jury = self.draw_jury(&[&claim.agent, &challenger, &self.config.judge]);
        for juror in &jury {
            self.jurors.get_mut(juror).unwrap().open_cases += 1;
        }
        let jury_until = U64(env::block_timestamp() + self.config.jury_window.0);
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

    /// A drawn juror votes. The appeal closes as soon as one side has a majority.
    pub fn vote(&mut self, claim_id: U64, side: Side) {
        let juror = env::predecessor_account_id();
        let claim = self.claim_mut(claim_id.0);
        require!(
            claim.status == Status::Appealed,
            "This claim is not under appeal"
        );
        let appeal = claim.appeal.as_mut().unwrap();
        require!(
            env::block_timestamp() < appeal.jury_until.0,
            "Voting has closed"
        );
        require!(appeal.jury.contains(&juror), "You are not on this jury");
        require!(
            appeal.votes.iter().all(|v| v.juror != juror),
            "You already voted"
        );
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

impl Contract {
    /// Pick `JURY_SIZE` distinct jurors with the block's random seed, skipping the parties.
    fn draw_jury(&self, exclude: &[&AccountId]) -> Vec<AccountId> {
        let mut pool: Vec<AccountId> = self
            .jurors
            .keys()
            .filter(|a| !exclude.contains(a))
            .cloned()
            .collect();
        require!(
            pool.len() >= JURY_SIZE,
            "Not enough jurors to hear an appeal"
        );
        let seed = env::random_seed();
        for i in 0..JURY_SIZE {
            let r = u32::from_le_bytes(seed[i * 4..i * 4 + 4].try_into().unwrap()) as usize;
            let j = i + r % (pool.len() - i);
            pool.swap(i, j);
        }
        pool.truncate(JURY_SIZE);
        pool
    }

    /// Close an appeal. With a majority, the jury's side wins and its voters split the fee.
    /// Without one (time ran out), the judge's ruling stands and the fee goes back to the appellant.
    pub(crate) fn close_appeal(&mut self, id: u64, majority: Option<Side>) {
        let claim = self.claim_mut(id);
        let judge_winner = claim.ruling.as_ref().unwrap().winner;
        let appeal = claim.appeal.as_mut().unwrap();
        appeal.decided = majority;
        let appeal = appeal.clone();

        for juror in &appeal.jury {
            if let Some(j) = self.jurors.get_mut(juror) {
                j.open_cases = j.open_cases.saturating_sub(1);
                if let Some(vote) = appeal.votes.iter().find(|v| &v.juror == juror) {
                    j.votes_cast += 1;
                    if Some(vote.side) == majority {
                        j.votes_with_majority += 1;
                    }
                }
            }
        }

        match majority {
            Some(side) => {
                let winners: Vec<&AccountId> = appeal
                    .votes
                    .iter()
                    .filter(|v| v.side == side)
                    .map(|v| &v.juror)
                    .collect();
                let share =
                    NearToken::from_yoctonear(appeal.fee.as_yoctonear() / winners.len() as u128);
                for juror in winners {
                    Promise::new(juror.clone()).transfer(share).detach();
                }
                self.settle(id, side);
            }
            None => {
                Promise::new(appeal.appellant.clone())
                    .transfer(appeal.fee)
                    .detach();
                self.settle(id, judge_winner);
            }
        }
    }
}
