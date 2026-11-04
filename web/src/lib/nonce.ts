// One access key has one nonce sequence, and serverless requests run at the same time. When two sign
// with the same nonce, one is refused without running. Trying again takes a fresh nonce.

const TRIES = 4;

export async function withNonceRetry<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      if (attempt === TRIES || !/nonce/i.test((e as Error).message)) throw e;
      // Spread out, so two callers don't collide again.
      await new Promise((r) => setTimeout(r, 300 * attempt + Math.random() * 700));
    }
  }
}
