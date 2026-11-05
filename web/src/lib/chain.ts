// Read-only views of testnet transactions, for the /tx and /account pages. These replace links to
// testnet.nearblocks.io, whose index stopped on 27 Sep 2026. Nothing here is stored or signed: every
// value comes from FastNEAR's public index or a NEAR RPC node at the moment the page is read.
import { formatNear, TESTNET_RPC } from "./vouch";

const TX_INDEX = "https://tx.test.fastnear.com";
export const ARCHIVAL_RPC = "https://archival-rpc.testnet.fastnear.com";

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const METHOD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const TIMEOUT_MS = 8000;
// A judge's proof sits in its call's arguments, so the limit is generous. Beyond it, the page says so.
const MAX_ARGS_BYTES = 256 * 1024;
// The index refuses more than this in one request.
const DETAILS_PER_REQUEST = 20;
const BAD_REQUEST = 400;

export const isTxHash = (value: string) => TX_HASH.test(value);
export const isMethodName = (value: string) => METHOD_NAME.test(value);

type RawStatus = { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string;
type RawOutcome = {
  block_timestamp: number;
  block_height: number;
  id: string;
  outcome: { logs: string[]; status: RawStatus; executor_id: string };
};
type RawReceipt = {
  execution_outcome: RawOutcome;
  receipt: { predecessor_id: string; receiver_id: string; receipt_id: string; receipt: { Action?: { actions: unknown[] } } };
};
type RawTransaction = {
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] };
  execution_outcome: RawOutcome;
  receipts: RawReceipt[];
};

export type ActionView = {
  kind: string;
  method?: string;
  deposit?: string;
  args?: string;
  argsBytes?: number;
  argsTooLong?: boolean;
};

export type StepView = {
  id: string;
  from: string;
  to: string;
  actions: ActionView[];
  logs: string[];
  failure: string | null;
};

export type TxView = {
  hash: string;
  signer: string;
  receiver: string;
  actions: ActionView[];
  at: number;
  blockHeight: number;
  result: "succeeded" | "failed" | "unfinished";
  failure: string | null;
  steps: StepView[];
  hiddenRefunds: number;
};

export type AccountView = { balance: string; isContract: boolean; storageBytes: number };

async function postIndex<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TX_INDEX}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new IndexError(res.status);
  return res.json();
}

class IndexError extends Error {
  constructor(readonly status: number) {
    super(`The transaction index answered ${status}`);
  }
}

function describeArgs(encoded: string): Pick<ActionView, "args" | "argsBytes" | "argsTooLong"> {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_ARGS_BYTES) return { argsBytes: bytes.length, argsTooLong: true };
  const text = bytes.toString("utf8");
  try {
    return { args: JSON.stringify(JSON.parse(text), null, 2), argsBytes: bytes.length };
  } catch {
    return { args: text, argsBytes: bytes.length };
  }
}

function describeAction(action: unknown): ActionView[] {
  if (typeof action === "string") return [{ kind: action }];
  if (!action || typeof action !== "object") return [{ kind: "Unknown" }];
  const [kind, body] = Object.entries(action)[0] ?? ["Unknown", null];
  const detail = (body ?? {}) as { method_name?: string; args?: string; deposit?: string; delegate_action?: { actions?: unknown[] } };
  if (kind === "FunctionCall") {
    return [{ kind, method: detail.method_name, deposit: detail.deposit, ...describeArgs(detail.args ?? "") }];
  }
  if (kind === "Transfer") return [{ kind, deposit: detail.deposit }];
  if (kind === "Delegate") return (detail.delegate_action?.actions ?? []).flatMap(describeAction);
  return [{ kind }];
}

function failureOf(status: RawStatus) {
  if (typeof status === "string" || status.Failure === undefined) return null;
  const failure = status.Failure as { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } } };
  // The contract's own words when there are any, and the node's full answer otherwise.
  return failure.ActionError?.kind?.FunctionCallError?.ExecutionError ?? JSON.stringify(status.Failure);
}

// The transaction's own answer: follow "the result is in that receipt" until a real value or a failure.
function finalResult(raw: RawTransaction): Pick<TxView, "result" | "failure"> {
  const byId = new Map(raw.receipts.map((r) => [r.execution_outcome.id, r.execution_outcome.outcome.status]));
  let status: RawStatus | undefined = raw.execution_outcome.outcome.status;
  for (let hops = 0; status && hops <= raw.receipts.length; hops++) {
    const failure = failureOf(status);
    if (failure) return { result: "failed", failure };
    if (typeof status === "string") break;
    if (status.SuccessValue !== undefined) return { result: "succeeded", failure: null };
    status = status.SuccessReceiptId ? byId.get(status.SuccessReceiptId) : undefined;
  }
  return { result: "unfinished", failure: null };
}

function toView(raw: RawTransaction): TxView {
  // Receipts from "system" return unspent gas. They'd bury the steps people came to read.
  const actionReceipts = raw.receipts.filter((r) => r.receipt.receipt.Action);
  const steps = actionReceipts.filter((r) => r.receipt.predecessor_id !== "system");
  return {
    hash: raw.transaction.hash,
    signer: raw.transaction.signer_id,
    receiver: raw.transaction.receiver_id,
    actions: raw.transaction.actions.flatMap(describeAction),
    at: raw.execution_outcome.block_timestamp,
    blockHeight: raw.execution_outcome.block_height,
    ...finalResult(raw),
    steps: steps.map((r) => ({
      id: r.receipt.receipt_id,
      from: r.receipt.predecessor_id,
      to: r.receipt.receiver_id,
      actions: (r.receipt.receipt.Action?.actions ?? []).flatMap(describeAction),
      logs: r.execution_outcome.outcome.logs,
      failure: failureOf(r.execution_outcome.outcome.status),
    })),
    hiddenRefunds: actionReceipts.length - steps.length,
  };
}

async function getTransactions(hashes: string[]) {
  const batches: string[][] = [];
  for (let i = 0; i < hashes.length; i += DETAILS_PER_REQUEST) batches.push(hashes.slice(i, i + DETAILS_PER_REQUEST));
  const answers = await Promise.all(
    batches.map((tx_hashes) => postIndex<{ transactions: RawTransaction[] }>("/v0/transactions", { tx_hashes })),
  );
  return answers.flatMap((a) => a.transactions).map(toView);
}

export async function getTransaction(hash: string): Promise<TxView | null> {
  try {
    return (await getTransactions([hash]))[0] ?? null;
  } catch (error) {
    // The regex lets through some strings that aren't 32 bytes. The index refuses those, and no such transaction exists.
    if (error instanceof IndexError && error.status === BAD_REQUEST) return null;
    throw error;
  }
}

// The account's newest transactions, newest first. With `method`, only calls to it, among those fetched.
export async function getAccountTransactions(account: string, limit: number, method?: string) {
  const { account_txs } = await postIndex<{ account_txs: { transaction_hash: string; tx_block_timestamp: string }[] }>(
    "/v0/account",
    { account_id: account, limit },
  );
  const txs = await getTransactions(account_txs.map((t) => t.transaction_hash));
  const newestFirst = txs.sort((a, b) => b.at - a.at);
  return {
    looked: account_txs.length,
    txs: method ? newestFirst.filter((t) => t.actions.some((a) => a.method === method)) : newestFirst,
  };
}

// Null when no such account exists. Any other failure throws, so a flaky node never reads as "no account".
export async function getAccount(account: string): Promise<AccountView | null> {
  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vouch",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: account },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The RPC node answered ${res.status}`);
  const body = await res.json();
  if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
  if (!body.result?.amount) throw new Error("The RPC node gave no answer");
  const { amount, code_hash, global_contract_hash, global_contract_account_id, storage_usage } = body.result;
  return {
    balance: amount,
    isContract: code_hash !== EMPTY_CODE_HASH || !!global_contract_hash || !!global_contract_account_id,
    storageBytes: storage_usage,
  };
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});
export const formatBlockTime = (nanos: number) => `${timeFormat.format(new Date(nanos / 1e6))} UTC`;

export function formatAmount(yocto: string) {
  const value = BigInt(yocto);
  // Under 0.0001 NEAR would print as zero, which isn't what the chain recorded.
  return value < BigInt(10) ** BigInt(20) ? `${value} yoctoNEAR` : `${formatNear(value, 4)} NEAR`;
}

export const actionLabel = (action: ActionView) => (action.method ? `${action.method}()` : action.kind);

// The same transaction from a different node, so nobody has to take this page's word for it.
export const checkCommand = (tx: Pick<TxView, "hash" | "signer">) =>
  `curl -s ${ARCHIVAL_RPC} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"${tx.hash}","sender_account_id":"${tx.signer}","wait_until":"FINAL"}}'`;
