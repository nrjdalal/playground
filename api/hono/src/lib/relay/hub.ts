import { env } from "@packages/env/api-hono"
import { z } from "zod"

import {
  RELAY_TIMEOUT_MS,
  type RelayRequest,
  relayRequestSchema,
  type RelayResponse,
  relayResponseSchema,
  type RelayStatus,
} from "@/lib/relay/protocol"
import { redisChannel } from "@/lib/yard/channel"

type MacSocket = { send: (data: string) => void }

type Waiting = {
  acked: boolean
  resolve: (answer: Forwarded) => void
  timers: ReturnType<typeof setTimeout>[]
  userId: string
}

// What a forward gives the route: this Mac's answer, or why there is none.
export type Forwarded = RelayResponse | { type: "offline" } | { type: "timeout" }

// How long an instance waits for the one holding the Mac's socket to say it took a request or a ping, before it reads the Mac as offline.
export const RELAY_ACK_MS = 2000

// What the instances tell each other over Redis, in transit alone: a request for the instance holding the Mac's socket, its ack, the Mac's answer, a status ping and its pong, and a socket gone.
const busSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("ack") }),
  z.object({ kind: z.literal("gone"), since: z.string(), userId: z.string() }),
  z.object({ id: z.string(), kind: z.literal("ping"), userId: z.string() }),
  z.object({ id: z.string(), kind: z.literal("pong") }),
  z.object({ kind: z.literal("request"), request: relayRequestSchema, userId: z.string() }),
  z.object({ kind: z.literal("response"), response: relayResponseSchema, userId: z.string() }),
])

type BusMessage = z.infer<typeof busSchema>

// How a hub reaches the other instances: listen subscribes, publish reaches every instance, this one's included.
export type Bus = { listen: () => void; publish: (data: string) => Promise<void> }

// The hosted side of the relay: the socket each owner's Mac holds on this instance, and the requests waiting on an answer, all in memory, so nothing a Mac answers is kept once its browser has it; with a bus, a request or a status read on another instance reaches the instance holding the socket.
export function createHub({
  ackMs = RELAY_ACK_MS,
  bus,
  id = () => crypto.randomUUID(),
  now = () => new Date(),
  timeoutMs = RELAY_TIMEOUT_MS,
}: {
  ackMs?: number
  bus?: Bus
  id?: () => string
  now?: () => Date
  timeoutMs?: number
} = {}) {
  const macs = new Map<string, MacSocket>()
  const offlineSince = new Map<string, string>()
  const waiting = new Map<string, Waiting>()
  const pings = new Map<string, () => void>()

  const settle = (key: string, answer: Forwarded) => {
    const found = waiting.get(key)
    if (!found) return
    waiting.delete(key)
    for (const timer of found.timers) clearTimeout(timer)
    found.resolve(answer)
  }

  const send = (message: BusMessage) =>
    bus
      ?.publish(JSON.stringify(message))
      .catch((error) => console.error("[relay] publish failed", String(error)))

  // Hands a request to the Mac's socket on this instance, and says whether one took it.
  const deliver = (userId: string, request: RelayRequest) => {
    const socket = macs.get(userId)
    if (!socket) return false
    try {
      socket.send(JSON.stringify(request))
      return true
    } catch {
      return false
    }
  }

  const goneHere = (userId: string, since: string) => {
    offlineSince.set(userId, since)
    for (const [key, found] of waiting)
      if (found.userId === userId) settle(key, { type: "offline" })
  }

  // Takes what another instance published.
  const receive = (raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const message = busSchema.safeParse(parsed)
    if (!message.success) return
    const data = message.data
    if (data.kind === "ack") {
      const found = waiting.get(data.id)
      if (found) found.acked = true
    } else if (data.kind === "gone") {
      if (!macs.has(data.userId)) goneHere(data.userId, data.since)
    } else if (data.kind === "ping") {
      if (macs.has(data.userId)) void send({ id: data.id, kind: "pong" })
    } else if (data.kind === "pong") pings.get(data.id)?.()
    else if (data.kind === "request") {
      if (deliver(data.userId, data.request)) void send({ id: data.request.id, kind: "ack" })
    } else if (waiting.get(data.response.id)?.userId === data.userId)
      settle(data.response.id, data.response)
  }

  return {
    // Holds the owner's Mac socket, a newer one replacing the old, and returns what lets it go; a socket that goes fails what still waits on it, on every instance.
    attach(userId: string, socket: MacSocket): () => void {
      macs.set(userId, socket)
      offlineSince.delete(userId)
      bus?.listen()
      return () => {
        if (macs.get(userId) !== socket) return
        macs.delete(userId)
        const since = now().toISOString()
        goneHere(userId, since)
        void send({ kind: "gone", since, userId })
      }
    },

    // Takes a frame the owner's Mac sent: an answer settles its own request, here or on the instance that waits on it, and anything else is dropped.
    answer(userId: string, raw: string): void {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return
      }
      const frame = relayResponseSchema.safeParse(parsed)
      if (!frame.success) return
      const found = waiting.get(frame.data.id)
      if (found) {
        if (found.userId === userId) settle(frame.data.id, frame.data)
      } else void send({ kind: "response", response: frame.data, userId })
    },

    // Sends one GET to the owner's Mac with a fresh id and time, through the instance holding its socket, and waits for its answer.
    forward(userId: string, login: string, path: string): Promise<Forwarded> {
      const request: RelayRequest = {
        at: now().toISOString(),
        id: id(),
        login,
        method: "GET",
        path,
        type: "request",
      }
      const here = macs.has(userId)
      if (!here && !bus) return Promise.resolve({ type: "offline" })
      return new Promise((resolve) => {
        const timers = [setTimeout(() => settle(request.id, { type: "timeout" }), timeoutMs)]
        const found: Waiting = { acked: here, resolve, timers, userId }
        waiting.set(request.id, found)
        if (here) {
          if (!deliver(userId, request)) settle(request.id, { type: "offline" })
          return
        }
        timers.push(
          setTimeout(() => {
            if (!found.acked) settle(request.id, { type: "offline" })
          }, ackMs),
        )
        void send({ kind: "request", request, userId })
      })
    },

    // Whether this instance still needs the bus: a socket held, or a request or a ping waiting.
    busy: () => macs.size > 0 || waiting.size > 0 || pings.size > 0,

    receive,

    // Whether the owner's Mac holds the relay on any instance, and since when it is offline when an instance saw it go.
    async status(userId: string): Promise<RelayStatus> {
      if (macs.has(userId)) return { online: true, since: null }
      const offline = () => ({ online: false, since: offlineSince.get(userId) ?? null })
      if (!bus) return offline()
      const ping = id()
      const online = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ackMs)
        pings.set(ping, () => {
          clearTimeout(timer)
          resolve(true)
        })
        void send({ id: ping, kind: "ping", userId })
      })
      pings.delete(ping)
      return online ? { online: true, since: null } : offline()
    },
  }
}

export type Hub = ReturnType<typeof createHub>

// The hosted API's one hub, on Redis when KV_URL is set, so every instance reaches the one holding the Mac's socket.
export const hub: Hub = (() => {
  if (!env.KV_URL) return createHub()
  let self: Hub | null = null
  const channel = redisChannel({
    name: "relay",
    onMessage: (raw) => self?.receive(raw),
    url: env.KV_URL,
    wanted: () => self?.busy() ?? false,
  })
  self = createHub({ bus: channel })
  return self
})()
