import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLAYGROUND, recordSent, USER } from "../../../../../packages/scripts/src/dm/slack"
import { type Stuck, stuckOf, watch } from "../../../../../packages/scripts/src/ops-dm-watch/watch"
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

// One watch over a fake DM, its passes at the times given, recording every line it sends; ours posts as dm send does, its ts in the record.
const harness = (dm: ReturnType<typeof fakeDm>, stuck: Stuck = null) => {
  const dir = scratch()
  const sent: { text: string; to: string }[] = []
  const ops: string[] = []
  let blocked = stuck
  const pass = (now: number) =>
    watch({
      channel: DM,
      dir,
      now,
      owner: OWNER,
      send: async (to, text) => sent.push({ text, to }),
      slack: dm.slack,
      stuck: async () => blocked,
      tellOps: async (text) => ops.push(text),
    })
  const ours = async (text: string) => recordSent(dir, dm.add(text).ts)
  return { ops, ours, pass, sent, setStuck: (s: Stuck) => (blocked = s) }
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

  test("a message with no reply in 3 minutes goes to dispatcher-2 as well, once; one answered in time does not", async () => {
    const dm = fakeDm([{ text: "anyone there?", ts: "1000.000100", user: OWNER }])
    const w = harness(dm)
    await w.pass(1010)
    await w.pass(1150)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher"])
    await w.pass(1191)
    await w.pass(1251)
    expect(w.sent.map((s) => s.to)).toEqual(["dispatcher", "dispatcher-2"])
    expect(w.sent[1]!.text).toContain("anyone there?")

    const answered = fakeDm([{ text: "quick one", ts: "1000.000100", user: OWNER }])
    const a = harness(answered)
    await a.pass(1010)
    await a.ours(PLAYGROUND)
    await a.pass(1250)
    expect(a.sent.map((s) => s.to)).toEqual(["dispatcher"])
  })

  test("while the dispatcher has read stuck for 3 minutes, a new message goes to dispatcher-2 at once and Ops hears it once", async () => {
    const dm = fakeDm([{ text: "help", ts: "1000.000100", user: OWNER }])
    const w = harness(dm, { at: "2026-10-31T06:00:00.000Z", state: "stuck" })
    await w.pass(1010)
    dm.add("still there?")
    await w.pass(1070)
    expect(w.sent.map((s) => s.to)).toEqual([
      "dispatcher",
      "dispatcher-2",
      "dispatcher",
      "dispatcher-2",
    ])
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
