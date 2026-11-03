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
    connect(env.KV_URL).sender.catch((error) =>
      console.error("[yard] socket subscribe failed", String(error)),
    )
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

// A command to a Redis that has dropped fails at once rather than queueing, and a connect or a fan-out waits 2 s at most, then drops the pair, so a post never hangs on a Redis that stopped answering (a client retrying a hung post would post twice); Bun's own reconnect is off, since it never sends SUBSCRIBE again.
const OPTIONS = { autoReconnect: false, connectionTimeout: 2000, enableOfflineQueue: false }
const FAN_OUT_MS = 2000
const RETRY_MS = 1000
const RETRY_MAX_MS = 30_000

type Pair = { drop: () => void; sender: Promise<RedisClient> }

// With KV_URL set, every instance subscribes to one Redis channel, so a post on one instance reaches a socket held by another; without it, the instance's own sockets alone.
let pair: Pair | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let backoff = RETRY_MS

// One subscriber and one sender per instance; when either drops, a connect fails partway or a fan-out passes its cap, both close, and the pair is built again on the next join or publish, or while a socket is open after a backoff from 1 s doubling to 30 s.
const connect = (url: string): Pair => {
  if (pair) return pair
  const clients: RedisClient[] = []
  let live = true
  const drop = () => {
    if (!live) return
    live = false
    clearTimeout(slow)
    if (pair === self) pair = null
    for (const one of clients) one.close()
    if (open.size > 0)
      retry ??= setTimeout(() => {
        retry = null
        if (open.size > 0)
          connect(url).sender.catch((error) =>
            console.error("[yard] socket resubscribe failed", String(error)),
          )
      }, backoff)
    backoff = Math.min(backoff * 2, RETRY_MAX_MS)
  }
  const client = (): RedisClient => {
    const one = new RedisClient(url, OPTIONS)
    one.onclose = drop
    clients.push(one)
    return one
  }
  const slow = setTimeout(drop, FAN_OUT_MS)
  const sender: Promise<RedisClient> = (async () => {
    const subscriber = client()
    await subscriber.connect()
    await subscriber.subscribe(CHANNEL, (raw) => {
      const { frame, userIds } = JSON.parse(String(raw)) as { frame: Frame; userIds: string[] }
      sendHere(userIds, frame)
    })
    const one = client()
    await one.connect()
    if (!live) {
      for (const each of clients) each.close()
      throw new Error("Redis dropped while the socket connected")
    }
    clearTimeout(slow)
    backoff = RETRY_MS
    return one
  })().catch((error) => {
    drop()
    throw error
  })
  const self: Pair = { drop, sender }
  pair = self
  return self
}

// Sends a frame to every open socket of the members named.
export const publish = async (userIds: string[], frame: Frame) => {
  if (userIds.length === 0) return
  if (!env.KV_URL) return sendHere(userIds, frame)
  const { drop, sender } = connect(env.KV_URL)
  const sent = sender.then((client) => client.publish(CHANNEL, JSON.stringify({ frame, userIds })))
  await new Promise<void>((resolve, reject) => {
    const cap = setTimeout(() => {
      drop()
      reject(new Error(`Redis took no fan-out in ${FAN_OUT_MS} ms`))
    }, FAN_OUT_MS)
    sent.then(
      () => {
        clearTimeout(cap)
        resolve()
      },
      (error) => {
        clearTimeout(cap)
        reject(error)
      },
    )
  })
}
