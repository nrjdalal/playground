import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLAYGROUND, recordSent, USER } from "../../../../../packages/scripts/src/dm/slack"
import {
  assistantOf,
  busyOf,
  type Stuck,
  stuckOf,
  watch,
} from "../../../../../packages/scripts/src/ops-dm-watch/watch"
import { DM, fakeDm, OWNER } from "../dm/fake-dm"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "dm-watch-"))
  dirs.push(dir)
  return dir
}

const ASSISTANT = "k3m9px-worker"

// One watch over a fake DM, its passes at the times given, recording every line it sends and logs; the assistant seat is ASSISTANT's unless seat says otherwise.
const harness = (
  dm: ReturnType<typeof fakeDm>,
  stuck: Stuck = null,
  working = false,
  seat: string | null = ASSISTANT,
) => {
  const dir = scratch()
  const sent: { text: string; to: string }[] = []
  const ops: string[] = []
  const logs: string[] = []
  let blocked = stuck
  let busy = working
  const pass = (now: number) =>
    watch({
      channel: DM,
      dir,
      log: (line) => logs.push(line),
      now,
      owner: OWNER,
      assistant: async () => seat ?? undefined,
      busy: async () => busy,
      send: async (to, text) => sent.push({ text, to }),
      slack: dm.slack,
      stuck: async () => blocked,
      tellOps: async (text) => ops.push(text),
    })
  const ours = async (text: string) => recordSent(dir, dm.add(text).ts)
  return {
    logs,
    ops,
    ours,
    pass,
    sent,
    setBusy: (b: boolean) => (busy = b),
    setStuck: (s: Stuck) => (blocked = s),
  }
}

describe("the DM watch", () => {
  test("hands each new owner message to the dispatcher in full, once, and never our own framed reply", async () => {
    const dm = fakeDm([{ text: "line one\nline two", ts: "1000.000100", user: OWNER }])
    const w = harness(dm)
    await w.pass(1010)
    await w.pass(1070)
    await w.ours(PLAYGROUND)
    await w.ours("our answer")
    await w.ours(USER)
    dm.add("thanks")
    await w.pass(1130)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", "dispatcher"])
    expect(w.sent[0]!.text).toContain("line one\nline two")
    expect(w.sent[1]!.text).toContain("thanks")
    expect(w.sent.some((s) => s.text.includes("our answer"))).toBe(false)
  })

  test("a message with no reply in 3 minutes goes to the assistant as well, once; one answered in time does not", async () => {
    const dm = fakeDm([{ text: "anyone there?", ts: "1000.000100", user: OWNER }])
    const w = harness(dm)
    await w.pass(1010)
    await w.pass(1150)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher"])
    await w.pass(1191)
    await w.pass(1251)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", ASSISTANT])
    expect(w.sent[1]!.text).toContain("anyone there?")

    const answered = fakeDm([{ text: "quick one", ts: "1000.000100", user: OWNER }])
    const a = harness(answered)
    await a.pass(1010)
    await a.ours("our answer")
    await a.pass(1250)
    expect(a.sent.map((s) => s.to)).toEqual(["dispatcher"])
  })

  // #779: a busy dispatcher's reply waits behind its turn, so 3 minutes of silence alone escalated a healthy busy spell
  test("a message with no reply in 3 minutes waits while the dispatcher works on a fresh record, and goes to the assistant once it stops", async () => {
    const dm = fakeDm([{ text: "busy?", ts: "1000.000100", user: OWNER }])
    const w = harness(dm, null, true)
    await w.pass(1010)
    await w.pass(1251)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher"])
    w.setBusy(false)
    await w.pass(1311)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", ASSISTANT])
  })

  test("with no session in the assistant seat, an unanswered message stays with the dispatcher alone, and the log says so once", async () => {
    const dm = fakeDm([{ text: "hello?", ts: "1000.000100", user: OWNER }])
    const w = harness(dm, null, false, null)
    await w.pass(1010)
    await w.pass(1191)
    await w.pass(1251)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher"])
    expect(w.logs).toEqual([
      "no live session holds the assistant seat, so the owner's DM at 1000.000100 stays with the dispatcher alone",
    ])
  })

  test("the lone PLAYGROUND line a mid-send repair leaves is no reply, so the owner's message still goes to the assistant", async () => {
    const dm = fakeDm([{ text: "status?", ts: "1000.000100", user: OWNER }])
    const w = harness(dm)
    await w.ours(PLAYGROUND)
    await w.ours(`the body\n${USER}`)
    dm.add("wait, one more thing")
    await w.ours(PLAYGROUND)
    await w.pass(1010)
    await w.pass(1250)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", "dispatcher", ASSISTANT])
    expect(w.sent[2]!.text).toContain("wait, one more thing")
  })

  test("while the dispatcher has read stuck for 3 minutes, a new message goes to the assistant at once and Ops hears it once", async () => {
    const dm = fakeDm([{ text: "help", ts: "1000.000100", user: OWNER }])
    const w = harness(dm, { at: "2026-10-31T06:00:00.000Z", state: "stuck" })
    await w.pass(1010)
    dm.add("still there?")
    await w.pass(1070)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", ASSISTANT, "dispatcher", ASSISTANT])
    expect(w.ops).toHaveLength(1)
    expect(w.ops[0]).toContain("dispatcher has read stuck since 2026-10-31T06:00:00.000Z")
  })

  test("a first pass hands on only the last 2 minutes, so a new install replays no history", async () => {
    const dm = fakeDm([
      { text: "old", ts: "1000.000100", user: OWNER },
      { text: "new", ts: "1900.000100", user: OWNER },
    ])
    const w = harness(dm)
    await w.pass(2000)
    expect(w.sent.map((s) => s.text.includes("new"))).toEqual([true])
  })
})

describe("stuckOf", () => {
  test("names the dispatcher's stuck or failed record once it has stood over 3 minutes, and nothing for another session or a fresh one", async () => {
    const data = scratch()
    const config = scratch()
    mkdirSync(join(config, "sessions"))
    mkdirSync(join(data, "session-state"))
    const live = (id: string, name: string) =>
      writeFileSync(
        join(config, "sessions", `${id}.json`),
        JSON.stringify({ name, pid: process.pid, sessionId: id }),
      )
    const state = (id: string, s: string, at: string) =>
      writeFileSync(
        join(data, "session-state", `${id}.json`),
        JSON.stringify({ at, event: "Notification", sessionId: id, state: s }),
      )
    live("a", "dispatcher")
    live("b", "builder")
    state("b", "stuck", "2026-10-31T06:00:00.000Z")
    const now = Date.parse("2026-10-31T06:10:00Z") / 1000
    expect(await stuckOf("dispatcher", data, config, now)).toBeNull()
    state("a", "stuck", "2026-10-31T06:08:00.000Z")
    expect(await stuckOf("dispatcher", data, config, now)).toBeNull()
    state("a", "failed", "2026-10-31T06:06:00.000Z")
    expect(await stuckOf("dispatcher", data, config, now)).toEqual({
      at: "2026-10-31T06:06:00.000Z",
      state: "failed",
    })
  })

  test("a stuck record its transcript has a newer turn after no longer stands, as stateNow() reads it", async () => {
    const data = scratch()
    const config = scratch()
    mkdirSync(join(config, "sessions"))
    mkdirSync(join(config, "projects", "a-project"), { recursive: true })
    mkdirSync(join(data, "session-state"))
    writeFileSync(
      join(config, "sessions", "a.json"),
      JSON.stringify({ name: "dispatcher", pid: process.pid, sessionId: "a" }),
    )
    writeFileSync(
      join(data, "session-state", "a.json"),
      JSON.stringify({
        at: "2026-10-31T06:00:00.000Z",
        event: "Notification",
        sessionId: "a",
        state: "stuck",
      }),
    )
    const now = Date.parse("2026-10-31T06:10:00Z") / 1000
    const turn = (at: string) =>
      writeFileSync(
        join(config, "projects", "a-project", "a.jsonl"),
        `${JSON.stringify({ timestamp: at, type: "assistant" })}\n`,
      )
    turn("2026-10-31T05:59:00.000Z")
    expect(await stuckOf("dispatcher", data, config, now)).toEqual({
      at: "2026-10-31T06:00:00.000Z",
      state: "stuck",
    })
    turn("2026-10-31T06:01:00.000Z")
    expect(await stuckOf("dispatcher", data, config, now)).toBeNull()
  })
})

describe("assistantOf", () => {
  test("names the live session the roster gives the assistant kind, and none while no live one holds it", async () => {
    const data = scratch()
    expect(await assistantOf(data)).toBeUndefined()
    const roster = (agents: object[]) =>
      writeFileSync(join(data, "roster.json"), JSON.stringify({ agents }))
    roster([{ kind: "assistant", name: ASSISTANT, role: "manager", status: "ended", task: "t" }])
    expect(await assistantOf(data)).toBeUndefined()
    roster([{ kind: "assistant", name: ASSISTANT, role: "manager", status: "working", task: "t" }])
    expect(await assistantOf(data)).toBe(ASSISTANT)
  })
})

describe("busyOf", () => {
  test("reads the dispatcher as busy only while a live session's working record is under 3 minutes old", async () => {
    const data = scratch()
    const config = scratch()
    mkdirSync(join(config, "sessions"))
    mkdirSync(join(data, "session-state"))
    const live = (id: string, name: string) =>
      writeFileSync(
        join(config, "sessions", `${id}.json`),
        JSON.stringify({ name, pid: process.pid, sessionId: id }),
      )
    const state = (id: string, s: string, at: string) =>
      writeFileSync(
        join(data, "session-state", `${id}.json`),
        JSON.stringify({ at, event: "PostToolUse", sessionId: id, state: s }),
      )
    const now = Date.parse("2026-10-31T06:10:00Z") / 1000
    live("a", "dispatcher")
    live("b", "builder")
    state("b", "working", "2026-10-31T06:09:00.000Z")
    expect(await busyOf("dispatcher", data, config, now)).toBe(false)
    state("a", "working", "2026-10-31T06:06:00.000Z")
    expect(await busyOf("dispatcher", data, config, now)).toBe(false)
    state("a", "idle", "2026-10-31T06:09:00.000Z")
    expect(await busyOf("dispatcher", data, config, now)).toBe(false)
    state("a", "working", "2026-10-31T06:09:00.000Z")
    expect(await busyOf("dispatcher", data, config, now)).toBe(true)
  })
})

describe("watch.ts as the beat runs it", () => {
  test("with no token, as when vault cannot read 1Password, one pass exits 1 with one plain error line and calls nothing", async () => {
    const script = join(
      import.meta.dir,
      "../../../../../packages/scripts/src/ops-dm-watch/watch.ts",
    )
    const env: Record<string, string | undefined> = {
      ...process.env,
      PLAYGROUND_DATA_DIR: scratch(),
    }
    delete env.SLACK_TOKEN
    const child = Bun.spawn([process.execPath, script], { env, stderr: "pipe", stdout: "pipe" })
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code).toBe(1)
    expect(out).toBe("")
    expect(err).toBe("error: SLACK_TOKEN is unset: run it through vault.py run -e\n")
  })
})
