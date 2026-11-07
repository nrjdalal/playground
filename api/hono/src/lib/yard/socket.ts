import { env } from "@packages/env/api-hono"
import type { Message } from "@packages/message"

import { redisChannel } from "@/lib/yard/channel"

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
  channel?.listen()
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

// The key a delivery reads once by: a message frame's id with its status, so a publish whose first try landed and then reported a closed connection reaches a socket once, while a pending message's send or deny, the same id in a new status, still does.
export const deliveryKey = (raw: string): string | undefined => {
  try {
    const read = JSON.parse(raw) as { frame?: Frame }
    return read.frame?.type === "message"
      ? `${read.frame.message.id}:${read.frame.message.status ?? "sent"}`
      : undefined
  } catch {
    return undefined
  }
}

// With KV_URL set, every instance subscribes to one Redis channel, so a post on one instance reaches a socket held by another; without it, the instance's own sockets alone.
const channel = env.KV_URL
  ? redisChannel({
      id: deliveryKey,
      name: CHANNEL,
      onMessage: (raw) => {
        const { frame, userIds } = JSON.parse(raw) as { frame: Frame; userIds: string[] }
        sendHere(userIds, frame)
      },
      url: env.KV_URL,
      wanted: () => open.size > 0,
    })
  : null

// Sends a frame to every open socket of the members named.
export const publish = async (userIds: string[], frame: Frame) => {
  if (userIds.length === 0) return
  if (!channel) return sendHere(userIds, frame)
  await channel.publish(JSON.stringify({ frame, userIds }))
}
