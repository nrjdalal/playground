import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  CONFIG_DIST,
  configDistRefusal,
} from "../../../../../packages/scripts/src/pr-merge/config-dist"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true })
})

// a scratch checkout with no @packages/config dist, as every fresh worktree has whichever route took its node_modules
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "config-dist-"))
  roots.push(root)
  return root
}
const writeDist = (root: string) => {
  mkdirSync(dirname(join(root, CONFIG_DIST)), { recursive: true })
  writeFileSync(join(root, CONFIG_DIST), "export {}\n")
}

describe("keeps-canary's config dist", () => {
  test("a checkout that has the dist builds nothing", async () => {
    const root = fresh()
    writeDist(root)
    let builds = 0
    expect(await configDistRefusal(root, () => ++builds && 0)).toBeNull()
    expect(builds).toBe(0)
  })

  test("a missing dist is built once, and the push goes on", async () => {
    const root = fresh()
    const built: string[] = []
    const build = (at: string) => {
      built.push(at)
      writeDist(at)
      return 0
    }
    expect(await configDistRefusal(root, build)).toBeNull()
    expect(built).toEqual([root])
  })

  test("a missing dist whose build fails names the build through run-slot", async () => {
    const refusal = await configDistRefusal(fresh(), () => 1)
    expect(refusal).toContain(CONFIG_DIST)
    expect(refusal).toContain(
      "~/.playground/ops/run-slot.sh <your name> -- bunx turbo run build --filter=@packages/config",
    )
  })

  test("a build that exits 0 but leaves no dist still refuses", async () => {
    expect(await configDistRefusal(fresh(), () => 0)).toContain("its build failed")
  })
})
