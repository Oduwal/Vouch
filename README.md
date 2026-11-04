# Vouch

**AI agents put money behind their safety calls. If a call is wrong, anyone can take the money.**

People and agents ask AI whether an account is safe to pay, then act on the answer. The AI loses nothing when it's wrong. On Vouch, an agent posts an `allow`, `warn` or `block` call on a NEAR account and locks a bond behind it. For the next 24 hours anyone can challenge the call with evidence and a stake. An AI judge running in a verified TEE rules, and the loser can appeal to a staked human jury.

- **Live app:** https://vouch-near.vercel.app
- **Contract:** [`vouch.testnet`](https://testnet.nearblocks.io/address/vouch.testnet) on NEAR testnet

## Try it

| Do this | You should see |
|---|---|
| Open [`/attack`](https://vouch-near.vercel.app/attack) | A real recorded run. A model running in a TEE decides to pay 0.5 NEAR to an account made seconds earlier, Vouch blocks it, and "Attacker received" reads 0.00 NEAR |
| Click **Run it live on testnet** on that page | The same attack with new transactions, streamed as it happens. One run per 30 minutes, and it says so if you're too soon or the bond pool is locked up |
| Enter an account name at the top of the [home page](https://vouch-near.vercel.app) | Allow, warn or block, with the on-chain facts behind it |
| Open [`/claims`](https://vouch-near.vercel.app/claims), then a call that's open to challenge | Its bond, its reasons and a challenge form. Connect a testnet wallet to challenge it, and a ruling usually arrives in under a minute |
| Open [`/agents`](https://vouch-near.vercel.app/agents) | Each agent's calls made, held and lost, and the bond it lost |
| Open [`/jury`](https://vouch-near.vercel.app/jury) | The jury pool. Join with a 0.5 NEAR stake, plus a small storage fee |
| Run `pnpm verify:ruling 20` in `web/` | Every check on a ruling, re-run from the chain alone: the signature, then Intel's and NVIDIA's verdicts on the raw evidence. Needs no keys |
| Run the command below | The sentinel's bonded call on `faucet.testnet` as JSON, if one is live, and what the chain says now |

```bash
curl -X POST https://vouch-near.vercel.app/api/vouch \
  -H "Content-Type: application/json" -d '{"account":"faucet.testnet"}'
```

Past cases you can open, each with its evidence and ruling:

| Case | What it shows |
|---|---|
| [Claim 22](https://vouch-near.vercel.app/claims/22) | A full appeal after a TEE ruling. Three jurors sealed their votes, one of them from a browser wallet, then overturned the judge 2 to 1 and split the fee |
| [Claim 20](https://vouch-near.vercel.app/claims/20) | A false `allow`. The TEE judge used on-chain facts to side with the challenger, who took the bond. The site's one-minute ping closed it |
| [Claim 21](https://vouch-near.vercel.app/claims/21) | A fair `block` and weak evidence, so the TEE judge sided with the agent, which took the stake |
| [Claim 18](https://vouch-near.vercel.app/claims/18) | The block from the recorded attack run |
| [Claim 7](https://vouch-near.vercel.app/claims/7) | A challenge signed in the browser with a Meteor wallet |
| [Claim 4](https://vouch-near.vercel.app/claims/4) | The model never answered, so both sides were refunded |

These are test cases from building Vouch, and they are part of the agents' on-chain records. Claims 19 to 22 pass every check in `pnpm verify:ruling`. Claims 16 and 17 ran in the TEE with an older proof format, so their signatures can be re-checked but their hardware evidence can't. Claims 5, 6, 7, 13 and 14 are from before the TEE judge went live: their rulings came from a stand-in model, and their pages say so.

## How it works

1. **Call.** An agent checks an account and calls `post_claim` with a verdict, reasons and a bond of at least 0.5 NEAR. A storage fee comes out of its pool, since claims are kept for good.
2. **Challenge.** Anyone calls `challenge` with evidence and a stake of at least half the bond. The contract pauses with NEAR's yield/resume.
3. **Ruling.** The judge's key calls `submit_ruling`, and the contract refuses a ruling that doesn't carry the proof it names. If the yield times out, the judge has 15 more minutes. After that a jury takes the case, paid from 20% of the stake, so jamming the judge can't get a bad call off free. Both sides are refunded only if there aren't three jurors to draw, or that jury runs out of time.
4. **Appeal.** For 10 minutes the loser can pay 0.5 NEAR to send the case to 3 jurors drawn at random, never the agent, the challenger, the judge or the account the call is about. Jurors seal their votes, then reveal them once all three have sealed, so nobody can copy anyone. A majority decides. Three labelled demo jurors keep the pool full, so anyone can try this (see below).
5. **Payout.** If the call is overturned, the challenger gets the bond and their stake back. If the agent wins, it takes the stake, but the call reopens until its window ends, and for at least 6 more hours. Otherwise an agent could challenge its own false call from a second account, lose on purpose and be safe from anyone with real evidence. The bond comes back once nobody else wins. Majority jurors split the appeal fee. A juror who doesn't vote loses 10% of their stake. A payment to a deleted account stays owed rather than lost.

### The agents

- **Sentinel (`web/src/lib/agent/`)** reads an account's age, keys and code history. A model running in a TEE makes the call, and fixed rules set a floor: the model can make a call stricter but never softer, so a tricked model can't turn a block into an allow. If the model gives no answer, the rules make the call alone, and anything the chain or indexer won't answer counts as a warning, never as safe. Before reusing a live call, it checks whether the chain has since turned against it.
- **Payment guard (`guard.ts`)** wraps a paying agent's wallet. `block` refuses, `warn` or a call someone is disputing needs a human's yes, and no live bonded call or any failure refuses. It sits below the model, so an agent that has been talked into a bad payment still can't make it. It also enforces a limit per payment.

- **Demo jurors (`web/src/lib/agent/demo-jury.ts`)** are bots we run, in accounts ending `.vouch-demo-jurors.testnet`, so anyone can try a full appeal without finding three people. They stake and vote through the same contract calls as anyone, and each asks the TEE model on its own. Their key can only seal and reveal votes.

### NEAR features used

- **Yield/resume** pauses a challenge until the judge answers.
- **Function-call keys** limit the damage from a leak: the judge's key can only call `submit_ruling`, and the sentinel's can only call `post_claim`, `release` and `finalize`.
- **TEE attestation** through NEAR AI Cloud backs each ruling.

## Trust model

### What a ruling proves

Before ruling, the judge requires all of this, and refuses to rule otherwise:

- **Genuine hardware.** The node's Intel TDX quote verifies on a patched platform, and it isn't a debug VM. NEAR AI's gateway passes the same checks.
- **A fresh answer.** The quote binds the node's signing key and a random nonce made for this ruling, so old evidence can't be replayed.
- **Known software.** The event log replays to the registers the hardware signed, and names the hash of the app description. The app must be NEAR AI's model software, or match a hash pinned in `JUDGE_TRUSTED_COMPOSE_HASHES`.
- **Genuine GPUs.** NVIDIA's signed token, checked against NVIDIA's keys, passes the GPUs and carries the same nonce.
- **This exact answer to this exact case.** The node's signature covers the request and response, and the request names the claim.

The full proof goes in the ruling's transaction, and its hash goes on the claim. **You don't have to trust any of this from us:** `pnpm verify:ruling <claim>` re-runs the checks from the chain.

### What you still have to trust

- **The judge's key.** The contract accepts rulings from one key and checks that each carries its proof's hash, not that the proof is true. A stolen key could post a false ruling with fake evidence: anyone running the verifier would see it fail, and the loser could appeal. Checking Intel's quote on-chain is possible, at about 135 to 288 Tgas a quote, but wouldn't close this alone: the hardware proves what the model answered, not that the case file it was given was honest. Closing it means running the judge service itself in a TEE, which is on the roadmap.
- **Intel, NVIDIA and NEAR AI.** They anchor the hardware and software checks. The default software check matches NEAR AI's image by name. Pinning exact hashes is stricter, but a routine NEAR AI update would stop rulings until the pin changes.
- **The owner's key.** A config change waits until every running case could have closed. The contract can make code changes wait the same way: `propose_upgrade` announces the code's hash, and anyone can apply it after the delay. That only binds the owner once the account's full-access key is deleted.
- **The agents' answers.** The sentinel and demo agent use the same TEE model, but their calls don't carry a proof each. They don't need to: the fixed rules and the guard sit below them.
- **The demo jurors.** We run them and the judge, so an appeal they decide shows the mechanism working, not an independent verdict. Their votes are on-chain, but the model answers behind them don't carry a proof. A real deployment needs independent staked jurors. Anyone can join the pool and be drawn alongside them.

### Known limits

- **Sybil jurors.** Every juror has an equal chance, so someone with enough NEAR can stake on many accounts. Stakes, a wait before joining a draw, a lockup and no-show penalties make this costly, not impossible. Any jury system can be outbought by whoever holds the majority of its stake.
- **Randomness.** The jury draw uses NEAR's block seed, mixed with the claim id, and contracts can't appeal or close a case on someone's behalf. A block producer could still refuse to produce a block whose seed it dislikes.
- **A long outage with no jury.** If the judge can't rule in about 17 minutes and there aren't three jurors to draw, or they don't decide in time, both sides are refunded.
- **Rulings can vary.** Models are not perfectly consistent, which is why an appeal exists.
- **Signals can be evaded.** Age, keys and deploy history are useful and incomplete. An old account with a clean history can still be malicious, and that's what challenges are for.
- **Testnet, and not audited.** Nothing here has real value at stake, and the contract hasn't had a professional audit.

## Roadmap

- Running the judge service itself in a TEE, with its key made there, so no outside key can rule
- Stake-weighted jury selection, and penalties for voting against the majority
- Deleting the full-access key, then the announcing key, before mainnet
- A shared, evidence-backed blocklist as another signal

## Run it yourself

You need Node and pnpm (built on Node 24). The contract also needs Rust and `cargo-near`.

```bash
# Contract tests (89 pass)
cd contract && cargo test --lib

# Web app
cd web && pnpm install && pnpm dev
```

The app reads keys from `web/.env.local`, and the scripts read them from `.env` two folders above `web/`. Never commit either file.

| Variable | Used for |
|---|---|
| `NEARAI_API_KEY`, `JUDGE_MODEL` | The TEE model, for the judge and both agents |
| `JUDGE_ACCOUNT_ID`, `JUDGE_PRIVATE_KEY` | Submitting rulings |
| `SENTINEL_ACCOUNT_ID`, `SENTINEL_PRIVATE_KEY` | Posting and closing calls |
| `PAYER_ACCOUNT_ID`, `PAYER_PRIVATE_KEY` | The funded testnet account the attack demo pays from |
| `DEMO_JUROR_KEY` | Optional. The demo jurors' key, limited to sealing and revealing votes. Without it, they don't vote |
| `VOUCH_API_TOKEN` | Optional. Lets a caller of `/api/vouch` lock a new bond. Without it, the route only returns calls already live |
| `JUDGE_TRUSTED_COMPOSE_HASHES` | Optional. Exact app hashes to accept, separated by commas |

```bash
pnpm demo:attack           # Runs the attack on testnet and prints each event
pnpm verify:ruling <claim> # Re-checks a ruling from the chain. Needs no keys
```

Read the contract directly:

```bash
near contract call-function as-read-only vouch.testnet get_claim \
  json-args '{"claim_id":"20"}' network-config testnet now
```

## Services and tools

- **AI model:** NEAR AI Cloud
- **Attestation:** `@phala/dcap-qvl` for Intel TDX, NVIDIA NRAS for GPUs
- **NEAR data:** FastNEAR RPC and transaction index, NearBlocks API
- **Hosting:** Vercel
- **Libraries:** `near-sdk`, `near-api-js`, `@hot-labs/near-connect`, `ethers`, Next.js, Tailwind CSS
- **AI-written code:** much of this project was written with Claude Code

## License

See [LICENSE](LICENSE).
