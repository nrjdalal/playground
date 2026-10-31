import { mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"

import { parseSessionState, sessionStateDir } from "@packages/config/session-state"
import { configDirOf, dataDirOf } from "@packages/env/data-dir"
import { readPolicy, slackSettings } from "@packages/settings"

import { history, ownerMessages, PLAYGROUND, type Slack, slackOf } from "../dm/slack"
import { sendAs } from "../ops-job/job"
import { liveSessions } from "../ops-session-resume/resume"
import { writeAtomic } from "../write-atomic"

const STATE = "dm-watch.json"
// How long an owner message waits for our reply, and a dispatcher's stuck or failed record stands, before Bravo hears it too.
export const WAIT_S = 180
// How far back each pass reads; a first pass hands on only the last 2 minutes, so a new install replays no history.
const WINDOW_S = 3600
const FIRST_S = 120

type Handed = { at: number; bravo?: true; text: string; ts: string }
type State = { handed: Handed[]; stuckTold?: string }
export type Stuck = { at: string; state: string } | null
type Io = {
  channel: string
  dir: string
  now: number
  owner: string
  send: (to: string, text: string) => Promise<unknown>
  slack: Slack
  stuck: () => Promise<Stuck>
  tellOps: (text: string) => Promise<unknown>
}

const reply = "Answer through playground dm send <file>."

// One pass: each new owner message to the dispatcher in full; one with no reply (our PLAYGROUND line after it) in 3 minutes, or any while the dispatcher has read stuck or failed for 3 minutes, to Bravo as well, and Ops told of the stuck dispatcher once per record.
export async function watch({ channel, dir, now, owner, send, slack, stuck, tellOps }: Io) {
  const path = join(dir, STATE)
  await mkdir(dir, { recursive: true })
  const state: State = await Bun.file(path)
    .json()
    .catch(() => ({ handed: [] }))
  const first = !(await Bun.file(path).exists())
  const oldest = now - (first ? FIRST_S : WINDOW_S)
  const read = await history(slack, { channel, limit: "200", oldest: String(oldest) })
  const known = new Set(state.handed.map((h) => h.ts))
  for (const m of ownerMessages(read, owner)) {
    if (known.has(m.ts)) continue
    await send("dispatcher", `The owner wrote in their DM at ${m.ts}: ${m.text ?? ""}\n${reply}`)
    state.handed.push({ at: now, text: m.text ?? "", ts: m.ts })
  }
  const blocked = await stuck()
  const replied = (ts: string) =>
    read.some((m) => m.user === owner && m.text === PLAYGROUND && Number(m.ts) > Number(ts))
  let toBravo = false
  for (const h of state.handed) {
    if (h.bravo || replied(h.ts) || (now - h.at < WAIT_S && !blocked)) continue
    const why = blocked
      ? `the dispatcher has read ${blocked.state} since ${blocked.at}`
      : `no reply has landed in ${WAIT_S / 60} minutes`
    await send(
      "dispatcher-2",
      `The owner wrote in their DM at ${h.ts}, and ${why}: ${h.text}\n${reply}`,
    )
    h.bravo = true
    toBravo = true
  }
  if (blocked && toBravo && state.stuckTold !== blocked.at) {
    await tellOps(
      `dispatcher has read ${blocked.state} since ${blocked.at}, so the owner's DM messages go to dispatcher-2 too; unstick dispatcher.`,
    )
    state.stuckTold = blocked.at
  }
  state.handed = state.handed.filter((h) => Number(h.ts) >= now - WINDOW_S)
  await writeAtomic(path, JSON.stringify(state))
}

// The dispatcher's record when it has read stuck or failed for over 3 minutes, by the session-state file of each live session under its name.
export async function stuckOf(
  name: string,
  data: string,
  configDir: string,
  now: number,
): Promise<Stuck> {
  const live = await liveSessions(configDir)
  const dir = sessionStateDir(data)
  const files = new Set(await readdir(dir).catch(() => [] as string[]))
  for (const [id, session] of live) {
    if (session.name !== name || !files.has(`${id}.json`)) continue
    const record = parseSessionState(await Bun.file(join(dir, `${id}.json`)).text())
    if (!record || (record.state !== "stuck" && record.state !== "failed")) continue
    if (now - Date.parse(record.at) / 1000 > WAIT_S) return { at: record.at, state: record.state }
  }
  return null
}

// one pass, no retry: its errors as one plain line, which the beat's failure alert reads
const main = async () => {
  const token = process.env.SLACK_TOKEN
  if (!token) throw new Error("SLACK_TOKEN is unset: run it through vault.py run -e")
  const dir = dataDirOf(process.env)
  const policy = await readPolicy(dir)
  if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
  const channel = slackSettings.get(policy.settings, "slack.dmChannel")
  const owner = slackSettings.get(policy.settings, "slack.dmOwner")
  const now = Math.floor(Date.now() / 1000)
  const send = sendAs("dm-watch", true)
  await watch({
    channel,
    dir,
    now,
    owner,
    send,
    slack: slackOf(token),
    stuck: () => stuckOf("dispatcher", dir, configDirOf(process.env), now),
    tellOps: (text) => sendAs("unstick", true)("ops", text),
  })
}

if (import.meta.main)
  await main().catch((error: Error) => {
    console.error(`error: ${error.message}`)
    process.exit(1)
  })
