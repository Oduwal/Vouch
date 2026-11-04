import { runDemoJurors } from "../../../lib/agent/demo-jury";
import { closeDueClaims, keepCallsOpen } from "../../../lib/agent/upkeep";
import { judgeWaiting } from "../../../lib/judge";

// One ruling takes well under a minute. A case that has started can run on past its turn, so these leave
// room for that, and whatever doesn't fit waits for the next ping.
export const maxDuration = 180;
const JUDGE_STARTS_FOR_MS = 60_000;
const JURORS_START_UNTIL_MS = 125_000;
// Anyone can ping this, and each run can spend model credits. Per running instance, so it isn't a full rate
// limit: that belongs in front of the site.
const MIN_GAP_MS = 10_000;
let lastRun = 0;

// What a caller sees. The detail can name settings or echo a provider's error, so it stays in the logs.
function reported<T extends object>(items: T[], label: string) {
  return items.map((item) => {
    const { error } = item as { error?: string };
    if (!error) return item;
    console.error(label, error);
    return { ...item, error: "Not done yet. The next ping tries again." };
  });
}

// Rules on every challenge the contract is waiting on, moves the demo jurors along, closes claims whose time
// has run out, and keeps a call open to challenge. The challenge page calls this right after a challenge
// lands, and an outside pinger calls it every minute so no challenge times out unheard and no bond stays locked.
export async function POST() {
  const started = Date.now();
  if (started - lastRun < MIN_GAP_MS) return Response.json({ skipped: "A run just happened." });
  lastRun = started;
  try {
    const outcomes = await judgeWaiting(started + JUDGE_STARTS_FOR_MS);
    const jurors = await runDemoJurors(started + JURORS_START_UNTIL_MS).catch((e: Error) => [{ error: e.message }]);
    const closed = await closeDueClaims().catch((e: Error) => [{ error: e.message }]);
    const opened = await keepCallsOpen().catch(() => null);
    return Response.json({ outcomes: reported(outcomes, "judge"), jurors: reported(jurors, "jurors"), closed: reported(closed, "closing"), opened });
  } catch (e) {
    console.error("ping", (e as Error).message);
    return Response.json({ error: "This run failed. The next ping tries again." }, { status: 502 });
  }
}
