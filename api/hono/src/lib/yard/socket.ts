import { env } from "@packages/env/api-hono"
import type { Message } from "@packages/message"
import { RedisClient } from "bun"

// What the socket sends a member; the client sends nothing back.
export type Frame =
  | { message: Message; type: "message" }
  | { channel: string; lastReadAt: string; type: "read" }

type Socket = { send: (data: string) => void }

const CHANNEL = "yard"

// The sockets open on this instance, by the member they belong to.
const open = new Map<string, Set<Socket>>()

// Holds a socket open for its member and returns what removes it, since hono/bun hands onClose a new context that matches none; with KV_URL set, the first join subscribes, so the socket hears other instances' posts.
export const join = (userId: string, socket: Socket) => {
  const set = open.get(userId) ?? new Set()
  set.add(socket)
  open.set(userId, set)
  if (env.KV_URL)
    connect(env.KV_URL).catch((error) => console.error("[yard] socket subscribe failed", error))
  return () => {
    set.delete(socket)
    if (set.size === 0 && open.get(userId) === set) open.delete(userId)
  }
}

// A socket that throws on send (one closing under it) is skipped, so the rest still get the frame.
const sendHere = (userIds: string[], frame: Frame) => {
  const data = JSON.stringify(frame)
  for (const id of userIds)
    for (const socket of open.get(id) ?? [])
      try {
        socket.send(data)
      } catch (error) {
        console.error("[yard] socket send failed", error)
      }
}

// A command to a Redis that has dropped fails at once rather than queueing, and a fan-out waits 2 s at most for one that never connected, so a post never hangs on it (a client retrying a hung post would post twice); Bun's own reconnect is off, since it never sends SUBSCRIBE again.
const OPTIONS = { autoReconnect: false, connectionTimeout: 2000, enableOfflineQueue: false }
const FAN_OUT_MS = 2000
const RETRY_MS = 1000

// With KV_URL set, every instance subscribes to one Redis channel, so a post on one instance reaches a socket held by another; without it, the instance's own sockets alone.
let publisher: Promise<RedisClient> | null = null
let retry: ReturnType<typeof setTimeout> | null = null

// One subscriber and one publisher per instance; when either drops, or a connect fails partway, both close, and the pair is built again on the next join or publish, or after RETRY_MS while a socket is open.
const connect = (url: string): Promise<RedisClient> => {
  if (publisher) return publisher
  const clients: RedisClient[] = []
  let live = true
  const client = (): RedisClient => {
    const one = new RedisClient(url, OPTIONS)
    one.onclose = drop
    clients.push(one)
    return one
  }
  const drop = () => {
    if (!live) return
    live = false
    publisher = null
    for (const one of clients) one.close()
    if (open.size > 0)
      retry ??= setTimeout(() => {
        retry = null
        connect(url).catch((error) => console.error("[yard] socket resubscribe failed", error))
      }, RETRY_MS)
  }
  const attempt: Promise<RedisClient> = (async () => {
    const subscriber = client()
    await subscriber.connect()
    await subscriber.subscribe(CHANNEL, (raw) => {
      const { frame, userIds } = JSON.parse(String(raw)) as { frame: Frame; userIds: string[] }
      sendHere(userIds, frame)
    })
    const sender = client()
    await sender.connect()
    if (!live) {
      for (const one of clients) one.close()
      throw new Error("Redis dropped while the socket connected")
    }
    return sender
  })().catch((error) => {
    drop()
    throw error
  })
  publisher = attempt
  return attempt
}

// Sends a frame to every open socket of the members named.
export const publish = async (userIds: string[], frame: Frame) => {
  if (userIds.length === 0) return
  if (!env.KV_URL) return sendHere(userIds, frame)
  const sent = connect(env.KV_URL).then((client) =>
    client.publish(CHANNEL, JSON.stringify({ frame, userIds })),
  )
  sent.catch(() => {})
  await Promise.race([
    sent,
    Bun.sleep(FAN_OUT_MS).then(() => {
      throw new Error(`Redis took no fan-out in ${FAN_OUT_MS} ms`)
    }),
  ])
}
