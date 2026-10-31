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

// With KV_URL set, the first join subscribes, so a socket hears posts from other instances before its own instance has posted.
export const join = (userId: string, socket: Socket) => {
  const set = open.get(userId) ?? new Set()
  set.add(socket)
  open.set(userId, set)
  if (env.KV_URL) connect(env.KV_URL).catch(() => {})
}

export const leave = (userId: string, socket: Socket) => {
  open.get(userId)?.delete(socket)
  if (open.get(userId)?.size === 0) open.delete(userId)
}

const sendHere = (userIds: string[], frame: Frame) => {
  const data = JSON.stringify(frame)
  for (const id of userIds) for (const socket of open.get(id) ?? []) socket.send(data)
}

// With KV_URL set, every instance subscribes to one Redis channel, so a post on one instance reaches a socket held by another; without it, the instance's own sockets alone, as one local process has.
// The publisher is kept only once the subscribe has succeeded, so an instance never publishes while it cannot deliver to its own sockets; a failed connect is tried again on the next join or publish.
let publisher: Promise<RedisClient> | null = null
const connect = (url: string) => {
  publisher ??= (async () => {
    const subscriber = new RedisClient(url)
    await subscriber.subscribe(CHANNEL, (raw) => {
      const { frame, userIds } = JSON.parse(String(raw)) as { frame: Frame; userIds: string[] }
      sendHere(userIds, frame)
    })
    return new RedisClient(url)
  })().catch((error) => {
    publisher = null
    throw error
  })
  return publisher
}

// Sends a frame to every open socket of the members named.
export const publish = async (userIds: string[], frame: Frame) => {
  if (userIds.length === 0) return
  if (env.KV_URL)
    await (await connect(env.KV_URL)).publish(CHANNEL, JSON.stringify({ frame, userIds }))
  else sendHere(userIds, frame)
}
