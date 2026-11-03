import { AttackDemo } from "../../components/claims/AttackDemo";
import type { AttackEvent } from "../../lib/agent/attack-data";
import recorded from "../../data/attack-run.json";

export default function AttackPage() {
  return <AttackDemo recorded={recorded as AttackEvent[]} live={!!process.env.PAYER_PRIVATE_KEY} />;
}
