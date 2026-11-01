export type Level = "allow" | "warn" | "block";

export type Reason = { level: Level; text: string };

export type Check = {
  account: string;
  verdict: Level;
  reasons: Reason[];
  facts: {
    exists: boolean;
    createdAt: string | null;
    isContract: boolean;
    fullAccessKeys: number | null;
    deployCount: number | null;
    lastDeployAt: string | null;
  };
  checkedAt: string;
};

const RPC = "https://rpc.mainnet.fastnear.com";
const NEARBLOCKS = "https://api.nearblocks.io/v1";
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const DAY = 24 * 60 * 60 * 1000;

const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isAccountId(value: string) {
  return value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);
}

async function rpc<T>(params: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vouch", method: "query", params: { finality: "final", ...params } }),
    signal: AbortSignal.timeout(6000),
  });
  const body = await res.json();
  return body.result ?? null;
}

async function nearblocks<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${NEARBLOCKS}${path}`, { signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// NearBlocks timestamps are nanoseconds since the epoch.
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const fromNanos =(ns: string | number) => new Date(Number(BigInt(ns) / BigInt(1_000_000)));

export async function checkAccount(account: string): Promise<Check> {
  const [view, keys, info, deploys] = await Promise.all([
    rpc<{ code_hash: string }>({ request_type: "view_account", account_id: account }),
    rpc<{ keys: { access_key: { permission: unknown } }[] }>({ request_type: "view_access_key_list", account_id: account }),
    nearblocks<{ account: { created: { block_timestamp: number | string } }[] }>(`/account/${account}`),
    nearblocks<{ deployments: { block_timestamp: string }[] }>(`/account/${account}/contract/deployments`),
  ]);

  const checkedAt = new Date().toISOString();
  const reasons: Reason[] = [];

  if (!view) {
    return {
      account,
      verdict: "block",
      reasons: [{ level: "block", text: "No account by this name exists on NEAR mainnet" }],
      facts: { exists: false, createdAt: null, isContract: false, fullAccessKeys: null, deployCount: null, lastDeployAt: null },
      checkedAt,
    };
  }

  const isContract = view.code_hash !== EMPTY_CODE_HASH;
  const fullAccessKeys = keys ? keys.keys.filter((k) => k.access_key.permission === "FullAccess").length : null;
  const created = info?.account?.[0]?.created?.block_timestamp;
  const createdAt = created ? fromNanos(created) : null;
  const deployments = deploys?.deployments ?? null;
  const lastDeployAt = deployments?.length ? fromNanos(deployments[0].block_timestamp) : null;
  const now = Date.now();

  if (createdAt) {
    const age = now - createdAt.getTime();
    if (age < DAY) reasons.push({ level: "block", text: "Account was created less than a day ago" });
    else if (age < 30 * DAY) reasons.push({ level: "warn", text: `Account is only ${count(Math.floor(age / DAY), "day")} old` });
    else if (age < 365 * DAY) reasons.push({ level: "allow", text: `Account has existed for ${count(Math.floor(age / (30 * DAY)), "month")}` });
    else reasons.push({ level: "allow", text: `Account has existed for ${count(Math.floor(age / (365 * DAY)), "year")}` });
  }

  if (isContract) {
    if (fullAccessKeys === 0) reasons.push({ level: "allow", text: "Contract is locked: no key can change its code" });
    else if (fullAccessKeys) reasons.push({ level: "warn", text: `${count(fullAccessKeys, "full-access key")} can redeploy the code` });

    if (lastDeployAt) {
      const since = now - lastDeployAt.getTime();
      if (since < DAY) reasons.push({ level: "block", text: "Contract code changed in the last 24 hours" });
      else if (since < 7 * DAY) reasons.push({ level: "warn", text: "Contract code changed this week" });
    }
  } else {
    reasons.push({ level: "allow", text: "Plain account with no contract code" });
  }

  const verdict: Level = reasons.some((r) => r.level === "block")
    ? "block"
    : reasons.some((r) => r.level === "warn")
      ? "warn"
      : "allow";

  return {
    account,
    verdict,
    reasons,
    facts: {
      exists: true,
      createdAt: createdAt?.toISOString() ?? null,
      isContract,
      fullAccessKeys,
      deployCount: deployments?.length ?? null,
      lastDeployAt: lastDeployAt?.toISOString() ?? null,
    },
    checkedAt,
  };
}
