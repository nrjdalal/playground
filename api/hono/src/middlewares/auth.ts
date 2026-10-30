import type { Session } from "@packages/auth"
import { auth } from "@packages/auth"
import { reachesConsole } from "@packages/auth/access"
import { env } from "@packages/env/api-hono"
import type { Context, Next } from "hono"
import { createMiddleware } from "hono/factory"

import { jsonError } from "@/lib/error"
import { createRateLimiter } from "@/middlewares/rate-limiter"

export const USER_LIMIT = env.HONO_RATE_LIMIT * 2

// The dashboard polls many owner-rung reads from every open tab (the inbox every 5s, ops, system, agents, apps, running subagents), about 22 a minute a tab at rest and several times that while sessions talk, so they get a budget of their own, ten times the shared one.
export const OWNER_READ_LIMIT = USER_LIMIT * 10

const userRateLimiter = createRateLimiter({
  getUserId: (c) => c.get("session")?.userId,
  limit: USER_LIMIT,
  windowMs: env.HONO_RATE_LIMIT_WINDOW_MS,
})

const ownerReadLimiter = createRateLimiter({
  getUserId: (c) => c.get("session")?.userId,
  limit: OWNER_READ_LIMIT,
  windowMs: env.HONO_RATE_LIMIT_WINDOW_MS,
})

// An owner's GET or HEAD counts against the owner read budget, everything else against the shared one. The rung comes from the cached session, so a demotion moves its reads back within the cookie cache's window; the routes' own requireConsoleRole still decides access off a fresh read.
export const userLimiter = createMiddleware<{ Variables: Session }>((c, next) => {
  const read = c.req.method === "GET" || c.req.method === "HEAD"
  const limiter =
    read && reachesConsole(c.get("user"), "owner") ? ownerReadLimiter : userRateLimiter
  return limiter(c as Context, next as Next)
})

export const authMiddleware = createMiddleware<{ Variables: Session }>(async (c, next) => {
  // a route under two mounts that both guard it (/api/v1 and its dashboard router) reads the session and takes from the user's limit once
  if (c.get("user")) return next()
  const { headers, response: session } = await auth.api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  })

  // forward the session_data cookie so the cookie cache actually primes;
  // getSession without this silently drops better-auth's Set-Cookie
  for (const cookie of headers.getSetCookie()) {
    c.header("Set-Cookie", cookie, { append: true })
  }

  if (!session) {
    return jsonError(c, 401, "UNAUTHORIZED", "Unauthorized")
  }

  c.set("session", session.session)
  c.set("user", session.user)

  return userLimiter(c, next)
})
