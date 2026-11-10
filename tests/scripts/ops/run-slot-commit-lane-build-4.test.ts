import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// @web/next#build builds from every package and the root's manifests, so a commit staging only those runs next build too, and a README beside a file outside the build trees feeds the hash
describe("a commit whose pre-commit runs next build: the other build trees", () => {
  for (const file of ["packages/env/src/data-dir.ts", "bun.lock"]) {
    test(`staging ${file} alone waits as a big run too`, async () => {
      const m = repo({ idle: 30 }, [file])
      m.hold("run-slot", 3, "big")
      expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
    })
  }

  // lefthook skips its build only when every staged file is Markdown or a Python test under tests/, and a README feeds @web/next#build's hash
  test("staging Markdown under api/hono beside a file outside the build trees waits as a big run too", async () => {
    const m = repo({ idle: 30 }, ["api/hono/README.md", "scripts/ops/run-slot.sh"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })
})
