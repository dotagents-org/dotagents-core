// The API's prices, in dollars per million tokens, for what dotagents puts a cost on: a revision
// through the API, and the spend against the plan's % (core/spend.ts). Writing to the cache costs
// 1.25 times the input for 5 minutes and twice for an hour. For a subscription the dollar is a unit
// to compare with, not a charge.

type Price = { input: number; cacheRead: number; output: number };

const PRICES: Record<string, Price> = {
  "claude-fable-5-2": { input: 8, cacheRead: 0.2, output: 40 },
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheRead: 0.01, output: 0.5 },
};

export type Tokens = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; output: number };

// cacheWrite: the 5-minute writes; cacheWrite1h: the hour's. Null for a model with no known price.
export function costOf(model: string, t: Tokens): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (t.input * p.input + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * 1.25 + (t.cacheWrite1h ?? 0) * p.input * 2 + t.output * p.output) / 1e6;
}
