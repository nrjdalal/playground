import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { machine, runSlot, SCRIPT } from "./run-slot-fake"

// a check waits on its run's exit or a file its shim writes, so the timeout only catches a hang
setDefaultTimeout(60_000)

const DEAD = "worker-gone 99999999 2026-11-06T01:00:00Z 2 medium\n"
const LIVE = `worker-t ${process.pid} 2026-11-25T13:00:00Z 2 medium\n`

// a machine whose run-slot is set up by `plant`, and a run of run-slot.sh `cmd` whose mkdir, mv, rm and rmdir of run-slot, its holder line or a path in it go through a shim that, before its nth such call, writes `at` and waits for `go`
const paused = (plant: (slot: string) => void, cmd: string, pause: number) => {
  const m = machine()
  const slot = join(m.ops, "run-slot")
  plant(slot)
  const shims = join(m.root, "shims")
  mkdirSync(shims)
  const rest = m.env().PATH
  for (const name of ["mkdir", "mv", "rm", "rmdir"]) {
    writeFileSync(
      join(shims, name),
      `#!/bin/bash
case " $* " in
  *"/run-slot "* | *"/run-slot.holder "* | *"/run-slot/"*) ;;
  *) PATH=${rest} exec ${name} "$@" ;;
esac
n=$(($(cat ${shims}/count 2>/dev/null || echo 0) + 1)); echo $n > ${shims}/count
[ $n = ${pause} ] && { : > ${shims}/at; until [ -e ${shims}/go ]; do sleep 0.05; done; }
PATH=${rest} exec ${name} "$@"
`,
    )
    chmodSync(join(shims, name), 0o755)
  }
  const run = runSlot(["bash", SCRIPT, cmd], {
    env: m.env({ PATH: `${shims}:${rest}` }),
    stdout: "pipe",
    ops: m.ops,
  })
  return {
    at: async () => {
      while (!existsSync(join(shims, "at"))) await Bun.sleep(20)
    },
    go: () => writeFileSync(join(shims, "go"), ""),
    holder: `${slot}.holder`,
    out: async () => {
      expect(await run.exited).toBe(0)
      return new Response(run.stdout).text()
    },
    slot,
  }
}

const aged = (path: string) =>
  utimesSync(path, new Date(Date.now() - 3 * 3600_000), new Date(Date.now() - 3 * 3600_000))

// what a take does while clear-stale waits: a reclaimer moves the stale folder out, and the next run makes its own and writes its live holder line
const take = (slot: string) => {
  if (existsSync(slot)) renameSync(slot, `${slot}.away`)
  mkdirSync(slot)
  writeFileSync(`${slot}.holder`, LIVE)
}

// #3052: clear-stale checked a slot, then removed its folder and holder line in a second step, so a take between the two lost both
describe("a take between clear-stale's check and its removal keeps its folder and holder line", () => {
  const rows: [string, (slot: string) => void][] = [
    [
      "a holder line whose pid has died",
      (slot) => {
        mkdirSync(slot)
        writeFileSync(`${slot}.holder`, DEAD)
      },
    ],
    [
      "a folder with no holder line, 2 hours old",
      (slot) => {
        mkdirSync(slot)
        aged(slot)
      },
    ],
    ["a holder line with no folder", (slot) => writeFileSync(`${slot}.holder`, DEAD)],
  ]
  test.each(rows)("%s", async (_, plant) => {
    // call 1 is clear-stale's first act on the slot after its checks: the claim's mkdir (canary: the folder's rmdir, or the holder's rm when no folder stood)
    const r = paused(plant, "clear-stale", 1)
    await r.at()
    take(r.slot)
    r.go()
    expect(await r.out()).not.toContain("run-slot: cleared")
    expect(readdirSync(r.slot)).toEqual([])
    expect(readFileSync(r.holder, "utf8")).toBe(LIVE)
  })
})

// #3052: a reclaimer that found a claim 2 hours old removed it in a second step, so a live claim made between the two was removed and a second reclaimer could claim beside it
test("a live claim made between the stale claim's check and its removal stands", async () => {
  const r = paused(
    (slot) => {
      mkdirSync(join(slot, "reclaim"), { recursive: true })
      aged(join(slot, "reclaim"))
      writeFileSync(`${slot}.holder`, DEAD)
    },
    "room",
    2,
  )
  // call 1 is the claim's mkdir, which the old claim refuses; call 2 the next act on it (canary: the old claim's rmdir)
  await r.at()
  const claim = join(r.slot, "reclaim")
  renameSync(claim, `${r.slot}.old-claim`)
  mkdirSync(claim)
  const live = statSync(claim).ino
  r.go()
  await r.out()
  expect(statSync(claim).ino).toBe(live)
  expect(readdirSync(claim)).toEqual([])
  expect(readFileSync(r.holder, "utf8")).toBe(DEAD)
})

describe("a slot that really is stale is still cleared", () => {
  const cleared = async (plant: (slot: string) => void, line: string) => {
    const m = machine()
    const slot = join(m.ops, "run-slot")
    plant(slot)
    const p = runSlot(["bash", SCRIPT, "clear-stale"], { env: m.env(), stdout: "pipe", ops: m.ops })
    expect(await p.exited).toBe(0)
    expect(await new Response(p.stdout).text()).toContain(`run-slot: ${line}`)
    expect(existsSync(slot)).toBe(false)
    expect(existsSync(`${slot}.holder`)).toBe(false)
  }

  test("a holder line whose pid has died, with its folder", () =>
    cleared((slot) => {
      mkdirSync(slot)
      writeFileSync(`${slot}.holder`, DEAD)
    }, "cleared a stale holder"))

  test("a holder line with no folder", () =>
    cleared((slot) => writeFileSync(`${slot}.holder`, DEAD), "cleared a stale holder"))

  test("a folder with no holder line, 2 hours old", () =>
    cleared((slot) => {
      mkdirSync(slot)
      aged(slot)
    }, "cleared a slot directory with no holder line"))

  // a reclaimer killed holding its claim left it in the folder; the claim 2 hours old is taken over, and the folder goes with it
  test("a folder holding a claim 2 hours old", () =>
    cleared((slot) => {
      mkdirSync(join(slot, "reclaim"), { recursive: true })
      aged(join(slot, "reclaim"))
      writeFileSync(`${slot}.holder`, DEAD)
    }, "cleared a stale holder"))
})
