import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  clearManagersOrder,
  managersOrderSchema,
  readManagersOrder,
  unknownManager,
  writeManagersOrder,
} from "../../../../../../api/hono/src/lib/dashboard/managers-order"
import type { RosterAgent } from "../../../../../../api/hono/src/lib/dashboard/roster"
import { DISPATCHER } from "../../../../../../api/hono/src/lib/dashboard/workers"
import { setSessionNames } from "../../../../../../packages/config/src/kinds"
import { SEEDED_NAMES } from "../../../../../session-names"

// workers.ts sets the names its data folder holds when it loads; the cases name the managers' old names, as a machine past the switch does.
setSessionNames(SEEDED_NAMES)

const dir = mkdtempSync(join(tmpdir(), "managers-order-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const agent = (name: string, role: RosterAgent["role"]): RosterAgent => ({
  name,
  role,
  status: "working",
  task: "t",
})

describe("managersOrderSchema", () => {
  test("takes up to 20 names", () => {
    const names = Array.from({ length: 20 }, (_, i) => `manager-${i}`)
    expect(managersOrderSchema.safeParse({ names }).success).toBe(true)
    expect(managersOrderSchema.safeParse({ names: [...names, "manager-20"] }).success).toBe(false)
  })

  test("refuses a repeated name, an empty one and the dispatcher", () => {
    expect(managersOrderSchema.safeParse({ names: ["builder", "builder"] }).success).toBe(false)
    expect(managersOrderSchema.safeParse({ names: [""] }).success).toBe(false)
    expect(managersOrderSchema.safeParse({ names: [DISPATCHER] }).success).toBe(false)
  })

  test("refuses a key it does not know", () => {
    expect(managersOrderSchema.safeParse({ names: [], extra: 1 }).success).toBe(false)
  })
})

describe("unknownManager", () => {
  const roster = [agent("lightdoc", "manager"), agent("worker-greed", "worker")]

  test("the managers the dashboard names, and the roster's, are known", () => {
    expect(unknownManager(["planner", "builder", "ops", "lightdoc"], roster)).toBeNull()
  })

  test("a manager kind is known by today's name, its <id>-<kind> name and the roster's kind (PG-1644)", () => {
    const renamed = [{ ...agent("plain-name", "worker"), kind: "builder" as const }]
    expect(unknownManager(["optimizer", "plain-name"], renamed)).toBeNull()
    expect(unknownManager(["x7mh4d-builder", "k3v9q2-ops"], [])).toBeNull()
    expect(unknownManager(["ops-dashboard"], [])).toBe("ops-dashboard")
    expect(unknownManager(["m4n7vw-dispatcher"], [])).toBe("m4n7vw-dispatcher")
  })

  test("names the first that is neither", () => {
    expect(unknownManager(["builder", "worker-greed", "nobody"], roster)).toBe("worker-greed")
    expect(unknownManager(["nobody"], [])).toBe("nobody")
  })
})

describe("readManagersOrder", () => {
  test("a missing file is no order", async () => {
    expect(await readManagersOrder(join(dir, "missing.json"))).toEqual([])
  })

  test("a file that does not read is no order, never thrown", async () => {
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{not json")
    expect(await readManagersOrder(bad)).toEqual([])
    writeFileSync(bad, JSON.stringify([1, 2]))
    expect(await readManagersOrder(bad)).toEqual([])
  })

  test("drops a bad entry and a repeat, keeping the rest", async () => {
    const path = join(dir, "mixed.json")
    writeFileSync(
      path,
      JSON.stringify({ names: ["builder", 3, "", "builder", DISPATCHER, "planner"] }),
    )
    expect(await readManagersOrder(path)).toEqual(["builder", "planner"])
  })
})

describe("writeManagersOrder", () => {
  test("writes the names with the time, owner-only, and reads back the same", async () => {
    const path = join(dir, "sidebar", "managers-order.json")
    const now = new Date("2026-10-18T10:00:00.000Z")
    const written = await writeManagersOrder(["ops", "builder"], path, now)
    expect(written).toEqual({ names: ["ops", "builder"], updatedAt: now.toISOString() })
    expect(await readManagersOrder(path)).toEqual(["ops", "builder"])
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(dir, "sidebar"))).toEqual(["managers-order.json"])
  })

  test("two writes at once land in the order they were made", async () => {
    const path = join(dir, "serial.json")
    await Promise.all([
      writeManagersOrder(["builder", "ops"], path),
      writeManagersOrder(["ops", "builder"], path),
    ])
    expect(await readManagersOrder(path)).toEqual(["ops", "builder"])
  })
})

describe("clearManagersOrder", () => {
  test("removes the file, and a missing one is fine", async () => {
    const path = join(dir, "clear.json")
    await writeManagersOrder(["builder"], path)
    await clearManagersOrder(path)
    expect(await readManagersOrder(path)).toEqual([])
    expect(readdirSync(dir)).not.toContain("clear.json")
    await clearManagersOrder(path)
  })
})
