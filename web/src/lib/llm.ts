// Calls to the TEE model on NEAR AI Cloud, and the care its output needs: it's untrusted text from a
// model, and the contract measures strings in bytes where JavaScript measures them in code units.

export const NEARAI_API = "https://cloud-api.near.ai/v1";
export const TEE_MODEL = process.env.JUDGE_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8";
// The model's thinking counts toward this, and it takes hundreds of tokens even on a small case.
export const MAX_TOKENS = 4000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function nearAiHeaders(): Record<string, string> {
  const key = process.env.NEARAI_API_KEY;
  if (!key) throw new Error("NEARAI_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, Accept: "application/json", "x-no-aliasing": "true" };
}

// Reads a response body, refusing one too large to be a real answer.
export async function readCapped(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("The response was too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The first complete JSON object in a model's answer, wherever it sits in the text. A plain regex would
// run from the first brace to the last and break on any prose after the answer.
export function firstJsonObject(text: string): unknown {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = clean.indexOf("{");
  if (start < 0) throw new Error("Model did not answer with JSON");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error("Model's JSON was cut off");
}

// Shortens text to fit a limit the contract counts in UTF-8 bytes, without splitting a character.
export function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  let size = 0;
  for (const char of text) {
    size += Buffer.byteLength(char, "utf8");
    if (size > maxBytes) break;
    out += char;
  }
  return out;
}

// One question to the TEE model whose answer is a JSON object. Used by the agents: their calls are
// checked below the model, by the fixed rules and the guard, so they don't each carry a proof.
export async function askTeeJson(system: string, user: string, timeoutMs: number): Promise<{ answer: unknown; model: string }> {
  const res = await fetch(`${NEARAI_API}/chat/completions`, {
    method: "POST",
    headers: { ...nearAiHeaders(), "Content-Type": "application/json", "Accept-Encoding": "identity" },
    body: JSON.stringify({
      model: TEE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readCapped(res);
  if (!res.ok) throw new Error(`Model call failed: ${res.status} ${body.slice(0, 200)}`);
  const content: string = JSON.parse(body).choices?.[0]?.message?.content ?? "";
  return { answer: firstJsonObject(content), model: TEE_MODEL };
}
