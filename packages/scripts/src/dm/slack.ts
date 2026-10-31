import { join } from "node:path"

import { writeAtomic } from "../write-atomic"

// The owner's DM, read and written as the owner: every reply is framed by these two lines, byte for byte, so a reader tells our posts from the owner's.
export const PLAYGROUND = "━━━━━━  PLAYGROUND  ━━━━━━"
export const USER = "━━━━━━━━  USER   ━━━━━━━━"

// The vault key whose token posts and reads as the owner.
export const TOKEN_KEY = "local.slack.channel_token"

export type Message = { subtype?: string; text?: string; ts: string; user?: string }
type Reply = { error?: string; messages?: Message[]; ok: boolean; ts?: string }
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
