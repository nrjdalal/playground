import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { dataDirOf } from "@packages/env/data-dir"
import { channelSettings, readPolicy } from "@packages/settings"

import { sendAs } from "../ops-job/job"
import { writeAtomic } from "../write-atomic"

// The channel watch the runner's crons kept: each new post goes to the dispatcher as one line, and the full pass also relays edits.
const START = 1791877986
const SEEN = "channel-seen.txt"
const RELAYED = "channel-relayed.txt"
const SIGNED = /^(Question|Idea|Finding|Reply|Ack):/

type Post = {
  bot_id?: string
  permalink?: string
  text?: string
  thread_ts?: string
  ts: string
  user?: string
  username?: string
}
type Reply = {
  error?: string
  messages?: Post[] | { matches: Post[] }
  ok: boolean
  user?: { name: string }
}
export type Slack = (method: string, params: Record<string, string>) => Promise<Reply>
type Io = {
  channel: string
  dir: string
  now: number
  send: (text: string) => Promise<unknown>
  skip: string
  slack: Slack
}

export const slackOf =
  (token: string): Slack =>
  async (method, params) => {
    const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    return (await res.json()) as Reply
  }

// The old runner's own tr and shasum, run in the locale its shell had, so a hash it wrote still matches.
export const hashOf = async (text: string) => {
  const proc = Bun.spawn(
    ["bash", "-c", "tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]' | shasum | cut -c1-10"],
    {
      env: { ...process.env, LC_ALL: "en_US.UTF-8" },
      stdin: new Blob([text.replace(/<((?:https?|mailto):[^|>]*)\|[^>]*>/g, "$1")]),
      stdout: "pipe",
    },
  )
  const out = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || !/^[0-9a-f]{10}$/.test(out))
    throw new Error(`hash pipeline: ${out}`)
  return out
}

const flat = (text: string) => text.replaceAll("\n", " ")

export const lineOf = ({ name, text, thread }: { name: string; text: string; thread: string }) =>
  `${thread} · ${name} · ${SIGNED.test(text) || /_?Sent via Playground_?$/.test(text.trimEnd()) ? "Playground" : "person"} · ${flat(text)}`

const call = async (slack: Slack, method: string, params: Record<string, string>) => {
  const reply = await slack(method, params)
  if (!reply.ok) throw new Error(`${method}: ${reply.error}`)
  return reply
}

export async function watch(mode: "full" | "quick", { channel, dir, now, send, skip, slack }: Io) {
  const seenPath = join(dir, SEEN)
  const relayedPath = join(dir, RELAYED)
  await mkdir(dir, { recursive: true })
  await appendFile(relayedPath, "")
  const seen = (
    await Bun.file(seenPath)
      .text()
      .catch(() => "")
  ).trim()
  const floor = mode === "full" ? now - 7200 : Math.max(Math.floor(Number(seen)) - 300, now - 300)
  const history = await call(slack, "conversations.history", {
    channel,
    limit: "100",
    oldest: mode === "full" || !seen ? String(floor) : seen,
  })
  const search = await call(slack, "search.messages", {
    count: mode === "full" ? "100" : "20",
    query: `in:<#${channel}>`,
    sort: "timestamp",
    sort_dir: "desc",
  })
  const posts = new Map<string, Post>()
  for (const m of Array.isArray(search.messages) ? [] : (search.messages?.matches ?? []))
    if (Number(m.ts) > floor) posts.set(m.ts, m)
  for (const m of Array.isArray(history.messages) ? history.messages : [])
    posts.set(m.ts, { ...posts.get(m.ts), ...m })
  const read = [...posts.values()].sort((a, b) => Number(a.ts) - Number(b.ts))

  const names = new Map<string, string>()
  const nameOf = async (m: Post) => {
    if (m.username) return m.username
    if (!m.user) return m.bot_id ?? "unknown"
    if (!names.has(m.user))
      names.set(m.user, (await call(slack, "users.info", { user: m.user })).user?.name ?? m.user)
    return names.get(m.user)!
  }

  const relayed = (await Bun.file(relayedPath).text()).split("\n").filter(Boolean)
  const done = new Set(relayed.map((line) => line.split(" ")[0]))
  for (const m of read) {
    if (Number(m.ts) <= Math.max(floor, START) || m.user === skip || done.has(m.ts)) continue
    const text = m.text ?? ""
    const thread = m.permalink?.match(/thread_ts=([\d.]+)/)?.[1] ?? m.thread_ts ?? m.ts
    await send(lineOf({ name: await nameOf(m), text, thread }))
    await appendFile(relayedPath, mode === "full" ? `${m.ts} ${await hashOf(text)}\n` : `${m.ts}\n`)
  }

  if (mode === "full") {
    const kept: string[] = []
    for (const line of (await Bun.file(relayedPath).text()).split("\n").filter(Boolean)) {
      const [ts = "", hash] = line.split(" ")
      if (Number(ts) < now - 3 * 86400) continue
      const post = Number(ts) > floor ? posts.get(ts) : undefined
      if (!post) {
        kept.push(line)
        continue
      }
      const fresh = await hashOf(post.text ?? "")
      if (hash && hash !== fresh)
        await send(`Edited: ${ts} · ${await nameOf(post)} · ${flat(post.text ?? "")}`)
      kept.push(`${ts} ${fresh}`)
    }
    await writeAtomic(relayedPath, kept.map((line) => `${line}\n`).join(""))
  }

  const newest = read.at(-1)?.ts
  if (newest && Number(newest) > Number(seen || 0)) await writeAtomic(seenPath, `${newest}\n`)
}

if (import.meta.main) {
  const mode = process.argv[2]
  if (mode !== "full" && mode !== "quick") throw new Error("usage: watch.ts quick|full")
  const token = process.env.SLACK_TOKEN
  if (!token) throw new Error("SLACK_TOKEN is unset: run it through vault.py run -e")
  const dir = dataDirOf(process.env)
  const policy = await readPolicy(dir)
  if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
  const channel = channelSettings.get(policy.settings, "channel.slackId")
  if (!channel) {
    console.log("channel.slackId is unset, so there is no channel to watch")
    process.exit(0)
  }
  const send = sendAs("channel-watch", true)
  await watch(mode, {
    channel,
    dir,
    now: Math.floor(Date.now() / 1000),
    send: (text) => send("dispatcher", text),
    skip: channelSettings.get(policy.settings, "channel.skipUser"),
    slack: slackOf(token),
  })
}
