import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  execLine,
  herdrPin,
  launchOf,
  LSTART,
  lw,
  placing,
  root,
  Session,
  spawn,
  transcript,
  usage,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

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
