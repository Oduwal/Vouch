# Vouch contract

Checking agents lock a NEAR bond behind every call they make on an account (`allow`, `warn` or `block`, with reasons). Anyone can challenge a call by staking at least half the bond. The contract then **pauses in a yield** until the judge account resumes it with a ruling. If the judge does not answer within about 200 blocks, the yield times out and both sides are refunded. The loser of a ruling can appeal to three jurors drawn at random from a staked jury pool.

## Life of a claim

```
post_claim ──► open ──(window passes, release)──► held
                 │
             challenge
                 ▼
            challenged ──(yield times out)──► void: both refunded
                 │
          submit_ruling (judge resumes the yield → on_ruling)
                 ▼
               ruled ──(appeal window passes, finalize)──► held | overturned
                 │
              appeal
                 ▼
             appealed ──(2 of 3 jurors agree, or finalize after the jury window)──► held | overturned
```

- **held**: the call stood. The agent gets its bond back, plus the counter-stake if there was a challenge.
- **overturned**: the call was wrong. The challenger takes the bond and their stake back, and the agent's record shows a lost call.

## Methods

| Method | Who | Deposit |
| --- | --- | --- |
| `new(judge)` | deployer | none |
| `set_config(config)` | owner | none |
| `register_agent()` | an agent | bond to add to the pool |
| `withdraw(amount)` | an agent | exactly 1 yoctoNEAR |
| `post_claim(subject, verdict, reasons, bond)` | an agent | none |
| `release(claim_id)` | anyone | none |
| `challenge(claim_id, evidence)` | anyone except the agent | at least `challenge_stake_pct` of the bond |
| `submit_ruling(claim_id, ruling)` | the judge | none |
| `appeal(claim_id)` | the side that lost | exactly `appeal_fee` |
| `join_jury()` / `leave_jury()` | jurors | at least `juror_stake` / 1 yoctoNEAR |
| `vote(claim_id, side)` | a drawn juror | none |
| `finalize(claim_id)` | anyone | none |

Views: `get_verdict(subject)`, `get_claim(claim_id)`, `get_claims(from_index, limit)`, `claims_count()`, `get_agent(account)`, `get_agents(from_index, limit)`, `get_waiting()`, `get_config()`, `get_owner()`.

Every state change logs a NEP-297 event (`EVENT_JSON:{"standard":"vouch",...}`).

## Keys

`post_claim` takes no deposit, so an agent can sign it with a **function-call access key** limited to this contract and that one method. That key cannot transfer NEAR, add keys or withdraw bond: `withdraw` requires 1 yoctoNEAR, and function-call keys cannot attach deposits. Each transaction spends from the key's gas allowance; once the allowance runs out, the key stops working until the owner adds a new one.

## Build and test

Run these in Linux or WSL with [cargo-near](https://github.com/near/cargo-near) installed:

```bash
cargo near build non-reproducible-wasm   # contract wasm in target/near/
cargo test --lib                          # unit tests
cargo test --test sandbox                 # yield/resume on a local NEAR node
```
