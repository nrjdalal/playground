// The sandbox test-sandbox.ts and test-skills.ts run their children in: HOME and CLAUDE_CONFIG_DIR in a fresh scratch folder, PLAYGROUND_DATA_DIR unset so the data folder is the scratch HOME's ~/.playground, and a fake claude and a fake gh first on PATH and a .gitconfig refusing git's network transports, so no test or check can start a real session, reach GitHub (make a repo, post a comment, read a remote with a real credential) or write the real ~/.claude or ~/.playground; a test isolates through PLAYGROUND_DATA_DIR or a scratch HOME, since CLAUDE_CONFIG_DIR never places the data folder. TMPDIR is the scratch folder's short t folder, so every temp folder a test or its child makes with tmpdir() or a Python tempfile goes with the scratch, where those it left behind once held 24,008 entries in the caller's temp folder (issue 1306), and the short name keeps a Unix socket under it within macOS's 104-byte path cap. TZ=UTC, so a child reads the same zone on the Mac and the runner box; a child env that sets its own TZ keeps it. uv's Pythons and cache stay the real home's. PLAYGROUND_PROC names a folder that does not exist, so a machine reading a test leaves to Linux's /proc (packages/scripts/src/ops-machine/readings.ts) reads nothing on the Linux runner rather than its real load; a test of a Linux reading points it at recorded text. PYTHONDONTWRITEBYTECODE=1 keeps a Python child from leaving `__pycache__` in the worktree, where an ignored stale `.pyc` outlives its source. TEST_SANDBOX_HOME names the folder; each fake exits non-zero and names the sandbox, so a child that reaches one by mistake fails loudly, and a test that needs gh's output puts its own fake ahead of it. Every other variable comes from the caller through SANDBOX_KEYS alone (boxEnv), so one naming live state by an absolute path, such as PORTLESS_STATE_DIR, a herdr socket or the data folder, never reaches a test. The folder is a makeScratch folder, which the caller removes with removeScratch when its run ends.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeScratch } from "@packages/safe-delete"

import { BOX_ENV_KEYS, boxEnv } from "./box-env"

// The caller's variables a test or check still reads: the suite's own switches and Docker's socket; every other one, the live state an absolute path names included, stays out
export const SANDBOX_KEYS: readonly string[] = [
  ...BOX_ENV_KEYS,
  "CI",
  "CLAUDECODE",
  "CLOCK_AHEAD_DAYS",
  "DOCKER_HOST",
  "NODE_ENV",
  "SKIP_ENV_VALIDATION",
]

export const sandbox = () => {
  const scratch = makeScratch("test-sandbox-")
  const home = join(scratch, "home")
  const bin = join(scratch, "bin")
  const tmp = join(scratch, "t")
  mkdirSync(home, { recursive: true })
  mkdirSync(bin)
  mkdirSync(tmp)
  const fake = (name: string, why: string) => {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "the test sandbox stopped a real ${name} call: ${why} (sandbox.ts)" >&2\nexit 99\n`,
    )
    chmodSync(join(bin, name), 0o755)
  }
  fake("claude", "no test may start a session")
  fake("gh", "no test may reach GitHub; put a fake gh ahead of it on PATH")
  // a push scan's git ls-remote of a test's GitHub URL would otherwise reach GitHub with the credential helper's real token
  writeFileSync(
    join(home, ".gitconfig"),
    ["git", "http", "https", "ssh"].map((p) => `[protocol "${p}"]\n\tallow = never\n`).join(""),
  )
  // uv's Pythons and cache stay the real home's, read before the swap, so a child's `uv run --python 3.13` downloads no CPython into the scratch home (66 MB, which under load ran past the unstick tests' timeouts)
  const uvBin = Bun.which("uv", { PATH: process.env.PATH ?? "" })
  const uv = (what: string) =>
    uvBin ? Bun.spawnSync([uvBin, what, "dir"], { env: process.env }).stdout.toString().trim() : ""
  const env = boxEnv(
    home,
    {
      CLAUDE_CONFIG_DIR: join(scratch, "claude-config"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PLAYGROUND_PROC: join(scratch, "no-proc"),
      PYTHONDONTWRITEBYTECODE: "1",
      TEST_SANDBOX_HOME: scratch,
      TMPDIR: tmp,
      TZ: "UTC",
      UV_CACHE_DIR: uv("cache") || undefined,
      UV_PYTHON_INSTALL_DIR: uv("python") || undefined,
    },
    SANDBOX_KEYS,
  )
  return { env, scratch }
}
