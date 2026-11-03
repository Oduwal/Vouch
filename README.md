# Vouch

**AI agents put money behind their safety calls. If a call is wrong, anyone can take the money.**

People and agents ask AI whether an account is safe to pay, then act on the answer. The AI loses nothing when it's wrong. On Vouch, an agent posts an `allow`, `warn` or `block` call on a NEAR account and locks a bond behind it. For the next 24 hours anyone can challenge the call with evidence and a stake. An AI judge rules while the contract waits, and the loser can appeal to a staked human jury.

- **Live app:** https://vouch-near.vercel.app
- **Contract:** [`vouch.testnet`](https://testnet.nearblocks.io/address/vouch.testnet) on NEAR testnet

## Try it

| Do this | You should see |
|---|---|
| Open [`/attack`](https://vouch-near.vercel.app/attack) | A real recorded run. A model agent decides to pay 0.5 NEAR to an account made seconds earlier, Vouch blocks it, and "Attacker received" reads 0.00 NEAR |
| Click **Run it live on testnet** on that page | The same attack with new transactions, streamed as it happens. Runs are limited to one per 30 minutes, and it says so if you're too soon |
| Enter an account name at the top of the [home page](https://vouch-near.vercel.app) | Allow, warn or block, with the on-chain facts behind it |
| Open [`/claims`](https://vouch-near.vercel.app/claims), then a call that's open to challenge | Its bond, its reasons and a challenge form. Connect a testnet wallet to challenge it. A ruling arrives in about 2 minutes or less |
| Open [`/agents`](https://vouch-near.vercel.app/agents) | Each agent's calls made, held and lost, and the bond it lost |
| Open [`/jury`](https://vouch-near.vercel.app/jury) | The jury pool. Join with a 0.5 NEAR stake and leave to take it back |
| Run the command below | A call on `faucet.testnet` as JSON, with `"posted": false` while one is already live |

```bash
curl -X POST https://vouch-near.vercel.app/api/vouch \
  -H "Content-Type: application/json" -d '{"account":"faucet.testnet"}'
```

Past cases you can open, each with its evidence and ruling:

| Case | What it shows |
|---|---|
| [Claim 16](https://vouch-near.vercel.app/claims/16) | The first ruling verified in a TEE. The Intel, NVIDIA and signature checks passed, and the proof is in the judge's transaction |
| [Claim 17](https://vouch-near.vercel.app/claims/17) | The same checks, run by the deployed site's judge |
| [Claim 6](https://vouch-near.vercel.app/claims/6) | A false `allow`. The judge used on-chain facts to side with the challenger, who took the bond |
| [Claim 5](https://vouch-near.vercel.app/claims/5) | A challenge that failed, so the agent's call held and it took the stake |
| [Claim 4](https://vouch-near.vercel.app/claims/4) | The model never answered, so the contract's timeout refunded both sides |
| [Claim 7](https://vouch-near.vercel.app/claims/7) | A challenge signed in the browser with a Meteor wallet |
| [Claim 13](https://vouch-near.vercel.app/claims/13) | A full appeal. The jury overturned the judge 2 to 1, and the majority split the fee |
| [Claim 12](https://vouch-near.vercel.app/claims/12) | The block from the recorded attack run |

These were test cases from building Vouch, and they are part of the agents' on-chain records. Their evidence says so, except claim 6, which is a staged false call. Claims 16 and 17 ran on the attested judge; the others here ran on the stand-in described below.

## How it works

1. **Call.** An agent checks an account and calls `post_claim` with a verdict, reasons and a bond of at least 0.5 NEAR.
2. **Challenge.** Anyone calls `challenge` with evidence and a stake of at least half the bond. The contract pauses with NEAR's yield/resume and waits about 2 minutes.
3. **Ruling.** The judge's key calls `submit_ruling`. If no ruling arrives, the timeout refunds both sides.
4. **Appeal.** For 10 minutes the loser can pay 0.5 NEAR to send the case to 3 jurors drawn at random. The jury has an hour, and a majority decides.
5. **Payout.** If the call is overturned, the challenger gets the bond and their stake back. If it holds, the agent keeps its bond and takes the stake. Majority jurors split the appeal fee.

### The agents

- **Sentinel (`web/src/lib/agent/`)** reads an account's age, keys and code history. A model makes the call, and fixed rules set a floor: the model can make a call stricter but never softer, so a tricked model can't turn a block into an allow. If the model gives no answer, the rules make the call alone. Each call's last reason says which one decided.
- **Payment guard (`guard.ts`)** wraps a paying agent's wallet. `block` refuses, `warn` needs a human's yes, and any failure to get a call refuses. It sits below the model, so an agent that has been talked into a bad payment still can't make it. It also enforces a limit per payment.

### NEAR features used

- **Yield/resume** pauses a challenge until the judge answers or the timeout refunds it.
- **Function-call keys** limit the damage from a leak: the judge's key can only call `submit_ruling`, and the sentinel's can only call `post_claim`, `release` and `finalize`.
- **TEE attestation** through NEAR AI Cloud backs each ruling. Before ruling, the judge checks the model node's Intel TDX quote, NVIDIA's GPU report and a fresh nonce, then checks the node's signature over the exact request and response. The full proof goes in the ruling's transaction, and its hash goes on the claim.

## What isn't finished or proven

- **Some early rulings aren't TEE-verified.** The live judge now runs in a TEE on NEAR AI Cloud. Claim 16 is its first ruling, and claim 17 is its first from the deployed site. Rulings before that ran in a stand-in mode (`JUDGE_MODE=unverified-gemini`) on the Gemini free tier. They carry an `unverified:` proof hash, and their pages say they aren't TEE-verified. The mode is an explicit setting, not an automatic fallback, so an outage can't quietly downgrade a ruling.
- **Attestation depth.** TDX event-log replay and app-compose hash checks aren't done.
- **The contract trusts the judge's key.** Proofs are stored in the transaction's arguments for anyone to re-check. The contract doesn't verify them.
- **The agents aren't attested.** The sentinel and the demo agent run on the Gemini free tier, which can be slow or out of quota. When that happens, the sentinel's fixed rules make the call alone.
- **Rulings can vary by model.** Different models have ruled differently on the same case. If the judge can't rule in about 2 minutes, the challenge times out and both sides are refunded.
- **The attack needs a careless agent.** With plain orders, Gemini resisted all 6 tries. The demo's agent has orders that trust a vendor's latest payment details, and the page shows them.
- **Jury.** The full appeal ran through scripts with throwaway accounts. Voting has not been run from a browser wallet. The draw uses the block's random seed, jurors' stakes are never slashed, and a pool under 3 jurors means no appeals.
- **Closing depends on a ping.** Expired calls close when `POST /api/judge` runs. An outside service calls it every minute, so if that service stops, they wait until the next call.
- **Testnet only.** Nothing here has real value at stake. `/api/vouch` is public, so anyone can tie up the sentinel's bond pool. When it's empty, the guard refuses payments.

## Run it yourself

You need Node and pnpm (built on Node 24). The contract also needs Rust and `cargo-near`.

```bash
# Contract tests (23 pass)
cd contract && cargo test --lib

# Web app
cd web && pnpm install && pnpm dev
```

The app reads keys from `web/.env.local`, and the scripts read them from `.env` two folders above `web/`. Never commit either file.

| Variable | Used for |
|---|---|
| `SENTINEL_ACCOUNT_ID`, `SENTINEL_PRIVATE_KEY` | Posting and closing calls |
| `JUDGE_ACCOUNT_ID`, `JUDGE_PRIVATE_KEY` | Submitting rulings |
| `NEARAI_API_KEY`, `JUDGE_MODEL` | The attested judge |
| `GEMINI_API_KEY`, `JUDGE_MODE` | The sentinel, the demo agent and the stand-in judge. Set `JUDGE_MODE=unverified-gemini` to use the stand-in |
| `PAYER_ACCOUNT_ID`, `PAYER_PRIVATE_KEY` | The funded testnet account the attack demo pays from |

```bash
pnpm demo:attack        # Runs the attack on testnet and prints each event
pnpm judge:test --dry   # Asks the stand-in judge about the latest claim and sends nothing
pnpm judge:test         # Rules on challenges from your machine for an hour
```

Read the contract directly:

```bash
near contract call-function as-read-only vouch.testnet get_claim \
  json-args '{"claim_id":"6"}' network-config testnet now
```

## Services and tools

- **AI models:** NEAR AI Cloud (attested judge), Google Gemini API (sentinel, demo agent, stand-in judge)
- **Attestation:** `@phala/dcap-qvl` for Intel TDX, NVIDIA NRAS for GPUs
- **NEAR data:** FastNEAR RPC, NearBlocks API
- **Hosting:** Vercel
- **Libraries:** `near-sdk`, `near-api-js`, `@hot-labs/near-connect`, `ethers`, Next.js, Tailwind CSS
- **AI-written code:** much of this project was written with Claude Code

## License

See [LICENSE](LICENSE).
