// The sandbox test-sandbox.ts and test-skills.ts run their children in: HOME and CLAUDE_CONFIG_DIR in a fresh scratch folder, PLAYGROUND_DATA_DIR unset so the data folder is the scratch HOME's ~/.playground, and a fake claude and a fake gh first on PATH, so no test or check can start a real session, reach GitHub (make a repo, post a comment) or write the real ~/.claude or ~/.playground; a test isolates through PLAYGROUND_DATA_DIR or a scratch HOME, since CLAUDE_CONFIG_DIR never places the data folder. TZ=UTC, so a child reads the same zone on the Mac and the runner box; a child env that sets its own TZ keeps it. uv's Pythons and cache stay the real home's. PYTHONDONTWRITEBYTECODE=1 keeps a Python child from leaving `__pycache__` in the worktree, where an ignored stale `.pyc` outlives its source. TEST_SANDBOX_HOME names the folder; each fake exits non-zero and names the sandbox, so a child that reaches one by mistake fails loudly, and a test that needs gh's output puts its own fake ahead of it. An env name the rename replaced reaches a child under its new name alone. The caller removes the folder when its run ends.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renamedEnv } from "@packages/env/aliases"

export const sandbox = () => {
  const scratch = mkdtempSync(join(tmpdir(), "test-sandbox-"))
  const home = join(scratch, "home")
  const bin = join(scratch, "bin")
  mkdirSync(home, { recursive: true })
  mkdirSync(bin)
  const fake = (name: string, why: string) => {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "the test sandbox stopped a real ${name} call: ${why} (sandbox.ts)" >&2\nexit 99\n`,
    )
    chmodSync(join(bin, name), 0o755)
  }
  fake("claude", "no test may start a session")
  fake("gh", "no test may reach GitHub; put a fake gh ahead of it on PATH")
  // uv's Pythons and cache stay the real home's, read before the swap, so a child's `uv run --python 3.13` downloads no CPython into the scratch home (66 MB, which under load ran past the unstick tests' timeouts)
  const uvBin = Bun.which("uv", { PATH: process.env.PATH ?? "" })
  const uv = (what: string) =>
    uvBin ? Bun.spawnSync([uvBin, what, "dir"], { env: process.env }).stdout.toString().trim() : ""
  const real = { UV_CACHE_DIR: uv("cache"), UV_PYTHON_INSTALL_DIR: uv("python") }
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...Object.fromEntries(Object.entries(real).filter(([, dir]) => dir)),
    CLAUDE_CONFIG_DIR: join(scratch, "claude-config"),
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PYTHONDONTWRITEBYTECODE: "1",
    TEST_SANDBOX_HOME: scratch,
    TZ: "UTC",
  }
  // a renamed env name reaches a child under its new name alone, as on a machine that set only the new one, so a test that clears the new name clears it whole
  for (const [name, value] of Object.entries(process.env)) {
    const renamed = renamedEnv(name)
    if (!renamed) continue
    delete env[name]
    env[renamed] ||= value
  }
  delete env.PLAYGROUND_DATA_DIR
  return { env, scratch }
}
