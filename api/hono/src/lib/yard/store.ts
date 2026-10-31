import { createHash, randomBytes } from "node:crypto"

import { reachesConsole } from "@packages/auth/access"
import {
  type Database,
  user,
  yardChannel,
  yardInvite,
  yardMember,
  yardMessage,
  yardToken,
} from "@packages/db"
import { type Channel, type Message, tokenNameSchema } from "@packages/message"
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"

import { ApiError } from "@/lib/error"
import { live, take } from "@/lib/yard/limits"
import { heldBecause } from "@/lib/yard/tier"

type YardChannel = typeof yardChannel.$inferSelect

// Who is calling: a member signed in on the web, or one of their tokens, whose name is the device a post carries.
export type Caller = {
  device: string
  id: string
  login: string
  owner: boolean
  via: "token" | "web"
}

// The channels every member joins on redeeming an invite: #general, where every member posts, and #releases, where the owner rung alone posts.
export const JOINED_ON_REDEEM = [
  { name: "general", postRule: "members" },
  { name: "releases", postRule: "owner" },
] as const

// The token, invite and channel writes a member makes in an hour.
export const WRITES_HOUR = 20

export const hashOf = (secret: string): string => createHash("sha256").update(secret).digest("hex")

const secret = (prefix: string): string => `${prefix}${randomBytes(24).toString("base64url")}`

// A unique-constraint violation, which a write that can lose a race answers as 409; drizzle wraps the driver's error as its cause.
const taken = (error: unknown): boolean => {
  for (
    let at = error as { cause?: unknown; errno?: string } | undefined;
    at;
    at = at.cause as typeof at
  )
    if (at.errno === "23505") return true
  return false
}

const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`)

type MessageRow = typeof yardMessage.$inferSelect

export const toMessage = (row: MessageRow): Message => ({
  at: row.at.toISOString(),
  channel: row.channelId,
  from: { device: row.device, login: row.login },
  id: row.id,
  kind: row.kind,
  ...(row.links?.length ? { links: row.links } : {}),
  ...(row.parentId ? { parent: row.parentId } : {}),
  status: row.status,
  text: row.text,
})

// Every channel and DM a caller sees, each with its unread and mention counts since the caller last read it: every channel, joined or not, and the DMs the caller is in.
export const channels = async (db: Database, caller: Caller, id?: string): Promise<Channel[]> => {
  const rows = await db.execute<{
    id: string
    joined: boolean
    kind: "channel" | "dm"
    last_message_at: Date | string | null
    mentions: number
    name: string
    peer: Channel["peer"]
    post_rule: "members" | "owner"
    topic: string | null
    unread: number
  }>(sql`
    select c.id, c.kind, c.name, c.post_rule, c.topic, m.user_id is not null as joined,
      (select max(x.at) from yard_message x where x.channel_id = c.id and x.status = 'sent' and ${live("x")}) as last_message_at,
      (select count(*)::int from yard_message x where x.channel_id = c.id and x.status = 'sent'
        and x.user_id is distinct from ${caller.id} and x.at > coalesce(m.last_read_at, m.joined_at) and ${live("x")}) as unread,
      (select count(*)::int from yard_message x where x.channel_id = c.id and x.status = 'sent'
        and x.user_id is distinct from ${caller.id} and x.at > coalesce(m.last_read_at, m.joined_at)
        and x.text ~* ${`(^|[^\\w@])@${caller.login}([^\\w-]|$)`} and ${live("x")}) as mentions,
      case when c.kind = 'dm' then (
        select json_build_object('id', u.id, 'image', u.image, 'login', u.login, 'name', u.name)
        from yard_member o join "user" u on u.id = o.user_id
        where o.channel_id = c.id and o.user_id <> ${caller.id} limit 1
      ) end as peer
    from yard_channel c
    left join yard_member m on m.channel_id = c.id and m.user_id = ${caller.id}
    where (c.kind = 'channel' or m.user_id is not null) ${id ? sql`and c.id = ${id}` : sql``}
    order by c.kind, c.name
  `)
  return [...rows].map((row) => ({
    id: row.id,
    joined: row.joined,
    kind: row.kind,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    mentions: row.mentions,
    name: row.name,
    peer: row.peer ?? null,
    postRule: row.post_rule,
    topic: row.topic,
    unread: row.unread,
  }))
}

const channelFor = async (db: Database, caller: Caller, id: string): Promise<Channel> => {
  const [channel] = await channels(db, caller, id)
  if (!channel) throw notFound("Channel")
  return channel
}

export const createChannel = async (
  db: Database,
  caller: Caller,
  { name, topic }: { name: string; topic?: string },
): Promise<Channel> => {
  // the redeem's channels are made by the first redeem alone, so a member who named one first cannot set #releases open to every member
  if (JOINED_ON_REDEEM.some((channel) => channel.name === name))
    throw new ApiError(409, "CONFLICT", `#${name} is kept for Yard's own channel`)
  await take(db, `writes:${caller.id}`, "hour", WRITES_HOUR)
  const id = crypto.randomUUID()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(yardChannel).values({ id, kind: "channel", name, topic })
      await tx.insert(yardMember).values({ channelId: id, userId: caller.id })
    })
  } catch (error) {
    if (taken(error)) throw new ApiError(409, "CONFLICT", `#${name} already exists`)
    throw error
  }
  return channelFor(db, caller, id)
}

export const joinChannel = async (db: Database, caller: Caller, id: string): Promise<Channel> => {
  const [row] = await db.select().from(yardChannel).where(eq(yardChannel.id, id))
  if (!row || row.kind !== "channel") throw notFound("Channel")
  await db.insert(yardMember).values({ channelId: id, userId: caller.id }).onConflictDoNothing()
  return channelFor(db, caller, id)
}

// The DM between the caller and another member, named by both user ids sorted so either side opens the same row.
export const openDm = async (db: Database, caller: Caller, login: string): Promise<Channel> => {
  const [peer] = await db
    .select({ banned: user.banned, id: user.id, role: user.role })
    .from(user)
    .where(sql`lower(${user.login}) = ${login.toLowerCase()}`)
  if (!peer || !reachesConsole(peer, "member")) throw notFound("Member")
  if (peer.id === caller.id) throw new ApiError(400, "BAD_REQUEST", "A DM is between two members")
  const name = `dm:${[caller.id, peer.id].sort().join(":")}`
  await db.transaction(async (tx) => {
    await tx
      .insert(yardChannel)
      .values({ id: crypto.randomUUID(), kind: "dm", name })
      .onConflictDoNothing()
    const [row] = await tx
      .select({ id: yardChannel.id })
      .from(yardChannel)
      .where(eq(yardChannel.name, name))
    await tx
      .insert(yardMember)
      .values([caller.id, peer.id].map((userId) => ({ channelId: row!.id, userId })))
      .onConflictDoNothing()
  })
  const [row] = await db
    .select({ id: yardChannel.id })
    .from(yardChannel)
    .where(eq(yardChannel.name, name))
  return channelFor(db, caller, row!.id)
}

// The channel, when the caller is a member of it; a channel the caller is not in reads as missing.
const memberOf = async (db: Database, caller: Caller, id: string): Promise<YardChannel> => {
  const [row] = await db
    .select({ channel: yardChannel })
    .from(yardChannel)
    .innerJoin(
      yardMember,
      and(eq(yardMember.channelId, yardChannel.id), eq(yardMember.userId, caller.id)),
    )
    .where(eq(yardChannel.id, id))
  if (!row) throw notFound("Channel")
  return row.channel
}

// A channel's messages, newest page first and each page oldest first: every sent one, and the caller's own pending and denied ones; with parent, that message's thread.
export const messages = async (
  db: Database,
  caller: Caller,
  channelId: string,
  { before, limit = 50, parent }: { before?: string; limit?: number; parent?: string },
): Promise<{ hasMore: boolean; messages: Message[] }> => {
  await memberOf(db, caller, channelId)
  const rows = await db
    .select()
    .from(yardMessage)
    .where(
      and(
        eq(yardMessage.channelId, channelId),
        or(eq(yardMessage.status, "sent"), eq(yardMessage.userId, caller.id)),
        parent ? eq(yardMessage.parentId, parent) : isNull(yardMessage.parentId),
        before ? lt(yardMessage.at, new Date(before)) : undefined,
        live(),
      ),
    )
    .orderBy(desc(yardMessage.at), desc(yardMessage.id))
    .limit(limit + 1)
  return { hasMore: rows.length > limit, messages: rows.slice(0, limit).reverse().map(toMessage) }
}

// The owner's #i6 limits: a login posts once a second and 200 times a day, and a channel takes 60 posts an hour.
export const POST_LIMITS = { channelHour: 60, loginDay: 200, loginSecond: 1 } as const

// What one channel kind checks before a post: whether the caller may post there, and what decides a token's hold. A later kind (a self channel) adds its own.
const POST_RULES: Record<
  YardChannel["kind"],
  (db: Database, caller: Caller, channel: YardChannel) => Promise<{ firstInDm: boolean }>
> = {
  channel: async (_db, caller, channel) => {
    if (channel.postRule === "owner" && !caller.owner)
      throw new ApiError(403, "FORBIDDEN", `Only the owner posts in #${channel.name}`)
    return { firstInDm: false }
  },
  // A token's post waits while the DM has no sent message, so a held or denied opener lets nothing through after it.
  dm: async (db, _caller, channel) => ({
    firstInDm:
      (
        await db
          .select({ id: yardMessage.id })
          .from(yardMessage)
          .where(and(eq(yardMessage.channelId, channel.id), eq(yardMessage.status, "sent")))
          .limit(1)
      ).length === 0,
  }),
}

export const post = async (
  db: Database,
  caller: Caller,
  channelId: string,
  body: { kind: Message["kind"]; links?: string[]; parent?: string; text: string },
  limits: Record<keyof typeof POST_LIMITS, number> = POST_LIMITS,
): Promise<Message> => {
  const channel = await memberOf(db, caller, channelId)
  const { firstInDm } = await POST_RULES[channel.kind](db, caller, channel)
  if (body.parent) {
    // a thread past retention is gone, so a reply cannot bring it back before the sweep removes it
    const [parent] = await db
      .select({ channelId: yardMessage.channelId, parentId: yardMessage.parentId })
      .from(yardMessage)
      .where(and(eq(yardMessage.id, body.parent), live()))
    if (parent?.channelId !== channelId) throw notFound("Parent message")
    // Threads are one level deep, a first message and its replies, so retention reads a thread's newest message in one step.
    if (parent.parentId)
      throw new ApiError(400, "BAD_REQUEST", "Reply to the thread's first message")
  }
  await take(db, `post:${caller.login}`, "second", limits.loginSecond)
  await take(db, `post:${caller.login}`, "day", limits.loginDay)
  await take(db, `channel:${channelId}`, "hour", limits.channelHour)
  const held = heldBecause({ ...body, firstInDm, postRule: channel.postRule, via: caller.via })
  const [row] = await db
    .insert(yardMessage)
    .values({
      channelId,
      device: caller.device,
      kind: body.kind,
      links: body.links,
      login: caller.login,
      parentId: body.parent,
      status: held ? "pending" : "sent",
      text: body.text,
      userId: caller.id,
    })
    .returning()
  return toMessage(row!)
}

export const markRead = async (db: Database, caller: Caller, channelId: string, at?: string) => {
  await memberOf(db, caller, channelId)
  const now = new Date()
  const lastReadAt = at && new Date(at) < now ? new Date(at) : now
  await db
    .update(yardMember)
    .set({ lastReadAt })
    .where(and(eq(yardMember.channelId, channelId), eq(yardMember.userId, caller.id)))
  return { lastReadAt: lastReadAt.toISOString() }
}

// One of the caller's own messages; anyone else's reads as missing.
export const ownMessage = async (db: Database, caller: Caller, id: string): Promise<Message> => {
  const [row] = await db
    .select()
    .from(yardMessage)
    .where(and(eq(yardMessage.id, id), eq(yardMessage.userId, caller.id), live()))
  if (!row) throw notFound("Message")
  return toMessage(row)
}

// Sends or denies one of the caller's pending messages, stamping decided_at; a message already decided is a conflict.
export const decide = async (
  db: Database,
  caller: Caller,
  id: string,
  status: "denied" | "sent",
): Promise<Message> => {
  const [row] = await db
    .update(yardMessage)
    .set({ decidedAt: new Date(), status })
    .where(
      and(
        eq(yardMessage.id, id),
        eq(yardMessage.userId, caller.id),
        eq(yardMessage.status, "pending"),
        live(),
      ),
    )
    .returning()
  if (row) return toMessage(row)
  const existing = await ownMessage(db, caller, id)
  throw new ApiError(409, "CONFLICT", `The message is already ${existing.status}`)
}

const tokenOut = (row: typeof yardToken.$inferSelect) => ({
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  name: row.name,
  revokedAt: row.revokedAt?.toISOString() ?? null,
})

export const tokens = async (db: Database, caller: Caller) =>
  (
    await db
      .select()
      .from(yardToken)
      .where(eq(yardToken.userId, caller.id))
      .orderBy(asc(yardToken.name))
  ).map(tokenOut)

// A new token: its secret, yard_ and 32 random characters, is returned this once and kept only as its hash.
export const createToken = async (db: Database, caller: Caller, name: string) => {
  tokenNameSchema.parse(name)
  await take(db, `writes:${caller.id}`, "hour", WRITES_HOUR)
  const value = secret("yard_")
  try {
    const [row] = await db
      .insert(yardToken)
      .values({ hash: hashOf(value), name, userId: caller.id })
      .returning()
    return { ...tokenOut(row!), secret: value }
  } catch (error) {
    if (taken(error)) throw new ApiError(409, "CONFLICT", `A token named ${name} exists`)
    throw error
  }
}

export const revokeToken = async (db: Database, caller: Caller, id: string) => {
  const [row] = await db
    .update(yardToken)
    .set({ revokedAt: sql`coalesce(${yardToken.revokedAt}, now())` })
    .where(and(eq(yardToken.id, id), eq(yardToken.userId, caller.id)))
    .returning()
  if (!row) throw notFound("Token")
  return tokenOut(row)
}

// The member a token names, when it is live and its owner still holds the member rung, stamping its last use.
export const tokenOwner = async (db: Database, value: string) => {
  const [row] = await db
    .select({ name: yardToken.name, tokenId: yardToken.id, user })
    .from(yardToken)
    .innerJoin(user, eq(user.id, yardToken.userId))
    .where(and(eq(yardToken.hash, hashOf(value)), isNull(yardToken.revokedAt)))
  if (!row) return null
  await db.update(yardToken).set({ lastUsedAt: new Date() }).where(eq(yardToken.id, row.tokenId))
  return { device: row.name, user: row.user }
}

const inviteOut = (row: typeof yardInvite.$inferSelect, requestedBy: string | null) => ({
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString() ?? null,
  forLogin: row.forLogin,
  id: row.id,
  requestedBy: requestedBy ? { login: requestedBy } : null,
  status: row.status,
})

const inviteCode = (): string =>
  randomBytes(9)
    .toString("base64url")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X")
    .slice(0, 12)
    .replace(/(.{4})(?=.)/g, "$1-")

const DAY_MS = 86_400_000

// How long an invite stays open when its maker names no other span, and when the owner opens a request.
const INVITE_DAYS = 7

// The owner sees every invite; a member sees the requests they made.
export const invites = async (db: Database, caller: Caller) => {
  const rows = await db
    .select({ invite: yardInvite, requester: user.login })
    .from(yardInvite)
    .leftJoin(user, eq(user.id, yardInvite.requestedBy))
    .where(caller.owner ? undefined : eq(yardInvite.requestedBy, caller.id))
    .orderBy(desc(yardInvite.createdAt))
  return rows.map(({ invite, requester }) => inviteOut(invite, requester))
}

export const createInvite = async (
  db: Database,
  caller: Caller,
  { expiresInDays = INVITE_DAYS, forLogin }: { expiresInDays?: number; forLogin?: string },
) => {
  await take(db, `writes:${caller.id}`, "hour", WRITES_HOUR)
  const code = inviteCode()
  const [row] = await db
    .insert(yardInvite)
    .values({
      codeHash: hashOf(code),
      expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
      forLogin: forLogin?.toLowerCase(),
      madeBy: caller.id,
      status: "open",
    })
    .returning()
  return { ...inviteOut(row!, null), code }
}

export const requestInvite = async (db: Database, caller: Caller, forLogin: string) => {
  await take(db, `writes:${caller.id}`, "hour", WRITES_HOUR)
  const [row] = await db
    .insert(yardInvite)
    .values({ forLogin: forLogin.toLowerCase(), requestedBy: caller.id, status: "requested" })
    .returning()
  return inviteOut(row!, caller.login)
}

// The owner opens a member's request, which mints its code, or revokes a request or an open invite.
export const decideInvite = async (
  db: Database,
  caller: Caller,
  id: string,
  action: "approve" | "deny",
) => {
  const code = action === "approve" ? inviteCode() : null
  const [row] = await db
    .update(yardInvite)
    .set(
      code
        ? {
            codeHash: hashOf(code),
            expiresAt: new Date(Date.now() + INVITE_DAYS * DAY_MS),
            madeBy: caller.id,
            status: "open",
          }
        : { status: "revoked" },
    )
    .where(
      and(
        eq(yardInvite.id, id),
        inArray(yardInvite.status, action === "approve" ? ["requested"] : ["open", "requested"]),
      ),
    )
    .returning()
  if (!row) {
    const [existing] = await db.select().from(yardInvite).where(eq(yardInvite.id, id))
    if (!existing) throw notFound("Invite")
    throw new ApiError(409, "CONFLICT", `The invite is already ${existing.status}`)
  }
  const [requester] = row.requestedBy
    ? await db.select({ login: user.login }).from(user).where(eq(user.id, row.requestedBy))
    : []
  return { ...inviteOut(row, requester?.login ?? null), ...(code ? { code } : {}) }
}

// Redeems an open, unexpired invite meant for the caller (or for anyone): the caller takes the member rung, unless already above it, and joins #general and #releases.
export const redeemInvite = async (db: Database, caller: Caller, code: string) => {
  const now = new Date()
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(yardInvite)
      .set({ redeemedAt: now, redeemedBy: caller.id, status: "redeemed" })
      .where(
        and(
          eq(yardInvite.codeHash, hashOf(code.trim().toUpperCase())),
          eq(yardInvite.status, "open"),
          or(isNull(yardInvite.expiresAt), sql`${yardInvite.expiresAt} > ${now}`),
          or(isNull(yardInvite.forLogin), eq(yardInvite.forLogin, caller.login.toLowerCase())),
        ),
      )
      .returning()
    if (!row) throw new ApiError(404, "NOT_FOUND", "No open invite matches that code")
    await tx
      .update(user)
      .set({ role: "member", roleSetAt: now })
      .where(and(eq(user.id, caller.id), or(isNull(user.role), eq(user.role, "user"))))
    for (const { name, postRule } of JOINED_ON_REDEEM) {
      await tx
        .insert(yardChannel)
        .values({ id: crypto.randomUUID(), kind: "channel", name, postRule })
        .onConflictDoNothing()
      const [channel] = await tx
        .select({ id: yardChannel.id })
        .from(yardChannel)
        .where(eq(yardChannel.name, name))
      await tx
        .insert(yardMember)
        .values({ channelId: channel!.id, userId: caller.id })
        .onConflictDoNothing()
    }
  })
  return { member: true as const }
}

// Who a message's frame reaches: every member of its channel who still holds the member rung once it is sent, so a banned member's open socket hears nothing, and its sender alone while it is pending or denied.
export const audienceOf = async (db: Database, caller: Caller, message: Message) =>
  message.status === "sent"
    ? (
        await db
          .select({ banned: user.banned, id: user.id, role: user.role })
          .from(yardMember)
          .innerJoin(user, eq(user.id, yardMember.userId))
          .where(eq(yardMember.channelId, message.channel))
      )
        .filter((row) => reachesConsole(row, "member"))
        .map((row) => row.id)
    : [caller.id]
