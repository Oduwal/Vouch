//! Runs the contract on a local NEAR node to prove the pause works for real: a challenge yields,
//! the judge resumes it with a ruling, and a judge that never answers times out into refunds.

use std::sync::Arc;
use std::time::Duration;

use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde::de::DeserializeOwned;
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

struct Env {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    vouch: Contract,
    judge: AccountId,
    agent: AccountId,
    alice: AccountId,
}

impl Env {
    async fn new(wasm: Vec<u8>) -> TestResult<Self> {
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let mut accounts = vec![];
        for name in [
            "vouch.sandbox",
            "judge.sandbox",
            "sentinel.sandbox",
            "alice.sandbox",
        ] {
            let id: AccountId = name.parse()?;
            sandbox
                .create_account(id.clone())
                .initial_balance(NearToken::from_near(20))
                .send()
                .await?;
            accounts.push(id);
        }
        let [vouch, judge, agent, alice] = accounts.try_into().unwrap();

        Contract::deploy(vouch.clone())
            .use_code(wasm)
            .with_init_call("new", json!({ "judge": judge }))?
            .with_signer(signer.clone())
            .send_to(&net)
            .await?
            .assert_success();

        let env = Self {
            sandbox,
            net,
            signer,
            vouch: Contract(vouch.clone()),
            judge,
            agent,
            alice,
        };
        let hour = "3600000000000";
        env.call(
            &vouch,
            "set_config",
            json!({ "config": {
                "judge": env.judge,
                "challenge_window": hour,
                "appeal_window": "0",
                "jury_window": hour,
                "min_bond": NearToken::from_millinear(500),
                "challenge_stake_pct": 50,
                "appeal_fee": NearToken::from_near(1),
                "juror_stake": NearToken::from_near(1),
            }}),
            NearToken::from_yoctonear(0),
        )
        .await?;
        env.call(
            &env.agent,
            "register_agent",
            json!({}),
            NearToken::from_near(10),
        )
        .await?;
        env.call(
            &env.agent,
            "post_claim",
            json!({
                "subject": "free-airdrop-claim.near",
                "verdict": "block",
                "reasons": ["Created an hour ago", "Its code changed today"],
                "bond": NearToken::from_near(2),
            }),
            NearToken::from_yoctonear(0),
        )
        .await?;
        Ok(env)
    }

    async fn call(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult<()> {
        self.vouch
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(100))
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    async fn view<T: DeserializeOwned + Send + Sync>(
        &self,
        method: &str,
        args: Value,
    ) -> TestResult<T> {
        Ok(self
            .vouch
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    async fn balance(&self, who: &AccountId) -> TestResult<NearToken> {
        Ok(near_api::Account(who.clone())
            .tokens()
            .near_balance()
            .fetch_from(&self.net)
            .await?
            .total)
    }

    /// File a challenge without waiting on its transaction, which may not finish until the yield
    /// is resolved, and return once the contract lists it as waiting for the judge.
    async fn challenge(&self) -> TestResult<tokio::task::JoinHandle<()>> {
        let (vouch, alice, signer, net) = (
            self.vouch.clone(),
            self.alice.clone(),
            self.signer.clone(),
            self.net.clone(),
        );
        let tx = tokio::spawn(async move {
            vouch
                .call_function("challenge", json!({ "claim_id": "0", "evidence": "The receiver is a fresh airdrop drainer." }))
                .transaction()
                .deposit(NearToken::from_near(1))
                .gas(NearGas::from_tgas(100))
                .with_signer(alice, signer)
                .send_to(&net)
                .await
                .unwrap()
                .assert_success();
        });
        for _ in 0..60 {
            let waiting: Vec<Value> = self.view("get_waiting", json!({})).await?;
            if !waiting.is_empty() {
                return Ok(tx);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        panic!("the challenge never reached the judge");
    }

    async fn status(&self) -> TestResult<String> {
        let claim: Value = self.view("get_claim", json!({ "claim_id": "0" })).await?;
        Ok(claim["status"].as_str().unwrap().to_string())
    }
}

fn build() -> TestResult<Vec<u8>> {
    Ok(std::fs::read(cargo_near_build::build_with_cli(
        Default::default(),
    )?)?)
}

#[tokio::test]
async fn judge_resumes_the_paused_challenge() -> TestResult {
    let env = Env::new(build()?).await?;
    let alice_before = env.balance(&env.alice).await?;

    let tx = env.challenge().await?;
    assert_eq!(env.status().await?, "challenged");

    let ruling = json!({ "claim_id": "0", "ruling": {
        "winner": "challenger",
        "summary": "The receiver drains approvals. The block call was right.",
        "model": "sandbox-model",
        "attestation": "sha256:test",
    }});
    let stranger = env
        .vouch
        .call_function("submit_ruling", ruling.clone())
        .transaction()
        .with_signer(env.alice.clone(), env.signer.clone())
        .send_to(&env.net)
        .await?;
    stranger.assert_failure();

    env.call(
        &env.judge,
        "submit_ruling",
        ruling,
        NearToken::from_yoctonear(0),
    )
    .await?;
    tx.await?;
    assert_eq!(env.status().await?, "ruled");

    env.call(
        &env.alice,
        "finalize",
        json!({ "claim_id": "0" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(env.status().await?, "overturned");

    let agent: Value = env
        .view("get_agent", json!({ "account": env.agent }))
        .await?;
    assert_eq!(agent["calls_lost"], 1);
    assert_eq!(agent["bond_locked"], "0");
    let gained =
        env.balance(&env.alice).await?.as_yoctonear() as i128 - alice_before.as_yoctonear() as i128;
    // Alice staked 1 NEAR and got it back with the 2 NEAR bond, less gas.
    assert!(
        gained > NearToken::from_millinear(1900).as_yoctonear() as i128,
        "alice gained {gained}"
    );
    Ok(())
}

#[tokio::test]
async fn silent_judge_times_out_into_refunds() -> TestResult {
    let env = Env::new(build()?).await?;
    let tx = env.challenge().await?;

    // Yields time out after 200 blocks.
    env.sandbox.fast_forward(250).await?;
    tx.await?;
    for _ in 0..40 {
        if env.status().await? == "void" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert_eq!(env.status().await?, "void");

    let agent: Value = env
        .view("get_agent", json!({ "account": env.agent }))
        .await?;
    assert_eq!(
        agent["bond_free"],
        NearToken::from_near(10).as_yoctonear().to_string()
    );
    assert_eq!(agent["calls_lost"], 0);

    let late = env
        .vouch
        .call_function(
            "submit_ruling",
            json!({ "claim_id": "0", "ruling": {
                "winner": "challenger", "summary": "Too late.", "model": "m", "attestation": "a",
            }}),
        )
        .transaction()
        .with_signer(env.judge.clone(), env.signer.clone())
        .send_to(&env.net)
        .await?;
    late.assert_failure();
    Ok(())
}
