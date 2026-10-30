import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  mergeQueuePath,
  parseMergeQueue,
  queueRepo,
  readMergeQueue,
} from "../../../../../../api/hono/src/lib/dashboard/merge-queue"
import { checkoutRepo } from "../../../../../../api/hono/src/lib/dashboard/repo"
import { dataDir } from "../../../../../../api/hono/src/lib/sessions/paths"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const QUEUE = {
  // a lead-owned key the dashboard has no use for, dropped on the read
  lanes: [{ lane: "pg-227", prs: [101] }],
  parked: [{ item: "Kettle timer", pr: 103, why: "waiting on its base branch" }],
  queue: [
    {
      etaMerge: "2026-01-02T09:30:00.000Z",
      item: "Board status colours",
      nextGate: "tester",
      pr: 101,
    },
    { item: "Sidebar row spacing", pr: 102 },
  ],
  updatedAt: "2026-01-01T11:30:00.000Z",
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "merge-queue-"))
  dirs.push(dir)
  return dir
}

describe("parseMergeQueue", () => {
  test("a queue in shape reads what the tab shows, the lead-owned keys dropped", () => {
    expect(parseMergeQueue(JSON.stringify(QUEUE))).toEqual({
      parked: [{ pr: 103 }],
      queue: [
        { etaMerge: "2026-01-02T09:30:00.000Z", item: "Board status colours", pr: 101 },
        { item: "Sidebar row spacing", pr: 102 },
      ],
    })
  })

  test("an entry without the keys the tab shows, or with a malformed time, keeps its row", () => {
    const read = parseMergeQueue(
      JSON.stringify({
        ...QUEUE,
        queue: [
          { item: "No time", pr: 104 },
          { ...QUEUE.queue[0], etaMerge: "tomorrow morning" },
        ],
      }),
    )
    expect(read?.queue).toEqual([
      { item: "No time", pr: 104 },
      { item: "Board status colours", pr: 101 },
    ])
  })

  test("one entry with a bad number drops alone", () => {
    const read = parseMergeQueue(
      JSON.stringify({ ...QUEUE, queue: [...QUEUE.queue, { item: "No number", pr: "soon" }] }),
    )
    expect(read?.queue).toHaveLength(2)
    expect(read?.parked).toHaveLength(1)
  })

  test("a list that is not a list reads as empty", () => {
    expect(parseMergeQueue(JSON.stringify({ ...QUEUE, parked: 3 }))?.parked).toEqual([])
  })

  test("a pull listed twice keeps its first place", () => {
    const read = parseMergeQueue(
      JSON.stringify({ ...QUEUE, queue: [QUEUE.queue[0], QUEUE.queue[1], QUEUE.queue[0]] }),
    )
    expect(read?.queue.map((entry) => entry.pr)).toEqual([101, 102])
  })

  test("a repo key, which no writer of the file sets, is dropped like any lead-owned key, whatever it holds", () => {
    for (const repo of ["", 7, "example/other"]) {
      expect(parseMergeQueue(JSON.stringify({ ...QUEUE, repo }))?.queue).toHaveLength(2)
    }
  })

  test("the queue's repository is this checkout's", () => {
    expect(queueRepo()).toBe(checkoutRepo() ?? "")
  })

  test("a fixture stack takes the fixture's origin, and never runs git", () => {
    const live = process.env.PLAYGROUND_LIVE_READS
    const dir = process.env.PLAYGROUND_FIXTURE_DIR
    // the fixture writer replaces a folder only when it is a fixture's own, so the scratch must not exist yet
    const scratch = mkdtempSync(join(tmpdir(), "merge-queue-fixture-"))
    rmSync(scratch, { force: true, recursive: true })
    dirs.push(scratch)
    // the file opts into live reads wholesale; this one case is a fixture stack, whose origin is the fixture's own
    delete process.env.PLAYGROUND_LIVE_READS
    process.env.PLAYGROUND_FIXTURE_DIR = scratch
    try {
      expect(queueRepo()).toBe("example/fixture")
    } finally {
      if (live === undefined) delete process.env.PLAYGROUND_LIVE_READS
      else process.env.PLAYGROUND_LIVE_READS = live
      if (dir === undefined) delete process.env.PLAYGROUND_FIXTURE_DIR
      else process.env.PLAYGROUND_FIXTURE_DIR = dir
    }
  })

  test("text that is not JSON is no queue", () => {
    expect(parseMergeQueue("{oops")).toBeNull()
  })
})

describe("readMergeQueue", () => {
  test("reads the scratch file, and a changed one again", async () => {
    const path = join(tempDir(), "dispatcher", "merge-queue.json")
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, JSON.stringify({ queue: [{ item: "one", pr: 5 }] }))
    expect(await readMergeQueue(path)).toEqual({
      parked: [],
      queue: [{ item: "one", pr: 5 }],
    })
    writeFileSync(path, JSON.stringify({ parked: [{ item: "two", pr: 6 }] }))
    expect(await readMergeQueue(path)).toEqual({
      parked: [{ pr: 6 }],
      queue: [],
    })
  })

  test("a file that is missing, or one that cannot be read, is no queue", async () => {
    const dir = tempDir()
    expect(await readMergeQueue(join(dir, "gone.json"))).toBeNull()
    expect(await readMergeQueue(dir)).toBeNull()
  })

  test("the live path names the data folder", () => {
    expect(mergeQueuePath()).toBe(join(dataDir(), "merge-queue.json"))
  })
})
