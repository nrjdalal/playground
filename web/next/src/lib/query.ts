import { QueryClient } from "@tanstack/react-query"

// The message the API's rate limiter answers a 429 with (api/hono/src/middlewares/rate-limiter.ts); every read throws its error's message, so this is how a read knows it was limited.
export const RATE_LIMITED_MESSAGE = "Too Many Requests"

// A limited read is retried after 2, 4, 8 and 16 seconds: 30 seconds holding its last data with no error before the read gives up and its page shows the failure.
export const RATE_LIMIT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000]

// React Query's own default for any other failure: three retries.
const DEFAULT_RETRIES = 3

export const isRateLimited = (error: unknown): boolean =>
  error instanceof Error && error.message === RATE_LIMITED_MESSAGE

export const queryRetry = (failureCount: number, error: unknown): boolean =>
  failureCount < (isRateLimited(error) ? RATE_LIMIT_DELAYS_MS.length : DEFAULT_RETRIES)

export const queryRetryDelay = (failureCount: number, error: unknown): number =>
  isRateLimited(error)
    ? (RATE_LIMIT_DELAYS_MS[failureCount] ?? RATE_LIMIT_DELAYS_MS.at(-1) ?? 0)
    : Math.min(1000 * 2 ** failureCount, 30_000)

// Every page's reads share these: a 429 is transient, so a read keeps its last data and backs off rather than showing an error at once. Writes (mutations) keep React Query's default of no retry.
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: queryRetry, retryDelay: queryRetryDelay } },
  })
}
