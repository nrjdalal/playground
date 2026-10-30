import { expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { sandbox } from "../../../../packages/scripts/src/sandbox"

// Builds the sandbox while the parent reads Asia/Kolkata, as the Mac does, and returns the zone a Python child reports with that env plus the given overrides
const childZone = (overrides: Record<string, string> = {}) => {
  const parent = process.env.TZ
  process.env.TZ = "Asia/Kolkata"
  const { env, scratch } = sandbox()
  if (parent === undefined) delete process.env.TZ
  else process.env.TZ = parent
  try {
    const run = Bun.spawnSync(["python3", "-c", "import time; print(time.strftime('%Z'))"], {
      env: { ...env, ...overrides },
    })
    return run.stdout.toString().trim()
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}

test("a child spawned in the sandbox reads UTC whatever the parent's zone", () => {
  expect(childZone()).toBe("UTC")
})

test("a child given its own TZ keeps it", () => {
  expect(childZone({ TZ: "Asia/Kolkata" })).toBe("IST")
})

test("a Python child in the sandbox leaves no __pycache__ behind", () => {
  const { env, scratch } = sandbox()
  try {
    writeFileSync(join(scratch, "mod.py"), "x = 1\n")
    const run = Bun.spawnSync(["python3", "-c", "import mod"], { cwd: scratch, env })
    expect(run.exitCode).toBe(0)
    expect(existsSync(join(scratch, "__pycache__"))).toBe(false)
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
})

test("gh in the sandbox is its fake: gh repo create exits non-zero and names the sandbox, so no test reaches GitHub", () => {
  const { env, scratch } = sandbox()
  try {
    // resolved before it runs, so a sandbox without the fake fails here and never calls the real gh
    expect(Bun.which("gh", { PATH: env.PATH })).toBe(join(scratch, "bin", "gh"))
    const run = Bun.spawnSync(["gh", "repo", "create", "made-up/repo", "--private"], { env })
    expect(run.exitCode).toBe(99)
    expect(run.stderr.toString()).toContain("the test sandbox stopped a real gh call")
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
})

test("a test's own fake gh ahead of the sandbox's answers instead", () => {
  const { env, scratch } = sandbox()
  try {
    const mine = join(scratch, "mine")
    mkdirSync(mine)
    writeFileSync(join(mine, "gh"), "#!/bin/sh\necho made-up-me\n")
    chmodSync(join(mine, "gh"), 0o755)
    const run = Bun.spawnSync(["gh", "api", "user"], {
      env: { ...env, PATH: `${mine}:${env.PATH}` },
    })
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString().trim()).toBe("made-up-me")
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
})
