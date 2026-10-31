import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { OLD } from "../old-names"
import { storeWith } from "./hooks/render-set"
import {
  bin,
  BRIEF_AT,
  execLine,
  fake,
  herdrCalls,
  herdrPin,
  launchAfterRm,
  launchOf,
  LSTART,
  lw,
  opened,
  placing,
  projectOf,
  ranIn,
  resumeFile,
  root,
  scratch,
  script,
  Session,
  SID,
  spawn,
  TOKEN,
  transcript,
  typed,
  unplugged,
  usage,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// OLD.dispatcher: "spawn.sh must refuse a missing brief in every start mode, not only on resume."
describe("a start refuses a brief that is not a file (#1471)", () => {
  // Every row carries a setup, since test.each hands a shorter row's callback a done function in its place.
  const none = () => {}
  const STARTS: [string, string[], string, (home: string) => void][] = [
    ["worker", ["worker", "worker-brave-otter", "brief-x.md"], "worker-brave-otter", none],
    ["runner", ["runner", "runner-calm-heron", "brief-r.md"], "runner-calm-heron", none],
    [
      "column",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "handoffs/rev.md"],
      "reviewer-x",
      none,
    ],
    [
      "manager",
      ["manager", `${OLD.dispatcher}-2`, `brief-${OLD.dispatcher}-2.md`, "--backend", "glm"],
      `${OLD.dispatcher}-2`,
      none,
    ],
    [
      "probe",
      ["probe", "probe-herdr-a", OLD.ops, "b.md", "--runtime", "herdr"],
      "probe-herdr-a",
      herdrPin(),
    ],
  ]

  test.each(STARTS)(
    "a %s start whose brief is missing refuses, naming it",
    async (_, args, __, setup) => {
      const brief = args[BRIEF_AT[args[0] ?? ""] ?? -1]
      const r = await spawn(
        [...args, "--check"],
        [],
        { NO_BRIEF_FILE: "1" },
        undefined,
        undefined,
        setup,
      )
      expect(r.code).toBe(1)
      expect(r.err).toContain(`~/.playground/${brief} is not a file`)
      expect(r.cmux).toBeUndefined()
      expect(r.roster).toBeUndefined()
      expect(existsSync(lw(r.home, "ops", "capacity.jsonl"))).toBe(false)
    },
  )

  test.each(STARTS)(
    "a %s start whose brief is there passes the check",
    async (_, args, name, setup) => {
      const r = await spawn([...args, "--check"], [], {}, undefined, undefined, setup)
      expect(r.err).not.toContain("is not a file")
      expect(r.out).toContain(`ok: ${name} can start`)
      expect(r.code).toBe(0)
      expect(existsSync(lw(r.home, "ops", "capacity.jsonl"))).toBe(true)
    },
  )

  test("a start whose brief word is empty refuses before any gate", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "", "--check"], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("a brief is a file name under ~/.playground")
    expect(r.cmux).toBeUndefined()
    expect(existsSync(lw(r.home, "ops", "capacity.jsonl"))).toBe(false)
  })
})

// OLD.builder: given the brief's absolute path, spawn.sh refused with a path nobody typed.
describe("a brief given by its path under ~/.playground starts as its file name does (#1538)", () => {
  const seen = (r: Awaited<ReturnType<typeof spawn>>) => ({
    // each herdr start takes a session id of its own
    launch: launchOf(r)
      .replaceAll(r.home, "HOME")
      .replace(/--session-id [0-9a-f-]{36}/, "--session-id SID"),
    roster: r.roster,
  })

  test.each([
    ["an absolute path", "{home}/.playground/brief-x.md"],
    ["a quoted ~ path", "~/.playground/brief-x.md"],
  ])("%s starts the same session, its prompt naming the file", async (_, path) => {
    const bare = await spawn(["worker", "worker-brave-otter", "brief-x.md"], [])
    const r = await spawn(["worker", "worker-brave-otter", path], [], { BRIEF_FILE: "brief-x.md" })
    expect(r.code, r.err).toBe(0)
    expect(launchOf(r)).toContain("Your brief is in ~/.playground/brief-x.md: read it")
    expect(seen(r)).toEqual(seen(bare))
  })

  test("a resume's --brief takes the absolute path too", async () => {
    const brief = "handoffs/restart-brief.md"
    const r = await spawn(
      ["resume", OLD.dispatcher, root, "--brief", `{home}/.playground/${brief}`],
      [],
      { BRIEF_FILE: brief },
      undefined,
      { name: OLD.dispatcher, backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchOf(r)).toContain(`Your brief is in ~/.playground/${brief}: read it`)
  })

  test.each([
    ["a file outside it", "/etc/hosts"],
    ["a sibling folder", `{home}/.claude/${OLD.dispatcher}-old/brief-x.md`],
    ["the folder itself", "{home}/.playground"],
  ])("%s refuses with the name rule", async (_, path) => {
    const r = await spawn(["worker", "worker-brave-otter", path], [], { BRIEF_FILE: "brief-x.md" })
    expect(r.code).toBe(1)
    expect(r.err).toContain("a brief is a file name under ~/.playground")
    expect(r.cmux).toBeUndefined()
    expect(r.roster).toBeUndefined()
    expect(existsSync(lw(r.home, "ops", "capacity.jsonl"))).toBe(false)
  })
})

describe("--runtime herdr opens the session in herdr (#909)", () => {
  test("a worker opens a labelled workspace in the playground server, its launch names its session id, and both pins and the resume record land", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--runtime", "herdr"],
      [],
      {},
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    const sid = launchOf(r).match(SID)?.[1] ?? ""
    expect(sid).not.toBe("")
    expect(placing(r)).toEqual([
      ["workspace", "create", "--cwd", root, "--label", "worker-brave-otter", "--no-focus"],
      ["pane", "rename", "w5:p1", "worker-brave-otter"],
      ["pane", "run", "w5:p1", `exec bash '${lw(r.home, "launch", "worker-brave-otter.sh")}'`],
      [
        "pane",
        "wait-output",
        "w5:p1",
        "--regex",
        "Yes, I trust|New MCP server found in this project|⏵⏵",
        "--source",
        "visible",
        "--timeout",
        "120000",
      ],
    ])
    const dir = lw(r.home, "herdr")
    expect(readFileSync(join(r.home, "herdr.env"), "utf8").trim()).toBe(
      `playground ${dir}/playground.sock ${dir}/config.toml`,
    )
    expect(readFileSync(lw(r.home, "runtimes", "worker-brave-otter"), "utf8")).toBe("herdr\n")
    expect(readFileSync(lw(r.home, "backends", "worker-brave-otter"), "utf8")).toBe("claude\n")
    expect(execLine(r, "worker-brave-otter")).toBe(
      `exec spawn.sh resume worker-brave-otter ${root} ${sid}`,
    )
    expect(resumeFile(r, "worker-brave-otter").split("\n")).toContain("# server: playground")
    expect(launchOf(r).split("\n")[1]).toBe(`cd ${root} || exit 1`)
    expect(statSync(lw(r.home, "resume", "worker-brave-otter.sh")).mode & 0o777).toBe(0o700)
    expect(r.roster?.some((w) => /^(?:surface|workspace)=./.test(w))).toBe(false)
    const prompt = lw(r.home, "resume", "worker-brave-otter.prompt")
    expect(launchOf(r)).toContain(`"${readFileSync(prompt, "utf8").trim()}")`)
    expect(readFileSync(prompt, "utf8")).toStartWith("You are worker-brave-otter, a worker")
    expect(statSync(prompt).mode & 0o777).toBe(0o600)
  })

  // A herdr server starts its panes with the shell basics alone, so a session it runs had no TMPDIR.
  test.each([
    ["with none set gets the user's temp folder", {}, "/var/folders/zz/T/"],
    ["keeps one already set", { TMPDIR: "/tmp/own/" }, "/tmp/own/"],
  ])("a herdr session %s as TMPDIR", async (_, env, expected) => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--runtime", "herdr"],
      [],
      {},
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code, r.err).toBe(0)
    const shim = mkdtempSync(join(scratch, "bin-1614-"))
    writeFileSync(
      join(shim, "claude"),
      '#!/bin/bash\nprintf %s "$TMPDIR" > "$HOME/claude.tmpdir"\n',
    )
    // macOS's getconf, which names the user's temp folder; the box runs Linux, whose getconf has no such name.
    writeFileSync(
      join(shim, "getconf"),
      '#!/bin/bash\n[ "$1" = DARWIN_USER_TEMP_DIR ] && echo /var/folders/zz/T/\n',
    )
    for (const name of ["claude", "getconf"]) chmodSync(join(shim, name), 0o755)
    const run = Bun.spawn(["bash", lw(r.home, "launch", "worker-brave-otter.sh")], {
      env: { HOME: r.home, PATH: `${shim}:${bin}:${process.env.PATH}`, ...env },
      stderr: "ignore",
      stdout: "ignore",
    })
    expect(await run.exited).toBe(0)
    expect(readFileSync(join(r.home, "claude.tmpdir"), "utf8")).toBe(expected)
  })

  test("a session on the probes server records that server in its resume record", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--runtime", "herdr"],
      [],
      { PLAYGROUND_HERDR_SESSION: "probes" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(readFileSync(join(r.home, "herdr.env"), "utf8").trim()).toStartWith("probes ")
    expect(resumeFile(r, "worker-brave-otter").split("\n")).toContain("# server: probes")
  })

  test("a column splits right of the herdr pane it names, in this checkout, and takes no surface:N", async () => {
    const col = ["column", "probe", "probe-x", "worker-y", "w1:p2", "b.md", "--runtime", "herdr"]
    const r = await spawn(col, [], {}, undefined, undefined, herdrPin())
    expect(r.code).toBe(0)
    expect(placing(r)[0]).toEqual([
      "pane",
      "split",
      "w1:p2",
      "--direction",
      "right",
      "--cwd",
      root,
      "--no-focus",
    ])
    expect(r.roster?.some((w) => /^(?:surface|workspace)=./.test(w))).toBe(false)
    const bad = await spawn(col.with(4, "surface:3"), [], {}, undefined, undefined, herdrPin())
    expect(bad.code).toBe(1)
    expect(bad.err).toContain("surface:3 is a cmux surface, and spawn.sh starts nothing in cmux")
    expect(placing(bad)).toEqual([])
  })

  test("a column takes a herdr pane id with letters in either part, and refuses one missing a part (#1272)", async () => {
    const col = ["column", "probe", "probe-x", "worker-y", "w1:p2", "b.md", "--runtime", "herdr"]
    for (const id of ["wN:p1", "w1:p1A", "wH:p1"]) {
      const r = await spawn(col.with(4, id), [], {}, undefined, undefined, herdrPin())
      expect(r.err).not.toContain("is not a herdr pane id")
      expect(r.code).toBe(0)
      expect(placing(r)[0]?.slice(0, 3)).toEqual(["pane", "split", id])
    }
    for (const id of ["w1", "p1", "wN:", "x1:p1"]) {
      const bad = await spawn(col.with(4, id), [], {}, undefined, undefined, herdrPin())
      expect(bad.code).toBe(1)
      expect(bad.err).toContain(`${id} is not a herdr pane id (w1:p2)`)
      expect(placing(bad)).toEqual([])
    }
  })

  test("a probe with no pane to split beside opens a labelled workspace of its own, in this checkout (#1026)", async () => {
    const r = await spawn(
      ["probe", "probe-herdr-a", OLD.ops, "b.md", "--runtime", "herdr"],
      [],
      {},
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(placing(r).slice(0, 2)).toEqual([
      ["workspace", "create", "--cwd", root, "--label", "probe-herdr-a", "--no-focus"],
      ["pane", "rename", "w5:p1", "probe-herdr-a"],
    ])
    expect(launchOf(r).split("\n")[1]).toBe(`cd ${root} || exit 1`)
    expect(launchOf(r)).toContain(`you report to ${OLD.ops}`)
    expect(r.roster).toContain("title=Probe: herdr-a")
    expect(r.roster).toContain("kind=probe")
  })

  test("a runner start writes its name as its title", async () => {
    const r = await spawn(
      ["runner", "runner-calm-heron", "b.md"],
      [],
      {},
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.roster).toContain("title=runner-calm-heron")
    expect(r.roster).toContain("kind=runner")
  })

  test("a runner whose entry holds a title keeps it", async () => {
    const roster = JSON.stringify({
      agents: [{ name: "runner-calm-heron", role: "runner", title: "Keep the stack up" }],
    })
    const r = await spawn(
      ["runner", "runner-calm-heron", "b.md"],
      [],
      { ROSTER_JSON: roster },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.roster?.some((w) => w.startsWith("title="))).toBe(false)
  })

  test.each([
    [
      "a name that reads as another kind",
      ["probe", "worker-x", OLD.ops, "b.md"],
      "worker-x reads as a worker, not a probe: bun run name probe gives one",
    ],
    [
      "a reports-to that is not a session name",
      ["probe", "probe-x", "Bad Name", "b.md"],
      "it reports to a session name, not Bad Name",
    ],
    ["two words", ["probe", "probe-x", OLD.ops], "spawn.sh probe"],
  ])("a probe with %s is refused, nothing placed (#1026)", async (_, args, says) => {
    const r = await spawn([...args, "--runtime", "herdr"], [], {}, undefined, undefined, herdrPin())
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(says)
    expect(placing(r)).toEqual([])
  })

  test.each([
    ["workspace create", { FAKE_HERDR_CREATE_FAIL: "1" }, "error: workspace limit reached", false],
    ["pane rename", { FAKE_HERDR_RENAME_FAIL: "1" }, "error: label taken", true],
    ["pane run", { FAKE_HERDR_RUN_SAYS: "error: pane exited" }, "error: pane exited", true],
  ])(
    "a probe whose %s herdr refuses quotes herdr's words, leaving no launch file (#1026)",
    async (_, env, says, placed) => {
      const r = await spawn(
        ["probe", "probe-x", OLD.ops, "b.md", "--runtime", "herdr"],
        [],
        env,
        undefined,
        undefined,
        herdrPin(),
      )
      expect(r.code).toBe(1)
      expect(r.err).toContain(`herdr opened no session for probe-x (${says})`)
      expect(existsSync(lw(r.home, "launch", "probe-x.herdr"))).toBe(false)
      expect(existsSync(lw(r.home, "launch", "probe-x.sh"))).toBe(false)
      expect(placing(r).at(-1)?.[1] === "close").toBe(placed)
      expect(r.roster).toBeUndefined()
    },
  )

  test("a refused split names herdr's own error, not no answer (#1026)", async () => {
    const r = await spawn(
      ["column", "probe", "probe-x", "worker-y", "w1:p2", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_HERDR_SPLIT_FAIL: "1" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("herdr opened no session for probe-x (error: pane w1:p2 not found)")
    expect(r.err).not.toContain("no answer from herdr")
    expect(r.roster).toBeUndefined()
  })

  test.each([
    {
      label: "a name over herdr's 32 characters",
      name: "worker-abcdefghijklmnopqrstuvwxyz",
      env: {},
      pin: {},
      says: "at most 32 characters, and worker-abcdefghijklmnopqrstuvwxyz has 33",
    },
    {
      label: "a binary that does not hash to its pin",
      name: "worker-x",
      env: {},
      pin: { sha256: "0".repeat(64) },
      says: "does not hash to its pin's sha256",
    },
    {
      label: "a binary of another version",
      name: "worker-x",
      env: { FAKE_HERDR_VERSION: "0.9.6" },
      pin: {},
      says: "reads herdr 0.9.6 on --version, and its pin names herdr 0.9.5",
    },
    {
      label: "a pin naming no path",
      name: "worker-x",
      env: {},
      pin: { path: "" },
      says: "cannot read the herdr pin",
    },
    {
      label: "a herdr folder PLAYGROUND_HERDR_DIR names with no pin",
      name: "worker-x",
      env: { PLAYGROUND_HERDR_DIR: "/nowhere/new" },
      pin: {},
      says: "cannot read the herdr pin /nowhere/new/pin.json",
    },
    {
      label: "a server that is not running",
      name: "worker-x",
      env: { FAKE_HERDR_DOWN: "1" },
      pin: {},
      says: "playground, or bun run ops:herdr start, brings it up",
    },
  ] as { env: Record<string, string>; label: string; name: string; pin: object; says: string }[])(
    "$label is refused before anything opens",
    async ({ name, env, pin, says }) => {
      const r = await spawn(
        ["worker", name, "b.md", "--runtime", "herdr"],
        [],
        env,
        undefined,
        undefined,
        herdrPin(pin),
      )
      expect(r.code).toBe(1)
      expect(r.err).toContain(says)
      expect(placing(r)).toEqual([])
      expect(r.cmux).toBeUndefined()
      expect(r.roster).toBeUndefined()
      expect(existsSync(lw(r.home, "runtimes"))).toBe(false)
    },
  )

  test("a pane herdr will not run in is closed, and nothing is pinned or rostered", async () => {
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_HERDR_RUN_FAIL: "1" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "herdr opened no session for worker-x (herdr would not label pane w5:p1 or run the launch in it)",
    )
    expect(r.err).not.toContain("no answer from herdr")
    expect(r.err).not.toContain('"result"')
    expect(placing(r).at(-1)).toEqual(["pane", "close", "w5:p1"])
    expect(existsSync(lw(r.home, "launch", "worker-x.sh"))).toBe(false)
    expect(existsSync(lw(r.home, "resume", "worker-x.sh"))).toBe(false)
    expect(existsSync(lw(r.home, "runtimes"))).toBe(false)
    expect(r.roster).toBeUndefined()
  })

  test("under the code root the trust prompt and then the MCP picker are answered, one key a request", async () => {
    const r = await spawn(
      ["manager", "optimizer", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "trust,mcp,ready" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([
      ["pane", "send-keys", "w5:p1", "down"],
      ["pane", "send-keys", "w5:p1", "enter"],
      ["pane", "send-keys", "w5:p1", "esc"],
    ])
  })

  // playground planner, builder and ops start their managers this way, the first time the dispatcher routes work to each.
  test.each(["builder", "ops", "planner"])(
    "manager %s opens that lead in a workspace of its own",
    async (name) => {
      const r = await spawn(
        ["manager", name, "b.md", "--runtime", "herdr"],
        [],
        { FAKE_SCREENS: "ready" },
        undefined,
        undefined,
        herdrPin(),
      )
      expect(r.err).not.toContain("a manager in a workspace of its own is")
      expect(r.code).toBe(0)
    },
  )

  // a narrow column cuts the status line, "⏵⏵ bypass permissions" at 27 columns and "⏵⏵" at 12 (measured, 24 Oct), and herdr matches one row at a time.
  test.each(["cut", "bare"])(
    "a narrow column's %s status line is ready, and no key is sent",
    async (screen) => {
      const r = await spawn(
        ["manager", "optimizer", "b.md", "--runtime", "herdr"],
        [],
        { FAKE_SCREENS: screen },
        undefined,
        undefined,
        herdrPin(),
      )
      expect(r.code).toBe(0)
      expect(r.err).not.toContain("showed no REPL")
      expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([])
    },
  )

  test("a pane that never draws a status line still times out, naming the read", async () => {
    const r = await spawn(
      ["manager", "optimizer", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "blank" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.err).toContain(
      "optimizer showed no REPL within 2 minutes; read it with herdr pane read w5:p1",
    )
  })

  test("a narrow column's trust row, cut after its first words, is answered", async () => {
    const r = await spawn(
      ["manager", "optimizer", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "trustcut,ready" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([
      ["pane", "send-keys", "w5:p1", "down"],
      ["pane", "send-keys", "w5:p1", "enter"],
    ])
  })

  test("a REPL whose status line names an MCP server is ready, and no key is sent", async () => {
    const r = await spawn(
      ["manager", "optimizer", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "mcpstatus" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([])
    expect(placing(r).filter((c) => c[1] === "wait-output")).toHaveLength(1)
  })

  test("outside the two roots the trust prompt stays for the owner, and the session still lands", async () => {
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "trust" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.err).toContain("waits at Claude's folder trust prompt")
    expect(r.err).toContain("so it is the owner's to answer")
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([])
    expect(readFileSync(lw(r.home, "runtimes", "worker-x"), "utf8")).toBe("herdr\n")
  })

  test("paths.codeRoot moves the trusted root, so a session under it has its trust prompt answered", async () => {
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "trust,ready" },
      undefined,
      undefined,
      (home) => {
        herdrPin()(home)
        storeWith(
          join(home, ".playground"),
          {},
          {
            "paths.codeRoot": dirname(realpathSync(root)),
          },
        )
        // A machine with extensions has the login ext init wrote, which the skill resolver reads first.
        writeFileSync(join(home, ".playground", "extensions", "login"), "acme-dev\n")
      },
    )
    expect(r.code).toBe(0)
    expect(r.err).not.toContain("waits at Claude's folder trust prompt")
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([
      ["pane", "send-keys", "w5:p1", "down"],
      ["pane", "send-keys", "w5:p1", "enter"],
    ])
  })

  test("an org ext.links guards trusts its folder in the home folder, so a session under it has its trust prompt answered", async () => {
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--runtime", "herdr"],
      [],
      { FAKE_SCREENS: "trust,ready" },
      undefined,
      undefined,
      (home) => {
        herdrPin()(home)
        symlinkSync(dirname(realpathSync(root)), join(home, "acme-co"))
        storeWith(join(home, ".playground"), {}, { "ext.links": { acme: ["acme-co"] } })
        writeFileSync(join(home, ".playground", "extensions", "login"), "acme-dev\n")
      },
    )
    expect(r.code).toBe(0)
    expect(r.err).not.toContain("waits at Claude's folder trust prompt")
    expect(placing(r).filter((c) => c[1] === "send-keys")).toEqual([
      ["pane", "send-keys", "w5:p1", "down"],
      ["pane", "send-keys", "w5:p1", "enter"],
    ])
  })

  test("the resume record keeps the account and the model it started with, never a token", async () => {
    const r = await spawn(
      [
        "worker",
        "worker-x",
        "b.md",
        "--runtime",
        "herdr",
        "--account",
        "acme@example.net",
        "--model",
        "claude-sonnet-5-5",
      ],
      [],
      {},
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    const sid = launchOf(r).match(SID)?.[1] ?? ""
    expect(execLine(r, "worker-x")).toBe(
      `exec spawn.sh resume worker-x ${root} ${sid} --account acme@example.net --model claude-sonnet-5-5`,
    )
    expect(resumeFile(r, "worker-x")).toContain("\n# account: acme@example.net\n")
    expect(resumeFile(r, "worker-x")).not.toContain(TOKEN)
  })
})

describe("with no --runtime, a start opens in herdr whatever its spawner's terminal (#1484)", () => {
  test("from herdr, outside cmux, it opens in herdr", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { HERDR_ENV: "1" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(placing(r)[0]?.slice(0, 2)).toEqual(["workspace", "create"])
    expect(readFileSync(lw(r.home, "runtimes", "worker-brave-otter"), "utf8")).toBe("herdr\n")
  })

  test("a probe from herdr, outside cmux, passes the probe's herdr check and opens in herdr", async () => {
    const r = await spawn(
      ["probe", "probe-herdr-a", OLD.ops, "b.md"],
      [],
      { HERDR_ENV: "1" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(placing(r)[0]?.slice(0, 2)).toEqual(["workspace", "create"])
  })

  test("a column from herdr, outside cmux, splits the herdr pane it names", async () => {
    const r = await spawn(
      ["column", "probe", "probe-x", "worker-y", "w1:p2", "b.md"],
      [],
      { HERDR_ENV: "1" },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(placing(r)[0]?.slice(0, 3)).toEqual(["pane", "split", "w1:p2"])
    expect(readFileSync(lw(r.home, "runtimes", "probe-x"), "utf8")).toBe("herdr\n")
  })

  test("a column beside a cmux surface:N, from cmux, is refused, naming #2076", async () => {
    const r = await spawn(
      ["column", "lead", OLD.planner, OLD.dispatcher, "surface:1", "handoff.md"],
      [],
      { CMUX_SOCKET_PATH: join(scratch, "cmux.sock") },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("surface:1 is a cmux surface, and spawn.sh starts nothing in cmux")
    expect(r.cmux).toBeUndefined()
    expect(placing(r)).toEqual([])
  })

  test("from cmux it opens in herdr", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { CMUX_SOCKET_PATH: join(scratch, "cmux.sock") },
      undefined,
      undefined,
      herdrPin(),
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(placing(r)[0]?.slice(0, 2)).toEqual(["workspace", "create"])
    expect(readFileSync(lw(r.home, "runtimes", "worker-brave-otter"), "utf8")).toBe("herdr\n")
  })

  // spawn.sh starts nothing in cmux: --runtime cmux is refused in every mode, before any cmux or herdr call and any pin.
  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"]],
    ["a column", ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]],
    ["a probe", ["probe", "probe-x", OLD.ops, "p.md"]],
    ["a manager", ["manager", "optimizer", "b.md"]],
    ["a resume", ["resume", "worker-x", root, "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"]],
    ["a move", ["move", "worker-x"]],
    ["a --check", ["worker", "worker-brave-otter", "b.md", "--check"]],
  ])("--runtime cmux on %s is refused, naming #2076", async (_, args) => {
    const r = await spawn(
      [...args, "--runtime", "cmux"],
      [],
      { CMUX_SOCKET_PATH: join(scratch, "cmux.sock") },
      undefined,
      { name: String(args[0] === "column" ? args[2] : args[1]), backend: "claude" },
    )
    expect(r.code).toBe(2)
    expect(r.err).toContain("--runtime cmux is refused: spawn.sh starts nothing in cmux")
    expect(r.cmux).toBeUndefined()
    expect(herdrCalls(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes"))).toBe(false)
    expect(r.roster).toBeUndefined()
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"]],
    ["a resume", ["resume", "worker-x", root, "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"]],
  ])("--runtime with any other value on %s is refused at parse", async (_, args) => {
    const r = await spawn([...args, "--runtime", "tmux"], [], {}, undefined, {
      name: String(args[1]),
      backend: "claude",
    })
    expect(r.code).toBe(2)
    expect(r.err).toContain('--runtime takes herdr alone, not "tmux"')
    expect(herdrCalls(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes"))).toBe(false)
  })
})

describe("a resume opens in herdr, whatever runtime its start recorded", () => {
  const SESSION = "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"
  const pinned = (runtime: string) => (home: string) => {
    herdrPin()(home)
    mkdirSync(lw(home, "runtimes"), { recursive: true })
    writeFileSync(lw(home, "runtimes", "worker-x"), `${runtime}\n`)
  }
  const claude = { name: "worker-x", backend: "claude" }

  test("a herdr pin resumes in herdr, in the session's folder, and its run is stamped", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      {},
      undefined,
      claude,
      (home) => {
        pinned("herdr")(home)
        transcript(home, SESSION)
      },
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    const file = lw(r.home, "launch", "worker-x.sh")
    expect(placing(r).find((c) => c[1] === "run")).toEqual([
      "pane",
      "run",
      "w5:p1",
      `exec bash '${file}'`,
    ])
    expect(launchOf(r)).toContain(`claude --resume ${SESSION} -n worker-x`)
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${root} ${SESSION}`)
    const run = Bun.spawn(["bash", file], {
      env: { HOME: r.home, PATH: `${bin}:${process.env.PATH}` },
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(await run.exited).toBe(0)
    expect(readFileSync(join(r.home, "claude.args"), "utf8")).toContain(
      `--resume ${SESSION} -n worker-x`,
    )
    expect(readFileSync(lw(r.home, "resume", "worker-x.ran"), "utf8")).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/,
    )
  })

  // a restore, a move or an account switch resumes with no --brief, and a session idle at the restart would never act on after-resume's context
  test("a herdr resume with no --brief still takes one turn, so it acts on after-resume's instruction", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      {},
      undefined,
      claude,
      (home) => {
        pinned("herdr")(home)
        transcript(home, SESSION)
      },
    )
    expect(r.code).toBe(0)
    expect(unplugged(launchOf(r))).toContain(
      `--dangerously-skip-permissions "You are worker-x, resumed after a restart. Act on the after-resume instruction in your context first, then carry on."`,
    )
  })

  test("that first turn names whom the session reports to, from the prompt its start recorded", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      {},
      undefined,
      claude,
      (home) => {
        pinned("herdr")(home)
        transcript(home, SESSION)
        mkdirSync(lw(home, "resume"), { recursive: true })
        writeFileSync(
          lw(home, "resume", "worker-x.prompt"),
          `You are worker-x, a worker in the Playground factory; you report to ${OLD.builder}. Load the playbook skill first.\n`,
        )
      },
    )
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(
      `"You are worker-x, resumed after a restart; you report to ${OLD.builder}. Act on the after-resume instruction in your context first, then carry on."`,
    )
  })

  test("a herdr session with no transcript starts afresh under its own id and name, with the prompt its start recorded", async () => {
    const said = `You are worker-x, a worker in the Playground factory; you report to ${OLD.builder}.`
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      { NO_SESSION_TRANSCRIPT: "1" },
      undefined,
      claude,
      (home) => {
        pinned("herdr")(home)
        mkdirSync(lw(home, "resume"), { recursive: true })
        writeFileSync(lw(home, "resume", "worker-x.prompt"), `${said}\n`)
      },
    )
    expect(r.code).toBe(0)
    const launch = launchOf(r)
    expect(launch).toContain(`claude --session-id ${SESSION} -n worker-x --model`)
    expect(unplugged(launch)).toContain(`--dangerously-skip-permissions "${said}")`)
    expect(launch).not.toContain("--resume")
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${root} ${SESSION}`)
    expect(readFileSync(lw(r.home, "resume", "worker-x.prompt"), "utf8")).toBe(`${said}\n`)
  })

  test.each([
    ["a quote and a $", 'You are "$(touch x)"'],
    ["a backquote", "You are `touch x`"],
    ["a backslash", "You are \\"],
    ["a newline", "You are\nworker-x"],
  ])("a recorded prompt holding %s is left out and named", async (_, prompt) => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      { NO_SESSION_TRANSCRIPT: "1" },
      undefined,
      claude,
      (home) => {
        pinned("herdr")(home)
        mkdirSync(lw(home, "resume"), { recursive: true })
        writeFileSync(lw(home, "resume", "worker-x.prompt"), `${prompt}\n`)
      },
    )
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(`--session-id ${SESSION} -n worker-x`)
    expect(launchOf(r)).not.toContain("You are")
    expect(r.err).toContain("its recorded prompt holds a quote, $, backquote or backslash")
  })

  test("a resume reopens the session in the restored pane that holds its label, while that pane holds no agent", async () => {
    const panes = (home: string) => {
      pinned("herdr")(home)
      const pane = (id: string, label: string, over = {}) => ({
        agent_status: "unknown",
        label,
        pane_id: id,
        workspace_id: "w2",
        ...over,
      })
      writeFileSync(
        join(home, "herdr.panes"),
        JSON.stringify({
          result: {
            panes: [
              pane("w2:p1", "worker-x", { agent: OLD.dispatcher, agent_status: "idle" }),
              pane("w2:p3", "worker-x"),
              pane("w2:p4", "worker-y"),
            ],
          },
        }),
      )
    }
    const r = await spawn(["resume", "worker-x", root, SESSION], [], {}, undefined, claude, panes)
    expect(r.code).toBe(0)
    expect(placing(r).some((c) => c[0] === "workspace")).toBe(false)
    expect(placing(r).find((c) => c[1] === "run")?.[2]).toBe("w2:p3")
    expect(r.roster?.some((w) => /^(?:surface|workspace)=./.test(w))).toBe(false)
  })

  test("a resume with no pin from cmux opens in herdr (#1484)", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      { CMUX_SOCKET_PATH: join(scratch, "cmux.sock") },
      undefined,
      claude,
      (home) => {
        herdrPin()(home)
        transcript(home, SESSION)
      },
    )
    expect(r.code).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(
      placing(r)
        .find((c) => c[1] === "run")
        ?.slice(0, 3),
    ).toEqual(["pane", "run", "w5:p1"])
  })

  // A session that started in cmux, before herdr took over, resumes in herdr, and its pin then reads herdr.
  test("a resume whose pin reads cmux opens in herdr and rewrites the pin (#2076)", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      { CMUX_SOCKET_PATH: join(scratch, "cmux.sock") },
      undefined,
      claude,
      pinned("cmux"),
    )
    expect(r.code, r.err).toBe(0)
    expect(r.cmux).toBeUndefined()
    expect(
      placing(r)
        .find((c) => c[1] === "run")
        ?.slice(0, 3),
    ).toEqual(["pane", "run", "w5:p1"])
    expect(launchOf(r)).toContain(`claude --resume ${SESSION} -n worker-x`)
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${root} ${SESSION}`)
    expect(readFileSync(lw(r.home, "runtimes", "worker-x"), "utf8")).toBe("herdr\n")
  })

  test("a runtime pin that reads neither is refused", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, SESSION],
      [],
      {},
      undefined,
      claude,
      pinned("tmux"),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("the runtime pin for worker-x reads neither cmux nor herdr")
  })
})

// no factory session, script, skill or job uses a path under the Desktop folder.
const DESKTOP = "Desktop" // the folder the factory left
describe("a resume into a Desktop folder moves to the same tree under the code root", () => {
  const SESSION = "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"
  const claude = { name: "worker-x", backend: "claude" }
  const project = (home: string, dir: string) =>
    join(home, ".claude", "projects", projectOf(dir), `${SESSION}.jsonl`)
  // The session ran in the Desktop folder, whose transcript sits in that folder's project; the Desktop folder itself is never made, as macOS keeps it from a new pane.
  const ranOnDesktop = (from: string, to: string) => (home: string) => {
    herdrPin()(home)
    mkdirSync(join(home, to), { recursive: true })
    const old = project(home, join(home, from))
    mkdirSync(dirname(old), { recursive: true })
    writeFileSync(old, "{}\n")
  }

  test.each([
    [`${DESKTOP}/code/factory`, "code/factory"],
    [`${DESKTOP}/acme-labs/acme-app`, "code/acme-labs/acme-app"],
  ])("~/%s resumes in ~/%s with its transcript", async (from, to) => {
    const r = await spawn(
      ["resume", "worker-x", `{home}/${from}`, SESSION, "--runtime", "herdr"],
      [],
      {},
      undefined,
      claude,
      ranOnDesktop(from, to),
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    const dir = join(r.home, to)
    expect(launchOf(r)).toContain(`cd ${dir} || exit 1\n`)
    expect(launchOf(r)).toContain(`claude --resume ${SESSION} -n worker-x`)
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${dir} ${SESSION}`)
    expect(readFileSync(project(r.home, dir), "utf8")).toBe("{}\n")
  })

  test("--check copies no transcript", async () => {
    const from = `${DESKTOP}/code/factory`
    const to = "code/factory"
    const r = await spawn(
      ["resume", "worker-x", `{home}/${from}`, SESSION, "--runtime", "herdr", "--check"],
      [],
      {},
      undefined,
      claude,
      ranOnDesktop(from, to),
    )
    expect(r.code).toBe(0)
    expect(existsSync(project(r.home, join(r.home, to)))).toBe(false)
  })

  test("with no code root, a Desktop folder that exists resumes where it is", async () => {
    const from = `${DESKTOP}/visitor/factory`
    const r = await spawn(
      ["resume", "worker-x", `{home}/${from}`, SESSION, "--runtime", "herdr", "--check"],
      [],
      { NO_LEADS: "1" },
      undefined,
      claude,
      (home) => {
        herdrPin()(home)
        mkdirSync(join(home, from), { recursive: true })
      },
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(r.out).toContain("ok: worker-x can start")
  })

  test("with its twin under the code root beside it, a Desktop folder still resumes in the twin", async () => {
    const from = `${DESKTOP}/code/factory`
    const to = "code/factory"
    const r = await spawn(
      ["resume", "worker-x", `{home}/${from}`, SESSION, "--runtime", "herdr"],
      [],
      {},
      undefined,
      claude,
      (home) => {
        ranOnDesktop(from, to)(home)
        mkdirSync(join(home, from), { recursive: true })
      },
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(`cd ${join(r.home, to)} || exit 1\n`)
  })

  test.each([
    ["with the code root", {}, ["code", "gone"]],
    ["with no code root", { NO_LEADS: "1" }, [DESKTOP, "code", "gone"]],
  ])(
    "%s, a folder missing from both trees refuses naming where it would resume",
    async (_, env, named) => {
      const r = await spawn(
        ["resume", "worker-x", `{home}/${DESKTOP}/code/gone`, SESSION, "--runtime", "herdr"],
        [],
        env,
        undefined,
        claude,
        herdrPin(),
      )
      expect(r.code).toBe(1)
      expect(r.err).toContain(`${join(r.home, ...named)} is not a folder`)
    },
  )
})

// the main rule keeps every session out of the main checkout, so a resume never moves one there, and a resume into a removed worktree names its branch.
describe("a resume keeps a session out of the main checkout and out of a removed worktree (#1691)", () => {
  const SESSION = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
  const claude = { name: "worker-x", backend: "claude" }
  // Each case writes the transcripts it means, so the harness writes none.
  const NONE = { NO_SESSION_TRANSCRIPT: "1" }
  // A main checkout of its own with spawn.sh in it, so the script's main checkout is this one, and a worktree folder under it.
  const checkout = () => {
    const main = realpathSync(mkdtempSync(join(scratch, "main-1691-")))
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
    git("init", "-q", "-b", "main")
    git("add", ".")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
    return {
      main,
      spawnSh: join(main, "scripts", "spawn.sh"),
      tree: join(main, ".claude", "worktrees", "pg-9-x"),
    }
  }
  // The session's transcript in the project of the folder it ran in, naming that folder and its branch as Claude Code's lines do.
  const ranIn1691 =
    (dir: string, made = true) =>
    (home: string) => {
      herdrPin()(home)
      if (made) mkdirSync(dir, { recursive: true })
      const folder = join(home, ".claude", "projects", projectOf(dir))
      mkdirSync(folder, { recursive: true })
      writeFileSync(
        join(folder, `${SESSION}.jsonl`),
        `${JSON.stringify({ cwd: dir, gitBranch: "pg-9-x", sessionId: SESSION, type: "user" })}\n`,
      )
    }

  test("a session that ran in its worktree is refused the main checkout at --check, naming that worktree", async () => {
    const { main, spawnSh, tree } = checkout()
    const r = await spawn(
      ["resume", "worker-x", main, SESSION, "--runtime", "herdr", "--check"],
      [],
      NONE,
      spawnSh,
      claude,
      ranIn1691(tree),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      `${main} is the main checkout, and worker-x ran in ${tree}: resume it in ${tree}`,
    )
  })

  test("a session whose worktree is gone is refused the main checkout, naming the worktree add that brings it back", async () => {
    const { main, spawnSh, tree } = checkout()
    const r = await spawn(
      ["resume", "worker-x", main, SESSION, "--runtime", "herdr"],
      [],
      NONE,
      spawnSh,
      claude,
      ranIn1691(tree, false),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(`git -C ${main} worktree add ${tree} pg-9-x, then resume it there`)
    expect(existsSync(lw(r.home, "resume", "worker-x.sh"))).toBe(false)
  })

  test("a session that started in the main checkout resumes there", async () => {
    const { main, spawnSh } = checkout()
    const r = await spawn(
      ["resume", "worker-x", main, SESSION, "--runtime", "herdr"],
      [],
      NONE,
      spawnSh,
      claude,
      ranIn1691(main),
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${main} ${SESSION}`)
  })

  test("a resume into a removed worktree refuses, naming the folder and its branch", async () => {
    const { spawnSh, tree } = checkout()
    const r = await spawn(
      ["resume", "worker-x", tree, SESSION, "--runtime", "herdr"],
      [],
      NONE,
      spawnSh,
      claude,
      ranIn1691(tree, false),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${tree} is not a folder, and its branch is pg-9-x`)
  })

  test("a transcript holding a byte that is not UTF-8 still gives the refusal its branch", async () => {
    const { spawnSh, tree } = checkout()
    const r = await spawn(
      ["resume", "worker-x", tree, SESSION, "--runtime", "herdr"],
      [],
      { LC_ALL: "en_US.UTF-8" },
      spawnSh,
      claude,
      (home) => {
        ranIn1691(tree, false)(home)
        appendFileSync(
          join(home, ".claude", "projects", projectOf(tree), `${SESSION}.jsonl`),
          Buffer.from([0xff, 0x0a]),
        )
      },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${tree} is not a folder, and its branch is pg-9-x`)
  })

  test("a resume into a missing folder outside the main checkout's worktrees names its branch, with no worktree add", async () => {
    const { spawnSh } = checkout()
    const gone = join(scratch, "acme-1691", "x")
    const r = await spawn(
      ["resume", "worker-x", gone, SESSION, "--runtime", "herdr"],
      [],
      NONE,
      spawnSh,
      claude,
      ranIn1691(gone, false),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      `${gone} is not a folder, and its branch is pg-9-x: bring it back on pg-9-x, then resume it there`,
    )
    expect(r.err).not.toContain("worktree add")
  })

  test("the newest copy of the transcript names the folder, never a stale one a Desktop move left", async () => {
    const { main, spawnSh, tree } = checkout()
    const r = await spawn(
      ["resume", "worker-x", main, SESSION, "--runtime", "herdr", "--check"],
      [],
      NONE,
      spawnSh,
      claude,
      (home) => {
        ranIn1691(tree)(home)
        const stale = join(home, ".claude", "projects", "-A-stale")
        mkdirSync(stale, { recursive: true })
        const copy = join(stale, `${SESSION}.jsonl`)
        writeFileSync(
          copy,
          `${JSON.stringify({ cwd: join(home, DESKTOP, "old"), gitBranch: "old", sessionId: SESSION, type: "user" })}\n`,
        )
        utimesSync(copy, new Date(2000, 0, 1), new Date(2000, 0, 1))
      },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(`worker-x ran in ${tree}: resume it in ${tree}`)
    expect(r.err).not.toContain(DESKTOP)
  })

  test("restore names a refused resume as not restored and runs the rest", async () => {
    const { main, spawnSh, tree } = checkout()
    const other = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a"
    const r = await spawn(["restore"], [], {}, spawnSh, undefined, (home) => {
      ranIn1691(tree, false)(home)
      const started = join(home, ".claude", "projects", projectOf(main))
      mkdirSync(started, { recursive: true })
      writeFileSync(join(started, `${other}.jsonl`), "{}\n")
      for (const dir of ["resume", "runtimes", "backends"])
        mkdirSync(lw(home, dir), { recursive: true })
      for (const [name, dir, sid] of [
        ["worker-a", main, other],
        ["worker-x", tree, SESSION],
      ] as const) {
        writeFileSync(
          lw(home, "resume", `${name}.sh`),
          `#!/bin/bash\nexec /x/scripts/spawn.sh resume ${name} ${dir} ${sid}\n`,
        )
        writeFileSync(lw(home, "runtimes", name), "herdr\n")
        writeFileSync(lw(home, "backends", name), "claude\n")
      }
    })
    expect(r.out).toContain("restored worker-a\n")
    expect(r.out).toContain(
      `not restored: spawn.sh refuses worker-x: ${tree} is not a folder, and its branch is pg-9-x`,
    )
    expect(r.code).toBe(1)
  })
})

describe("restore resumes the herdr sessions its resume files list", () => {
  const ids = {
    a: "aaaaaaaa-0000-4000-8000-000000000001",
    b: "bbbbbbbb-0000-4000-8000-000000000002",
    c: "cccccccc-0000-4000-8000-000000000003",
    d: "dddddddd-0000-4000-8000-000000000004",
  }
  const listed = (home: string) => {
    herdrPin()(home)
    for (const dir of ["resume", "runtimes", "backends"])
      mkdirSync(lw(home, dir), { recursive: true })
    for (const [k, sid] of Object.entries(ids)) {
      const name = `worker-${k}`
      const extra = k === "a" ? " --account acme@example.net --model claude-sonnet-5-5" : ""
      writeFileSync(
        lw(home, "resume", `${name}.sh`),
        `#!/bin/bash\nexec /x/scripts/spawn.sh resume ${name} ${root} ${sid}${extra}\n`,
      )
      writeFileSync(lw(home, "runtimes", name), k === "c" ? "cmux\n" : "herdr\n")
      writeFileSync(lw(home, "backends", name), "claude\n")
      transcript(home, sid)
    }
  }
  const roster = JSON.stringify({
    agents: [
      { name: "worker-b", role: "worker", status: "ended", task: "t" },
      { name: "worker-a", role: "worker", status: "working", task: "t" },
    ],
  })

  test("it resumes each one not live with its account and model, skips what the roster ended, what runs in cmux and a live one", async () => {
    const r = await spawn(
      ["restore"],
      [{ name: "worker-d", pid: 5100 }],
      { ROSTER_JSON: roster },
      undefined,
      undefined,
      listed,
    )
    expect(r.out).toBe("restored worker-a\nskipped worker-d: live\n")
    expect(r.code).toBe(0)
    expect(placing(r).filter((c) => c[1] === "run")).toEqual([
      ["pane", "run", "w5:p1", `exec bash '${lw(r.home, "launch", "worker-a.sh")}'`],
    ])
    const launch = launchOf(r)
    expect(launch).toContain(`--resume ${ids.a} -n worker-a --model claude-sonnet-5-5`)
    expect(launch).toContain("acme@example.net")
    expect(execLine(r, "worker-a")).toBe(
      `exec spawn.sh resume worker-a ${root} ${ids.a} --account acme@example.net --model claude-sonnet-5-5`,
    )
  })

  test("under inscope it reads the roster roster.ts writes, ~/.claude's", async () => {
    const r = await spawn(
      ["restore"],
      [],
      {
        CLAUDE_CONFIG_DIR: "/no/such/inscope/dir",
        INSCOPE_CCD: "/no/such/inscope/dir",
        ROSTER_JSON: roster,
      },
      undefined,
      undefined,
      listed,
    )
    expect(r.out).toContain("restored worker-a")
    expect(r.out).not.toContain("worker-b")
  })

  test("a resume that fails is named and the run exits 1", async () => {
    const r = await spawn(
      ["restore"],
      [],
      { ROSTER_JSON: roster, FAKE_HERDR_RUN_FAIL: "1" },
      undefined,
      undefined,
      listed,
    )
    expect(r.out).toContain(
      "not restored: spawn.sh refuses worker-a: herdr opened no session for worker-a",
    )
    expect(r.code).toBe(1)
  })

  test("a record holding any other option is not restored", async () => {
    const r = await spawn(
      ["restore"],
      [],
      { ROSTER_JSON: roster },
      undefined,
      undefined,
      (home) => {
        listed(home)
        writeFileSync(
          lw(home, "resume", "worker-a.sh"),
          `exec /x/scripts/spawn.sh resume worker-a ${root} ${ids.a} --brief x.md\n`,
        )
      },
    )
    expect(r.out).toBe("restored worker-d\n")
  })

  const onProbes = (home: string) => {
    listed(home)
    writeFileSync(
      lw(home, "resume", "worker-d.sh"),
      `#!/bin/bash\n# server: probes\nexec /x/scripts/spawn.sh resume worker-d ${root} ${ids.d}\n`,
    )
  }

  test("each server restores only the sessions its records place there, a record with no server line being playground's", async () => {
    const factory = await spawn(
      ["restore"],
      [],
      { ROSTER_JSON: roster },
      undefined,
      undefined,
      onProbes,
    )
    expect(factory.out).toBe("restored worker-a\n")
    const probes = await spawn(
      ["restore"],
      [],
      { PLAYGROUND_HERDR_SESSION: "probes", ROSTER_JSON: roster },
      undefined,
      undefined,
      onProbes,
    )
    expect(probes.out).toBe("restored worker-d\n")
    expect(readFileSync(join(probes.home, "herdr.env"), "utf8").trim()).toStartWith("probes ")
  })

  test("a restore pointed at a server that is not a word restores nothing", async () => {
    const r = await spawn(
      ["restore"],
      [],
      { PLAYGROUND_HERDR_SESSION: "../x", ROSTER_JSON: roster },
      undefined,
      undefined,
      listed,
    )
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("PLAYGROUND_HERDR_SESSION is a word, not ../x")
  })

  const held = (pid: number) => (home: string) => {
    listed(home)
    symlinkSync(`${pid} Sun Oct 18 09:00:00 2026`, lw(home, "resume", ".restore.lock"))
  }

  test("while another restore holds the lock it restores nothing and exits 1", async () => {
    const r = await spawn(
      ["restore"],
      [],
      { FAKE_LSTART: "Sun Oct 18 09:00:00 2026", ROSTER_JSON: roster },
      undefined,
      undefined,
      held(4242),
    )
    expect(r.out).toBe("another restore is running (pid 4242)\n")
    expect(r.code).toBe(1)
    expect(placing(r).filter((c) => c[1] === "run")).toEqual([])
    expect(readlinkSync(lw(r.home, "resume", ".restore.lock"))).toBe(
      "4242 Sun Oct 18 09:00:00 2026",
    )
  })

  test("a lock whose holder has gone is taken, and let go once the restore ends", async () => {
    const r = await spawn(
      ["restore"],
      [],
      { FAKE_DEAD: "4242", FAKE_LSTART: "Sun Oct 18 09:00:00 2026", ROSTER_JSON: roster },
      undefined,
      undefined,
      held(4242),
    )
    expect(r.out).toContain("restored worker-a")
    expect(r.code).toBe(0)
    expect(existsSync(lw(r.home, "resume", ".restore.lock"))).toBe(false)
  })

  test("with nothing to restore it says nothing and exits 0", async () => {
    const r = await spawn(["restore"], [], {}, undefined, undefined, herdrPin())
    expect(r.code).toBe(0)
    expect(r.out).toBe("")
  })

  test("it takes no other words", async () => {
    const r = await spawn(["restore", "worker-a"], [], {})
    expect(r.code).toBe(2)
    expect(r.err).toContain("restore takes no other words")
  })
})

describe("close ends a herdr session by closing the pane it opened (#994)", () => {
  // The session as spawn.sh leaves it: its runtime pin, its resume record naming its server, and the panes herdr lists.
  const opened =
    (
      over: {
        panes?: { label: string; pane_id: string }[]
        record?: string | null
        runtime?: string | null
      } = {},
    ) =>
    (home: string) => {
      herdrPin()(home)
      mkdirSync(lw(home, "runtimes"), { recursive: true })
      mkdirSync(lw(home, "resume"), { recursive: true })
      if (over.runtime !== null)
        writeFileSync(lw(home, "runtimes", "worker-x"), `${over.runtime ?? "herdr"}\n`)
      if (over.record !== null)
        writeFileSync(
          lw(home, "resume", "worker-x.sh"),
          over.record ??
            `#!/bin/bash\n# server: factory\nexec ${root}/scripts/spawn.sh resume worker-x ${root} x\n`,
        )
      const panes = over.panes ?? [
        { label: "worker-x", pane_id: "w2:p3" },
        { label: "worker-y", pane_id: "w2:p4" },
      ]
      writeFileSync(
        join(home, "herdr.panes"),
        JSON.stringify({ result: { panes: panes.map((p) => ({ ...p, workspace_id: "w2" })) } }),
      )
    }
  const closes = (r: { home: string }) => placing(r).filter((c) => c[1] === "close")
  const socketOf = (r: { home: string }) =>
    readFileSync(join(r.home, "herdr.env"), "utf8").trim().split(" ")[1]

  test("it closes the one pane labelled with the name on the server its resume record names, ends its roster row and keeps its pins and record", async () => {
    const r = await spawn(["close", "worker-x"], [], {}, undefined, undefined, opened())
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(r.out).toBe("closed worker-x (pane w2:p3 on factory)\n")
    expect(closes(r)).toEqual([["pane", "close", "w2:p3"]])
    expect(socketOf(r)).toBe(lw(r.home, "herdr", "factory.sock"))
    expect(r.cmux).toBeUndefined()
    expect(r.rosterLog).toEqual(["set worker-x status=ended"])
    expect(readFileSync(lw(r.home, "runtimes", "worker-x"), "utf8")).toBe("herdr\n")
    expect(existsSync(lw(r.home, "resume", "worker-x.sh"))).toBe(true)
  })

  test("a roster write that fails after the close says the pane closed, names the write, and exits 0", async () => {
    const r = await spawn(
      ["close", "worker-x"],
      [],
      { FAKE_ROSTER_BROKEN: "1" },
      undefined,
      undefined,
      opened(),
    )
    expect(r.code).toBe(0)
    expect(r.out).toBe("closed worker-x (pane w2:p3 on factory)\n")
    expect(r.err).toContain("roster.ts says: roster broken")
    expect(r.err).toContain("worker-x closed, but its roster write failed; record it with ")
    expect(r.err).toContain("set worker-x status=ended")
  })

  test.each([
    ["probes", "#!/bin/bash\n# server: probes\nexec x\n", "probes"],
    ["playground, with no server line", "#!/bin/bash\nexec x\n", "playground"],
  ])("a record naming %s closes the pane there", async (_, record, server) => {
    const r = await spawn(["close", "worker-x"], [], {}, undefined, undefined, opened({ record }))
    expect(r.code).toBe(0)
    expect(closes(r)).toEqual([["pane", "close", "w2:p3"]])
    expect(socketOf(r)).toBe(lw(r.home, "herdr", `${server}.sock`))
  })

  test("your own pane id on another server is not your pane", async () => {
    const r = await spawn(
      ["close", "worker-x"],
      [],
      { HERDR_PANE_ID: "w2:p3", HERDR_SESSION: "probes" },
      undefined,
      undefined,
      opened(),
    )
    expect(r.code).toBe(0)
    expect(closes(r)).toEqual([["pane", "close", "w2:p3"]])
  })

  test.each([
    ["a cmux session", {}, opened({ runtime: "cmux" }), "does not read herdr"],
    ["a session with no runtime pin", {}, opened({ runtime: null }), "does not read herdr"],
    ["a session with no resume record", {}, opened({ record: null }), "has no resume record"],
    [
      "a server name that is not a word",
      {},
      opened({ record: "#!/bin/bash\n# server: ../x\nexec x\n" }),
      "names its server ../x",
    ],
    [
      "no pane with its label",
      {},
      opened({ panes: [{ label: "worker-y", pane_id: "w2:p4" }] }),
      "no pane on the herdr server factory carries the label worker-x",
    ],
    [
      "two panes with its label",
      {},
      opened({
        panes: [
          { label: "worker-x", pane_id: "w2:p3" },
          { label: "worker-x", pane_id: "w2:p5" },
        ],
      }),
      "2 panes on the herdr server factory carry the label worker-x",
    ],
    [
      "your own pane",
      { HERDR_PANE_ID: "w2:p3", HERDR_SESSION: "factory" },
      opened(),
      "pane w2:p3 is your own",
    ],
    ["a server that is down", { FAKE_HERDR_DOWN: "1" }, opened(), "is not running"],
    [
      "a herdr that is not the pinned one",
      { FAKE_HERDR_VERSION: "0.9.6" },
      opened(),
      "its pin names herdr 0.9.5",
    ],
  ])("it refuses %s and closes nothing", async (_, env, setup, said) => {
    const r = await spawn(["close", "worker-x"], [], env, undefined, undefined, setup)
    expect(r.code).toBe(1)
    expect(r.err).toContain("spawn.sh refuses worker-x: ")
    expect(r.err).toContain(said)
    expect(closes(r)).toEqual([])
    expect(r.roster).toBeUndefined()
  })

  test("a close herdr refuses names herdr's own words", async () => {
    const r = await spawn(
      ["close", "worker-x"],
      [],
      { FAKE_HERDR_CLOSE_FAIL: "1" },
      undefined,
      undefined,
      opened(),
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("herdr would not close pane w2:p3 (error: pane w2:p3 not found)")
    expect(r.roster).toBeUndefined()
  })

  test.each([
    ["no name", ["close"]],
    ["another word", ["close", "worker-x", "worker-y"]],
    ["an option", ["close", "worker-x", "--runtime", "herdr"]],
    ["a size", ["close", "worker-x", "--size", "small"]],
  ])("it takes a session's name alone, so %s is usage", async (_, args) => {
    const r = await spawn(args, [], {}, undefined, undefined, opened())
    expect(r.code).toBe(2)
    expect(r.err).toContain("close takes a session's name alone")
    expect(r.err).toContain("--runtime herdr    with any mode but restore or close,")
    expect(closes(r)).toEqual([])
    expect(r.roster).toBeUndefined()
  })
})

describe("a resume with no id finds its session by name in its folder (#1201)", () => {
  const SESSION = "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"
  const claude = { name: "worker-x", backend: "claude" }
  const NONE = { NO_SESSION_TRANSCRIPT: "1" }

  test("with no transcript naming it in the folder, it refuses before any pane opens, naming the fix", async () => {
    const r = await spawn(["resume", "worker-x", root], [], NONE, undefined, claude)
    expect(r.code).toBe(1)
    expect(r.err).toContain("spawn.sh refuses worker-x: ")
    expect(r.err).toContain(`no session named worker-x ran in ${root}`)
    expect(r.err).toContain("pass its session id, or resume it in the folder it ran in")
    expect(r.cmux).toBeUndefined()
    expect(r.roster).toBeUndefined()
  })

  test.each([
    [
      "it ran in another folder",
      (home: string) => ranIn(join(home, ".claude"), "/elsewhere", "worker-x"),
    ],
    [
      "another session ran in the folder",
      (home: string) => ranIn(join(home, ".claude"), root, "worker-y"),
    ],
  ])("it refuses when %s", async (_, setup) => {
    const r = await spawn(["resume", "worker-x", root], [], NONE, undefined, claude, setup)
    expect(r.code).toBe(1)
    expect(r.err).toContain(`no session named worker-x ran in ${root}`)
    expect(r.cmux).toBeUndefined()
  })

  test("a session that ran in the folder resumes by name, as before", async () => {
    const r = await spawn(["resume", "worker-x", root], [], NONE, undefined, claude, (home) =>
      ranIn(join(home, ".claude"), root, "worker-x"),
    )
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain("claude --resume worker-x -n worker-x ")
  })

  test("a resume with an id needs no transcript naming it, and herdr starts it afresh under that id", async () => {
    const r = await spawn(["resume", "worker-x", root, SESSION], [], NONE, undefined, claude)
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain(`claude --session-id ${SESSION} -n worker-x `)
  })

  test("the folder is read through its real path, as Claude Code names it", async () => {
    const link = join(scratch, `link-${Bun.hash(String(Math.random()))}`)
    symlinkSync(root, link)
    const r = await spawn(["resume", "worker-x", link], [], NONE, undefined, claude, (home) =>
      ranIn(join(home, ".claude"), root, "worker-x"),
    )
    expect(r.code).toBe(0)
  })
})

// Every cmux call of a case, one array of words a call, in order; the fake cmux appends them.
const cmuxCalls = (r: { home: string }): string[][] => {
  const f = join(r.home, "cmux.calls")
  if (!existsSync(f)) return []
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f").slice(0, -1))
}
const closes = (r: { home: string }) =>
  cmuxCalls(r).filter((c) => c[0] === "close-surface" || c[0] === "workspace")

describe("move takes a live cmux session to herdr past the load and memory gates (#1240)", () => {
  const SESSION = "0b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a"
  const SURFACE = "98189861-69DE-4CB5-B8B4-329E07BE1ADF"
  const WORKSPACE = "330A92BC-6C45-4884-B203-017ED4F7E6F1"
  const PID = 4100
  const claude = { name: "worker-x", backend: "claude" }
  const live = (name = "worker-x"): Session[] => [
    {
      pid: PID,
      raw: JSON.stringify({ cwd: root, name, pid: PID, procStart: LSTART, sessionId: SESSION }),
    },
  ]
  // The cmux record of that session, which the fake cmux prints for `sessions list`; none leaves cmux with no record of it.
  const record = (home: string, pid = PID) =>
    writeFileSync(
      join(home, "cmux.sessions"),
      JSON.stringify({
        sessions: [
          {
            agent: "claude",
            cwd: root,
            pid,
            session_id: SESSION,
            surface_id: SURFACE,
            workspace_id: WORKSPACE,
          },
        ],
      }),
    )
  const setup = (cmuxHasIt = true) => {
    const pin = herdrPin()
    return (home: string) => {
      pin(home)
      transcript(home, SESSION)
      if (cmuxHasIt) record(home)
    }
  }
  // The fake ps stops listing the pid once cmux has closed, as a session whose surface closed exits.
  const exits = { FAKE_EXITS_ON_CLOSE: String(PID), PLAYGROUND_MOVE_WAIT: "2" }
  // A machine that refuses every resume: 15% free, pressure 2, load far over the cores.
  const squeezed = { FAKE_FREE: "15", FAKE_LOAD5: "40", FAKE_PRESSURE: "2" }
  const move = (
    args: string[] = ["move", "worker-x"],
    env: Record<string, string> = {},
    sessions: Session[] = live(),
    has = true,
    pin: { name: string; backend: string } | null = claude,
  ) => spawn(args, sessions, { ...exits, ...env }, undefined, pin ?? undefined, setup(has))
  const capacity = (r: { home: string }) =>
    readFileSync(lw(r.home, "ops", "capacity.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))

  test("under a memory and load gate that refuse every resume it passes, closes the surface and resumes in herdr by its session id", async () => {
    const plain = await spawn(
      ["resume", "worker-x", root, SESSION, "--runtime", "herdr"],
      [],
      squeezed,
      undefined,
      claude,
      setup(),
    )
    expect(plain.code).toBe(1)
    expect(plain.err).toContain("the load gate holds it")
    const r = await move(["move", "worker-x"], squeezed)
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(cmuxCalls(r)).toEqual([
      ["sessions", "list", "--session", SESSION, "--json"],
      ["close-surface", "--workspace", WORKSPACE, "--surface", SURFACE, "--force"],
    ])
    expect(
      placing(r)
        .filter((c) => c[1] !== "list")
        .slice(0, 3),
    ).toEqual([
      ["workspace", "create", "--cwd", root, "--label", "worker-x", "--no-focus"],
      ["pane", "rename", "w5:p1", "worker-x"],
      ["pane", "run", "w5:p1", `exec bash '${lw(r.home, "launch", "worker-x.sh")}'`],
    ])
    expect(launchOf(r)).toContain(`claude --resume ${SESSION} -n worker-x `)
    expect(execLine(r, "worker-x")).toBe(`exec spawn.sh resume worker-x ${root} ${SESSION}`)
    expect(readFileSync(lw(r.home, "runtimes", "worker-x"), "utf8")).toBe("herdr\n")
    expect(r.roster?.some((w) => /^(?:surface|workspace)=./.test(w))).toBe(false)
    expect(r.roster).toContain("workspace=")
  })

  test("a session moving itself is refused before anything is closed", async () => {
    const r = await move(["move", "worker-x"], { CMUX_SURFACE_ID: SURFACE.toLowerCase() })
    expect(r.code).toBe(1)
    expect(r.err).toContain(`surface ${SURFACE} is your own`)
    expect(cmuxCalls(r)).toEqual([["sessions", "list", "--session", SESSION, "--json"]])
    expect(placing(r)).toEqual([])
  })

  test("a cmux record of the session at another pid, an earlier process's, closes nothing", async () => {
    const r = await spawn(["move", "worker-x"], live(), exits, undefined, claude, (home) => {
      setup(false)(home)
      record(home, PID + 1)
    })
    expect(r.code).toBe(1)
    expect(r.err).toContain(`cmux holds no surface for worker-x (session ${SESSION}, pid ${PID})`)
    expect(closes(r)).toEqual([])
    expect(placing(r)).toEqual([])
  })

  test("its capacity row is a pass that names the pid it moves and skips load and memory", async () => {
    const r = await move(["move", "worker-x"], squeezed)
    expect(r.code).toBe(0)
    const [row] = capacity(r)
    expect(row.verdict).toBe("pass")
    expect(row.gate).toBeNull()
    expect(row.readings.move).toBe(`pid ${PID}`)
    expect(row.readings.load).toContain("skipped")
    expect(row.readings.memory).toContain("skipped")
    expect(row.readings.backend).toBe("claude")
  })

  test("the usage gate still holds a move, and nothing is closed", async () => {
    const hot = JSON.stringify(
      usage({
        rate_limits: {
          five_hour: { resets_at: Math.floor(Date.now() / 1000) + 3_600, used_percentage: 95 },
          seven_day: { resets_at: Math.floor(Date.now() / 1000) + 5 * 86_400, used_percentage: 20 },
        },
      }),
    )
    const r = await move(["move", "worker-x"], { USAGE_JSON: hot })
    expect(r.code).toBe(1)
    expect(r.err).toContain("the usage gate holds it")
    expect(closes(r)).toEqual([])
    expect(placing(r)).toEqual([])
    const [row] = capacity(r)
    expect(row.verdict).toBe("refused")
    expect(row.readings.move).toBe(`pid ${PID}`)
  })

  test("--check runs the checks and closes nothing", async () => {
    const r = await move(["move", "worker-x", "--check"], squeezed)
    expect(r.code).toBe(0)
    expect(r.out).toContain("ok: worker-x can move")
    expect(cmuxCalls(r).map((c) => c[0])).toEqual(["sessions"])
    expect(placing(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes", "worker-x"))).toBe(false)
    expect(existsSync(lw(r.home, "launch", "worker-x.sh"))).toBe(false)
    expect(capacity(r)[0]?.verdict).toBe("check")
  })

  test("no live session by that name refuses with nothing closed", async () => {
    const r = await move(["move", "worker-x"], {}, live("worker-y"))
    expect(r.code).toBe(1)
    expect(r.err).toContain("no live session holds the name worker-x")
    expect(cmuxCalls(r)).toEqual([])
    expect(placing(r)).toEqual([])
  })

  test("a session cmux has no record of refuses with nothing closed", async () => {
    const r = await move(["move", "worker-x"], {}, live(), false)
    expect(r.code).toBe(1)
    expect(r.err).toContain("cmux holds no surface for worker-x")
    expect(closes(r)).toEqual([])
    expect(placing(r)).toEqual([])
  })

  test("a check that refuses closes nothing", async () => {
    const reviewer = live("reviewer-x")
    const r = await move(
      ["move", "reviewer-x", "--model", "claude-sonnet-5-5"],
      {},
      reviewer,
      true,
      { name: "reviewer-x", backend: "claude" },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain("a reviewer runs on claude-opus-5-5")
    expect(closes(r)).toEqual([])
    expect(placing(r)).toEqual([])
    const unpinned = await move(["move", "worker-x"], {}, live(), true, null)
    expect(unpinned.code).toBe(1)
    expect(unpinned.err).toContain("no backend pin for worker-x")
    expect(closes(unpinned)).toEqual([])
  })

  test("a move goes to herdr alone", async () => {
    const r = await move(["move", "worker-x", "--runtime", "cmux"])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--runtime cmux is refused: spawn.sh starts nothing in cmux")
    expect(closes(r)).toEqual([])
    const herdr = await move(["move", "worker-x", "--runtime", "herdr"])
    expect(herdr.code).toBe(0)
  })

  test("the last surface of a workspace closes the workspace", async () => {
    const r = await move(["move", "worker-x"], { FAKE_CLOSE_LAST: "1" })
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(closes(r)).toEqual([
      ["close-surface", "--workspace", WORKSPACE, "--surface", SURFACE, "--force"],
      ["workspace", "close", WORKSPACE, "--force"],
    ])
    expect(placing(r).length).toBeGreaterThan(0)
  })

  test("a close cmux refuses launches nothing", async () => {
    const r = await move(["move", "worker-x"], { FAKE_CLOSE_FAIL: "1" })
    expect(r.code).toBe(1)
    expect(r.err).toContain("cmux would not close the surface of worker-x (ERROR: Socket closed)")
    expect(placing(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes", "worker-x"))).toBe(false)
  })

  test("a process that never exits refuses, names its pid and launches nothing", async () => {
    const r = await move(["move", "worker-x"], {
      FAKE_EXITS_ON_CLOSE: "",
      PLAYGROUND_MOVE_WAIT: "1",
    })
    expect(r.code).toBe(1)
    expect(r.err).toContain(`pid ${PID} still runs`)
    expect(r.err).toContain(`spawn.sh resume worker-x ${root} ${SESSION} --runtime herdr`)
    expect(closes(r).length).toBe(1)
    expect(placing(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes", "worker-x"))).toBe(false)
    expect(existsSync(lw(r.home, "launch", "worker-x.sh"))).toBe(false)
  })

  test("herdr refusing after the close says the session is down and gives its resume", async () => {
    const r = await move(["move", "worker-x"], { FAKE_HERDR_CREATE_FAIL: "1" })
    expect(r.code).toBe(1)
    expect(r.err).toContain("after cmux closed its copy, so worker-x is down")
    expect(r.err).toContain(`spawn.sh resume worker-x ${root} ${SESSION} --runtime herdr`)
    expect(r.err).not.toContain("nothing was started")
    expect(closes(r).length).toBe(1)
    expect(existsSync(lw(r.home, "runtimes", "worker-x"))).toBe(false)
    expect(existsSync(lw(r.home, "launch", "worker-x.sh"))).toBe(false)
  })

  // Every command between the close and the herdr launch either carries the move on or refuses with the resume line, never ending the script with no word.
  const down = (r: { code: number; err: string }) => {
    expect(r.code).toBe(1)
    expect(r.err).toContain("so worker-x is down")
    expect(r.err).toContain(`spawn.sh resume worker-x ${root} ${SESSION} --runtime herdr`)
  }

  test("a pane list herdr will not give after the close opens the session in a workspace of its own", async () => {
    const r = await move(["move", "worker-x"], { FAKE_HERDR_LIST_FAIL: "1" })
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(closes(r).length).toBe(1)
    expect(placing(r).some((c) => c[0] === "workspace" && c[1] === "create")).toBe(true)
    expect(readFileSync(lw(r.home, "runtimes", "worker-x"), "utf8")).toBe("herdr\n")
  })

  test("a herdr answer file it cannot write after the close gives the resume", async () => {
    const r = await spawn(["move", "worker-x"], live(), exits, undefined, claude, (home) => {
      setup()(home)
      mkdirSync(lw(home, "launch", "worker-x.herdr"), { recursive: true })
    })
    down(r)
    expect(r.err).toContain("cannot write")
    expect(placing(r).filter((c) => c[0] === "workspace")).toEqual([])
    expect(existsSync(lw(r.home, "launch", "worker-x.sh"))).toBe(false)
  })

  test("a herdr answer file gone when herdr refuses still gives the resume", async () => {
    const r = await move(["move", "worker-x"], {
      FAKE_HERDR_RENAME_EATS: "1",
      FAKE_HERDR_RENAME_FAIL: "1",
    })
    down(r)
    expect(r.err).toContain("herdr would not label pane w5:p1")
  })

  test("the resume line carries the brief, the account and the model the move was given", async () => {
    const r = await spawn(
      [
        "move",
        "worker-x",
        "--brief",
        "handoffs/x.md",
        "--account",
        "pat@example.com",
        "--model",
        "claude-sonnet-5-5",
      ],
      live(),
      { ...exits, FAKE_HERDR_CREATE_FAIL: "1" },
      undefined,
      claude,
      (home) => {
        setup()(home)
        mkdirSync(lw(home, "handoffs"), { recursive: true })
        writeFileSync(lw(home, "handoffs", "x.md"), "brief")
      },
    )
    down(r)
    expect(r.err).toContain(
      `--runtime herdr --account pat@example.com --model claude-sonnet-5-5 --brief handoffs/x.md`,
    )
  })

  test("a process that exits after a few polls moves", async () => {
    const r = await move(["move", "worker-x"], { FAKE_EXIT_AFTER: "2" })
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
    expect(readFileSync(join(r.home, "ps.after"), "utf8")).toBe("3\n")
  })

  test("a wait with a leading zero reads as decimal seconds", async () => {
    const r = await move(["move", "worker-x"], { FAKE_EXIT_AFTER: "1", PLAYGROUND_MOVE_WAIT: "08" })
    expect(r.err).toBe("")
    expect(r.code).toBe(0)
  })

  test("a workspace cmux will not close launches nothing", async () => {
    const r = await move(["move", "worker-x"], { FAKE_CLOSE_LAST: "1", FAKE_WS_CLOSE_FAIL: "1" })
    expect(r.code).toBe(1)
    expect(r.err).toContain("cmux would not close the surface of worker-x (ERROR: Workspace busy)")
    expect(placing(r)).toEqual([])
    expect(existsSync(lw(r.home, "runtimes", "worker-x"))).toBe(false)
  })

  test("a second holder of the name refuses, and nothing is closed", async () => {
    const other: Session = {
      pid: 4200,
      raw: JSON.stringify({
        cwd: root,
        name: "worker-x",
        pid: 4200,
        procStart: LSTART,
        sessionId: "1b6e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a",
      }),
    }
    const r = await move(["move", "worker-x"], {}, [...live(), other])
    expect(r.code).toBe(1)
    expect(r.err).toContain("2 live sessions hold the name worker-x")
    expect(closes(r)).toEqual([])
  })
})
