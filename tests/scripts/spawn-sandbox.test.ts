import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

import { FACTORY_SETTINGS, launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// The main checkout spawn.sh resolves, git's common dir less .git, whose tree a sandboxed session may not write.
const main = dirname(
  Bun.spawnSync(["git", "-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"])
    .stdout.toString()
    .trim(),
)
const temp = Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trim()

const sandboxOf = (home: string, data = join(home, ".playground")) => ({
  allowUnsandboxedCommands: false,
  enabled: true,
  enableWeakerNetworkIsolation: true,
  excludedCommands: ["docker ps", "docker ps *"],
  failIfUnavailable: true,
  filesystem: {
    allowWrite: [
      data,
      join(home, ".agent-browser"),
      join(home, ".bun", "install", "cache"),
      join(home, ".cache", "turbo"),
      join(home, ".portless"),
      ...(temp ? [temp.replace(/\/$/, "")] : []),
    ].sort(),
    denyWrite: expect.any(Array),
  },
  network: {
    allowLocalBinding: true,
    allowUnixSockets: [join(data, "herdr"), join(home, ".agent-browser")].sort(),
  },
})

const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
// The extensions root, the data folder's extensions folder (extensionsDir in packages/settings/src/rendered.ts).
const extensionsOf = (home: string, data = join(home, ".playground")) => join(data, "extensions")
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

describe("a probe runs its shell commands in Claude Code's sandbox", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"

  test.each([
    ["a probe in its own workspace", ["probe", "probe-x", "ops", "p.md"]],
    ["a probe's column", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md"]],
  ])("%s starts with the sandbox's settings file", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    const file = "factory-settings-sandbox-400k.json"
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, file)} --dangerously-skip-permissions`,
    )
    expect(builtOf(r, file)).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
      sandbox: sandboxOf(r.home),
    })
    expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
  })

  test("a probe whose folder is the main checkout can write no entry of it, .git and .claude/worktrees included", async () => {
    const r = await spawn(["resume", "probe-x", main, id], [], {}, undefined, {
      name: "probe-x",
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    const { denyWrite } = builtOf(r, "factory-settings-sandbox-400k.json").sandbox.filesystem
    expect(denyWrite.filter((path: string) => path !== extensionsOf(r.home))).toEqual(
      readdirSync(main)
        .sort()
        .map((name) => join(main, name)),
    )
    expect(denyWrite).toContain(join(main, ".git"))
    expect(denyWrite).toContain(join(main, ".claude"))
  })

  test("a probe in the checkout the suite runs from writes its own folder alone: .git, every other worktree and the rest of the main checkout are denied", async () => {
    const r = await spawn(["probe", "probe-x", "ops", "p.md"], [])
    expect(r.code, r.err).toBe(0)
    const { denyWrite } = builtOf(r, "factory-settings-sandbox-400k.json").sandbox.filesystem
    const own = realpathSync(root)
    const covered = (path: string) =>
      denyWrite.some((d: string) => path === d || path.startsWith(`${d}/`))
    expect(covered(own)).toBe(false)
    expect(covered(join(main, ".git"))).toBe(true)
    expect(covered(join(main, "scripts"))).toBe(true)
    const worktrees = join(main, ".claude", "worktrees")
    const others = existsSync(worktrees)
      ? readdirSync(worktrees)
          .map((name) => join(worktrees, name))
          .filter((path) => path !== own)
      : []
    expect(others.filter((path) => !covered(path))).toEqual([])
    expect(
      denyWrite.filter(
        (path: string) => !path.startsWith(`${main}/`) && path !== extensionsOf(r.home),
      ),
    ).toEqual([])
  })

  test("a probe resumed in scripts/hooks writes that folder alone, in every checkout", async () => {
    const own = join(main, "scripts", "hooks")
    const r = await spawn(["resume", "probe-x", own, id], [], {}, undefined, {
      name: "probe-x",
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    const { denyWrite } = builtOf(r, "factory-settings-sandbox-400k.json").sandbox.filesystem
    const covered = (path: string) =>
      denyWrite.some((d: string) => path === d || path.startsWith(`${d}/`))
    expect(covered(own)).toBe(false)
    expect(covered(join(main, "scripts", "spawn.sh"))).toBe(true)
    expect(covered(join(main, ".git"))).toBe(true)
    expect(covered(join(main, "README.md"))).toBe(true)
  })

  test.each([
    ["the data folder in the home", {}, ".playground"],
    ["a scratch data folder", { SCRATCH_DATA: "1" }, "scratch-data"],
  ])(
    "a probe on %s can write nothing under the extensions root, while the rest of the data folder stays writable",
    async (_, env, folder) => {
      const r = await spawn(["probe", "probe-x", "ops", "p.md"], [], env)
      expect(r.code, r.err).toBe(0)
      const file = join(r.home, folder, "factory-settings-sandbox-400k.json")
      const { allowWrite, denyWrite } = JSON.parse(readFileSync(file, "utf8")).sandbox.filesystem
      expect(denyWrite).toContain(extensionsOf(r.home, join(r.home, folder)))
      expect(allowWrite).toContain(join(r.home, folder))
    },
  )

  test("a resumed probe keeps the sandbox", async () => {
    const name = "probe-x"
    const r = await spawn(["resume", name, root, id], [], {}, undefined, {
      name,
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    const file = "factory-settings-sandbox-400k.json"
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).sandbox).toEqual(sandboxOf(r.home))
  })

  test("a probe on GLM keeps the sandbox in GLM's own file", async () => {
    const r = await spawn(
      ["column", "probe", "probe-x", "ops", "w1:p2", "p.md", "--backend", "glm"],
      [],
    )
    expect(r.code, r.err).toBe(0)
    const built = builtOf(r, "factory-settings-glm-sandbox-400k.json")
    expect(built.sandbox).toEqual(sandboxOf(r.home))
    expect(built.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0")
  })

  // the dispatcher reads a file of its own, since the memory trial starts it on (ADR 0022), and the optimizer the managers' shared file (spawn-manager-deny.test.ts)
  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"], "factory-settings-400k.json"],
    ["a runner", ["runner", "runner-calm-heron", "b.md"], "factory-settings-400k.json"],
    [
      "a reviewer",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1"],
      "factory-settings-400k.json",
    ],
    [
      "a tester",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1"],
      "factory-settings-400k.json",
    ],
    [
      "the dispatcher",
      ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"],
      "factory-settings-400k-memory-dispatcher.json",
    ],
    ["an optimizer", ["manager", "optimizer", "b.md"], "factory-settings-manager-400k.json"],
  ])("%s keeps today's settings, with no sandbox", async (_, args, file) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).sandbox).toBeUndefined()
  })
})
