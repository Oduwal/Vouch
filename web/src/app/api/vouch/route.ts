import { vouchFor } from "../../../lib/agent/sentinel";
import { isAccountId } from "../../../lib/signals";

// Checking the account and posting the claim together take a few seconds.
export const maxDuration = 30;

// Returns the sentinel's bonded call on an account, posting a new one when none is live.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const account = String(body.account ?? "").trim().toLowerCase();
  if (!isAccountId(account)) {
    return Response.json({ error: "Send {\"account\": \"<NEAR account name>\"}" }, { status: 400 });
  }

  try {
    return Response.json(await vouchFor(account));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
