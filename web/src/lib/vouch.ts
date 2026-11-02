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

export type Agent = {
  account: string;
  bond_free: string;
  bond_locked: string;
  calls_made: number;
  calls_held: number;
  calls_lost: number;
  bond_lost: string;
};

export type Config = {
  judge: string;
  challenge_window: string;
  appeal_window: string;
  jury_window: string;
  min_bond: string;
  challenge_stake_pct: number;
  appeal_fee: string;
  juror_stake: string;
};

export type Juror = {
  account: string;
  stake: string;
  open_cases: number;
  votes_cast: number;
  votes_with_majority: number;
};

export const JURY_SIZE = 3;

// The draw skips both parties and the judge, as the contract does.
export function eligibleJurors(jurors: Juror[], claim: Claim, config: Config) {
  const parties = [claim.agent, claim.challenge?.challenger, config.judge];
  return jurors.filter((j) => !parties.includes(j.account));
}

const YOCTO_PER_NEAR = BigInt(10) ** BigInt(24);
const NANOS_PER_MS = BigInt(1_000_000);
const PAGE = 100;

export const nanosToMs = (ns: string) => Number(BigInt(ns) / NANOS_PER_MS);

export function formatNear(yocto: string | bigint, digits = 2) {
  const value = BigInt(yocto);
  const scale = BigInt(10) ** BigInt(digits);
  // Rounds to the nearest unit shown, so 0.249… never prints as 0.24.
  const scaled = (value * scale + YOCTO_PER_NEAR / BigInt(2)) / YOCTO_PER_NEAR;
  return `${scaled / scale}.${(scaled % scale).toString().padStart(digits, "0")}`;
}

// Exact decimal parsing: floats cannot hold 24 places. Returns null for anything but a plain amount.
export function parseNear(near: string): bigint | null {
  const match = near.trim().match(/^(\d*)(?:\.(\d{0,24}))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  return BigInt(match[1] || "0") * YOCTO_PER_NEAR + BigInt((match[2] ?? "").padEnd(24, "0") || "0");
}

// The contract's own rule, in the same order of operations.
export const minStake = (bond: string, config: Config) =>
  (BigInt(bond) / BigInt(100)) * BigInt(config.challenge_stake_pct);

export type Phase = "open" | "window-closed" | "dispute" | "held" | "overturned" | "void";

export function phaseOf(claim: Claim, nowMs: number): Phase {
  switch (claim.status) {
    case "open":
      return nanosToMs(claim.challenge_until) > nowMs ? "open" : "window-closed";
    case "challenged":
    case "ruled":
    case "appealed":
      return "dispute";
    default:
      return claim.status;
  }
}

// The newest claims, newest first.
export async function latestClaims(): Promise<Claim[]> {
  const count = Number(await view<string>("claims_count"));
  const from = Math.max(0, count - PAGE);
  const claims = await view<Claim[]>("get_claims", { from_index: String(from), limit: PAGE });
  return claims.reverse();
}

// Public RPC nodes drop the odd request; one retry keeps that from failing a whole page.
export function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return callView<T>(method, args).catch(() => callView<T>(method, args));
}

async function callView<T>(method: string, args: Record<string, unknown>): Promise<T> {
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
