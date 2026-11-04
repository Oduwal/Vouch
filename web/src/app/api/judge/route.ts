import { runDemoJurors } from "../../../lib/agent/demo-jury";
import { closeDueClaims, keepCallsOpen } from "../../../lib/agent/upkeep";
import { judgeWaiting } from "../../../lib/judge";

// One ruling takes well under a minute. A case that has started can run on past its turn, so these leave
// room for that, and whatever doesn't fit waits for the next ping.
export const maxDuration = 180;
const JUDGE_STARTS_FOR_MS = 60_000;
const JURORS_START_UNTIL_MS = 125_000;

// Rules on every challenge the contract is waiting on, moves the demo jurors along, closes claims whose time
// has run out, and keeps a call open to challenge. The challenge page calls this right after a challenge lands, and an outside
// pinger calls it every minute so no challenge times out unheard and no bond stays locked.
export async function POST() {
  try {
    const started = Date.now();
    const outcomes = await judgeWaiting(started + JUDGE_STARTS_FOR_MS);
    const jurors = await runDemoJurors(started + JURORS_START_UNTIL_MS).catch((e: Error) => [{ error: e.message }]);
    const closed = await closeDueClaims().catch((e: Error) => [{ error: e.message }]);
    const opened = await keepCallsOpen().catch(() => null);
    return Response.json({ outcomes, jurors, closed, opened });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
