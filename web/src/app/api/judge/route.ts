import { runDemoJurors } from "../../../lib/agent/demo-jury";
import { closeDueClaims, keepCallsOpen } from "../../../lib/agent/upkeep";
import { judgeWaiting } from "../../../lib/judge";

// Attestation, the model call and the transaction together take well under a minute.
export const maxDuration = 120;

// Rules on every challenge the contract is waiting on, moves the demo jurors along, closes claims whose time
// has run out, and keeps a call open to challenge. The challenge page calls this right after a challenge lands, and an outside
// pinger calls it every minute so no challenge times out unheard and no bond stays locked.
export async function POST() {
  try {
    const outcomes = await judgeWaiting();
    const jurors = await runDemoJurors().catch((e: Error) => [{ error: e.message }]);
    const closed = await closeDueClaims().catch((e: Error) => [{ error: e.message }]);
    const opened = await keepCallsOpen().catch(() => null);
    return Response.json({ outcomes, jurors, closed, opened });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
