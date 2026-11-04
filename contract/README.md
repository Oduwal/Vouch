# Vouch contract

Bonded safety calls on NEAR accounts, with challenges ruled by a judge key through yield/resume and appeals to a staked jury. Rust, near-sdk 5.29. Version 1.3, deployed at `vouch.testnet`.

```bash
cargo test --lib                      # 106 tests
cargo near build non-reproducible-wasm
```

## Life of a claim

1. `post_claim`: an agent locks a bond from its pool behind `allow`, `warn` or `block`. One live call per agent per account, unless the new one is stricter. A `block` is also a report on the shared blocklist.
2. `challenge`: anyone files evidence and a stake while the claim is open. The contract yields.
3. `submit_ruling`: the judge key rules, in the yield or the late window after it times out. The ruling must carry the proof whose hash it names.
4. `appeal`: the loser pays to send the case to three jurors, who `commit_vote` then `reveal_vote`.
5. `finalize` or `release`: anyone closes a claim whose time has run out.
   - The challenger wins: they take the bond and their stake back.
   - The agent wins: it takes the stake, and the call reopens for at least 6 hours, so a weak challenge can't shield a false call. The round is kept, and `get_rounds` returns it.
   - The judge never ruled: a jury takes the case, paid from 20% of the stake. Without three jurors, or if that jury runs out of time, both sides are refunded.

## Methods

| Method | Who | What it does |
|---|---|---|
| `register_agent`, `withdraw` | Agents | Fund the bond pool, or take free bond out (1 yocto) |
| `post_claim` | Agents | Make a call, or report an account |
| `challenge` | Anyone | Dispute an open call |
| `submit_ruling` | Judge key | Rule on a challenge |
| `appeal` | The loser | Send a ruling to a jury |
| `join_jury`, `leave_jury` | Jurors | Stake, or leave after the lockup |
| `commit_vote`, `reveal_vote` | Drawn jurors | Seal a vote, then show it |
| `release`, `finalize` | Anyone | Close a claim whose time has run out |
| `collect_owed` | Anyone owed | Collect a payment that failed |
| `set_config`, `apply_config` | Owner, then anyone | Change settings after a public delay |
| `propose_upgrade`, `cancel_upgrade`, `apply_upgrade` | Owner, then anyone | Change the code after a public delay of at least 2 days |

## Views

`get_claim`, `get_claims`, `claims_count`, `get_verdict`, `get_agent_verdict`, `get_reports`, `get_rounds`, `get_appeals`, `get_due`, `active_count`, `get_waiting`, `get_agent`, `get_agents`, `get_juror`, `get_jurors`, `get_juror_joined`, `has_committed`, `get_commitment`, `get_owed`, `get_config`, `get_pending_config`, `get_pending_upgrade`, `get_owner`.

**Reading a report:** `get_reports` returns `block` calls that still stand, up to five, with those whose bond is at risk first. Treat one with its bond at risk as a block, and a closed one as a reason to ask a human: nobody can challenge it any more.

## Upgrades

Claim, Agent and Juror are stored one entry at a time, so their layout must never change. New data goes in new root maps, with new storage keys at the end of the enum.
