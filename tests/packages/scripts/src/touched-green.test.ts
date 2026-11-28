import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  MARK,
  markGreen,
  pushRefusal,
  type MarkIo,
} from "../../../../packages/scripts/src/touched-green"

const ZERO = "0".repeat(40)
const OLD = "a".repeat(40)
const HEAD = "b".repeat(40)
const line = (branch: string, sha: string) =>
  `refs/heads/${branch} ${sha} refs/heads/${branch} ${ZERO}\n`

describe("pushRefusal", () => {
  test("refuses a PG- branch whose head has no green mark, naming the command to run", () => {
    const refusal = pushRefusal(line("PG-3287-push-waits", HEAD), null)
    expect(refusal).toContain(HEAD.slice(0, 7))
    expect(refusal).toContain("bun packages/scripts/src/touched-green.ts <your session name>")
  })

  test("refuses a PG- branch whose mark is from an older head", () => {
    expect(pushRefusal(line("PG-3287-push-waits", HEAD), OLD)).toContain(HEAD.slice(0, 7))
  })

  test("allows a PG- branch whose mark is its head", () => {
    expect(pushRefusal(line("PG-3287-push-waits", HEAD), HEAD)).toBeNull()
    expect(pushRefusal(line("pg-3287-push-waits", HEAD), `${HEAD}\n`)).toBeNull()
  })

  test("leaves a branch that is not PG-, and a delete, alone", () => {
    expect(pushRefusal(line("canary", HEAD), null)).toBeNull()
    expect(pushRefusal(line("before-PG-3287", HEAD), null)).toBeNull()
    expect(pushRefusal(line("PG-3287-push-waits", ZERO), null)).toBeNull()
  })
})

describe("markGreen", () => {
  const io = (dir: string, over: Partial<MarkIo> = {}): MarkIo & { ran: string[][] } => {
    const ran: string[][] = []
    return {
      dirty: () => false,
      gitDir: () => dir,
      head: () => HEAD,
      ran,
      tests: (files) => {
        ran.push(files)
        return 0
      },
      touched: () => ["tests/a.test.ts", "tests/b.test.ts"],
      ...over,
    }
  }
  const scratch = () => mkdtempSync(join(tmpdir(), "touched-green-"))
  const mark = (dir: string) => {
    try {
      return readFileSync(join(dir, MARK), "utf8")
    } catch {
      return null
    }
  }

  test("a fully green run marks the head", () => {
    const dir = scratch()
    try {
      const stub = io(dir)
      expect(markGreen(stub)).toBe(0)
      expect(stub.ran).toEqual([["tests/a.test.ts", "tests/b.test.ts"]])
      expect(mark(dir)).toBe(`${HEAD}\n`)
      expect(pushRefusal(line("PG-1-x", HEAD), mark(dir))).toBeNull()
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test("a red run marks nothing and keeps an older head's mark from counting", () => {
    const dir = scratch()
    try {
      expect(markGreen(io(dir, { head: () => OLD }))).toBe(0)
      expect(markGreen(io(dir, { tests: () => 1 }))).toBe(1)
      expect(mark(dir)).toBe(`${OLD}\n`)
      expect(pushRefusal(line("PG-1-x", HEAD), mark(dir))).toContain(HEAD.slice(0, 7))
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test("an empty touched list marks the head with no run", () => {
    const dir = scratch()
    try {
      const stub = io(dir, { touched: () => [] })
      expect(markGreen(stub)).toBe(0)
      expect(stub.ran).toEqual([])
      expect(mark(dir)).toBe(`${HEAD}\n`)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test("a tree with uncommitted edits runs nothing and marks nothing", () => {
    const dir = scratch()
    try {
      const stub = io(dir, { dirty: () => true })
      expect(markGreen(stub)).toBe(1)
      expect(stub.ran).toEqual([])
      expect(mark(dir)).toBeNull()
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
