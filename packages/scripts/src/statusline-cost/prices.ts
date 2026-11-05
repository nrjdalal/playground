// List prices in $ per million tokens, from platform.claude.com/docs/en/about-claude/pricing ("Model pricing", "Fast mode pricing"); a model that ships gets its row here, and until then its messages count as unpriced
type Rate = { cacheRead: number; input: number; output: number; write1h: number; write5m: number }
type Price = Rate & { fast?: { input: number; output: number }; over?: { at: number; rate: Rate } }

const opus4 = { cacheRead: 0.5, input: 5, output: 25, write1h: 10, write5m: 6.25 }

export const PRICES: Record<string, Price> = {
  "claude-fable-5": { cacheRead: 1, input: 10, output: 50, write1h: 20, write5m: 12.5 },
  "claude-fable-5-1": { cacheRead: 0.25, input: 10, output: 50, write1h: 20, write5m: 12.5 },
  "claude-haiku-5-5": {
    cacheRead: 0.01,
    input: 0.1,
    output: 0.5,
    over: {
      at: 100_000,
      rate: { cacheRead: 0.05, input: 0.5, output: 2.5, write1h: 1, write5m: 0.625 },
    },
    write1h: 0.2,
    write5m: 0.125,
  },
  "claude-opus-4-8": { ...opus4, fast: { input: 10, output: 50 } },
  "claude-opus-5": { ...opus4, fast: { input: 10, output: 50 } },
  "claude-opus-5-5": {
    cacheRead: 0.2,
    fast: { input: 8, output: 40 },
    input: 4,
    output: 20,
    write1h: 8,
    write5m: 5,
  },
  "claude-sonnet-5": { cacheRead: 0.2, input: 2, output: 10, write1h: 4, write5m: 2.5 },
  "claude-sonnet-5-5": { cacheRead: 0.1, input: 2, output: 10, write1h: 4, write5m: 2.5 },
}

export type Tokens = {
  cacheRead: number
  input: number
  output: number
  write1h: number
  write5m: number
}

// The message's $ at list price, or undefined when its model has no row; fast mode scales the input side (cache writes and reads with it) and sets its own output rate
export function usd(model: string, t: Tokens, fast: boolean): number | undefined {
  const price = PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")]
  if (!price) return undefined
  const prompt = t.input + t.write5m + t.write1h + t.cacheRead
  const rate = price.over && prompt > price.over.at ? price.over.rate : price
  const scale = fast && price.fast ? price.fast.input / rate.input : 1
  const output = fast && price.fast ? price.fast.output : rate.output
  const inputSide =
    t.input * rate.input +
    t.write5m * rate.write5m +
    t.write1h * rate.write1h +
    t.cacheRead * rate.cacheRead
  return (scale * inputSide + t.output * output) / 1e6
}
