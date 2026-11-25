import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { giveBackSlot } from "../../../../../packages/scripts/src/playground/give-back"

const root = mkdtempSync(join(tmpdir(), "give-back-"))
afterAll(() => rmSync(root, { force: true, recursive: true }))

// #3039: a reclaimer's claim can land in a live run's lane folder, and the folder must still go when that run gives the lane back
test("a lane holding a reclaimer's claim is given back whole", () => {
  const slot = join(root, "run-slot")
  mkdirSync(join(slot, "reclaim"), { recursive: true })
  writeFileSync(`${slot}.holder`, "worker-a 4242 2026-11-25T06:00:00Z 1 small\n")
  expect(giveBackSlot(`${slot} 4242`)).toBe(true)
  expect(existsSync(slot)).toBe(false)
  expect(existsSync(`${slot}.holder`)).toBe(false)
})
