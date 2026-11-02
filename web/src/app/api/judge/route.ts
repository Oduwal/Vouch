import { judgeWaiting } from "../../../lib/judge";

// Attestation, the model call and the transaction together take well under a minute.
export const maxDuration = 60;

// Rules on every challenge the contract is waiting on. The challenge page calls this right after a
// challenge lands, and an outside pinger calls it every minute so no challenge times out unheard.
export async function POST() {
  try {
    return Response.json({ outcomes: await judgeWaiting() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
