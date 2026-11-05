import { formatNear, isLive, view, type Claim } from "./vouch";

export type Level = "allow" | "warn" | "block";

export type Reason = { level: Level; text: string };

export type Network = "mainnet" | "testnet";

export type CodeChange = "day" | "week" | "longer";

export type Check = {
  account: string;
  network: Network;
  verdict: Level;
  reasons: Reason[];
  facts: {
    exists: boolean;
    createdAt: string | null;
    // "indexer" is the account's creation; "oldest-key" is when its oldest access key was added;
    // "oldest-tx" is its oldest transaction in the index, which can only understate its age.
    ageSource: "indexer" | "oldest-key" | "oldest-tx" | null;
    isContract: boolean;
    fullAccessKeys: number | null;
    // NearBlocks' list of deploys, on mainnet only: its testnet index stopped on 27 Sep 2026.
    deployCount: number | null;
    lastDeployAt: string | null;
    // Null when it couldn't be read. On testnet this comes from comparing the code hash with past blocks.
    codeChangedWithin: CodeChange | null;
    // From the transaction index, which can be missing the oldest history of an account.
    txCount: number | null;
    lastActivityAt: string | null;
    // Who has reported this account. Their evidence is on the claim, written by an interested party.
    // A live report still has its bond at risk. A closed one can't be challenged any more.
    reports: { claimId: string; agent: string; live: boolean }[];
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
const TX_INDEX: Record<Network, string> = {
  mainnet: "https://tx.main.fastnear.com",
  testnet: "https://tx.test.fastnear.com",
};
// FastNEAR's free archival node refuses bursts. NEAR's own is slower, and answers when FastNEAR won't.
const TESTNET_ARCHIVAL = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"];
const INDEX_PAGE = 1;
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
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

// NearBlocks' free tier stops answering after about a dozen requests a minute, so its last answers are kept
// and used when it says no. How long an answer stays good depends on what it says, so callers choose.
const REMEMBERED_LIMIT = 500;
const remembered = new Map<string, { at: number; value: unknown }>();

type Keep = { key?: string; freshMs: number; staleMs: number };

async function nearblocks<T>(network: Network, path: string, { key = path, freshMs, staleMs }: Keep): Promise<T | null> {
  const id = `${network}:${key}`;
  const known = remembered.get(id);
  if (known && Date.now() - known.at < freshMs) return known.value as T;
  let fresh: T | null = null;
  try {
    const res = await fetch(`${NEARBLOCKS[network]}${path}`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) fresh = await res.json();
  } catch {
    // An outage looks the same as a refusal: fall through to what we knew.
  }
  if (fresh) {
    remember(id, fresh);
    return fresh;
  }
  return known && Date.now() - known.at < staleMs ? (known.value as T) : null;
}

function remember(id: string, value: unknown) {
  remembered.delete(id);
  remembered.set(id, { at: Date.now(), value });
  if (remembered.size > REMEMBERED_LIMIT) remembered.delete(remembered.keys().next().value as string);
}

type IndexedTx = { transaction_hash: string; tx_block_timestamp: string };

// Every transaction touching an account, newest first. Null when the index doesn't answer.
async function txIndex(network: Network, account: string): Promise<{ count: number; txs: IndexedTx[] } | null> {
  try {
    const res = await fetch(`${TX_INDEX[network]}/v0/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account, limit: INDEX_PAGE }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    // A 200 with some other shape is an outage, not an empty history.
    if (typeof body.txs_count !== "number" || !Array.isArray(body.account_txs)) return null;
    return { count: body.txs_count, txs: body.account_txs };
  } catch {
    return null;
  }
}

export type CheckOptions = {
  // Off where the check has to be free of anyone's say-so, as when ruling on one of those reports.
  reports?: boolean;
  // An agent doesn't count as its own witness.
  ignoreReportsBy?: string;
};

// NearBlocks timestamps are nanoseconds since the epoch.
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const fromNanos = (ns: string | number) => new Date(Number(BigInt(ns) / BigInt(1_000_000)));

type Block = { header: { height: number; timestamp_nanosec: string } };

type AccountState = { code_hash: string; global_contract_hash?: string | null; global_contract_account_id?: string | null };

// What an account runs. An account using a global contract reports the empty hash, and its code lives elsewhere.
const codeIdOf = (s: AccountState) => s.global_contract_hash ?? s.global_contract_account_id ?? s.code_hash;

const blockAt = (network: Network, id: number | "final") =>
  rpc<Block>(network, "block", id === "final" ? { finality: "final" } : { block_id: id }).catch(() => null);

// The newest block and the recent pace, for working out which height a past moment was at.
async function chainClock(network: Network) {
  const latest = await blockAt(network, "final");
  if (!latest) return null;
  const earlier = await blockAt(network, latest.header.height - 10_000);
  if (!earlier) return null;
  const msPerBlock = Number(BigInt(latest.header.timestamp_nanosec) - BigInt(earlier.header.timestamp_nanosec)) / 1e6 / 10_000;
  return { latest, msPerBlock };
}

// What an account ran at a past height: null if it didn't exist then, undefined if no node would say.
async function codeIdAt(account: string, height: number, signal: AbortSignal): Promise<string | null | undefined> {
  for (const node of TESTNET_ARCHIVAL) {
    // Some heights have no block, so a few are tried going back.
    for (let block_id = height; block_id > height - 3; block_id--) {
      let body;
      try {
        const res = await fetch(node, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "vouch", method: "query", params: { request_type: "view_account", account_id: account, block_id } }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        body = await res.json();
      } catch {
        break;
      }
      if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
      if (body.result?.code_hash) return codeIdOf(body.result);
      if (body.error?.cause?.name !== "UNKNOWN_BLOCK") break;
    }
  }
  return undefined;
}

// When a testnet contract's code last changed, without an indexer. It reads the code at past blocks, so it sees
// every way of deploying, including a contract replacing itself. Code changed and then put back within the
// week reads as unchanged, which is still true of the code running now.
async function testnetCodeChange(account: string, codeId: string): Promise<CodeChange | null> {
  const id = `testnet:${account}/code-change@${codeId}`;
  const known = remembered.get(id) as { at: number; value: CodeChange } | undefined;
  // Under the same code, "longer" stays true. The others age, so they're read again.
  if (known && (known.value === "longer" || Date.now() - known.at < 10 * MINUTE)) return known.value;

  const found = await (async () => {
    const clock = await chainClock("testnet");
    if (!clock) return null;
    const signal = AbortSignal.timeout(9000);
    // Blocks don't keep a steady pace. Reaching a little further back can only err towards caution.
    const heightBefore = (ms: number) => clock.latest.header.height - Math.round((ms * 1.02) / clock.msPerBlock);
    const aWeekAgo = await codeIdAt(account, heightBefore(7 * DAY), signal);
    if (aWeekAgo === undefined) return null;
    if (aWeekAgo === codeId) return "longer";
    const aDayAgo = await codeIdAt(account, heightBefore(DAY), signal);
    if (aDayAgo === undefined) return null;
    return aDayAgo === codeId ? "week" : "day";
  })();

  if (found) {
    remember(id, found);
    return found;
  }
  return known && Date.now() - known.at < 6 * HOUR ? known.value : null;
}

// The oldest transaction the index has, from another source than NearBlocks. Older history can be missing
// from the index, so this can make an account look younger than it is, but never older.
async function oldestTxAt(network: Network, account: string): Promise<Date | null> {
  try {
    const res = await fetch(`${TX_INDEX[network]}/v0/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account, limit: 1, desc: false }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const stamp = (await res.json()).account_txs?.[0]?.tx_block_timestamp;
    return stamp ? fromNanos(stamp) : null;
  } catch {
    return null;
  }
}

// When the indexer has no creation time (the testnet indexer often lags), date the oldest access key
// from its nonce. Nodes only keep about a day of blocks, so older heights are dated from the
// average block time.
async function oldestKeyAddedAt(network: Network, nonces: bigint[]): Promise<Date | null> {
  if (!nonces.length) return null;
  const height = Number(nonces.reduce((a, b) => (a < b ? a : b)) / NONCE_PER_BLOCK);

  const exact = await blockAt(network, height);
  if (exact) return fromNanos(exact.header.timestamp_nanosec);

  const clock = await chainClock(network);
  if (!clock) return null;
  return new Date(fromNanos(clock.latest.header.timestamp_nanosec).getTime() - (clock.latest.header.height - height) * clock.msPerBlock);
}

export async function checkAccount(account: string, { reports: readReports = true, ignoreReportsBy }: CheckOptions = {}): Promise<Check> {
  const network = networkOf(account);
  const reading = query<AccountState>(network, {
    request_type: "view_account",
    account_id: account,
  });
  const [state, keys, info, deploys, testnetChange, activity, reported] = await Promise.all([
    reading,
    // Accounts with thousands of keys make this query fail; the key signals are then skipped.
    query<{ keys: { access_key: { nonce: number | string; permission: unknown } }[] }>(network, {
      request_type: "view_access_key_list",
      account_id: account,
    }).catch(() => null),
    nearblocks<{ account: { created?: { block_timestamp: number | string }; deleted?: { block_timestamp: number | string | null } }[] }>(
      network,
      `/account/${account}`,
      { freshMs: 5 * MINUTE, staleMs: 6 * HOUR },
    ),
    // A deploy changes the code hash, so a list read under the same hash is still the whole list.
    reading.then((s) =>
      s && network === "mainnet"
        ? nearblocks<{ deployments: { block_timestamp: string }[] }>(network, `/account/${account}/contract/deployments`, {
            key: `${account}/deployments@${codeIdOf(s)}`,
            freshMs: 10 * MINUTE,
            staleMs: Infinity,
          })
        : null,
    ),
    reading.then((s) => (s && network === "testnet" && codeIdOf(s) !== EMPTY_CODE_HASH ? testnetCodeChange(account, codeIdOf(s)) : null)),
    txIndex(network, account),
    // The blocklist lives on testnet, where NEAR is free, so it says nothing about a mainnet account.
    readReports && network === "testnet" ? view<Claim[]>("get_reports", { subject: account }).catch(() => null) : Promise.resolve([] as Claim[]),
  ]);

  const checkedAt = new Date().toISOString();
  const reasons: Reason[] = [];

  if (!state) {
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
        codeChangedWithin: null,
        txCount: null,
        lastActivityAt: null,
        reports: [],
      },
      checkedAt,
    };
  }

  // An account using a global contract reports the empty hash, and its code lives elsewhere.
  const globalCode = !!(state.global_contract_hash || state.global_contract_account_id);
  const isContract = state.code_hash !== EMPTY_CODE_HASH || globalCode;
  const fullAccessKeys = keys ? keys.keys.filter((k) => k.access_key.permission === "FullAccess").length : null;
  const created = info?.account?.[0]?.created?.block_timestamp;
  const wasDeleted = !!info?.account?.[0]?.deleted?.block_timestamp;
  const indexedAt = created ? fromNanos(created) : null;
  const keyedAt = keys ? await oldestKeyAddedAt(network, keys.keys.map((k) => BigInt(k.access_key.nonce))) : null;
  // A name deleted and made again keeps its old indexer date, and the testnet indexer stopped on 27 Sep 2026. There
  // the younger date wins. On mainnet the indexer does, so rotating a key doesn't make an account look new.
  const keyFirst = (network === "testnet" || wasDeleted) && keyedAt && (!indexedAt || keyedAt > indexedAt);
  const txAt = indexedAt || keyedAt ? null : await oldestTxAt(network, account);
  const createdAt = keyFirst ? keyedAt : (indexedAt ?? keyedAt ?? txAt);
  const ageSource: Check["facts"]["ageSource"] = !createdAt ? null : createdAt === indexedAt ? "indexer" : createdAt === keyedAt ? "oldest-key" : "oldest-tx";
  const deployments = deploys?.deployments?.length ? deploys.deployments : null;
  // The API doesn't sort these.
  const lastDeployNanos = deployments?.reduce((latest, d) => (BigInt(d.block_timestamp) > latest ? BigInt(d.block_timestamp) : latest), BigInt(0));
  const lastDeployAt = lastDeployNanos ? fromNanos(lastDeployNanos.toString()) : null;
  const now = Date.now();
  const sinceDeploy = lastDeployAt ? now - lastDeployAt.getTime() : null;
  const codeChangedWithin: CodeChange | null =
    network === "testnet" ? testnetChange : sinceDeploy === null ? null : sinceDeploy < DAY ? "day" : sinceDeploy < 7 * DAY ? "week" : "longer";

  if (createdAt) {
    const age = now - createdAt.getTime();
    const what = ageSource === "indexer" ? "Account" : ageSource === "oldest-key" ? "Oldest key on this account" : "The earliest record of this account";
    if (age < DAY) reasons.push({ level: "block", text: `${what} was created less than a day ago` });
    else if (age < 30 * DAY) reasons.push({ level: "warn", text: `${what} is only ${count(Math.floor(age / DAY), "day")} old` });
    else if (age < 365 * DAY) reasons.push({ level: "allow", text: `${what} has existed for ${count(Math.floor(age / (30 * DAY)), "month")}` });
    else reasons.push({ level: "allow", text: `${what} has existed for ${count(Math.floor(age / (365 * DAY)), "year")}` });
  } else {
    // A flaky indexer must not make an account look safe: unknown age is a reason for care.
    reasons.push({ level: "warn", text: "Couldn't read how old this account is" });
  }

  if (wasDeleted) reasons.push({ level: "warn", text: "This name was deleted once, so someone new may hold it" });

  // Someone may have taken over an older account: its age says nothing about who holds it now.
  const fullKeyNonces = keys?.keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => BigInt(k.access_key.nonce)) ?? [];
  if (fullKeyNonces.length && createdAt && now - createdAt.getTime() >= 7 * DAY) {
    const newest = await oldestKeyAddedAt(network, [fullKeyNonces.reduce((a, b) => (a > b ? a : b))]);
    if (newest && now - newest.getTime() < 7 * DAY) reasons.push({ level: "warn", text: "A full-access key was added this week" });
  }

  if (isContract) {
    if (globalCode) reasons.push({ level: "warn", text: "Runs a shared global contract, whose code may be changed from elsewhere" });
    if (fullAccessKeys === 0) reasons.push({ level: "allow", text: "No full-access keys, though a contract can still change its own code if it has a method for it" });
    else if (fullAccessKeys) reasons.push({ level: "warn", text: `${count(fullAccessKeys, "full-access key")} can redeploy the code` });
    // A failed read, or thousands of keys added to make it fail. Either way, not a clean bill of health.
    else reasons.push({ level: "warn", text: "Couldn't read this contract's access keys" });

    // No answer, or an empty one from an indexer that lags, isn't the same as no recent deploy.
    if (!codeChangedWithin) reasons.push({ level: "warn", text: "Couldn't read when this contract's code last changed" });
    else if (codeChangedWithin === "day") reasons.push({ level: "block", text: "Contract code changed in the last 24 hours" });
    else if (codeChangedWithin === "week") reasons.push({ level: "warn", text: "Contract code changed this week" });
  } else {
    reasons.push({ level: "allow", text: "Plain account with no contract code" });
  }

  const lastActivity = activity?.txs[0] ? fromNanos(activity.txs[0].tx_block_timestamp) : null;
  if (!activity) {
    reasons.push({ level: "warn", text: "Couldn't read this account's activity" });
  } else if (activity.count === 0) {
    // The index can lack an old account's history, so silence only counts against a young one.
    const young = !createdAt || now - createdAt.getTime() < 90 * DAY;
    reasons.push({ level: young ? "warn" : "allow", text: "No transactions on record for this account" });
  } else if (lastActivity) {
    const since = Math.floor((now - lastActivity.getTime()) / DAY);
    reasons.push({ level: "allow", text: `${count(activity.count, "transaction")} on record, the latest ${since ? `${count(since, "day")} ago` : "today"}` });
  }

  // Every `block` from another agent is a report with money behind it, and anyone can challenge it.
  const others = (reported ?? []).filter((r) => r.agent !== ignoreReportsBy);
  if (!reported) reasons.push({ level: "warn", text: "Couldn't read the shared blocklist" });
  // A report only blocks while someone can still challenge it and take the bond. After that it's a reason for
  // a human to look, or a report costing one fee could block an honest account for a month.
  const shown = others.map((r) => ({ claimId: r.id, agent: r.agent, live: isLive(r) }));
  others.forEach((r, i) =>
    reasons.push(
      shown[i].live
        ? { level: "block", text: `Reported by ${r.agent}, with ${formatNear(r.bond)} NEAR at risk, in claim ${r.id}` }
        : { level: "warn", text: `Reported by ${r.agent} in claim ${r.id}, and nobody challenged it` },
    ),
  );

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
      codeChangedWithin,
      txCount: activity?.count ?? null,
      lastActivityAt: lastActivity?.toISOString() ?? null,
      reports: shown,
    },
    checkedAt,
  };
}

// The check without anyone's reports. An agent that bonds a call has to defend it to a judge who doesn't
// read reports, so it can only stand on what the chain says.
export function chainOnly(check: Check): Check {
  const reasons = check.reasons.filter((r) => !r.text.startsWith("Reported by"));
  const verdict: Level = reasons.some((r) => r.level === "block") ? "block" : reasons.some((r) => r.level === "warn") ? "warn" : "allow";
  return { ...check, verdict, reasons, facts: { ...check.facts, reports: [] } };
}
