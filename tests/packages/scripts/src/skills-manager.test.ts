import { expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..", "..", "..")

// The skills tables live in skills/zerostarter/README.md, so a ZeroStarter sync that overlays upstream's script, which writes AGENTS.md's, fails here until this repo's is restored
test("skills-manager checks the tables in skills/zerostarter/README.md, and AGENTS.md holds none", async () => {
  const run = Bun.spawnSync(["bun", "packages/scripts/src/skills-manager.ts", "--check"], {
    cwd: ROOT,
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(`${run.stdout}${run.stderr}`).toContain(
    "skills/zerostarter/README.md skills tables are up to date.",
  )
  expect(run.exitCode).toBe(0)
  expect(await Bun.file(join(ROOT, "AGENTS.md")).text()).not.toContain("<!-- skills:custom -->")
})
