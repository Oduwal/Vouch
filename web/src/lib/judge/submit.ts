// Sends a ruling to the contract, signed with the judge's key that can only call submit_ruling.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import { CONTRACT_ID, TESTNET_RPC, type Side } from "../vouch";

export type Outcome =
  | { claimId: string; ruled: true; winner: Side; summary: string; attestation: string; transaction: string }
  | { claimId: string; ruled: false; error: string };

function judgeAccount() {
  const id = process.env.JUDGE_ACCOUNT_ID;
  const key = process.env.JUDGE_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !key) throw new Error("JUDGE_ACCOUNT_ID and JUDGE_PRIVATE_KEY must be set");
  return new Account(id, new JsonRpcProvider({ url: TESTNET_RPC }), key);
}

export async function submitRuling(
  claimId: string,
  ruling: { winner: Side; summary: string; model: string; attestation: string },
  proof: string,
): Promise<Outcome> {
  const tx = await judgeAccount().callFunctionRaw({
    contractId: CONTRACT_ID,
    methodName: "submit_ruling",
    args: { claim_id: claimId, ruling, proof },
    gas: teraToGas("100"),
  });
  return {
    claimId,
    ruled: true,
    winner: ruling.winner,
    summary: ruling.summary,
    attestation: ruling.attestation,
    transaction: tx.transaction.hash,
  };
}
