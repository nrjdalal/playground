import { mkdir, rename, stat } from "node:fs/promises"
import { join } from "node:path"

import { makeScratch, removeScratch } from "@packages/safe-delete"

import { writeAtomic } from "../write-atomic"

// The owner's DM, read and written as the owner: every reply is framed by these two lines, byte for byte, so a reader tells our posts from the owner's.
export const PLAYGROUND = "━━━━━━  PLAYGROUND  ━━━━━━"
export const USER = "━━━━━━━━  USER   ━━━━━━━━"

// The vault key whose token posts and reads as the owner.
export const TOKEN_KEY = "local.slack.channel_token"

export type Message = { subtype?: string; text?: string; ts: string; user?: string }
type Reply = {
  error?: string
  file_id?: string
  messages?: Message[]
  ok: boolean
  ts?: string
  upload_url?: string
}
export type Slack = (method: string, params: Record<string, string>) => Promise<Reply>

export const slackOf =
  (token: string): Slack =>
  async (method, params) => {
    const res = await fetch(`https://slack.com/api/${method}`, {
      body: new URLSearchParams(params),
      headers: { Authorization: `Bearer ${token}` },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    })
    return (await res.json()) as Reply
  }

export const call = async (slack: Slack, method: string, params: Record<string, string>) => {
  const reply = await slack(method, params)
  if (!reply.ok) throw new Error(`${method}: ${reply.error}`)
  return reply
}

// The DM's messages oldest first; Slack's history comes newest first.
export const history = async (slack: Slack, params: Record<string, string>) =>
  [...((await call(slack, "conversations.history", params)).messages ?? [])].reverse()

// Every ts dm send posts, kept in the data folder: every post is the owner's, so a reader tells ours by this record, never by where a post sits in the frame.
const SENT = "dm-sent.json"
const KEEP = 1000
export const readSent = async (dir: string): Promise<Set<string>> =>
  new Set(
    await Bun.file(join(dir, SENT))
      .json()
      .then((v: unknown) => (Array.isArray(v) ? v.map(String) : []))
      .catch(() => []),
  )
export const recordSent = async (dir: string, ts: string) =>
  writeAtomic(join(dir, SENT), JSON.stringify([...(await readSent(dir)), ts].slice(-KEEP)))

// One dm send at a time per data folder, so two never interleave their frames or lose a record: a lock folder held for the whole send, a scratch folder holding the send's token renamed into place, so it always holds makeScratch's marker. A send makes at most nine Slack calls of up to 30 s each, so a lock older than LOCK_STALE_MS is a dead send's and is taken over; each holder frees the lock only while the token is still its own, so a taken-over send never frees its successor's.
const LOCK_STALE_MS = 600_000
export async function locked<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const path = join(dir, "dm-send.lock")
  const owner = join(path, "owner")
  const token = crypto.randomUUID()
  const drop = (at: string) => {
    const refused = removeScratch(at, dir)
    if (refused) console.error(`dm send: ${refused}`)
  }
  await mkdir(dir, { recursive: true })
  const until = Date.now() + LOCK_STALE_MS + 30_000
  for (;;) {
    const mine = makeScratch("dm-send.lock.", dir)
    await Bun.write(join(mine, "owner"), token)
    try {
      await rename(mine, path)
      break
    } catch (error) {
      drop(mine)
      const code = (error as { code?: string }).code
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error
      const since = await stat(path).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      )
      // moved aside before its removal, so a lock another waiter has just taken is never the one removed
      if (since > LOCK_STALE_MS) {
        const aside = `${path}.stale-${token}`
        if (
          await rename(path, aside).then(
            () => true,
            () => false,
          )
        )
          drop(aside)
      } else if (Date.now() > until) throw new Error("another dm send holds its lock")
      else await Bun.sleep(100)
    }
  }
  try {
    return await fn()
  } finally {
    const held = await Bun.file(owner)
      .text()
      .catch(() => "")
    // moved aside before its removal, so the lock is never an empty folder a waiter's rename could land on
    const aside = `${path}.free-${token}`
    if (
      held === token &&
      (await rename(path, aside).then(
        () => true,
        () => false,
      ))
    )
      drop(aside)
  }
}

// Pure, over messages oldest first: the owner's own messages, each one dm send did not post and neither frame line.
export const ownerMessages = (messages: Message[], owner: string, sent: Set<string>) =>
  messages.filter(
    (m) =>
      m.user === owner && !m.subtype && !sent.has(m.ts) && m.text !== PLAYGROUND && m.text !== USER,
  )

// The vault skill's run of a script with the token in its environment alone, as channel-watch runs its own.
export const underVault = (vault: string, script: string, args: string[]): string[] => [
  Bun.which("uv") ?? "uv",
  "run",
  "--python",
  "3.13",
  join(vault, "scripts", "vault.py"),
  "run",
  "-e",
  `SLACK_TOKEN=${TOKEN_KEY}`,
  "--",
  process.execPath,
  script,
  ...args,
]
