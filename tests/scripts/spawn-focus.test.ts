import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { OLD } from "../session-names"
import { placing, script, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const lead = ["column", "lead", OLD.planner, OLD.dispatcher, "w1:p2", "handoff.md"]
const focus = (until: Date) => (home: string) =>
  writeFileSync(
    join(home, ".playground", "focus.json"),
    JSON.stringify({
      reason: "demo",
      session: "owner-desk",
      since: new Date(0).toISOString(),
      until: until.toISOString(),
    }),
  )

describe("focus holds every new session", () => {
  test("on, a start is refused, naming focus's session and its end", async () => {
    const until = new Date(Date.now() + 3_600_000)
    const r = await spawn(lead, [], {}, script, undefined, focus(until))
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`focus stands for owner-desk until ${until.toISOString()}`)
  })

  // for an urgent ticket the focused session still gets its checkers, so its fix is reviewed
  test("on, the focused session's own reviewer and tester start, and a checker of another session is refused", async () => {
    const until = new Date(Date.now() + 3_600_000)
    for (const role of ["reviewer", "tester"]) {
      const own = await spawn(
        ["column", role, `${role}-owner`, "owner-desk", "w1:p2", "r.md"],
        [],
        {},
        script,
        undefined,
        focus(until),
      )
      expect(own.code).toBe(0)
    }
    const other = await spawn(
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"],
      [],
      {},
      script,
      undefined,
      focus(until),
    )
    expect(other.code).not.toBe(0)
    expect(placing(other)).toEqual([])
    expect(other.err).toContain(`focus stands for owner-desk until ${until.toISOString()}`)
  })

  test("on, a --firefighting start goes on while a firefighting trigger file stands, and is refused while none does", async () => {
    const until = new Date(Date.now() + 3_600_000)
    for (const trigger of ["firefighting-stop.json", "firefighting-headstart.json"]) {
      const r = await spawn([...lead, "--firefighting"], [], {}, script, undefined, (home) => {
        focus(until)(home)
        writeFileSync(join(home, ".playground", trigger), "{}")
      })
      expect(r.code).toBe(0)
    }
    const none = await spawn([...lead, "--firefighting"], [], {}, script, undefined, focus(until))
    expect(none.code).not.toBe(0)
    expect(placing(none)).toEqual([])
    expect(none.err).toContain(
      "--firefighting starts only while a firefighting trigger file stands in",
    )
  })

  test("lapsed, past its end, the start goes on", async () => {
    const r = await spawn(lead, [], {}, script, undefined, focus(new Date(Date.now() - 60_000)))
    expect(r.code).toBe(0)
  })

  test("off, with no focus.json, the start goes on", async () => {
    expect((await spawn(lead, [])).code).toBe(0)
  })
})
