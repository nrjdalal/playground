// The repo's one price table: first-party API rates in dollars per million tokens, Anthropic's from https://platform.claude.com/docs/en/about-claude/pricing as of 2026-10-18 and Z.ai's from https://docs.z.ai/guides/overview/pricing as of 2026-10-17, so a figure is what the same tokens would cost on the API, not what a subscription bills. A cache write costs 1.25x input held for 5 minutes and 2x held for an hour (https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Claude Code's own totals (claude_session.cost_usd) check it: the report names a gap over 10% between the two over the week's exited sessions. Fast mode (2x on Opus 5.5, 5 and 4.8) is priced at the standard rate, since no transcript here has recorded a fast call; that gap would show there too. Claude Haiku 5.5 bills prompts over 100,000 tokens at higher prices ($0.50 in, $0.05 cache read, $2.50 out), which this table does not see, since costOf prices a session's 15-minute bucket of summed calls (`Bucket` in report.ts), never one request's prompt.
export type Price = { cacheRead: number; input: number; output: number }

// Keyed by the model id without a date or a context suffix; a model not here is priced as nothing and named in the report's problems.
export const PRICES: Record<string, Price> = {
  "claude-fable-5": { cacheRead: 1, input: 10, output: 50 },
  "claude-fable-5-1": { cacheRead: 0.25, input: 10, output: 50 },
  "claude-haiku-4-5": { cacheRead: 0.1, input: 1, output: 5 },
  "claude-haiku-5-5": { cacheRead: 0.01, input: 0.1, output: 0.5 },
  "claude-opus-4-5": { cacheRead: 0.5, input: 5, output: 25 },
  "claude-opus-4-6": { cacheRead: 0.5, input: 5, output: 25 },
  "claude-opus-4-7": { cacheRead: 0.5, input: 5, output: 25 },
  "claude-opus-4-8": { cacheRead: 0.5, input: 5, output: 25 },
  "claude-opus-5": { cacheRead: 0.5, input: 5, output: 25 },
  "claude-opus-5-5": { cacheRead: 0.2, input: 4, output: 20 },
  "claude-sonnet-4-5": { cacheRead: 0.3, input: 3, output: 15 },
  "claude-sonnet-4-6": { cacheRead: 0.3, input: 3, output: 15 },
  "claude-sonnet-5": { cacheRead: 0.2, input: 2, output: 10 },
  "claude-sonnet-5-5": { cacheRead: 0.1, input: 2, output: 10 },
  "glm-5.3-flash": { cacheRead: 0.03, input: 0.15, output: 0.5 },
}

const WRITE_5M = 1.25
const WRITE_1H = 2

// Claude Code names a model as the API does, sometimes with a date (claude-haiku-4-5-20251001) or a context marker (claude-opus-5-5[1m]); both name the same price.
export const modelKey = (model: string): string =>
  model
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "")

export const priceOf = (model: string | null): Price | null =>
  model ? (PRICES[modelKey(model)] ?? null) : null

// cacheWrite is every token written to the cache; cacheWrite1h is the part of it held for an hour.
export type Tokens = {
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  input: number
  output: number
}

// Dollars for one model's tokens, null when the model has no price here.
export function costOf(model: string | null, tokens: Tokens): number | null {
  const p = priceOf(model)
  if (!p) return null
  const hour = Math.min(tokens.cacheWrite1h, tokens.cacheWrite)
  const writes = (tokens.cacheWrite - hour) * WRITE_5M + hour * WRITE_1H
  return (
    (tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      writes * p.input) /
    1e6
  )
}
