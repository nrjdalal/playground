import { Database } from "bun:sqlite"
import { afterAll, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readTranscripts, render } from "../../../../../packages/scripts/src/wispr/latest"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { force: true, recursive: true })
})
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "wispr-test-"))
  dirs.push(d)
  return d
}
const dir = scratch()

// The columns it reads, as Wispr Flow declares them; every row and line below is made up.
const writer = new Database(join(dir, "flow.sqlite"))
writer.run("PRAGMA journal_mode = WAL")
writer.run(
  "CREATE TABLE `Meetings` (`id` VARCHAR(36) NOT NULL UNIQUE PRIMARY KEY, `title` VARCHAR(255) NOT NULL, `isDeleted` TINYINT(1) NOT NULL DEFAULT 0, `endedAt` INTEGER DEFAULT NULL, `speakerMap` TEXT DEFAULT NULL, `transcriptReady` TINYINT(1) NOT NULL DEFAULT 0)",
)
const meeting = (
  id: string,
  title: string,
  endedAt: number | null,
  { isDeleted = 0, speakerMap = null as string | null, transcriptReady = 1 } = {},
) =>
  writer
    .query("insert into Meetings values (?, ?, ?, ?, ?, ?)")
    .run(id, title, isDeleted, endedAt, speakerMap, transcriptReady)
const ndjson = (id: string, file: string, lines: (object | null)[]) => {
  mkdirSync(join(dir, "meetings", id), { recursive: true })
  writeFileSync(join(dir, "meetings", id, file), lines.map((l) => JSON.stringify(l)).join("\n"))
}

const T1 = Date.parse("2026-01-01T10:00:00Z")
const T2 = Date.parse("2026-01-02T10:00:00Z")
meeting("m1", "Standup", T1, {
  speakerMap: JSON.stringify({
    assignments: { "0": { consensus: "p-a" }, "1": { consensus: null } },
    people: { "p-a": { name: "Ada" } },
  }),
})
ndjson("m1", "refined.ndjson", [
  { id: "a", speaker: { id: 0, source: "refined" }, text: "Hello there.", timestamp: "00:01" },
  { id: "b", speaker: { id: 1, source: "refined" }, text: "Hi.", timestamp: "00:04" },
])
meeting("m2", "Planning", T2, { transcriptReady: 0 })
ndjson("m2", "live.ndjson", [
  { meta: { clock: 1, v: 1 } },
  {
    id: "c",
    speaker: { id: 2, name: "Bo", source: "system" },
    text: "Next step.",
    timestamp: "01:10",
  },
  { epochMs: T2, id: "d", marker: "paused", segment: 0, timestamp: "01:20" },
])
meeting("m3", "Deleted", T2 + 1, { isDeleted: 1 })
meeting("m4", "Recording", null, { transcriptReady: 0 })
ndjson("m4", "live.ndjson", [
  { speaker: { id: 0 }, text: "So far.", timestamp: "00:02" },
  null,
  { torn: true },
])
writeFileSync(join(dir, "meetings", "m4", "live.ndjson"), '\n{"text": "cut off mid-wri', {
  flag: "a",
})

const hashes = (d: string) =>
  readdirSync(d, { recursive: true })
    .map(String)
    .filter((name) => statSync(join(d, name)).isFile())
    .sort()
    .map((name) => `${name} ${Bun.hash(readFileSync(join(d, name)))}`)

test("prints the newest ended meeting, read live while the writer holds the WAL", () => {
  const before = hashes(dir)
  const [latest, ...rest] = readTranscripts(dir)
  expect(rest).toEqual([])
  expect(render(latest!)).toBe(
    [
      "# Planning",
      "ended 2026-01-02T10:00:00.000Z · live transcript, not refined yet",
      "",
      "[01:10] Bo: Next step.",
    ].join("\n"),
  )
  expect(hashes(dir)).toEqual(before)
})

test("--since lists every meeting ended after that time, oldest first, names from the speaker map", () => {
  const transcripts = readTranscripts(dir, { since: new Date(T1 - 1) })
  expect(transcripts.map((t) => t.title)).toEqual(["Standup", "Planning"])
  expect(transcripts[0]!.lines).toEqual(["[00:01] Ada: Hello there.", "[00:04] Speaker 1: Hi."])
  expect(readTranscripts(dir, { since: new Date(T1) }).map((t) => t.title)).toEqual(["Planning"])
  expect(readTranscripts(dir, { since: new Date(T2) })).toEqual([])
})

test("a meeting still recording shows only with --live, marked partial, past a torn last line", () => {
  const transcripts = readTranscripts(dir, { live: true })
  expect(transcripts.map((t) => t.title)).toEqual(["Planning", "Recording"])
  expect(render(transcripts[1]!).split("\n")[1]).toBe(
    "in progress, partial · live transcript, not refined yet",
  )
  expect(transcripts[1]!.lines).toEqual(["[00:02] Speaker 0: So far."])
})

test("a missing database is a clear error", () => {
  expect(() => readTranscripts(join(dir, "nowhere"))).toThrow("no Wispr Flow database at")
})

test("reads a database Wispr Flow has closed, with no -wal or -shm beside it", () => {
  const closed = scratch()
  const db = new Database(join(closed, "flow.sqlite"))
  db.run("PRAGMA journal_mode = WAL")
  db.run(
    "CREATE TABLE `Meetings` (`id` VARCHAR(36), `title` VARCHAR(255), `isDeleted` TINYINT(1), `endedAt` INTEGER, `speakerMap` TEXT, `transcriptReady` TINYINT(1))",
  )
  db.run("insert into Meetings values ('c1', 'Closed', 0, 1, null, 0)")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
  for (const side of ["-wal", "-shm"]) rmSync(join(closed, `flow.sqlite${side}`), { force: true })
  expect(readdirSync(closed)).toEqual(["flow.sqlite"])
  expect(readTranscripts(closed).map((t) => t.title)).toEqual(["Closed"])
  expect(readdirSync(closed)).toEqual(["flow.sqlite"])
})

test("reads past an exclusive lock Wispr Flow holds", () => {
  const locked = scratch()
  const db = new Database(join(locked, "flow.sqlite"))
  db.run("PRAGMA journal_mode = WAL")
  db.run(
    "CREATE TABLE `Meetings` (`id` VARCHAR(36), `title` VARCHAR(255), `isDeleted` TINYINT(1), `endedAt` INTEGER, `speakerMap` TEXT, `transcriptReady` TINYINT(1))",
  )
  db.run("insert into Meetings values ('l1', 'Held', 0, 1, null, 0)")
  db.run("PRAGMA locking_mode = EXCLUSIVE")
  db.run("begin exclusive")
  db.run("insert into Meetings values ('l2', 'Uncommitted', 0, 2, null, 0)")
  expect(readTranscripts(locked).map((t) => t.title)).toEqual(["Held"])
  db.run("rollback")
  db.close()
})
