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

const sendHere = (userIds: string[], frame: Frame) => {
  const data = JSON.stringify(frame)
  for (const id of userIds) for (const socket of open.get(id) ?? []) socket.send(data)
}

// A command to a Redis that has dropped fails at once rather than queueing, and a fan-out waits 2 s at most for one that never connected, so a post never hangs on it (a client retrying a hung post would post twice).
const OPTIONS = { connectionTimeout: 2000, enableOfflineQueue: false }
const FAN_OUT_MS = 2000

// With KV_URL set, every instance subscribes to one Redis channel, so a post on one instance reaches a socket held by another, and a failed connect is tried again on the next join or publish; without it, the instance's own sockets alone.
let publisher: Promise<RedisClient> | null = null
const connect = (url: string) => {
  publisher ??= (async () => {
    const subscriber = new RedisClient(url, OPTIONS)
    await subscriber.connect()
    await subscriber.subscribe(CHANNEL, (raw) => {
      const { frame, userIds } = JSON.parse(String(raw)) as { frame: Frame; userIds: string[] }
      sendHere(userIds, frame)
    })
    const client = new RedisClient(url, OPTIONS)
    await client.connect()
    return client
  })().catch((error) => {
    publisher = null
    throw error
  })
  return publisher
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
