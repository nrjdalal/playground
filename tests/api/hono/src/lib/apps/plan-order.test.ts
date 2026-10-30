import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readOrder, writeOrder } from "../../../../../../api/hono/src/lib/apps/plan-order"

const dir = mkdtempSync(join(tmpdir(), "plan-order-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

describe("readOrder", () => {
  test("no file is no order and no problem", async () => {
    expect(await readOrder(join(dir, "missing.json"))).toEqual({ order: null, problem: null })
  })

  test("a file that does not read is named, never thrown", async () => {
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{not json")
    const read = await readOrder(bad)
    expect(read.order).toBeNull()
    expect(read.problem).toContain("order.json could not be read")
    writeFileSync(
      bad,
      JSON.stringify({ lanes: { easy: ["F2", "F2"] }, updatedAt: "2026-10-06T20:00:00Z" }),
    )
    expect((await readOrder(bad)).problem).toContain("order.json does not read")
  })
})

describe("writeOrder", () => {
  test("writes the order whole, with its time, and reads back the same", async () => {
    const path = join(dir, "nested", "bundles", "order.json")
    const now = new Date("2026-10-06T20:00:00.000Z")
    const order = await writeOrder({ easy: ["F3", "F2"], hard: ["F6"] }, path, now)
    expect(order).toEqual({
      lanes: { easy: ["F3", "F2"], hard: ["F6"] },
      updatedAt: now.toISOString(),
    })
    expect(await readOrder(path)).toEqual({ order, problem: null })
    expect(readdirSync(join(dir, "nested", "bundles"))).toEqual(["order.json"])
  })

  test("a write that fails leaves no temp file behind, and the next one still lands", async () => {
    const parent = join(dir, "blocked")
    const path = join(parent, "order.json")
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "keep"), "")
    await expect(writeOrder({ easy: ["F2"] }, path)).rejects.toThrow()
    expect(readdirSync(parent)).toEqual(["order.json"])
    rmSync(path, { force: true, recursive: true })
    await writeOrder({ easy: ["F2"] }, path)
    expect((await readOrder(path)).order?.lanes).toEqual({ easy: ["F2"] })
  })

  test("two writes at once land in the order they were made", async () => {
    const path = join(dir, "serial.json")
    await Promise.all([
      writeOrder({ easy: ["F2", "F3"] }, path),
      writeOrder({ easy: ["F3", "F2"] }, path),
    ])
    expect((await readOrder(path)).order?.lanes).toEqual({ easy: ["F3", "F2"] })
  })
})
