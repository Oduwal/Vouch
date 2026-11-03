export type Level = "allow" | "warn" | "block";

export type Reason = { level: Level; text: string };

export type Network = "mainnet" | "testnet";

export type Check = {
  account: string;
  network: Network;
  verdict: Level;
  reasons: Reason[];
  facts: {
    exists: boolean;
    createdAt: string | null;
    // "indexer" is the account's creation; "oldest-key" is when its oldest access key was added.
    ageSource: "indexer" | "oldest-key" | null;
    isContract: boolean;
    fullAccessKeys: number | null;
    deployCount: number | null;
    lastDeployAt: string | null;
  };
  checkedAt: string;
};

const RPC: Record<Network, string> = {
  mainnet: "https://rpc.mainnet.fastnear.com",
  testnet: "https://test.rpc.fastnear.com",
};
const NEARBLOCKS: Record<Network, string> = {
  mainnet: "https://api.nearblocks.io/v1",
  testnet: "https://api-testnet.nearblocks.io/v1",
};
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const DAY = 24 * 60 * 60 * 1000;
// A new access key's nonce starts at the block height times this.
const NONCE_PER_BLOCK = BigInt(1_000_000);

const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isAccountId(value: string) {
  return value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);
}

export const networkOf = (account: string): Network => (account.endsWith(".testnet") ? "testnet" : "mainnet");

// Returns null only when the account does not exist. Any other RPC failure throws, so a flaky node
// is never mistaken for a missing account.
async function rpc<T>(network: Network, method: string, params: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(RPC[network], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vouch", method, params }),
    signal: AbortSignal.timeout(6000),
  });
  const body = await res.json();
  if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
  if (!body.result) throw new Error(`${method} failed: ${body.error?.cause?.name ?? res.status}`);
  return body.result;
}

const query = <T>(network: Network, params: Record<string, unknown>) =>
  rpc<T>(network, "query", { finality: "final", ...params });

async function nearblocks<T>(network: Network, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${NEARBLOCKS[network]}${path}`, { signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// NearBlocks timestamps are nanoseconds since the epoch.
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const fromNanos = (ns: string | number) => new Date(Number(BigInt(ns) / BigInt(1_000_000)));

type Block = { header: { height: number; timestamp_nanosec: string } };

// When the indexer has no creation time (the testnet indexer often lags), date the oldest access key
// from its nonce. Nodes only keep about a day of blocks, so older heights are dated from the
// average block time.
async function oldestKeyAddedAt(network: Network, nonces: bigint[]): Promise<Date | null> {
  if (!nonces.length) return null;
  const height = Number(nonces.reduce((a, b) => (a < b ? a : b)) / NONCE_PER_BLOCK);
  const block = (id: number | "final") =>
    rpc<Block>(network, "block", id === "final" ? { finality: "final" } : { block_id: id }).catch(() => null);

  const exact = await block(height);
  if (exact) return fromNanos(exact.header.timestamp_nanosec);

  const latest = await block("final");
  if (!latest) return null;
  const earlier = await block(latest.header.height - 10_000);
  if (!earlier) return null;
  const msPerBlock =
    Number(BigInt(latest.header.timestamp_nanosec) - BigInt(earlier.header.timestamp_nanosec)) / 1e6 / 10_000;
  return new Date(fromNanos(latest.header.timestamp_nanosec).getTime() - (latest.header.height - height) * msPerBlock);
}

export async function checkAccount(account: string): Promise<Check> {
  const network = networkOf(account);
  const [view, keys, info, deploys] = await Promise.all([
    query<{ code_hash: string }>(network, { request_type: "view_account", account_id: account }),
    // Accounts with thousands of keys make this query fail; the key signals are then skipped.
    query<{ keys: { access_key: { nonce: number | string; permission: unknown } }[] }>(network, {
      request_type: "view_access_key_list",
      account_id: account,
    }).catch(() => null),
    nearblocks<{ account: { created?: { block_timestamp: number | string } }[] }>(network, `/account/${account}`),
    nearblocks<{ deployments: { block_timestamp: string }[] }>(network, `/account/${account}/contract/deployments`),
  ]);

  const checkedAt = new Date().toISOString();
  const reasons: Reason[] = [];

  if (!view) {
    return {
      account,
      network,
      verdict: "block",
      reasons: [{ level: "block", text: `No account by this name exists on NEAR ${network}` }],
      facts: {
        exists: false,
        createdAt: null,
        ageSource: null,
        isContract: false,
        fullAccessKeys: null,
        deployCount: null,
        lastDeployAt: null,
      },
      checkedAt,
    };
  }

  const isContract = view.code_hash !== EMPTY_CODE_HASH;
  const fullAccessKeys = keys ? keys.keys.filter((k) => k.access_key.permission === "FullAccess").length : null;
  const created = info?.account?.[0]?.created?.block_timestamp;
  let createdAt = created ? fromNanos(created) : null;
  let ageSource: Check["facts"]["ageSource"] = createdAt ? "indexer" : null;
  if (!createdAt && keys) {
    createdAt = await oldestKeyAddedAt(network, keys.keys.map((k) => BigInt(k.access_key.nonce)));
    if (createdAt) ageSource = "oldest-key";
  }
  const deployments = deploys?.deployments?.length ? deploys.deployments : null;
  const lastDeployAt = deployments ? fromNanos(deployments[0].block_timestamp) : null;
  const now = Date.now();

  if (createdAt) {
    const age = now - createdAt.getTime();
    const what = ageSource === "indexer" ? "Account" : "Oldest key on this account";
    if (age < DAY) reasons.push({ level: "block", text: `${what} was created less than a day ago` });
    else if (age < 30 * DAY) reasons.push({ level: "warn", text: `${what} is only ${count(Math.floor(age / DAY), "day")} old` });
    else if (age < 365 * DAY) reasons.push({ level: "allow", text: `${what} has existed for ${count(Math.floor(age / (30 * DAY)), "month")}` });
    else reasons.push({ level: "allow", text: `${what} has existed for ${count(Math.floor(age / (365 * DAY)), "year")}` });
  } else {
    // A flaky indexer must not make an account look safe: unknown age is a reason for care.
    reasons.push({ level: "warn", text: "Couldn't read how old this account is" });
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
    network,
    verdict,
    reasons,
    facts: {
      exists: true,
      createdAt: createdAt?.toISOString() ?? null,
      ageSource,
      isContract,
      fullAccessKeys,
      deployCount: deployments?.length ?? null,
      lastDeployAt: lastDeployAt?.toISOString() ?? null,
    },
    checkedAt,
  };
}
