import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, set } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>

const room = (m: Machine) => {
  const r = Bun.spawnSync(["bash", SCRIPT, "room"], { cwd: m.root, env: m.env() })
  return { code: r.exitCode, err: r.stderr.toString(), out: r.stdout.toString() }
}
const roster = { agents: [{ name: "worker-f", status: "working" }] }

// PG-3189, 27 Nov: a reviewer's start was refused for about 20 min while room's four numbers gave no sign of the focus
describe("room names the focus that holds the lanes on stderr, its stdout the four numbers", () => {
  test("under a focus on a live session: the line names it, its end and its reason", async () => {
    const m = machine({ roster })
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "an urgent ticket")
    const ends = readFileSync(join(m.ops, "run-slot.focus"), "utf8").split(" ")[2]
    const r = room(m)
    expect(r.code).toBe(0)
    expect(r.out).toBe("4 0 0 0\n")
    expect(r.err).toBe(
      `run-slot.sh: run-slot.focus for worker-f holds the lanes until ${ends}: an urgent ticket\n`,
    )
  })

  test("with no focus, stdout and stderr read as before", () => {
    const r = room(machine({ roster }))
    expect(r).toEqual({ code: 0, err: "", out: "4 0 4 0\n" })
  })

  // a focus no live session holds holds no lane (issue 3184), so it names none
  test("under a focus on a name no live session holds, no line", async () => {
    const m = machine({ roster })
    await set(m, "worker-gone", "focus", "--for", "30m", "--reason", "demo")
    expect(room(m)).toEqual({ code: 0, err: "", out: "4 0 4 0\n" })
  })
})
