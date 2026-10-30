import { findIp } from "@arcjet/ip"
import { auth } from "@packages/auth"
import { env } from "@packages/env/api-hono"
import { hash } from "bun"
import type { Context } from "hono"
import { rateLimiter } from "hono-rate-limiter"
import { createMiddleware } from "hono/factory"

import { jsonError } from "@/lib/error"

function generateRateLimitKey(
  c: Context,
  getUserId?: (c: Context) => string | undefined,
  getApiKey?: (c: Context) => string | undefined,
): string {
  const userId = getUserId?.(c)
  if (userId) return `userid:${userId}`

  const apiKey = getApiKey?.(c)
  if (apiKey) return `apikey:${hash(apiKey).toString(16)}`

  // findIp returns "" for a loopback or private peer (every request behind portless), so those share one key rather than each taking a fresh one that never fills.
  return `ip:${findIp(c.req.raw) || "unknown"}`
}

interface RateLimiterConfig {
  limit?: number
  windowMs?: number
  getUserId?: (c: Context) => string | undefined
  getApiKey?: (c: Context) => string | undefined
}

export function createRateLimiter(config: RateLimiterConfig = {}) {
  const { limit = 60, windowMs = 60000, getUserId, getApiKey } = config

  return rateLimiter({
    limit,
    windowMs,
    keyGenerator: (c) => generateRateLimitKey(c, getUserId, getApiKey),
    handler: (c) => jsonError(c, 429, "TOO_MANY_REQUESTS", "Too Many Requests"),
  })
}

// A signed-in request gets a budget of its own, keyed by user, so the Dashboard's polling never spends the anonymous one; at twenty times the anonymous limit it is no lower than any per-user limit authMiddleware sets, so on its routes those bind first.
export const SIGNED_IN_LIMIT = env.HONO_RATE_LIMIT * 20

const anonymousLimiter = createRateLimiter({
  limit: env.HONO_RATE_LIMIT,
  windowMs: env.HONO_RATE_LIMIT_WINDOW_MS,
})

const signedInLimiter = createRateLimiter({
  getUserId: (c) => c.get("rateLimitUserId"),
  limit: SIGNED_IN_LIMIT,
  windowMs: env.HONO_RATE_LIMIT_WINDOW_MS,
})

// A missing or forged session cookie fails its signature check before any database read, and the check never refreshes a session, which authMiddleware does.
async function signedInUserId(c: Context) {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true },
    })
    return session?.user.id
  } catch {
    return undefined
  }
}

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|::1)$/

// Every page render reads GET /api/health with no session, and on a loopback stack every peer shares one anonymous key, so those reads spent the budget and every health read after it answered 429; on an API bound past loopback the read stays limited.
export const limitExempt = (method: string, path: string, hostname: string = env.HONO_HOSTNAME) =>
  method === "GET" && path === "/api/health" && LOOPBACK_HOST.test(hostname)

export const rateLimiterMiddleware = createMiddleware<{ Variables: { rateLimitUserId: string } }>(
  async (c, next) => {
    if (limitExempt(c.req.method, c.req.path)) return next()
    const userId = await signedInUserId(c)
    if (!userId) return anonymousLimiter(c as Context, next)
    c.set("rateLimitUserId", userId)
    return signedInLimiter(c as Context, next)
  },
)
