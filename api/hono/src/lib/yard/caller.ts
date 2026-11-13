import { auth } from "@packages/auth"
import { type ConsoleRole, reachesConsole } from "@packages/auth/access"
import { db } from "@packages/db"
import { isBotLogin, WEB_DEVICE } from "@packages/message"
import { createMiddleware } from "hono/factory"

import { ApiError } from "@/lib/error"
import { type Caller, tokenOwner } from "@/lib/yard/store"
import { requireTrustedOrigin } from "@/middlewares/dashboard"

export type YardVariables = { caller: Caller }

type Signed = { banned?: boolean | null; id: string; login?: string | null; role?: string | null }

// Who may call, through a session or a bearer token: rung the lowest console rung that passes (member for Yard, user to redeem an invite, owner for invites and bots), web true where a bearer token is refused (approving, tokens, invites), since a token, an agent's, never decides for its person, and bots true on the message routes, by a channel's id or the bot's own, and the log route, the only ones a bot's token reaches, and relay true on the relay's socket and /me, the only ones the owner's relay token reaches.
export const yardCaller = ({
  bots = false,
  relay = false,
  rung = "member",
  web = false,
}: { bots?: boolean; relay?: boolean; rung?: ConsoleRole; web?: boolean } = {}) =>
  createMiddleware<{ Variables: YardVariables }>(async (c, next) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(yard_\S+)$/)?.[1]
    let signed: Signed
    let device = WEB_DEVICE
    let bot: { madeBy: string; readsLog: boolean } | null = null
    let relayToken = false
    if (bearer) {
      if (web) throw new ApiError(403, "FORBIDDEN", "Only a signed-in browser may do this")
      const found = await tokenOwner(db, bearer)
      if (!found) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
      signed = found.user
      device = found.device
      bot = found.bot
      relayToken = found.relay
      if (relayToken && !relay)
        throw new ApiError(403, "FORBIDDEN", "A relay token opens the relay alone")
    } else {
      // A browser's write carries its cookie wherever a page sends it from, so it must come from a trusted origin (writes.md); a token is never sent on its own, so a token's write needs none.
      if (c.req.method !== "GET") await requireTrustedOrigin(c, async () => {})
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
        query: { disableCookieCache: true },
      })
      if (!session) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
      signed = session.user
    }
    if (!reachesConsole(signed, rung)) throw new ApiError(403, "FORBIDDEN", "Yard is invite-only")
    if (!signed.login) throw new ApiError(403, "FORBIDDEN", "Yard needs a GitHub sign-in")
    // a bot's login with no bot row, its maker gone, or on a web session, which no bot holds, is no one
    if (isBotLogin(signed.login) && !bot) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
    if (bot && !bots)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "A bot's token reaches only its DM's messages and the log",
      )
    c.set("caller", {
      ...(bot ? { bot } : {}),
      device,
      id: signed.id,
      login: signed.login,
      owner: reachesConsole(signed, "owner"),
      ...(relayToken ? { relay: true as const } : {}),
      via: bearer ? "token" : "web",
    })
    return next()
  })
