import { expect, test } from "bun:test"
import { join } from "node:path"

import { readCheck, strayRoutes } from "../../../../../packages/scripts/src/verify/checks"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/verify/cli.ts")

// dispatcher's decision: "a missing check means `all`", so a bare `bun run verify`, as the docs and briefs write it, checks everything.
test("no check reads as all, and an unknown word as no check", () => {
  expect(readCheck([])).toEqual({ check: "all", routes: [] })
  expect(readCheck(["pages", "/dashboard/apps"])).toEqual({
    check: "pages",
    routes: ["/dashboard/apps"],
  })
  expect(readCheck(["nope"])).toBeNull()
})

test("verify with no check gets past the usage exit", () => {
  // --web alone: a run that read a check stops at the --web and --api pairing before it reads anything
  const run = Bun.spawnSync(["bun", CLI, "--web", "http://127.0.0.1:9"], { stdin: "ignore" })
  const out = run.stdout.toString() + run.stderr.toString()
  expect(out).toContain("Pass --web and --api together")
  expect(out).not.toContain("Usage:")
})

test("verify --help names all as the default check", () => {
  const run = Bun.spawnSync(["bun", CLI, "--help"], { stdin: "ignore" })
  expect(run.exitCode).toBe(0)
  expect(run.stdout.toString()).toContain("Usage: bun run verify [check] [route...] [options]")
  expect(run.stdout.toString()).toMatch(/default: all/)
})

// A word after a check is a route only for the checks that open pages; any other check refuses it, so a second check name never reads as run.
test("a check that takes no route refuses one, naming the check and the word", () => {
  expect(strayRoutes("health", ["cursor"])).toBe(
    "health takes no route; did you mean `verify health` then `verify cursor`?",
  )
  expect(strayRoutes("system", ["/dashboard", "x"])).toBe("system takes no route: /dashboard x")
  expect(strayRoutes("health", ["foo"])).toBe("health takes no route: foo")
  expect(strayRoutes("health", [])).toBeNull()
  expect(strayRoutes("ended", ["probe-x"])).toBeNull()
  expect(strayRoutes("ended", [])).toBe("ended takes one session name")
  expect(strayRoutes("ended", ["a", "b"])).toBe("ended takes one session name")
  for (const check of ["all", "cls", "pages", "screenshots"] as const) {
    expect(strayRoutes(check, ["/dashboard/apps"])).toBeNull()
  }
})

test("verify health cursor stops before it reads anything, and exits non-zero", () => {
  // a closed port: a run that got past the refusal would try it and fail with a different line
  const run = Bun.spawnSync(
    ["bun", CLI, "health", "cursor", "--web", "http://127.0.0.1:9", "--api", "http://127.0.0.1:9"],
    { stdin: "ignore" },
  )
  const out = run.stdout.toString() + run.stderr.toString()
  expect(run.exitCode).not.toBe(0)
  expect(out).toContain("health takes no route; did you mean `verify health` then `verify cursor`?")
  expect(out).not.toContain("✓")
})

// verify all runs its checks one after another: a check on the run's own session raced the one before it still closing ("Failed to connect: No such file or directory"), so each check names its own.
test("no two checks in a run share a browser session", async () => {
  const source = await Bun.file(CLI).text()
  const browsed = [...source.matchAll(/\bbrowse\(\s*at,\s*"([a-z-]+)"/g)].map((m) => m[1]!)
  const shifted = [...source.matchAll(/\bshiftsIn\(\s*at,\s*\[[^\]]*\],\s*"([a-z-]+)"/g)].map(
    (m) => m[1]!,
  )
  const names = [...browsed, ...shifted]
  expect(names.length).toBeGreaterThanOrEqual(7)
  expect(new Set(names).size).toBe(names.length)
  expect(source).not.toMatch(/browse\(\s*at,\s*async/)
})
