import { env } from "@packages/env/redis"
import { RedisClient } from "bun"

// A call that could not reach Redis: nothing answers at the URL, the connection dropped, or a reply took longer than CALL_MS. A caller falls back to what it did before Redis only on this, never on any other error.
export class RedisUnreachable extends Error {
  override name = "RedisUnreachable"
}

// A lock kept in Redis: its key holds `<token> <holder>` with a time to live, so a holder that dies stops renewing it and it lapses by itself.
export type LockStore = {
  close: () => void
  // Frees the lock only while it still holds `value`, so a holder whose lock lapsed and went to another never frees that one.
  free: (key: string, value: string) => Promise<boolean>
  // Pushes the lock's expiry out again only while it still holds `value`; false once it has lapsed.
  renew: (key: string, value: string, ttlMs: number) => Promise<boolean>
  // Takes the lock for `holder`: its value when it was free, else who holds it.
  take: (
    key: string,
    holder: string,
    ttlMs: number,
  ) => Promise<{ holder: string } | { value: string }>
}

const CALL_MS = 2000

const RENEW = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end`
const FREE = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`

// Who a lock's value names, the words after its token.
const holderOf = (value: unknown): string =>
  typeof value === "string" && value.includes(" ")
    ? value.slice(value.indexOf(" ") + 1)
    : "an unnamed holder"

const within = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new RedisUnreachable(`no reply in ${CALL_MS}ms`)), CALL_MS).unref(),
    ),
  ])

const dropped = (err: unknown): boolean => {
  const code = err instanceof Error && "code" in err ? String(err.code) : ""
  return (
    code.startsWith("ERR_REDIS_CONNECTION") ||
    /^E(CONNREFUSED|CONNRESET|HOSTUNREACH|NETUNREACH|TIMEDOUT)$/.test(code)
  )
}

// The lock store at `url` (REDIS_URL by default), or null when none is set. It connects on its first call, and a call that cannot reach Redis throws RedisUnreachable and connects afresh on the next.
export function lockStore(url: string | undefined = env.REDIS_URL): LockStore | null {
  if (!url) return null
  let client: RedisClient | null = null
  const call = async (command: string, args: string[]): Promise<unknown> => {
    try {
      if (!client) {
        client = new RedisClient(url, {
          autoReconnect: false,
          connectionTimeout: CALL_MS,
          enableOfflineQueue: false,
          maxRetries: 0,
        })
        await within(client.connect()).catch((err: unknown) => {
          throw err instanceof RedisUnreachable ? err : new RedisUnreachable(String(err))
        })
      }
      return await within(client.send(command, args))
    } catch (err) {
      if (!(err instanceof RedisUnreachable) && !dropped(err)) throw err
      client?.close()
      client = null
      throw err instanceof RedisUnreachable ? err : new RedisUnreachable(String(err))
    }
  }
  return {
    close: () => {
      client?.close()
      client = null
    },
    free: async (key, value) => (await call("EVAL", [FREE, "1", key, value])) === 1,
    renew: async (key, value, ttlMs) =>
      (await call("EVAL", [RENEW, "1", key, value, String(ttlMs)])) === 1,
    take: async (key, holder, ttlMs) => {
      const value = `${crypto.randomUUID()} ${holder}`
      if ((await call("SET", [key, value, "NX", "PX", String(ttlMs)])) === "OK") return { value }
      return { holder: holderOf(await call("GET", [key])) }
    },
  }
}
