import { timingSafeEqual } from "node:crypto";
import { vouchFor } from "../../../lib/agent/sentinel";
import { isAccountId } from "../../../lib/signals";

// Checking the account, asking the model and posting the claim. The model gets 25 seconds at most.
export const maxDuration = 45;

function isTrusted(request: Request) {
  const token = process.env.VOUCH_API_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !given) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Returns the sentinel's bonded call on an account, if one is live, and what the chain says now. Locking a
// new bond takes the API token: otherwise a loop over account names could tie up the whole pool.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const account = String(body.account ?? "").trim().toLowerCase();
  if (!isAccountId(account)) {
    return Response.json({ error: "Send {\"account\": \"<NEAR account name>\"}" }, { status: 400 });
  }

  try {
    return Response.json(await vouchFor(account, { mayPost: isTrusted(request) }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
