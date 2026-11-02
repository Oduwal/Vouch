import { closeDueClaims } from "../../../lib/agent/upkeep";
import { judgeWaiting } from "../../../lib/judge";

// Attestation, the model call and the transaction together take well under a minute.
export const maxDuration = 60;

// Rules on every challenge the contract is waiting on, then closes claims whose windows have passed.
// The challenge page calls this right after a challenge lands, and an outside pinger calls it every
// minute so no challenge times out unheard and no bond stays locked.
export async function POST() {
  try {
    const outcomes = await judgeWaiting();
    const closed = await closeDueClaims().catch((e: Error) => [{ error: e.message }]);
    return Response.json({ outcomes, closed });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
