import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  RATE_LIMITED_MESSAGE,
  RATE_LIMIT_DELAYS_MS,
  isRateLimited,
  makeQueryClient,
  queryRetry,
  queryRetryDelay,
} from "../../../../../web/next/src/lib/query"

// React Query resolves from the web app's own packages, the same copy query.ts loads, so its timer clock is the one the client below runs on.
const web = join(import.meta.dir, "../../../../../web/next")
type Result = { data: unknown; error: unknown; failureCount: number }
type Observer = {
  getCurrentResult: () => Result
  refetch: () => Promise<Result>
  subscribe: (listener: (result: Result) => void) => () => void
}
const { QueryObserver, timeoutManager } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as {
  QueryObserver: new (client: unknown, options: unknown) => Observer
  timeoutManager: { setTimeoutProvider: (provider: unknown) => void }
}

// A clock the test moves: React Query's retry waits run on it, so 30 seconds pass at once. It is set once and never switched back (React Query warns on a switch), so once this file is done it hands every timer to the real one.
let fake = false
let now = 0
let nextId = 1
const timers = new Map<number, { at: number; callback: () => void }>()
type Id = number | ReturnType<typeof setTimeout>
timeoutManager.setTimeoutProvider({
  clearInterval: (id: Id) => (typeof id === "number" ? timers.delete(id) : clearInterval(id)),
  clearTimeout: (id: Id) => (typeof id === "number" ? timers.delete(id) : clearTimeout(id)),
  setInterval: (callback: () => void, delay: number) => setInterval(callback, delay),
  setTimeout: (callback: () => void, delay: number) => {
    if (!fake) return setTimeout(callback, delay)
    timers.set(nextId, { at: now + delay, callback })
    return nextId++
  },
})
const settle = () => new Promise((resolve) => setImmediate(resolve))
async function advance(ms: number) {
  const end = now + ms
  for (;;) {
    await settle()
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0]
    if (!due) break
    timers.delete(due[0])
    now = due[1].at
    due[1].callback()
  }
  now = end
  await settle()
}

beforeAll(() => {
  fake = true
})
afterAll(() => {
  fake = false
  timers.clear()
})

// A read whose answers the test scripts: each call takes the next, "429" failing as a limited read does.
function read(answers: string[]) {
  const client = makeQueryClient()
  let calls = 0
  const observer = new QueryObserver(client, {
    queryFn: async () => {
      const answer = answers[Math.min(calls++, answers.length - 1)]
      if (answer === "429") throw new Error(RATE_LIMITED_MESSAGE)
      if (answer === "500") throw new Error("Internal Server Error")
      return answer
    },
    queryKey: ["read", Math.random()],
  })
  const seen: Result[] = []
  const unsubscribe = observer.subscribe((result) => seen.push(result))
  return { calls: () => calls, observer, seen, unsubscribe }
}

describe("a rate-limited read", () => {
  test("keeps its last data and shows no error while a 429 clears within 30s", async () => {
    const { observer, seen, unsubscribe } = read(["first", "429", "429", "429", "second"])
    await advance(0)
    expect(observer.getCurrentResult().data).toBe("first")
    void observer.refetch()
    await advance(29_999)
    expect(observer.getCurrentResult().data).toBe("second")
    expect(seen.every((result) => result.error === null)).toBe(true)
    expect(seen.every((result, i) => i === 0 || result.data !== undefined)).toBe(true)
    unsubscribe()
  })

  test("shows its error only once the 429s have lasted 30s, still holding its data", async () => {
    const { calls, observer, unsubscribe } = read(["first", "429"])
    await advance(0)
    void observer.refetch()
    await advance(29_999)
    expect(observer.getCurrentResult().error).toBeNull()
    expect(observer.getCurrentResult().data).toBe("first")
    await advance(1)
    expect(isRateLimited(observer.getCurrentResult().error)).toBe(true)
    expect(observer.getCurrentResult().data).toBe("first")
    expect(calls()).toBe(1 + 1 + RATE_LIMIT_DELAYS_MS.length)
    unsubscribe()
  })

  test("leaves any other failure on React Query's three retries", async () => {
    const { calls, observer, unsubscribe } = read(["500"])
    await advance(7_000)
    expect(observer.getCurrentResult().error).toBeInstanceOf(Error)
    expect(calls()).toBe(4)
    unsubscribe()
  })
})

describe("queryRetry", () => {
  test("backs a 429 off for 30 seconds in all, doubling each wait", () => {
    const limited = new Error(RATE_LIMITED_MESSAGE)
    expect(RATE_LIMIT_DELAYS_MS.map((_, i) => queryRetryDelay(i, limited))).toEqual([
      2_000, 4_000, 8_000, 16_000,
    ])
    expect(RATE_LIMIT_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBe(30_000)
    expect(queryRetry(3, limited)).toBe(true)
    expect(queryRetry(4, limited)).toBe(false)
    expect(queryRetry(2, new Error("Not Found"))).toBe(true)
    expect(queryRetry(3, new Error("Not Found"))).toBe(false)
  })

  test("names the message the API's limiter answers with", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../../../api/hono/src/middlewares/rate-limiter.ts"),
    ).text()
    expect(source).toContain(`"TOO_MANY_REQUESTS", "${RATE_LIMITED_MESSAGE}"`)
  })
})
