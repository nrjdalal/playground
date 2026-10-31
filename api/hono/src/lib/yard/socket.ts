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

export const join = (userId: string, socket: Socket) => {
  const set = open.get(userId) ?? new Set()
  set.add(socket)
  open.set(userId, set)
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
let publisher: RedisClient | null = null
const connect = async () => {
  if (!env.KV_URL || publisher) return publisher
  publisher = new RedisClient(env.KV_URL)
  const subscriber = new RedisClient(env.KV_URL)
  await subscriber.subscribe(CHANNEL, (raw) => {
    const { frame, userIds } = JSON.parse(String(raw)) as { frame: Frame; userIds: string[] }
    sendHere(userIds, frame)
  })
  return publisher
}

// Sends a frame to every open socket of the members named.
export const publish = async (userIds: string[], frame: Frame) => {
  if (userIds.length === 0) return
  const redis = await connect()
  if (redis) await redis.publish(CHANNEL, JSON.stringify({ frame, userIds }))
  else sendHere(userIds, frame)
}
