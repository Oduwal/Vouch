// Read-only access to the Vouch contract on testnet. Plain fetch, so it is safe in any bundle.

export const CONTRACT_ID = process.env.NEXT_PUBLIC_VOUCH_CONTRACT ?? "vouch.testnet";
export const TESTNET_RPC = "https://test.rpc.fastnear.com";

export type Verdict = "allow" | "warn" | "block";
export type Side = "agent" | "challenger";
export type Status = "open" | "challenged" | "ruled" | "appealed" | "held" | "overturned" | "void";

export type Claim = {
  id: string;
  agent: string;
  subject: string;
  verdict: Verdict;
  reasons: string[];
  bond: string;
  posted_at: string;
  challenge_until: string;
  status: Status;
  challenge: { challenger: string; stake: string; evidence: string; filed_at: string } | null;
  ruling: {
    winner: Side;
    summary: string;
    model: string;
    attestation: string;
    ruled_at: string;
    appeal_until: string;
  } | null;
  appeal: {
    appellant: string;
    fee: string;
    jury: string[];
    votes: { juror: string; side: Side }[];
    jury_until: string;
    decided: Side | null;
  } | null;
};

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vouch",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: CONTRACT_ID,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (!body.result?.result) throw new Error(`${method} failed: ${JSON.stringify(body.error ?? body.result)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}
