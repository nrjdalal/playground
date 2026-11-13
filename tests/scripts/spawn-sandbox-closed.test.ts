import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  bin,
  FACTORY_SETTINGS,
  LSTART,
  launchAfterRm,
  root,
  scratch,
  script,
  spawn,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const temp = Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trim()
const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

// --sandbox starts a worker, a reviewer or a probe in the closed sandbox: the probe's block, with loopback, the Keychain and the data folder's secret files closed to its shell commands, and outbound hosts held to the list a worker's loop needs.
const closedOf = (home: string, data = join(home, ".playground")) => ({
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
    denyRead: [
      join(home, "Library", "Keychains"),
      join(data, "dumps"),
      join(data, "remote-key.json"),
      join(data, "whatsapp"),
    ].sort(),
    // the secret files refuse writes as well as reads, beside the probe's main-checkout and extensions-root entries
    denyWrite: expect.arrayContaining(
      ["dumps", "remote-key.json", "whatsapp"].map((name) => join(data, name)),
    ),
  },
  network: {
    allowedDomains: ["api.github.com", "github.com", "registry.npmjs.org"],
    allowUnixSockets: [join(data, "herdr"), join(home, ".agent-browser")].sort(),
    strictAllowlist: true,
  },
})

// gpg needs writes to ~/.gnupg, which the closed sandbox keeps shut since gpg-agent runs the programs its config there names outside the sandbox, so a closed session's commits go unsigned through git's env config.
const UNSIGNED = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
}

describe("--sandbox starts a worker, a reviewer or a probe in the closed sandbox", () => {
  const id = "b8f48a29-2ab2-4dc3-b37f-5a0525fe5c38"
  const closed = "factory-settings-sandbox-closed-400k.json"

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md", "--sandbox"]],
    [
      "a reviewer's column",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1", "--sandbox"],
    ],
    ["a probe", ["--sandbox", "probe", "probe-x", "ops", "p.md"]],
    ["a probe's column", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md", "--sandbox"]],
  ])("%s starts on the closed sandbox's file, and its row records it", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, closed)} --dangerously-skip-permissions`,
    )
    expect(builtOf(r, closed)).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
      env: { ...FACTORY_SETTINGS.env, ...UNSIGNED },
      sandbox: closedOf(r.home),
    })
    expect(r.roster).toContain("sandbox=on")
    expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
    expect(existsSync(settingsOf(r, "factory-settings-sandbox-400k.json"))).toBe(false)
  })

  test("a start without it records nothing new on its row", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster?.some((word) => word.startsWith("sandbox="))).toBe(false)
  })

  // a respawn under the same name without the flag clears the row's sandbox=on, so a later resume or restore keeps the settings this start took
  test("a start without it over a row that records it clears the key and starts on the open file", async () => {
    const name = "worker-brave-otter"
    const r = await spawn(["worker", name, "b.md"], [], {
      ROSTER_JSON: JSON.stringify({
        agents: [{ kind: "worker", name, role: "worker", sandbox: "on", status: "ended" }],
      }),
    })
    expect(r.code, r.err).toBe(0)
    expect(r.roster).toContain("sandbox=")
    expect(r.roster).not.toContain("sandbox=on")
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
  })

  test.each([
    [
      "a tester",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1", "--sandbox"],
    ],
    ["a runner", ["runner", "runner-calm-heron", "b.md", "--sandbox"]],
    ["a manager", ["manager", "optimizer", "b.md", "--sandbox"]],
    ["a resume", ["resume", "worker-brave-otter", root, id, "--sandbox"]],
    ["a restore", ["restore", "--sandbox"]],
    ["a close", ["close", "worker-brave-otter", "--sandbox"]],
  ])("%s is refused it before herdr runs", async (_, args) => {
    const r = await spawn(args, [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "claude",
    })
    expect(r.code).toBe(2)
    expect(r.err).toContain("--sandbox is for a worker's, a reviewer's or a probe's start")
    expect(r.roster).toBeUndefined()
  })

  test("a resumed worker whose row records it keeps the closed sandbox", async () => {
    const name = "worker-brave-otter"
    const r = await spawn(
      ["resume", name, root, id],
      [],
      {
        ROSTER_JSON: JSON.stringify({
          agents: [{ kind: "worker", name, role: "worker", sandbox: "on", status: "working" }],
        }),
      },
      undefined,
      { name, backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closed)} `)
    expect(builtOf(r, closed).sandbox).toEqual(closedOf(r.home))
    expect(r.roster).toContain("sandbox=on")
  })

  test("a worker on GLM takes the closed sandbox in GLM's own file", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm", "--sandbox"],
      [],
    )
    expect(r.code, r.err).toBe(0)
    const built = builtOf(r, "factory-settings-glm-sandbox-closed-400k.json")
    expect(built.sandbox).toEqual(closedOf(r.home))
    expect(built.env).toMatchObject({ ...UNSIGNED, CLAUDE_CODE_ENABLE_TELEMETRY: "0" })
  })

  test("a worker on a scratch data folder has that folder's secret files closed", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--sandbox"], [], {
      SCRATCH_DATA: "1",
    })
    expect(r.code, r.err).toBe(0)
    const data = join(r.home, "scratch-data")
    const built = JSON.parse(readFileSync(join(data, closed), "utf8"))
    expect(built.sandbox).toEqual(closedOf(r.home, data))
  })
})

// A session in the closed sandbox makes, fetches and commits in its own worktree: it writes its own .claude/worktrees/<name> and .git/worktrees/<name>, the worktree it runs in, the main checkout's .git/FETCH_HEAD, objects, refs and logs, but never main's or canary's ref, another session's worktree or the rest of .git (#2052).
describe("the closed sandbox lets a session work in its own worktree", () => {
  const fileOf = (name: string) => `factory-settings-sandbox-closed-400k-${name}.json`
  // A main checkout of its own with spawn.sh in it, so the script's main checkout is this one, holding the session's worktree, another session's and a worker's --in worktree.
  const checkout = () => {
    const main = realpathSync(mkdtempSync(join(scratch, "main-2052-")))
    const git = (...args: string[]) =>
      expect(Bun.spawnSync(["git", ...args], { cwd: main, stderr: "ignore" }).exitCode).toBe(0)
    mkdirSync(join(main, "scripts"))
    writeFileSync(join(main, "scripts", "spawn.sh"), readFileSync(script))
    // spawn.sh resolves its data folder through the checkout's own resolver.
    mkdirSync(join(main, "packages", "env", "src"), { recursive: true })
    for (const file of ["aliases.ts", "data-dir.ts"])
      writeFileSync(
        join(main, "packages", "env", "src", file),
        readFileSync(join(root, "packages", "env", "src", file)),
      )
    git("init", "-q", "-b", "canary")
    git("add", ".")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
    git("branch", "main")
    for (const name of ["reviewer-x", "worker-x", "worker-other", "pg-9-x"])
      git("worktree", "add", "-q", "--detach", join(".claude", "worktrees", name))
    git("fetch", "-q", ".", "canary")
    return { main, spawnSh: join(main, "scripts", "spawn.sh") }
  }
  const filesystemOf = (home: string, name: string) =>
    JSON.parse(readFileSync(join(home, ".playground", fileOf(name)), "utf8")).sandbox
      .filesystem as { allowWrite: string[]; denyWrite: string[] }
  const under = (paths: string[]) => (path: string) =>
    paths.some((p) => path === p || path.startsWith(`${p}/`))
  // What a fetch, a worktree add -b, a commit and a push write in the common dir, measured in a scratch clone.
  const own = (main: string, name: string) => [
    join(main, ".claude", "worktrees", name),
    join(main, ".git", "worktrees", name),
    join(main, ".git", "FETCH_HEAD"),
    join(main, ".git", "objects", "pack"),
    join(main, ".git", "refs", "heads", "PG-1-x"),
    join(main, ".git", "refs", "remotes", "origin", "canary"),
    join(main, ".git", "logs", "refs", "heads", "PG-1-x"),
    join(main, ".git", "logs", "refs", "remotes", "origin", "canary"),
  ]
  // The branches the main checkout and the merge flow follow, another session's worktree and the rest of .git and the checkout.
  const shut = (main: string) => [
    join(main, ".claude", "worktrees", "worker-other"),
    join(main, ".git", "worktrees", "worker-other"),
    join(main, ".git", "refs", "heads", "canary"),
    join(main, ".git", "refs", "heads", "main"),
    join(main, ".git", "logs", "refs", "heads", "canary"),
    join(main, ".git", "logs", "refs", "heads", "main"),
    join(main, ".git", "config"),
    join(main, ".git", "HEAD"),
    join(main, ".git", "hooks"),
    join(main, ".git", "index"),
    join(main, ".git", "packed-refs"),
    join(main, "scripts"),
  ]

  // A worker's start in this scratch checkout reads only, since the checkout holds no run-slot for the slots gate to read.
  test.each([
    [
      "a reviewer's column",
      "reviewer-x",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1"],
    ],
    ["a worker", "worker-x", ["worker", "worker-x", "b.md", "--reads-only"]],
  ])(
    "%s writes its own worktree, its git entry, FETCH_HEAD, objects, refs and logs, and nothing of another session's",
    async (_, name, args) => {
      const { main, spawnSh } = checkout()
      const r = await spawn([...args, "--sandbox"], [], { PLAYGROUND_REPO: main }, spawnSh)
      expect(r.code, r.err).toBe(0)
      expect(launchAfterRm(r)).toContain(
        ` --settings ${join(r.home, ".playground", fileOf(name))} `,
      )
      const { allowWrite, denyWrite } = filesystemOf(r.home, name)
      for (const path of own(main, name)) {
        expect(under(allowWrite)(path), path).toBe(true)
        expect(under(denyWrite)(path), path).toBe(false)
      }
      for (const path of shut(main)) expect(under(denyWrite)(path), path).toBe(true)
      expect(under(allowWrite)(join(main, ".claude", "worktrees", "worker-other"))).toBe(false)
      expect(under(allowWrite)(join(main, ".git", "worktrees", "worker-other"))).toBe(false)
    },
  )

  test("a worker whose --in names a worktree writes that worktree and its git entry too", async () => {
    const { main, spawnSh } = checkout()
    const tree = join(main, ".claude", "worktrees", "pg-9-x")
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--in", tree, "--reads-only", "--sandbox"],
      [],
      { PLAYGROUND_REPO: main },
      spawnSh,
    )
    expect(r.code, r.err).toBe(0)
    const { allowWrite, denyWrite } = filesystemOf(r.home, "worker-brave-otter")
    for (const path of [
      ...own(main, "worker-brave-otter"),
      tree,
      join(main, ".git", "worktrees", "pg-9-x"),
    ]) {
      expect(under(allowWrite)(path), path).toBe(true)
      expect(under(denyWrite)(path), path).toBe(false)
    }
    for (const path of [...shut(main), join(main, ".claude", "worktrees", "worker-x")])
      expect(under(denyWrite)(path), path).toBe(true)
  })

  // The file holds the session's own name, so each start writes its own, and a later start never rewrites the file a live session runs on.
  test("two starts write two files, each holding its own session's worktree alone", async () => {
    const { main, spawnSh } = checkout()
    const env = { PLAYGROUND_REPO: main }
    const start = ["b.md", "--reads-only", "--sandbox"]
    const first = (home: string) => {
      const run = Bun.spawnSync(
        ["bash", spawnSh, "--title", "Plain test work", "worker", "worker-other", ...start],
        { env: { FAKE_LSTART: LSTART, HOME: home, PATH: `${bin}:${process.env.PATH}`, ...env } },
      )
      expect(run.exitCode, run.stderr.toString()).toBe(0)
    }
    const r = await spawn(["worker", "worker-x", ...start], [], env, spawnSh, undefined, first)
    expect(r.code, r.err).toBe(0)
    const tree = (name: string) => join(main, ".claude", "worktrees", name)
    const x = filesystemOf(r.home, "worker-x")
    const other = filesystemOf(r.home, "worker-other")
    expect(under(x.allowWrite)(tree("worker-x"))).toBe(true)
    expect(under(x.denyWrite)(tree("worker-other"))).toBe(true)
    expect(under(other.allowWrite)(tree("worker-other"))).toBe(true)
    expect(under(other.denyWrite)(tree("worker-x"))).toBe(true)
    expect(
      existsSync(join(r.home, ".playground", "factory-settings-sandbox-closed-400k.json")),
    ).toBe(false)
  })
})

// The closed sandbox refuses every Keychain read, so a start from inside it cannot tell an --account's item is there; the new pane's shell, outside the sandbox, still stops on a missing one before claude runs.
describe("a start from inside the sandbox leaves the Keychain check to the new pane", () => {
  const inside = { FAKE_NO_ITEM: "1", SANDBOX_RUNTIME: "1" }

  test("a Claude --account starts, naming the check it left", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      inside,
    )
    expect(r.code, r.err).toBe(0)
    expect(r.err).toContain(
      "the sandbox closes the Keychain to this shell, so the new pane checks the playground-claude-oauth item for spare@example.com",
    )
  })

  test("a GLM key starts, naming the check it left", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], inside)
    expect(r.code, r.err).toBe(0)
    expect(r.err).toContain(
      "the sandbox closes the Keychain to this shell, so the new pane checks the playground-glm item for zai",
    )
  })

  test("outside the sandbox a missing item is still refused", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      { FAKE_NO_ITEM: "1" },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "the Keychain holds no playground-claude-oauth item for spare@example.com",
    )
  })
})
