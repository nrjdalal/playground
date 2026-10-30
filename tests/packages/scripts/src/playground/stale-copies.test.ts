import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  STALE_OPS_COPIES,
  staleCopies,
} from "../../../../../packages/scripts/src/playground/stale-copies"

const home = mkdtempSync(join(tmpdir(), "stale-copies-"))
afterAll(() => rmSync(home, { force: true, recursive: true }))

test("a data folder's stale copies are the listed files it holds, and its state beside them stays", () => {
  const data = join(home, "data")
  mkdirSync(join(data, "ops", "dashboard", "dashboard-db"), { recursive: true })
  for (const path of [
    ...STALE_OPS_COPIES,
    "ops/dashboard/state.json",
    "ops/jobs.json",
    "ops/up.py",
  ])
    if (path !== "ops/dashboard/watch-stuck.py") writeFileSync(join(data, path), "")
  expect(staleCopies(data)).toEqual(
    STALE_OPS_COPIES.filter((path) => path !== "ops/dashboard/watch-stuck.py").map((path) =>
      join(data, path),
    ),
  )
  expect(staleCopies(join(home, "none"))).toEqual([])
})
