import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  endOrphans,
  orphansOf,
  PS,
  procsOf,
} from "../../../../../packages/scripts/src/ops-tick/orphans"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const root = mkdtempSync(join(tmpdir(), "orphans-"))
const worktrees = join(root, "main", ".claude", "worktrees")
const kept = join(worktrees, "PG-2-kept")
mkdirSync(kept, { recursive: true })
const gone = join(worktrees, "review-947")
afterAll(() => rmSync(root, { force: true, recursive: true }))

// a ps -A -ww -o pid=,ppid=,etime=,command= row, as ps pads it
const row = (pid: number, ppid: number, command: string, age = "02:13:07") =>
  `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${age.padStart(11)} ${command}`

describe("procsOf", () => {
  test("reads each row's pid, parent, age and whole command, spaces kept", () => {
    expect(
      procsOf(
        [
          row(314, 1, "/usr/libexec/logd"),
          row(58523, 1, `bash ${gone}/scripts/ops/run-slot.sh worker-a -- sleep 5`, "1-04:05:06"),
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { age: "02:13:07", command: "/usr/libexec/logd", pid: 314, ppid: 1 },
      {
        age: "1-04:05:06",
        command: `bash ${gone}/scripts/ops/run-slot.sh worker-a -- sleep 5`,
        pid: 58523,
        ppid: 1,
      },
    ])
  })
})

describe("orphansOf", () => {
  const select = (rows: string[]) =>
    orphansOf(procsOf(rows.join("\n")), worktrees, existsSync).map((o) => o.pid)

  // the 7 Nov shape: a run-slot waiter a test fixture started from a review clone, left with parent pid 1 after the clone was removed
  test("selects a script of a worktree that is gone, once its parent is pid 1", () => {
    expect(
      select([row(58523, 1, `bash ${gone}/scripts/ops/run-slot.sh worker-a -- sleep 5`)]),
    ).toEqual([58523])
    expect(
      orphansOf(
        procsOf(row(63802, 1, `bun ${gone}/packages/scripts/src/x.ts`)),
        worktrees,
        existsSync,
      ),
    ).toEqual([
      {
        age: "02:13:07",
        command: `bun ${gone}/packages/scripts/src/x.ts`,
        pid: 63802,
        ppid: 1,
        worktree: gone,
      },
    ])
  })

  test("never selects a live session's process: its parent is the session, not pid 1", () => {
    expect(select([row(700, 650, `bash ${gone}/scripts/ops/run-slot.sh w -- sleep 5`)])).toEqual([])
  })

  test("never selects a process whose worktree still exists", () => {
    expect(select([row(701, 1, `bash ${kept}/scripts/ops/run-slot.sh w -- sleep 5`)])).toEqual([])
    // one named worktree still there keeps it, whatever else the command names
    expect(select([row(702, 1, `bun ${gone}/a.ts --cwd ${kept}/web/next`)])).toEqual([])
  })

  // a worktree is matched on its whole folder name, never a prefix: a gone foo leaves the live foo-2's process alone, and a gone bar-2 leaves the live bar's
  test("matches a worktree on its whole folder name, never on a prefix", () => {
    mkdirSync(join(worktrees, "foo-2"), { recursive: true })
    mkdirSync(join(worktrees, "bar"), { recursive: true })
    expect(
      select([
        row(710, 1, `bash ${worktrees}/foo-2/scripts/ops/run-slot.sh w -- sleep 5`),
        row(711, 1, `bash ${worktrees}/bar/scripts/ops/run-slot.sh w -- sleep 5`),
        row(712, 1, `bash ${worktrees}/foo/scripts/ops/run-slot.sh w -- sleep 5`),
        row(713, 1, `bash ${worktrees}/bar-2/scripts/ops/run-slot.sh w -- sleep 5`),
      ]),
    ).toEqual([712, 713])
  })

  // an ops job launchd runs from the main checkout has parent pid 1 too, and its checkout stays
  test("never selects a launchd ops job that runs a script of the main checkout", () => {
    expect(
      select([
        row(720, 1, `bun ${join(root, "main")}/packages/scripts/src/ops-tick/cli.ts`),
        row(721, 1, `bash ${join(root, "main")}/scripts/ops/run-slot.sh ops-tick -- git fetch`),
      ]),
    ).toEqual([])
  })

  // portless's shared proxy, which a stack's dev.ts starts from its worktree's node_modules and portless detaches, so its parent is pid 1; every stack routes through it, so a dependency's binary under node_modules is never this repo's script
  test("never selects a dependency's binary under a gone worktree's node_modules, the shared proxy's shape", () => {
    expect(
      select([
        row(
          730,
          1,
          `bun ${gone}/node_modules/portless/dist/cli.js proxy start --foreground -p 1355 --skip-trust`,
          "1-02:00:00",
        ),
        row(731, 1, `${gone}/node_modules/.bin/portless proxy start -p 1355`),
        row(732, 1, `${gone}/node_modules/turbo-darwin-arm64/bin/turbo daemon`),
        row(733, 1, `bun ${gone}/web/next/node_modules/next/dist/bin/next dev`),
      ]),
    ).toEqual([])
    // this repo's own script run through a dependency's binary is still this repo's script
    expect(select([row(734, 1, `${gone}/node_modules/.bin/tsx ${gone}/scripts/x.ts`)])).toEqual([
      734,
    ])
  })

  // only a script file counts: an app opened on a gone worktree's folder, or a reader of a log there, may have parent pid 1 too, and is no factory script
  test("never selects a program that names only a gone worktree's folder or a file that is no script", () => {
    expect(
      select([
        row(740, 1, `/Applications/Editor.app/Contents/MacOS/Electron ${gone}/`),
        row(741, 1, `/Applications/Editor.app/Contents/MacOS/Electron ${gone}`),
        row(742, 1, `tail -f ${gone}/.turbo/dev.log`),
        row(743, 1, `less ${gone}/README.md`),
      ]),
    ).toEqual([])
    expect(
      select([
        row(744, 1, `bash ${gone}/scripts/ops/run-slot.sh w -- sleep 5`),
        row(745, 1, `bun ${gone}/packages/scripts/src/x.ts`),
        row(746, 1, `node ${gone}/scripts/x.mjs`),
        row(747, 1, `python3 ${gone}/scripts/x.py`),
      ]),
    ).toEqual([744, 745, 746, 747])
  })

  test("never selects a process that names no worktree of this checkout", () => {
    expect(
      select([
        row(314, 1, "/usr/libexec/logd"),
        row(703, 1, `bash ${root}/elsewhere/.claude/worktrees/x/run.sh`),
        row(704, 1, `bash ${worktrees}-old/review-947/run.sh`),
        // the worktrees folder itself, no worktree in it
        row(705, 1, `ls ${worktrees}`),
      ]),
    ).toEqual([])
  })
})

describe("endOrphans", () => {
  // processes this test spawns itself, each listed by a fake ps row with parent pid 1 and a gone worktree's script, so the real kill reaches only them
  const spawnOwn = (script: string) =>
    Bun.spawn(["bun", "-e", script], { stdio: ["ignore", "ignore", "ignore"] })
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  test("sends TERM, waits the grace, sends KILL only to one still listed with the same command, and names how each ended", async () => {
    const calm = spawnOwn("setInterval(() => {}, 1000)")
    const stubborn = spawnOwn("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")
    await Bun.sleep(300)
    const own = new Map([
      [calm.pid, `bun ${gone}/scripts/calm.ts`],
      [stubborn.pid, `bun ${gone}/scripts/stubborn.ts`],
    ])
    const runs: string[][] = []
    const run: Context["run"] = async (argv) => {
      runs.push(argv)
      if (argv.join(" ") === PS.join(" "))
        return {
          code: 0,
          out: [...own]
            .filter(([pid]) => alive(pid))
            .map(([pid, c]) => row(pid, 1, c))
            .join("\n"),
        }
      if (argv[0] === "kill" && own.has(Number(argv[2]))) {
        const done = Bun.spawnSync(argv)
        return { code: done.exitCode, out: done.stderr.toString() }
      }
      throw new Error(`not this test's: ${argv.join(" ")}`)
    }
    try {
      const found = orphansOf(procsOf((await run(PS)).out), worktrees, existsSync)
      expect(found.map((o) => o.pid).sort()).toEqual([calm.pid, stubborn.pid].sort())
      const waits: number[] = []
      const said = await endOrphans(found, run, async (ms) => {
        waits.push(ms)
        await Bun.sleep(500)
      })
      expect(await calm.exited).toBe(143)
      await stubborn.exited
      expect(stubborn.signalCode).toBe("SIGKILL")
      expect(waits).toEqual([5000])
      expect(runs.filter((r) => r[0] === "kill").map((r) => `${r[1]} ${r[2]}`)).toEqual([
        `-TERM ${calm.pid}`,
        `-TERM ${stubborn.pid}`,
        `-KILL ${stubborn.pid}`,
      ])
      expect(said.kept).toEqual([])
      expect(said.ended).toEqual([
        `orphan pid ${calm.pid} ended by TERM (age 02:13:07, its worktree ${gone} gone): bun ${gone}/scripts/calm.ts`,
        `orphan pid ${stubborn.pid} ended by KILL (age 02:13:07, its worktree ${gone} gone): bun ${gone}/scripts/stubborn.ts`,
      ])
    } finally {
      calm.kill("SIGKILL")
      stubborn.kill("SIGKILL")
    }
  })

  test("sends no KILL to a pid ps now lists with another command, as a reused pid would be", async () => {
    const runs: string[][] = []
    const run: Context["run"] = async (argv) => {
      runs.push(argv)
      if (argv.join(" ") === PS.join(" ")) return { code: 0, out: row(424242, 1, "/usr/bin/other") }
      return { code: 0, out: "" }
    }
    const found = orphansOf(procsOf(row(424242, 1, `bun ${gone}/x.ts`)), worktrees, existsSync)
    const said = await endOrphans(found, run, async () => {})
    expect(runs.filter((r) => r[0] === "kill").map((r) => r[1])).toEqual(["-TERM"])
    expect(said.ended).toEqual([
      `orphan pid 424242 ended by TERM (age 02:13:07, its worktree ${gone} gone): bun ${gone}/x.ts`,
    ])
  })

  test("names a pid whose signals fail as kept, and asks nothing for none", async () => {
    const run: Context["run"] = async (argv) =>
      argv[0] === "kill"
        ? { code: 1, out: "kill: 424243: Operation not permitted" }
        : { code: 0, out: row(424243, 1, `bun ${gone}/x.ts`) }
    const found = orphansOf(procsOf(row(424243, 1, `bun ${gone}/x.ts`)), worktrees, existsSync)
    expect(await endOrphans(found, run, async () => {})).toEqual({
      ended: [],
      kept: [
        `orphan pid 424243 kept: its KILL failed: kill: 424243: Operation not permitted (age 02:13:07, its worktree ${gone} gone): bun ${gone}/x.ts`,
      ],
    })
    const none: string[][] = []
    expect(
      await endOrphans(
        [],
        async (argv) => {
          none.push(argv)
          return { code: 0, out: "" }
        },
        async () => {},
      ),
    ).toEqual({ ended: [], kept: [] })
    expect(none).toEqual([])
  })
})
