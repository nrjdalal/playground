import { sValidator } from "@hono/standard-validator"
import { auth } from "@packages/auth"
import { reachesConsole } from "@packages/auth/access"
import { db } from "@packages/db"
import { env } from "@packages/env/api-hono"
import {
  channelSchema,
  githubLoginSchema,
  inviteCodeSchema,
  MAX_TEXT,
  MESSAGE_KINDS,
  messageSchema,
  tokenNameSchema,
  WEB_DEVICE,
} from "@packages/message"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import {
  ApiError,
  authErrorResponses,
  conflictErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { upgradeWebSocket } from "@/lib/server"
import { type YardVariables, yardCaller } from "@/lib/yard/caller"
import { join, publish } from "@/lib/yard/socket"
import * as store from "@/lib/yard/store"

// The validation envelope for a body or a query, so a refusal is the API's one 400 VALIDATION_ERROR.
const valid = <T extends z.ZodType>(target: "json" | "query", schema: T) =>
  sValidator(target, schema, (result) => {
    if (!result.success)
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
  })

// A route's OpenAPI entry: its { data } shape, the refusals it can answer with, and 201 for a route that makes a row.
const doc = (
  description: string,
  data: z.ZodType,
  refusals: object[] = [],
  status: 200 | 201 = 200,
) =>
  describeRoute({
    tags: ["Yard"],
    description,
    responses: {
      [status]: {
        description: status === 201 ? "Created" : "OK",
        content: { "application/json": { schema: resolver(z.object({ data })) } },
      },
      ...authErrorResponses,
      ...forbiddenErrorResponses,
      ...Object.assign({}, ...refusals),
    },
  })

const tokenSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.string(),
  lastUsedAt: z.iso.datetime().nullable(),
  name: z.string(),
  revokedAt: z.iso.datetime().nullable(),
})

const inviteSchema = z.object({
  code: z.string().optional(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  forLogin: z.string().nullable(),
  id: z.string(),
  requestedBy: z.object({ login: z.string() }).nullable(),
  status: z.enum(["open", "redeemed", "requested", "revoked"]),
})

// The hosted web's origin, the one a socket opens from; with HONO_WEB_URL unset, no socket opens, while the other routes still serve.
const webOrigin = env.HONO_WEB_URL ? new URL(env.HONO_WEB_URL).origin : null

const member = yardCaller()
const web = yardCaller({ web: true })
const owner = yardCaller({ rung: "owner", web: true })

// Sends a message's frame to whoever may read it: its channel once sent, its sender alone while it waits or after a deny.
// A stored post answers as stored whatever the fan-out does, so a client's retry never posts it twice; a failed fan-out is logged.
const fanOut = async (caller: store.Caller, message: z.infer<typeof messageSchema>) => {
  try {
    await publish(await store.audienceOf(db, caller, message), { message, type: "message" })
  } catch (error) {
    console.error("[yard] fan-out failed", error)
  }
}

// Yard's routes, which only the hosted build mounts (hosted.ts), each on the member rung or the narrower one it names.
export const yardRouter = new Hono<{ Variables: YardVariables }>()
  // who a token or a session belongs to, so the local Playground knows which @login is its owner's
  .get(
    "/me",
    doc(
      "Who you are on Yard: your login, and whether you are its owner",
      z.object({ login: z.string(), owner: z.boolean() }),
    ),
    member,
    (c) => {
      const { login, owner } = c.get("caller")
      return c.json({ data: { login, owner } })
    },
  )
  // what the local Playground cards in its Inbox: mentions, a thread's replies included, which a channel's page of top-level messages leaves out, and your own held posts
  .get(
    "/waiting",
    doc(
      "What waits on you past a mark, oldest first by when it showed, then by id: every sent message that names you in the channels and DMs you are in, a thread's replies included, and your own posts held for your approval; take the last item's shownAt as the next since and its message's id as the next after",
      z.object({
        items: z.array(
          z.object({ held: z.boolean(), message: messageSchema, shownAt: z.iso.datetime() }),
        ),
      }),
      [validationErrorResponses],
    ),
    member,
    valid("query", z.object({ after: z.string().min(1).optional(), since: z.iso.datetime() })),
    async (c) =>
      c.json({
        data: { items: await store.waiting(db, c.get("caller"), c.req.valid("query")) },
      }),
  )
  .get(
    "/channels",
    doc(
      "Every channel, joined or not, and your DMs, with unread and mention counts",
      z.object({ channels: z.array(channelSchema) }),
    ),
    member,
    async (c) => c.json({ data: { channels: await store.channels(db, c.get("caller")) } }),
  )
  .post(
    "/channels",
    doc(
      "Creates a channel, which its creator joins",
      z.object({ channel: channelSchema }),
      [validationErrorResponses, conflictErrorResponses],
      201,
    ),
    member,
    valid(
      "json",
      z.object({
        name: z
          .string()
          .trim()
          .regex(/^[a-z\d][a-z\d-]{0,31}$/, "lowercase letters, digits and dashes, 1 to 32"),
        topic: z.string().trim().max(200).optional(),
      }),
    ),
    async (c) =>
      c.json(
        { data: { channel: await store.createChannel(db, c.get("caller"), c.req.valid("json")) } },
        201,
      ),
  )
  .post(
    "/channels/:id/join",
    doc("Joins a channel", z.object({ channel: channelSchema }), [notFoundErrorResponses]),
    member,
    async (c) =>
      c.json({
        data: { channel: await store.joinChannel(db, c.get("caller"), c.req.param("id")) },
      }),
  )
  .post(
    "/dms",
    doc(
      "Opens your DM with a member, or returns the one there is",
      z.object({ channel: channelSchema }),
      [validationErrorResponses, notFoundErrorResponses],
    ),
    member,
    valid("json", z.object({ login: githubLoginSchema })),
    async (c) =>
      c.json({
        data: { channel: await store.openDm(db, c.get("caller"), c.req.valid("json").login) },
      }),
  )
  .get(
    "/channels/:id/messages",
    doc(
      "A page of a channel's messages, or of one thread's replies, oldest first: every sent one and your own pending and denied ones",
      z.object({ messages: z.array(messageSchema), hasMore: z.boolean() }),
      [validationErrorResponses, notFoundErrorResponses],
    ),
    member,
    valid(
      "query",
      z.object({
        before: z.iso.datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        parent: z.string().min(1).optional(),
      }),
    ),
    async (c) =>
      c.json({
        data: await store.messages(db, c.get("caller"), c.req.param("id"), c.req.valid("query")),
      }),
  )
  .post(
    "/channels/:id/messages",
    doc(
      "Posts a message; a token's tier-two post waits as pending until your signed-in browser approves it",
      z.object({ message: messageSchema }),
      [validationErrorResponses, notFoundErrorResponses],
      201,
    ),
    member,
    valid(
      "json",
      z.object({
        kind: z.enum(MESSAGE_KINDS),
        links: messageSchema.shape.links,
        parent: z.string().min(1).optional(),
        text: z.string().min(1).max(MAX_TEXT),
      }),
    ),
    async (c) => {
      const caller = c.get("caller")
      const message = await store.post(db, caller, c.req.param("id"), c.req.valid("json"))
      await fanOut(caller, message)
      return c.json({ data: { message } }, 201)
    },
  )
  .post(
    "/channels/:id/read",
    doc(
      "Marks a channel read up to a time, now by default",
      z.object({ lastReadAt: z.iso.datetime() }),
      [validationErrorResponses, notFoundErrorResponses],
    ),
    member,
    valid("json", z.object({ at: z.iso.datetime().optional() })),
    async (c) => {
      const caller = c.get("caller")
      const channel = c.req.param("id")
      const read = await store.markRead(db, caller, channel, c.req.valid("json").at)
      await publish([caller.id], { channel, lastReadAt: read.lastReadAt, type: "read" }).catch(
        (error) => console.error("[yard] read fan-out failed", error),
      )
      return c.json({ data: read })
    },
  )
  .get(
    "/messages/:id",
    doc("One of your own messages, for the approve page", z.object({ message: messageSchema }), [
      notFoundErrorResponses,
    ]),
    web,
    async (c) =>
      c.json({ data: { message: await store.ownMessage(db, c.get("caller"), c.req.param("id")) } }),
  )
  .post(
    "/messages/:id/approve",
    doc("Sends one of your pending messages", z.object({ message: messageSchema }), [
      notFoundErrorResponses,
      conflictErrorResponses,
    ]),
    web,
    async (c) => {
      const caller = c.get("caller")
      const message = await store.decide(db, caller, c.req.param("id"), "sent")
      await fanOut(caller, message)
      return c.json({ data: { message } })
    },
  )
  .post(
    "/messages/:id/deny",
    doc("Denies one of your pending messages", z.object({ message: messageSchema }), [
      notFoundErrorResponses,
      conflictErrorResponses,
    ]),
    web,
    async (c) => {
      const caller = c.get("caller")
      const message = await store.decide(db, caller, c.req.param("id"), "denied")
      await fanOut(caller, message)
      return c.json({ data: { message } })
    },
  )
  .get("/tokens", doc("Your tokens", z.object({ tokens: z.array(tokenSchema) })), web, async (c) =>
    c.json({ data: { tokens: await store.tokens(db, c.get("caller")) } }),
  )
  .post(
    "/tokens",
    doc(
      "Makes a token; its secret is shown this once",
      z.object({ token: tokenSchema.extend({ secret: z.string() }) }),
      [validationErrorResponses, conflictErrorResponses],
      201,
    ),
    web,
    valid("json", z.object({ name: tokenNameSchema })),
    async (c) =>
      c.json(
        { data: { token: await store.createToken(db, c.get("caller"), c.req.valid("json").name) } },
        201,
      ),
  )
  .delete(
    "/tokens/:id",
    doc("Revokes a token; its next call reads 401", z.object({ token: tokenSchema }), [
      notFoundErrorResponses,
    ]),
    web,
    async (c) =>
      c.json({ data: { token: await store.revokeToken(db, c.get("caller"), c.req.param("id")) } }),
  )
  .get(
    "/invites",
    doc(
      "Every invite for the owner; a member's own requests otherwise",
      z.object({ invites: z.array(inviteSchema) }),
    ),
    web,
    async (c) => c.json({ data: { invites: await store.invites(db, c.get("caller")) } }),
  )
  .post(
    "/invites",
    doc(
      "Makes an invite; its code is shown this once",
      z.object({ invite: inviteSchema }),
      [validationErrorResponses],
      201,
    ),
    owner,
    valid(
      "json",
      z.object({
        expiresInDays: z.number().int().min(1).max(30).optional(),
        forLogin: githubLoginSchema.optional(),
      }),
    ),
    async (c) =>
      c.json(
        { data: { invite: await store.createInvite(db, c.get("caller"), c.req.valid("json")) } },
        201,
      ),
  )
  .post(
    "/invites/request",
    doc(
      "Asks the owner to let a GitHub login in",
      z.object({ invite: inviteSchema }),
      [validationErrorResponses],
      201,
    ),
    web,
    valid("json", z.object({ forLogin: githubLoginSchema })),
    async (c) =>
      c.json(
        {
          data: {
            invite: await store.requestInvite(db, c.get("caller"), c.req.valid("json").forLogin),
          },
        },
        201,
      ),
  )
  .post(
    "/invites/:id/approve",
    doc(
      "Opens a member's request, minting its code, shown this once",
      z.object({ invite: inviteSchema }),
      [notFoundErrorResponses, conflictErrorResponses],
    ),
    owner,
    async (c) =>
      c.json({
        data: {
          invite: await store.decideInvite(db, c.get("caller"), c.req.param("id"), "approve"),
        },
      }),
  )
  .post(
    "/invites/:id/deny",
    doc("Revokes a request or an open invite", z.object({ invite: inviteSchema }), [
      notFoundErrorResponses,
      conflictErrorResponses,
    ]),
    owner,
    async (c) =>
      c.json({
        data: { invite: await store.decideInvite(db, c.get("caller"), c.req.param("id"), "deny") },
      }),
  )
  .post(
    "/invites/redeem",
    doc(
      "Redeems an invite: you take the member rung and join #general and #releases",
      z.object({ member: z.literal(true) }),
      [validationErrorResponses, notFoundErrorResponses],
    ),
    yardCaller({ rung: "user", web: true }),
    valid("json", z.object({ code: inviteCodeSchema })),
    async (c) =>
      c.json({ data: await store.redeemInvite(db, c.get("caller"), c.req.valid("json").code) }),
  )
  // The socket: the web opens it straight to the API's host with a one-time token from its own proxy, since the API never sees the web's cookie; it checks the Origin is the hosted web's and the member rung, then pushes frames.
  .get(
    "/socket",
    describeRoute({
      description:
        'Opens a member\'s socket with a one-time token from /api/auth/one-time-token/generate, from the hosted web\'s Origin alone. The server sends JSON frames and reads none: { type: "message", message } for a message the member may read, and { type: "read", channel, lastReadAt } for a read the member made elsewhere.',
      responses: {
        101: { description: "Switching Protocols: the socket is open" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
      tags: ["Yard"],
    }),
    async (c, next) => {
      if (!webOrigin || c.req.header("origin") !== webOrigin)
        throw new ApiError(403, "FORBIDDEN", "The socket opens from the hosted web alone")
      const token = c.req.query("token")
      if (!token) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
      // The plugin's verify answers the session it consumed the token for; its declared type is a bare Response.
      const signed = (await auth.api.verifyOneTimeToken({ body: { token } }).catch(() => null)) as {
        user?: { banned?: boolean | null; id: string; login?: string | null; role?: string | null }
      } | null
      const user = signed?.user
      if (!user?.login || !reachesConsole(user, "member"))
        throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
      c.set("caller", {
        device: WEB_DEVICE,
        id: user.id,
        login: user.login,
        owner: reachesConsole(user, "owner"),
        via: "web",
      })
      return next()
    },
    upgradeWebSocket((c) => {
      const id = c.get("caller").id
      // join's own close, kept from onOpen, since onClose's context is a new object
      let leave = () => {}
      return {
        onClose: () => leave(),
        onOpen: (_, socket) => {
          leave = join(id, socket)
        },
      }
    }),
  )
