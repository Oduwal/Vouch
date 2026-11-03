// Gemini through its OpenAI-compatible API. Nothing here runs in a TEE or is attested: the sentinel
// and the payer agent use it because their calls are checked elsewhere, and the judge uses it only
// in the unverified mode that marks every ruling as such.

import type { ModelEndpoint } from "./judge/ruling";

// Tried in turn when one is overloaded. The lighter model comes first: on the free tier it answers in
// about a second, while the larger ones often run out of quota or time out.
export const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.7-flash"];

const RETRY_MS = 2_000;

function geminiKey() {
  // The variable may list several keys. Only the first is used.
  const key = process.env.GEMINI_API_KEY?.match(/[\w.-]+/)?.[0];
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

export const GEMINI: ModelEndpoint = {
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  headers: () => ({ Authorization: `Bearer ${geminiKey()}` }),
  // Roomier than the NEAR AI limit so the model's thinking can't cut the JSON answer short.
  maxTokens: 4000,
};

function isBusy(e: Error) {
  return /^Model call failed: (429|503)/.test(e.message) || e.name === "TimeoutError";
}

// Tries each model in turn until one answers or the time budget runs out.
export async function withGeminiModels<T>(
  attempt: (model: string) => Promise<T>,
  { budgetMs, models = GEMINI_MODELS, log }: { budgetMs: number; models?: string[]; log?: (line: string) => void },
): Promise<T & { model: string }> {
  const until = Date.now() + budgetMs;
  for (let i = 0; ; i++) {
    const model = models[i % models.length];
    try {
      return { ...(await attempt(model)), model };
    } catch (e) {
      if (!isBusy(e as Error) || Date.now() > until) throw e;
      log?.(`${model} is busy, trying the next model`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

// One question whose answer is a JSON object, from whichever model answers first.
export function askGeminiJson<T extends object>(
  system: string,
  user: string,
  options: { budgetMs: number; models?: string[] },
): Promise<T & { model: string }> {
  return withGeminiModels(async (model) => {
    const res = await fetch(GEMINI.url, {
      method: "POST",
      headers: { ...GEMINI.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: GEMINI.maxTokens,
      }),
      signal: AbortSignal.timeout(Math.min(options.budgetMs, 30_000)),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Model call failed: ${res.status} ${body.slice(0, 200)}`);
    const content: string = JSON.parse(body).choices?.[0]?.message?.content ?? "";
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("Model did not answer with JSON");
    return JSON.parse(json) as T;
  }, options);
}
