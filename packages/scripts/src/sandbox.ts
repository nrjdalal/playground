// The sandbox test-sandbox.ts and test-skills.ts run their children in: HOME and CLAUDE_CONFIG_DIR in a fresh scratch folder, PLAYGROUND_DATA_DIR unset so the data folder is the scratch HOME's ~/.playground, and a fake claude, gh, herdr, launchctl, loginctl, portless and systemctl first on PATH and a .gitconfig refusing git's network transports, so no test or check can start a real session, reach GitHub (make a repo, post a comment, read a remote with a real credential), close a live herdr pane, start or stop a live ops job or the live proxy, or write the real ~/.claude or ~/.playground; a test isolates through PLAYGROUND_DATA_DIR or a scratch HOME, since CLAUDE_CONFIG_DIR never places the data folder. TMPDIR is the scratch folder's short t folder, so every temp folder a test or its child makes with tmpdir() or a Python tempfile goes with the scratch, where those it left behind once held 24,008 entries in the caller's temp folder (issue 1306), and the short name keeps a Unix socket under it within macOS's 104-byte path cap. TZ=UTC, so a child reads the same zone on the Mac and the runner box; a child env that sets its own TZ keeps it. uv's Pythons and cache stay the real home's. PLAYGROUND_PROC names a folder that does not exist, so a machine reading a test leaves to Linux's /proc (packages/scripts/src/ops-machine/readings.ts) reads nothing on the Linux runner rather than its real load; a test of a Linux reading points it at recorded text. PYTHONDONTWRITEBYTECODE=1 keeps a Python child from leaving `__pycache__` in the worktree, where an ignored stale `.pyc` outlives its source. PORTLESS_STATE_DIR, XDG_RUNTIME_DIR, HERDR_CONFIG_PATH and HERDR_SOCKET_PATH name folders in the scratch, so a call that gets past a fake by an absolute path still finds no live proxy, user bus or herdr server; tests/live-tools-scan.test.ts fails on such a call in a test. TEST_SANDBOX_HOME names the folder; each fake exits non-zero and names the sandbox, so a child that reaches one by mistake fails loudly, and a test that needs a tool's output puts its own fake ahead of it. Every other variable comes from the caller through SANDBOX_KEYS alone (boxEnv), so one naming live state by an absolute path, such as a herdr session, the user's DBUS_SESSION_BUS_ADDRESS or the data folder, never reaches a test, nor does a git hook's GIT_DIR or GIT_INDEX_FILE, which would turn a test's scratch git init or commit onto the real repository. The folder is a makeScratch folder, which the caller removes with removeScratch when its run ends.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeScratch } from "@packages/safe-delete"

import { BOX_ENV_KEYS, boxEnv } from "./box-env"

// The caller's variables a test or check still reads: the suite's own switches, Docker's socket and the URLs `test:e2e` passes; every other one, the live state an absolute path names included, stays out
export const SANDBOX_KEYS: readonly string[] = [
  ...BOX_ENV_KEYS,
  "CI",
  "CLAUDECODE",
  "CLOCK_AHEAD_DAYS",
  "DOCKER_HOST",
  "E2E_API_URL",
  "E2E_POSTGRES_URL",
  "E2E_WEB_URL",
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
  // each of these changes the live machine: a herdr call can close a live session's pane, launchctl, loginctl and systemctl start or stop its ops jobs, and portless can stop or move the proxy every stack routes through
  const live: Record<string, string> = {
    herdr: "no test may reach a live herdr server",
    launchctl: "no test may load or stop a live launchd job",
    loginctl: "no test may change the user's login settings",
    portless: "no test may start, stop or install the live proxy",
    systemctl: "no test may start or stop a live systemd unit",
  }
  for (const [name, why] of Object.entries(live))
    fake(name, `${why}; put a fake ${name} ahead of it on PATH`)
  // the folders each tool reads its live state from, so even a call that gets past the fakes by an absolute path finds no live bus, proxy or herdr server
  const run = join(scratch, "run")
  mkdirSync(run)
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
      HERDR_CONFIG_PATH: join(scratch, "herdr", "config.toml"),
      HERDR_SOCKET_PATH: join(scratch, "herdr", "herdr.sock"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PLAYGROUND_PROC: join(scratch, "no-proc"),
      PORTLESS_STATE_DIR: join(scratch, "portless"),
      PYTHONDONTWRITEBYTECODE: "1",
      TEST_SANDBOX_HOME: scratch,
      TMPDIR: tmp,
      TZ: "UTC",
      UV_CACHE_DIR: uv("cache") || undefined,
      UV_PYTHON_INSTALL_DIR: uv("python") || undefined,
      XDG_RUNTIME_DIR: run,
    },
    SANDBOX_KEYS,
  )
  return { env, scratch }
}
