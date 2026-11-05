import { RedisClient } from "bun"

// A command to a Redis that has dropped fails at once rather than queueing, and a connect or a fan-out waits 2 s at most, then drops the pair, so a post never hangs on a Redis that stopped answering (a client retrying a hung post would post twice); Bun's own reconnect is off, since it never sends SUBSCRIBE again.
const OPTIONS = { autoReconnect: false, connectionTimeout: 2000, enableOfflineQueue: false }
const FAN_OUT_MS = 2000
const RETRY_MS = 1000
const RETRY_MAX_MS = 30_000

type Pair = { drop: () => void; sender: Promise<RedisClient> }

// One Redis pub/sub channel every instance shares, so a message published on one instance reaches the listeners of all: one subscriber and one sender per instance; when either drops, a connect fails partway or a fan-out passes its cap, both close, and the pair is built again on the next listen or publish, or after a backoff from 1 s doubling to 30 s while wanted() holds.
export function redisChannel({
  name,
  onMessage,
  url,
  wanted,
}: {
  name: string
  onMessage: (raw: string) => void
  url: string
  wanted: () => boolean
}) {
  let pair: Pair | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let backoff = RETRY_MS

  const connect = (): Pair => {
    if (pair) return pair
    const clients: RedisClient[] = []
    let live = true
    const drop = () => {
      if (!live) return
      live = false
      clearTimeout(slow)
      if (pair === self) pair = null
      for (const one of clients) one.close()
      if (wanted())
        retry ??= setTimeout(() => {
          retry = null
          if (wanted())
            connect().sender.catch((error) =>
              console.error(`[${name}] resubscribe failed`, String(error)),
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
      await subscriber.subscribe(name, (raw) => onMessage(String(raw)))
      const one = client()
      await one.connect()
      if (!live) {
        for (const each of clients) each.close()
        throw new Error("Redis dropped while the channel connected")
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

  return {
    // Subscribes this instance, so it hears what every instance publishes.
    listen(): void {
      connect().sender.catch((error) => console.error(`[${name}] subscribe failed`, String(error)))
    },

    // Publishes one message to every instance's listener, this one's included, failing after 2 s.
    async publish(data: string): Promise<void> {
      const { drop, sender } = connect()
      const sent = sender.then((client) => client.publish(name, data))
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
    },
  }
}
