import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { batteryOf, checkBattery } from "../../../../../packages/scripts/src/ops-awake/battery"
import { fakeRun } from "../ops-tick/fake-run"

const scratch = mkdtempSync(join(tmpdir(), "ops-awake-battery-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ON_BATTERY = (pct: number) =>
  `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${pct}%; discharging; 0:20 remaining present: true\n`
const ON_AC =
  "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t40%; charging; present: true\n"
const CHARGING = (pct: number) =>
  `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t${pct}%; charging; 1:40 remaining present: true\n`
// a charger that loses to the load: pmset still names AC Power, with no charging word, so only the charge between two checks says it falls
const AC_NOT_CHARGING = (pct: number) =>
  `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t${pct}%; AC attached; not charging present: true\n`
// pmset's own state word on AC, when it says the battery discharges under the charger
const AC_DISCHARGING = (pct: number) =>
  `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t${pct}%; discharging; (no estimate) present: true\n`
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

// A Mac whose pmset answers the given text, and whose ask command posts with the next id and reads each item at the status given.
const machine = (name: string) => {
  const data = join(scratch, name)
  const ops = join(data, "ops")
  mkdirSync(ops, { recursive: true })
  writeFileSync(
    join(data, "roster.json"),
    JSON.stringify({ agents: [{ kind: "ops", name: "b7k2mq-ops", status: "working" }] }),
  )
  const calls: { args: string[]; stdin?: unknown }[] = []
  let pmset = ""
  let posted = 0
  const status: Record<string, string> = {}
  // each item's other fields as ask get prints them, past its poster and status
  const fields: Record<string, object> = {}
  // ids deleted from the Inbox, whose get fails as dashboard-ask's does
  const deleted = new Set<string>()
  const run = async (argv: string[], _timeout?: number, stdin?: string) => {
    if (argv[0] === "pmset") return { code: 0, out: pmset }
    const args = argv.slice(argv.indexOf("ask") + 1)
    calls.push({ args, ...(stdin ? { stdin: JSON.parse(stdin) } : {}) })
    if (args[0] === "new") return { code: 0, out: `${ID(++posted)}\n` }
    // ask's run prints its JSON on stdout, then bun's echo of the command on stderr, which the job's run() appends
    if (args[0] === "get" && deleted.has(args[1]!))
      return { code: 1, out: `no inbox item ${args[1]}\n` }
    if (args[0] === "get")
      return {
        code: 0,
        out: `${JSON.stringify({ from: "b7k2mq-ops", status: status[args[1]!], ...fields[args[1]!] }, null, 2)}\n$ bun api/hono/src/bin/dashboard-ask.ts ${args.join(" ")}\n$ bun --no-env-file api/hono/src/bin/dashboard-ask.ts ${args.join(" ")}\n`,
      }
    return { code: 0, out: "" }
  }
  const check = (at = 0) => checkBattery({ now: new Date(at), ops, repo: "/r", run })
  // the state file past the last reading, which each check keeps
  const kept = () => {
    const { reading: _, ...rest } = JSON.parse(
      readFileSync(join(ops, "awake", "battery-state.json"), "utf8"),
    )
    return rest
  }
  // the pause run-slot reads: its line while it stands, else null
  const pause = () => {
    const path = join(ops, "run-slot.battery")
    return existsSync(path) ? readFileSync(path, "utf8") : null
  }
  return {
    calls,
    check,
    kept,
    pause,
    deleted,
    fields,
    ops,
    set: (text: string) => (pmset = text),
    status,
  }
}

test("pmset's answer reads as its power source, its charge and whether the charge falls", () => {
  expect(batteryOf(ON_BATTERY(9))).toEqual({ ac: false, falling: true, pct: 9 })
  expect(batteryOf(ON_AC)).toEqual({ ac: true, falling: false, pct: 40 })
})

test("on AC, a charge that falls reads as falling: pmset's discharging word, or the charge lower than the last check's with no charging word", () => {
  expect(batteryOf(AC_DISCHARGING(4))).toEqual({ ac: true, falling: true, pct: 4 })
  expect(batteryOf(AC_NOT_CHARGING(4), { ac: true, falling: false, pct: 5 })).toEqual({
    ac: true,
    falling: true,
    pct: 4,
  })
  // whole percents: a reading level with the last keeps the last's trend, so a dip that then holds still reads as falling
  expect(batteryOf(AC_NOT_CHARGING(4), { ac: true, falling: true, pct: 4 }).falling).toBe(true)
  // a charge that holds with no fall seen, that rises, or that pmset says is charging, does not fall
  expect(batteryOf(AC_NOT_CHARGING(5)).falling).toBe(false)
  expect(batteryOf(AC_NOT_CHARGING(5), { ac: true, falling: false, pct: 5 }).falling).toBe(false)
  expect(batteryOf(AC_NOT_CHARGING(5), { ac: true, falling: true, pct: 4 }).falling).toBe(false)
  expect(batteryOf(CHARGING(4), { ac: true, falling: true, pct: 4 }).falling).toBe(false)
  // a plug-in into a charger losing to the load keeps the battery's fall, since only a rise or the charging word ends it
  expect(batteryOf(AC_NOT_CHARGING(4), { ac: false, falling: true, pct: 4 }).falling).toBe(true)
})

describe("the red mark on a charger losing to the load, and the pause", () => {
  test("at 5% and falling on AC, the red alert posts with the charger's reason, the orange ask stays unposted, and run-slot.battery stands", async () => {
    const mac = machine("ac-falling")
    mac.set(AC_NOT_CHARGING(6))
    await mac.check(1_000_000)
    expect(mac.calls).toEqual([])
    expect(mac.pause()).toBeNull()
    mac.set(AC_NOT_CHARGING(5))
    await mac.check(1_060_000)
    expect(mac.calls).toEqual([
      {
        args: ["new"],
        stdin: {
          from: "b7k2mq-ops",
          kind: "update",
          preview: { outcome: "alert" },
          title:
            "The Mac's battery is at 5% on the charger: the charger is losing to the load, and heavy runs wait until the charge rises",
        },
      },
    ])
    expect(mac.kept()).toEqual({ alert: ID(1) })
    expect(mac.pause()).toBe(
      "ops-awake 1970-01-01T00:17:40Z 1970-01-01T00:27:40Z the battery is at 5% and falling, so heavy runs wait until the charge rises\n",
    )
    // each check while the mark holds pushes the fail-safe expiry on, so only an ops-awake that has stopped lets it lapse
    await mac.check(1_120_000)
    expect(mac.pause()).toStartWith("ops-awake 1970-01-01T00:18:40Z 1970-01-01T00:28:40Z ")
  })

  test("at 5% and falling on battery, the red alert says heavy runs wait, and run-slot.battery stands", async () => {
    const mac = machine("battery-red")
    mac.set(ON_BATTERY(5))
    await mac.check(1_000_000)
    expect(mac.calls.map((c) => (c.stdin as { title: string }).title)).toEqual([
      "Plug in the Mac: its battery is at 5%",
      "The Mac's battery is at 5%: plug it in now or it shuts down, and heavy runs wait until the charge rises",
    ])
    expect(mac.pause()).toStartWith("ops-awake ")
  })

  test("the check that sees the charge rise lifts run-slot.battery by its .lifted move, on battery and on AC", async () => {
    for (const [name, red, rise] of [
      ["lift-battery", ON_BATTERY(4), CHARGING(4)],
      ["lift-ac", AC_DISCHARGING(4), AC_NOT_CHARGING(5)],
    ] as const) {
      const mac = machine(name)
      mac.set(red)
      await mac.check(1_000_000)
      expect(mac.pause()).not.toBeNull()
      mac.set(rise)
      await mac.check(1_060_000)
      expect(mac.pause()).toBeNull()
      expect(readdirSync(mac.ops).filter((f) => f.startsWith("run-slot.battery"))).toEqual([
        "run-slot.battery.lifted-19700101T001740Z",
      ])
    }
  })

  test("a 1% dip on AC pauses, a hold after it keeps the pause, and the next rise lifts it", async () => {
    const mac = machine("dip")
    mac.set(AC_NOT_CHARGING(5))
    await mac.check(1_000_000)
    mac.set(AC_NOT_CHARGING(4))
    await mac.check(1_060_000)
    expect(mac.pause()).not.toBeNull()
    await mac.check(1_120_000)
    expect(mac.pause()).not.toBeNull()
    mac.set(AC_NOT_CHARGING(5))
    await mac.check(1_180_000)
    expect(mac.pause()).toBeNull()
  })

  test("plugged into a losing charger at the red mark, the pause stands and nothing posts or closes until the charge rises", async () => {
    const mac = machine("plug-in")
    mac.set(ON_BATTERY(4))
    await mac.check(1_000_000)
    expect(mac.calls.map((c) => c.args[0])).toEqual(["new", "new"])
    mac.calls.length = 0
    mac.set(AC_NOT_CHARGING(4))
    await mac.check(1_060_000)
    mac.set(AC_NOT_CHARGING(3))
    await mac.check(1_120_000)
    expect(mac.calls).toEqual([])
    expect(mac.pause()).not.toBeNull()
    expect(mac.kept()).toEqual({ alert: ID(2), ask: ID(1) })
    mac.set(CHARGING(3))
    await mac.check(1_180_000)
    expect(mac.pause()).toBeNull()
  })

  test("on AC with the charge holding or rising at 5%, nothing posts and nothing pauses", async () => {
    const mac = machine("ac-holding")
    for (const [at, text] of [
      [1_000_000, AC_NOT_CHARGING(5)],
      [1_060_000, AC_NOT_CHARGING(5)],
      [1_120_000, AC_NOT_CHARGING(5)],
      [1_180_000, CHARGING(5)],
    ] as const) {
      mac.set(text)
      await mac.check(at)
    }
    expect(mac.calls).toEqual([])
    expect(mac.pause()).toBeNull()
  })

  test("the check calls pmset and ask alone, so no session is stopped at the red mark", async () => {
    const mac = machine("sessions")
    const { run, runs } = fakeRun({ "ask new": `${ID(1)}\n`, pmset: ON_BATTERY(3) })
    await checkBattery({ now: new Date(1_000_000), ops: mac.ops, repo: "/r", run })
    expect(
      runs.map((argv) => (argv[0] === "pmset" ? "pmset" : argv.slice(5, 7).join(" "))),
    ).toEqual(["pmset", "ask new", "ask new"])
  })
})

test("discharging posts the orange ask at 10% and the red alert at 5%, each once, from the Ops lead", async () => {
  const mac = machine("drain")
  mac.set(ON_BATTERY(11))
  expect(await mac.check()).toBeUndefined()
  expect(mac.calls).toEqual([])
  mac.set(ON_BATTERY(10))
  await mac.check()
  await mac.check()
  expect(mac.calls).toEqual([
    {
      args: ["new"],
      stdin: {
        from: "b7k2mq-ops",
        preview: { text: "Approve: I plugged in the Mac.\nDeny: I can't right now.", type: "ask" },
        title: "Plug in the Mac: its battery is at 10%",
      },
    },
  ])
  mac.set(ON_BATTERY(5))
  await mac.check()
  expect(mac.calls.slice(1)).toEqual([
    {
      args: ["new"],
      stdin: {
        from: "b7k2mq-ops",
        kind: "update",
        preview: { outcome: "alert" },
        title:
          "The Mac's battery is at 5%: plug it in now or it shuts down, and heavy runs wait until the charge rises",
      },
    },
  ])
  expect(mac.kept()).toEqual({
    alert: ID(2),
    ask: ID(1),
  })
})

// the ask (ID 1) is a decision, open until answered; the red alert (ID 2) is an update, posted at status done
test("back on power, an approved ask is acked, the alert resolved by its poster, and the state re-arms", async () => {
  const mac = machine("back")
  mac.set(ON_BATTERY(4))
  await mac.check()
  mac.status[ID(1)] = "approved"
  mac.status[ID(2)] = "done"
  mac.fields[ID(2)] = { kind: "update" }
  mac.set(ON_AC)
  mac.calls.length = 0
  await mac.check()
  expect(mac.calls.map((c) => c.args)).toEqual([
    ["get", ID(1), "--ack"],
    ["ack", ID(1), "--no-link", "The Mac's charge has stopped falling"],
    ["get", ID(2), "--ack"],
    ["resolve", ID(2), "--by", "b7k2mq-ops", "--note", "The Mac's charge has stopped falling"],
  ])
  expect(mac.kept()).toEqual({})
})

test("back on power, an open ask is settled", async () => {
  const mac = machine("open")
  mac.set(ON_BATTERY(9))
  await mac.check()
  mac.status[ID(1)] = "open"
  mac.set(ON_AC)
  mac.calls.length = 0
  await mac.check()
  expect(mac.calls.map((c) => c.args)).toEqual([
    ["get", ID(1), "--ack"],
    ["settle", ID(1), "--note", "The Mac's charge has stopped falling"],
  ])
})

// retro 35: ask get's JSON, then bun's echo lines, failed the parse, so 349 "not closed" lines went to ops and the orange ask was never armed again
test("back on power, a cleared ask and a resolved alert leave state on their read, which marks an answer read, with no further ask call", async () => {
  const mac = machine("cleared")
  mac.set(ON_BATTERY(4))
  await mac.check()
  mac.status[ID(1)] = "cleared"
  mac.status[ID(2)] = "done"
  mac.fields[ID(2)] = { answer: { choice: "resolved" }, kind: "update" }
  mac.set(ON_AC)
  mac.calls.length = 0
  expect(await mac.check(1_000_000_000)).toBeUndefined()
  expect(mac.calls.map((c) => c.args)).toEqual([
    ["get", ID(1), "--ack"],
    ["get", ID(2), "--ack"],
  ])
  expect(mac.kept()).toEqual({})
})

// a reply keeps the ask open, and its poster's ack stamps ackedAt, after which settle and ack are both refused
test("back on power, an ask whose answer its poster acked, open or approved, leaves state on its read", async () => {
  for (const status of ["open", "approved"]) {
    const mac = machine(`acked-${status}`)
    mac.set(ON_BATTERY(9))
    await mac.check()
    mac.status[ID(1)] = status
    mac.fields[ID(1)] = {
      answer: {
        ackedAt: "2026-11-04T20:00:00Z",
        choice: status === "open" ? "replied" : "approved",
      },
    }
    mac.set(ON_AC)
    mac.calls.length = 0
    expect(await mac.check(1_000_000_000)).toBeUndefined()
    expect(mac.calls.map((c) => c.args)).toEqual([["get", ID(1), "--ack"]])
    expect(mac.kept()).toEqual({})
  }
})

test("back on power, an item deleted from the Inbox leaves state with no failure line", async () => {
  const mac = machine("deleted")
  mac.set(ON_BATTERY(9))
  await mac.check()
  mac.deleted.add(ID(1))
  mac.set(ON_AC)
  mac.calls.length = 0
  expect(await mac.check(1_000_000_000)).toBeUndefined()
  expect(mac.calls.map((c) => c.args)).toEqual([["get", ID(1), "--ack"]])
  expect(mac.kept()).toEqual({})
})

test("a post that fails is told to ops once in 15 minutes, and tried again each minute", async () => {
  const mac = machine("refused")
  const failing = async (argv: string[]) =>
    argv[0] === "pmset" ? { code: 0, out: ON_BATTERY(8) } : { code: 1, out: "no database" }
  const check = (at: number) =>
    checkBattery({ now: new Date(at), ops: mac.ops, repo: "/r", run: failing })
  expect(await check(1_000_000)).toBe("battery alert: ask not posted to the Inbox: no database")
  expect(await check(1_060_000)).toBeUndefined()
  expect(await check(1_000_000 + 15 * 60_000)).toStartWith("battery alert:")
})

test("ask runs under bun run --silent, so a refusal reads as ask's own line, not bun's echo and exit line (#1102)", async () => {
  const mac = machine("silent")
  const { run, runs } = fakeRun({
    "ask new": { code: 1, err: "ask: refused\n" },
    pmset: ON_BATTERY(8),
  })
  const line = await checkBattery({ now: new Date(1_000_000), ops: mac.ops, repo: "/r", run })
  expect(runs.filter((argv) => argv.includes("ask"))[0]).toEqual([
    "bun",
    "run",
    "--silent",
    "--cwd",
    "/r",
    "ask",
    "new",
  ])
  expect(line).toBe("battery alert: ask not posted to the Inbox: ask: refused")
})

test("a Mac with no pmset is left alone", async () => {
  const none = async () => ({ code: 127, out: "" })
  expect(
    await checkBattery({ now: new Date(), ops: join(scratch, "none"), repo: "/r", run: none }),
  ).toBeUndefined()
})
