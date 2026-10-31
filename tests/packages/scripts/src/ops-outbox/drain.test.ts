import { afterAll, describe, expect, test } from "bun:test"
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { drain, pending } from "../../../../../packages/scripts/src/ops-outbox/drain"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "outbox-"))
  dirs.push(dir)
  return dir
}

const rec = (at: string, job: string, text: string) =>
  `${JSON.stringify({ at, job, text, to: "ops" })}\n`

describe("drain", () => {
  test("a first run starts the cursor at each file's end and prints nothing", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    expect(await drain(dir)).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, "cursor.json"), "utf8"))).toEqual({
      "ops-dashboard.jsonl": statSync(join(dir, "ops-dashboard.jsonl")).size,
    })
  })

  test("prints each line queued since, oldest first across files, once, and keeps a half-written line", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    await drain(dir)
    appendFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-23T07:02:00Z", "dashboard", "b"))
    writeFileSync(
      join(dir, "ops-channel-watch.jsonl"),
      rec("2026-10-23T07:01:00Z", "channel-watch", "a"),
    )
    appendFileSync(join(dir, "ops-dashboard.jsonl"), '{"at": "2026-10-23T07:03')
    writeFileSync(join(dir, "alerts.log"), "not a queue\n")
    expect((await drain(dir)).map((r) => r.text)).toEqual(["a", "b"])
    expect(await drain(dir)).toEqual([])
    appendFileSync(
      join(dir, "ops-dashboard.jsonl"),
      `:00Z", "job": "dashboard", "text": "c", "to": "ops"}\n`,
    )
    expect(await drain(dir)).toEqual([
      { at: "2026-10-23T07:03:00Z", job: "dashboard", text: "c", to: "ops" },
    ])
  })

  test("leaves the cursor untouched when nothing is pending, so relay-watch reads no move", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    await drain(dir)
    const before = statSync(join(dir, "cursor.json")).mtimeMs
    await Bun.sleep(20)
    await drain(dir)
    expect(statSync(join(dir, "cursor.json")).mtimeMs).toBe(before)
  })

  test("a file cut shorter than its cursor is read again from its start", async () => {
    const dir = scratch()
    writeFileSync(
      join(dir, "ops-dashboard.jsonl"),
      rec("2026-10-19T05:33:19Z", "dashboard", "a long old line"),
    )
    await drain(dir)
    writeFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-23T07:00:00Z", "dashboard", "new"))
    expect((await drain(dir)).map((r) => r.text)).toEqual(["new"])
  })

  test("an unreadable line fails loud and moves no cursor", async () => {
    const dir = scratch()
    await drain(dir)
    expect(existsSync(join(dir, "cursor.json"))).toBe(true)
    writeFileSync(join(dir, "ops-dashboard.jsonl"), "not json\n")
    await expect(drain(dir)).rejects.toThrow("ops-dashboard.jsonl")
    expect(JSON.parse(readFileSync(join(dir, "cursor.json"), "utf8"))).toEqual({})
  })

  test("refuses an outbox a relay owns, and writes no cursor there", async () => {
    const dir = scratch()
    writeFileSync(join(dir, "relay.py"), "")
    writeFileSync(join(dir, "ops-dashboard.jsonl"), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    await expect(drain(dir)).rejects.toThrow("relay.py")
    expect(existsSync(join(dir, "cursor.json"))).toBe(false)
  })
})

// pending() names the queues the next drain() would send from, and moves nothing, so each case reads it and then drains
describe("pending", () => {
  const Q = "ops-dashboard.jsonl"

  test("no cursor yet: none, as a first drain sends nothing", async () => {
    const dir = scratch()
    writeFileSync(join(dir, Q), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    expect(await pending(dir)).toEqual([])
    expect(existsSync(join(dir, "cursor.json"))).toBe(false)
    expect(await drain(dir)).toEqual([])
  })

  test("a cursor at the end: none", async () => {
    const dir = scratch()
    writeFileSync(join(dir, Q), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    await drain(dir)
    expect(await pending(dir)).toEqual([])
    expect(await drain(dir)).toEqual([])
  })

  test("a half-written line: none, until its newline lands", async () => {
    const dir = scratch()
    writeFileSync(join(dir, Q), rec("2026-10-19T05:33:19Z", "dashboard", "old"))
    await drain(dir)
    appendFileSync(join(dir, Q), '{"at": "2026-10-23T07:03')
    expect(await pending(dir)).toEqual([])
    expect(await drain(dir)).toEqual([])
    appendFileSync(join(dir, Q), `:00Z", "job": "dashboard", "text": "c", "to": "ops"}\n`)
    expect(await pending(dir)).toEqual([Q])
    expect(await pending(dir)).toEqual([Q])
    expect((await drain(dir)).map((r) => r.text)).toEqual(["c"])
    expect(await pending(dir)).toEqual([])
  })

  test("a cursor past a file cut shorter: the file, read again from its start", async () => {
    const dir = scratch()
    writeFileSync(join(dir, Q), rec("2026-10-19T05:33:19Z", "dashboard", "a long old line"))
    await drain(dir)
    writeFileSync(join(dir, Q), rec("2026-10-23T07:00:00Z", "dashboard", "new"))
    expect(await pending(dir)).toEqual([Q])
    expect((await drain(dir)).map((r) => r.text)).toEqual(["new"])
  })
})
