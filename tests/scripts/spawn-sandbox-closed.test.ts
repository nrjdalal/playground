import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import {
  bin,
  FACTORY_SETTINGS,
  LSTART,
  launchAfterRm,
  launchOf,
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
// Each closed session builds a file of its own, since its allow list names its own worktree.
const closedFile = (name: string) => `factory-settings-sandbox-closed-400k-${name}.json`

// What git writes in a main checkout's common dir for a fetch, a commit and a push.
const gitWrites = (main: string) =>
  ["FETCH_HEAD", "logs", "objects", "refs"].map((entry) => join(main, ".git", entry))
// The main checkout spawn.sh resolves from this checkout, git's common dir less .git, and this checkout with its .git/worktrees entry when it is a linked worktree, where a probe or a resume here runs.
const gitOf = (...args: string[]) =>
  Bun.spawnSync(["git", "-C", root, "rev-parse", "--path-format=absolute", ...args])
    .stdout.toString()
    .trim()
const main = dirname(gitOf("--git-common-dir"))
const here = [
  ...gitWrites(main),
  ...(gitOf("--git-dir") === join(main, ".git") ? [] : [realpathSync(root), gitOf("--git-dir")]),
]

// A main checkout of its own with spawn.sh in it and an origin on GitHub, so a fresh closed start makes its worktree here rather than in the checkout the suite runs from; it holds another session's worktree and a worktree a worker's --in can name.
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
  git("remote", "add", "origin", "https://github.com/acme/app.git")
  for (const name of ["worker-other", "pg-9-x"])
    git("worktree", "add", "-q", "--detach", join(".claude", "worktrees", name))
  git("fetch", "-q", ".", "canary")
  return { env: { PLAYGROUND_REPO: main }, main, spawnSh: join(main, "scripts", "spawn.sh") }
}
// The worktree a fresh closed start makes and runs in, with its .git/worktrees entry, and what git writes in the common dir.
const treeOf = (main: string, leaf: string) => join(main, ".claude", "worktrees", leaf)
const workOf = (main: string, leaf: string) => [
  treeOf(main, leaf),
  join(main, ".git", "worktrees", leaf),
  ...gitWrites(main),
]

// --sandbox starts a worker, a reviewer or a probe in the closed sandbox: the probe's block, with loopback, the Keychain and the data folder's secret files closed to its shell commands, outbound hosts held to the list a worker's loop needs, and the worktree it runs in writable.
const closedOf = (home: string, work: string[], data = join(home, ".playground")) => ({
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
      ...work,
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

  // A worker's start in a scratch checkout reads only, since that checkout holds no run-slot for the slots gate to read.
  test.each([
    [
      "a worker",
      "worker-brave-otter",
      "worker-brave-otter",
      ["worker", "worker-brave-otter", "b.md", "--reads-only", "--sandbox"],
    ],
    [
      "a reviewer's column",
      "reviewer-x",
      "review-1",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1", "--sandbox"],
    ],
  ])(
    "%s starts on the closed sandbox's file, and its row records it",
    async (_, name, leaf, args) => {
      const { env, main, spawnSh } = checkout()
      const r = await spawn(args, [], env, spawnSh)
      expect(r.code, r.err).toBe(0)
      expect(launchAfterRm(r)).toContain(
        ` --settings ${settingsOf(r, closedFile(name))} --dangerously-skip-permissions`,
      )
      expect(builtOf(r, closedFile(name))).toEqual({
        ...FACTORY_SETTINGS,
        autoCompactWindow: 400000,
        enabledPlugins: { "ws-home@ws": false },
        env: { ...FACTORY_SETTINGS.env, ...UNSIGNED },
        sandbox: closedOf(r.home, workOf(main, leaf)),
      })
      expect(r.roster).toContain("sandbox=on")
      expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
      expect(existsSync(settingsOf(r, "factory-settings-sandbox-400k.json"))).toBe(false)
    },
  )

  test.each([
    ["a probe", ["--sandbox", "probe", "probe-x", "ops", "p.md"]],
    ["a probe's column", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md", "--sandbox"]],
  ])("%s starts on the closed sandbox's file in the folder it starts in today", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closedFile("probe-x"))} `)
    expect(builtOf(r, closedFile("probe-x")).sandbox).toEqual(closedOf(r.home, here))
    expect(r.roster).toContain("sandbox=on")
  })

  test("an open start, --no-sandbox here as spawn-fake gives, records nothing new on its row", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster?.some((word) => word.startsWith("sandbox="))).toBe(false)
  })

  // an open respawn under the same name clears the row's sandbox=on, so a later resume or restore keeps the settings this start took
  test("an open start over a row that records it clears the key and starts on the open file", async () => {
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
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closedFile(name))} `)
    expect(builtOf(r, closedFile(name)).sandbox).toEqual(closedOf(r.home, here))
    expect(r.roster).toContain("sandbox=on")
  })

  // GLM's start reads settings this checkout's resolver alone holds, so it runs here, in a folder its --in names, where spawn.sh makes no worktree.
  test("a worker on GLM takes the closed sandbox in GLM's own file", async () => {
    const r = await spawn(
      [
        "worker",
        "worker-brave-otter",
        "b.md",
        "--backend",
        "glm",
        "--in",
        "{home}/code",
        "--sandbox",
      ],
      [],
    )
    expect(r.code, r.err).toBe(0)
    const built = builtOf(r, "factory-settings-glm-sandbox-closed-400k-worker-brave-otter.json")
    expect(built.sandbox).toEqual(closedOf(r.home, gitWrites(main)))
    expect(built.env).toMatchObject({ ...UNSIGNED, CLAUDE_CODE_ENABLE_TELEMETRY: "0" })
  })

  test("a worker on a scratch data folder has that folder's secret files closed", async () => {
    const { env, main, spawnSh } = checkout()
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--reads-only", "--sandbox"],
      [],
      { ...env, SCRATCH_DATA: "1" },
      spawnSh,
    )
    expect(r.code, r.err).toBe(0)
    const data = join(r.home, "scratch-data")
    const built = JSON.parse(readFileSync(join(data, closedFile("worker-brave-otter")), "utf8"))
    expect(built.sandbox).toEqual(closedOf(r.home, workOf(main, "worker-brave-otter"), data))
  })
})

// Claude Code's sandbox keeps the repository's .git/worktrees read-only but for the folder a session starts in, so a fresh closed worker or reviewer starts in a worktree spawn.sh makes for it; inside, it writes that worktree, its .git/worktrees entry, FETCH_HEAD, objects, refs and logs, but never main's or canary's ref, another session's worktree or the rest of .git (#2052).
describe("the closed sandbox lets a session work in its own worktree", () => {
  const filesystemOf = (home: string, name: string) =>
    JSON.parse(readFileSync(join(home, ".playground", closedFile(name)), "utf8")).sandbox
      .filesystem as { allowWrite: string[]; denyWrite: string[] }
  const under = (paths: string[]) => (path: string) =>
    paths.some((p) => path === p || path.startsWith(`${p}/`))
  // What a fetch, a branch made with git switch -c, a commit and a push write, measured in a scratch clone.
  const own = (main: string, leaf: string) => [
    treeOf(main, leaf),
    join(main, ".git", "worktrees", leaf),
    join(main, ".git", "FETCH_HEAD"),
    join(main, ".git", "objects", "pack"),
    join(main, ".git", "refs", "heads", "PG-1-x"),
    join(main, ".git", "refs", "remotes", "origin", "canary"),
    join(main, ".git", "logs", "refs", "heads", "PG-1-x"),
    join(main, ".git", "logs", "refs", "remotes", "origin", "canary"),
  ]
  // The branches the main checkout, the merge flow and the live dashboard (live.branch) follow, another session's worktree and the rest of .git and the checkout.
  const branchesOf = (main: string, live: string) =>
    ["canary", "main", live].flatMap((branch) => [
      join(main, ".git", "refs", "heads", branch),
      join(main, ".git", "logs", "refs", "heads", branch),
    ])
  const shut = (main: string) => [
    ...branchesOf(main, "live/dashboard"),
    treeOf(main, "worker-other"),
    join(main, ".git", "worktrees", "worker-other"),
    join(main, ".git", "config"),
    join(main, ".git", "HEAD"),
    join(main, ".git", "hooks"),
    join(main, ".git", "index"),
    join(main, ".git", "packed-refs"),
    join(main, "scripts"),
  ]
  // A worktree git lists, detached, and the launch moving into it.
  const startsIn = (r: { home: string }, main: string, leaf: string) => {
    const listed = Bun.spawnSync([
      "git",
      "-C",
      main,
      "worktree",
      "list",
      "--porcelain",
    ]).stdout.toString()
    expect(listed).toContain(`worktree ${treeOf(main, leaf)}\nHEAD `)
    expect(
      listed.split("\n\n").find((b) => b.startsWith(`worktree ${treeOf(main, leaf)}\n`)),
    ).toContain("\ndetached")
    expect(launchOf(r)).toContain(`\ncd ${treeOf(main, leaf)} || exit 1\n`)
  }

  test.each([
    [
      "a reviewer of this checkout's PR by its number, in its review clone",
      "reviewer-x",
      "review-1",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1"],
    ],
    [
      "a reviewer of this checkout's PR by its URL, in its review clone",
      "reviewer-x",
      "review-7",
      [
        "column",
        "reviewer",
        "reviewer-x",
        "worker-x",
        "w1:p2",
        "r.md",
        "--pr",
        "https://github.com/acme/app/pull/7",
      ],
    ],
    [
      "a reviewer of another repo's PR, in a worktree by its name",
      "reviewer-x",
      "reviewer-x",
      [
        "column",
        "reviewer",
        "reviewer-x",
        "worker-x",
        "w1:p2",
        "r.md",
        "--pr",
        "https://github.com/acme/web/pull/7",
      ],
    ],
    [
      "a worker, in a worktree by its name",
      "worker-x",
      "worker-x",
      ["worker", "worker-x", "b.md", "--reads-only"],
    ],
  ])(
    "%s starts in a detached worktree spawn.sh makes, and writes it, its git entry, FETCH_HEAD, objects, refs and logs, and nothing of another session's",
    async (_, name, leaf, args) => {
      const { env, main, spawnSh } = checkout()
      const r = await spawn([...args, "--sandbox"], [], env, spawnSh)
      expect(r.code, r.err).toBe(0)
      startsIn(r, main, leaf)
      expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closedFile(name))} `)
      const { allowWrite, denyWrite } = filesystemOf(r.home, name)
      for (const path of own(main, leaf)) {
        expect(under(allowWrite)(path), path).toBe(true)
        expect(under(denyWrite)(path), path).toBe(false)
      }
      for (const path of shut(main)) expect(under(denyWrite)(path), path).toBe(true)
      expect(under(allowWrite)(treeOf(main, "worker-other"))).toBe(false)
      expect(under(allowWrite)(join(main, ".git", "worktrees", "worker-other"))).toBe(false)
    },
  )

  test("a worker whose --in names a worktree starts there, with no worktree made, and writes it and its git entry", async () => {
    const { env, main, spawnSh } = checkout()
    const tree = treeOf(main, "pg-9-x")
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--in", tree, "--reads-only", "--sandbox"],
      [],
      env,
      spawnSh,
    )
    expect(r.code, r.err).toBe(0)
    expect(existsSync(treeOf(main, "worker-brave-otter"))).toBe(false)
    expect(launchOf(r)).toContain(`\ncd ${tree} || exit 1\n`)
    const { allowWrite, denyWrite } = filesystemOf(r.home, "worker-brave-otter")
    for (const path of own(main, "pg-9-x")) {
      expect(under(allowWrite)(path), path).toBe(true)
      expect(under(denyWrite)(path), path).toBe(false)
    }
    for (const path of shut(main)) expect(under(denyWrite)(path), path).toBe(true)
  })

  test("a live.branch of its own stays shut in place of the default", async () => {
    const { env, main, spawnSh } = checkout()
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--reads-only", "--sandbox"],
      [],
      { ...env, SETTINGS_JSON: JSON.stringify({ "live.branch": "live/board" }) },
      spawnSh,
    )
    expect(r.code, r.err).toBe(0)
    const { allowWrite, denyWrite } = filesystemOf(r.home, "worker-x")
    for (const path of branchesOf(main, "live/board")) {
      expect(under(allowWrite)(path), path).toBe(true)
      expect(under(denyWrite)(path), path).toBe(true)
    }
    expect(under(denyWrite)(join(main, ".git", "refs", "heads", "live", "dashboard"))).toBe(false)
  })

  test("a start with --no-sandbox makes no worktree", async () => {
    const { env, main, spawnSh } = checkout()
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--reads-only", "--no-sandbox"],
      [],
      env,
      spawnSh,
    )
    expect(r.code, r.err).toBe(0)
    expect(existsSync(treeOf(main, "worker-x"))).toBe(false)
  })

  // The file holds the session's own worktree, so each start writes its own, and a later start never rewrites the file a live session runs on.
  test("two starts write two files, each holding its own session's worktree alone", async () => {
    const { env, main, spawnSh } = checkout()
    // the memory trial alternates a worker's arm, and its arm on names a file of its own, so both starts keep it off
    const start = ["b.md", "--memory", "off", "--reads-only", "--sandbox"]
    const first = (home: string) => {
      const run = Bun.spawnSync(
        ["bash", spawnSh, "--title", "Plain test work", "worker", "worker-one", ...start],
        { env: { FAKE_LSTART: LSTART, HOME: home, PATH: `${bin}:${process.env.PATH}`, ...env } },
      )
      expect(run.exitCode, run.stderr.toString()).toBe(0)
    }
    const r = await spawn(["worker", "worker-x", ...start], [], env, spawnSh, undefined, first)
    expect(r.code, r.err).toBe(0)
    const x = filesystemOf(r.home, "worker-x")
    const one = filesystemOf(r.home, "worker-one")
    expect(under(x.allowWrite)(treeOf(main, "worker-x"))).toBe(true)
    expect(under(x.denyWrite)(treeOf(main, "worker-one"))).toBe(true)
    expect(under(one.allowWrite)(treeOf(main, "worker-one"))).toBe(true)
    expect(under(one.allowWrite)(treeOf(main, "worker-x"))).toBe(false)
    expect(
      existsSync(join(r.home, ".playground", "factory-settings-sandbox-closed-400k.json")),
    ).toBe(false)
  })
})

// The closed sandbox refuses every Keychain read, so a start from inside it cannot tell an --account's item is there; the new pane's shell, outside the sandbox, still stops on a missing one before claude runs.
// issue 2059: a fresh worker's or reviewer's start that works in this checkout takes the closed sandbox with no flag, and --no-sandbox, which a stack worker gives, opts it out.
describe("the closed sandbox is the default for a worker or reviewer with no stack", () => {
  // SANDBOX_DEFAULT keeps spawn-fake from opting the case out, so spawn.sh's own default decides.
  const fresh = { SANDBOX_DEFAULT: "1" }
  const reviewer = ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]

  test.each([
    [
      "a worker",
      "worker-brave-otter",
      "worker-brave-otter",
      ["worker", "worker-brave-otter", "b.md", "--reads-only"],
    ],
    [
      "a reviewer's column of this checkout's PR",
      "reviewer-x",
      "review-1",
      [...reviewer, "--pr", "1"],
    ],
  ])(
    "%s with no flag starts on the closed sandbox's file in a worktree made for it",
    async (_, name, leaf, args) => {
      const { env, main, spawnSh } = checkout()
      const r = await spawn(args, [], { ...env, ...fresh }, spawnSh)
      expect(r.code, r.err).toBe(0)
      expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closedFile(name))} `)
      expect(builtOf(r, closedFile(name)).sandbox).toEqual(closedOf(r.home, workOf(main, leaf)))
      expect(existsSync(treeOf(main, leaf))).toBe(true)
      expect(r.roster).toContain("sandbox=on")
    },
  )

  test.each([
    [
      "a worker",
      "worker-brave-otter",
      ["worker", "worker-brave-otter", "b.md", "--reads-only", "--no-sandbox"],
    ],
    ["a reviewer's column", "review-1", [...reviewer, "--pr", "1", "--no-sandbox"]],
  ])(
    "%s with --no-sandbox starts on the open file, with no worktree made",
    async (_, leaf, args) => {
      const { env, main, spawnSh } = checkout()
      const r = await spawn(args, [], { ...env, ...fresh }, spawnSh)
      expect(r.code, r.err).toBe(0)
      expect(launchAfterRm(r)).toContain(
        ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
      )
      expect(existsSync(treeOf(main, leaf))).toBe(false)
      expect(r.roster?.some((word) => word.startsWith("sandbox="))).toBe(false)
    },
  )

  // A tester drives a stack, a worker's --in names a folder the lead picked, and another repository's PR is no worktree of this checkout, so each keeps the open file.
  test.each([
    [
      "a tester's column",
      "tester-x",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1"],
    ],
    [
      "a worker with --in",
      "worker-brave-otter",
      ["worker", "worker-brave-otter", "b.md", "--in", "{home}/code", "--reads-only"],
    ],
    [
      "a reviewer of another repository's PR",
      "reviewer-x",
      [...reviewer, "--pr", "https://github.com/acme/other/pull/7"],
    ],
  ])("%s with no flag starts on the open file", async (_, name, args) => {
    const { env, main, spawnSh } = checkout()
    const r = await spawn(args, [], { ...env, ...fresh }, spawnSh)
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
    expect(existsSync(treeOf(main, name))).toBe(false)
  })

  test("a resume of a row that records no sandbox stays on the open file", async () => {
    const name = "worker-brave-otter"
    const r = await spawn(
      ["resume", name, root, "b8f48a29-2ab2-4dc3-b37f-5a0525fe5c38"],
      [],
      {
        ...fresh,
        ROSTER_JSON: JSON.stringify({
          agents: [{ kind: "worker", name, role: "worker", status: "working" }],
        }),
      },
      undefined,
      { name, backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
  })

  test.each([
    [
      "a tester",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1", "--no-sandbox"],
      "not a tester's",
    ],
    ["a probe", ["probe", "probe-x", "ops", "p.md", "--no-sandbox"], "not a probe's"],
    ["a runner", ["runner", "runner-calm-heron", "b.md", "--no-sandbox"], "not a runner's"],
    ["a manager", ["manager", "optimizer", "b.md", "--no-sandbox"], "not a manager's"],
  ])("--no-sandbox is refused for %s before herdr runs", async (_, args, which) => {
    const r = await spawn(args, [], fresh)
    expect(r.code).toBe(2)
    expect(r.err).toContain(`--no-sandbox is for a worker's or a reviewer's start, ${which}`)
    expect(r.roster).toBeUndefined()
  })

  test("--sandbox beside --no-sandbox is refused before herdr runs", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--sandbox", "--no-sandbox"],
      [],
      fresh,
    )
    expect(r.code).toBe(2)
    expect(r.err).toContain("--sandbox and --no-sandbox are each other's opposite; give one")
    expect(r.roster).toBeUndefined()
  })
})

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
