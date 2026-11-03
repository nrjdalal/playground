import { mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"

import { seatOf } from "@packages/config/kinds"
import {
  parseSessionState,
  type SessionState,
  type SessionStateName,
  sessionStateDir,
  stateNow,
} from "@packages/config/session-state"
import { configDirOf, dataDirOf } from "@packages/env/data-dir"
import { readPolicy, slackSettings } from "@packages/settings"

import { history, ownerMessages, PLAYGROUND, readSent, type Slack, slackOf } from "../dm/slack"
import { sendAs } from "../ops-job/job"
import { liveSessions, newestTurnAt, transcriptTail } from "../ops-session-resume/resume"
import { writeAtomic } from "../write-atomic"

const STATE = "dm-watch.json"
// How long an owner message waits for our reply, and a dispatcher's stuck or failed record stands, before the assistant hears it too.
export const WAIT_S = 180
// How far back each pass reads; a first pass hands on only the last 2 minutes, so a new install replays no history.
const WINDOW_S = 3600
const FIRST_S = 120

// bravo marks a message handed to the backup, a name kept from when the second dispatcher was it, so a file written before reads the same.
type Handed = { at: number; bravo?: true; text: string; ts: string }
type State = { handed: Handed[]; stuckTold?: string }
export type Stuck = { at: string; state: string } | null
type Io = {
  assistant: () => Promise<string | undefined>
  busy: () => Promise<boolean>
  channel: string
  dir: string
  log: (line: string) => void
  now: number
  owner: string
  send: (to: string, text: string) => Promise<unknown>
  slack: Slack
  stuck: () => Promise<Stuck>
  tellOps: (text: string) => Promise<unknown>
}

const reply = "Answer through playground dm send <file>."

// One pass: each new owner message to the dispatcher in full; one with no reply (a post of ours after it, other than the lone PLAYGROUND line a mid-send repair leaves) in 3 minutes while the dispatcher is not mid-turn (busy), or any while it has read stuck or failed for 3 minutes, to the session in the assistant seat as well (else logged once as kept with the dispatcher), and Ops told of the stuck dispatcher once per record.
export async function watch(io: Io) {
  const { assistant, busy, channel, dir, log, now, owner, send, slack, stuck, tellOps } = io
  const path = join(dir, STATE)
  await mkdir(dir, { recursive: true })
  const state: State = await Bun.file(path)
    .json()
    .catch(() => ({ handed: [] }))
  const first = !(await Bun.file(path).exists())
  const oldest = now - (first ? FIRST_S : WINDOW_S)
  const read = await history(slack, { channel, limit: "200", oldest: String(oldest) })
  const known = new Set(state.handed.map((h) => h.ts))
  const sent = await readSent(dir)
  for (const m of ownerMessages(read, owner, sent)) {
    if (known.has(m.ts)) continue
    await send("dispatcher", `The owner's DM at ${m.ts} reads: ${m.text ?? ""}\n${reply}`)
    state.handed.push({ at: now, text: m.text ?? "", ts: m.ts })
  }
  const blocked = await stuck()
  const replied = (ts: string) =>
    read.some((m) => sent.has(m.ts) && m.text !== PLAYGROUND && Number(m.ts) > Number(ts))
  const waiting = state.handed.filter((h) => !h.bravo && !replied(h.ts))
  const working = !blocked && waiting.length > 0 && (await busy())
  const due = waiting.filter((h) => blocked || (now - h.at >= WAIT_S && !working))
  const to = due.length > 0 ? await assistant() : undefined
  for (const h of due) {
    h.bravo = true
    if (!to) {
      log(
        `no live session holds the assistant seat, so the owner's DM at ${h.ts} stays with the dispatcher alone`,
      )
      continue
    }
    const why = blocked
      ? `the dispatcher has read ${blocked.state} since ${blocked.at}`
      : `no reply has landed in ${WAIT_S / 60} minutes`
    await send(to, `The owner's DM at ${h.ts}, handed on since ${why}: ${h.text}\n${reply}`)
  }
  if (blocked && due.length > 0 && state.stuckTold !== blocked.at) {
    const after = to
      ? `go to ${to} too`
      : "have no one else to go to, since no live session holds the assistant seat"
    await tellOps(
      `dispatcher has read ${blocked.state} since ${blocked.at}, so the owner's DM messages ${after}; unstick dispatcher.`,
    )
    state.stuckTold = blocked.at
  }
  state.handed = state.handed.filter((h) => Number(h.ts) >= now - WINDOW_S)
  await writeAtomic(path, JSON.stringify(state))
}

// The session in the assistant seat, by the roster as roster.ts who assistant reads it; undefined while none holds it or the roster does not read.
export async function assistantOf(data: string): Promise<string | undefined> {
  const roster = await Bun.file(join(data, "roster.json"))
    .json()
    .catch(() => null)
  return seatOf(roster?.agents, "assistant")
}

// The session-state record of each live session under the name, with the state stateNow() reads it as, as ops-session-resume reads it, so a newer turn ends a stuck one.
async function recordsOf(name: string, data: string, configDir: string) {
  const live = await liveSessions(configDir)
  const dir = sessionStateDir(data)
  const files = new Set(await readdir(dir).catch(() => [] as string[]))
  const found: { record: SessionState; state: SessionStateName | null }[] = []
  for (const [id, session] of live) {
    if (session.name !== name || !files.has(`${id}.json`)) continue
    const record = parseSessionState(await Bun.file(join(dir, `${id}.json`)).text())
    if (record)
      found.push({
        record,
        state: stateNow(record, newestTurnAt(await transcriptTail(configDir, id))),
      })
  }
  return found
}

// The dispatcher's record when it has read stuck or failed for over 3 minutes.
export async function stuckOf(
  name: string,
  data: string,
  configDir: string,
  now: number,
): Promise<Stuck> {
  for (const { record, state } of await recordsOf(name, data, configDir))
    if ((state === "stuck" || state === "failed") && now - Date.parse(record.at) / 1000 > WAIT_S)
      return { at: record.at, state: record.state }
  return null
}

// Whether the dispatcher is mid-turn: a working record written in the last 3 minutes, since each tool call rewrites it.
export async function busyOf(
  name: string,
  data: string,
  configDir: string,
  now: number,
): Promise<boolean> {
  return (await recordsOf(name, data, configDir)).some(
    ({ record, state }) => state === "working" && now - Date.parse(record.at) / 1000 <= WAIT_S,
  )
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
    assistant: () => assistantOf(dir),
    busy: () => busyOf("dispatcher", dir, configDirOf(process.env), now),
    channel,
    dir,
    log: (line) => console.log(line),
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
