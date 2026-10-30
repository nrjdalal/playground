import type { Session } from "@packages/auth"
import { env } from "@packages/env/api-hono"
import { getConnInfo } from "hono/bun"
import { createMiddleware } from "hono/factory"

import { ApiError } from "@/lib/error"

// A WebSocket handshake or a form post is not subject to CORS, so a page on another localhost port could send one with the session cookie; only the dashboard's own web origin may.
export const requireTrustedOrigin = createMiddleware(async (c, next) => {
  const origin = c.req.header("origin")
  if (!origin || !env.HONO_TRUSTED_ORIGINS.includes(origin)) {
    throw new ApiError(403, "FORBIDDEN", "Untrusted origin")
  }
  await next()
})

const LOOPBACK_RE = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/

// The API binds loopback, and a dashboard write checks its peer as well, so a HONO_HOSTNAME widened by mistake still takes no write from the network. A peer it cannot read (no Bun server behind the request) is refused.
export const requireLoopback = createMiddleware(async (c, next) => {
  let address: string | undefined
  try {
    address = getConnInfo(c).remote.address
  } catch {
    address = undefined
  }
  if (!address || !LOOPBACK_RE.test(address)) {
    throw new ApiError(403, "FORBIDDEN", "Writes are taken from this machine only")
  }
  await next()
})

// Behind portless or tailscale serve the peer is a proxy on loopback, so the client a proxy names counts too: a tailnet identity header, or any hop it forwarded from off loopback, is refused.
export const requireThisMachine = createMiddleware(async (c, next) => {
  const hops = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean)
  if (c.req.header("tailscale-user-login") || hops.some((hop) => !LOOPBACK_RE.test(hop))) {
    throw new ApiError(403, "FORBIDDEN", "Writes are taken from this machine only")
  }
  await next()
})

const READS = new Set(["GET", "HEAD", "OPTIONS"])

// A write types into sessions that bypass permission prompts, so before anything else it must come from the dashboard's own web origin, which a form or fetch on another localhost port cannot claim, over a loopback connection. Mounted on "/*" by method in every owner-rung router, so a write added later is guarded with no change here; a GET is never guarded, so a GET must never write.
export const guardWrites = createMiddleware(async (c, next) => {
  if (READS.has(c.req.method)) return next()
  await requireTrustedOrigin(c, async () => {
    await requireLoopback(c, next)
  })
})

export type StoreVariables = Session
