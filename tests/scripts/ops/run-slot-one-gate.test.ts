import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// A ticket waits AGED (1200 s) before it pins its place, so a pinned head is one written 1300 s back
const PINNED = 1300
const BIG = "s2 23 3 big"

const room = (m: ReturnType<typeof machine>) => {
  const run = Bun.spawnSync(["bash", SCRIPT, "room"], { cwd: m.root, env: m.env() })
  return [run.exitCode, run.stdout.toString()]
}

const iso = (secondsAgo = 0) =>
  `${new Date(Date.now() - secondsAgo * 1000).toISOString().slice(0, 19)}Z`

// the lanes verdict a waiter wrote `ago` seconds back
const lanesSeen = (m: ReturnType<typeof machine>, verdict: string, ago: number) => {
  const path = join(m.ops, "run-slot.lanes")
  writeFileSync(path, `${verdict}\n`)
  const at = Date.now() / 1000 - ago
  utimesSync(path, at, at)
}

// issue 1216: room, can-take, unstick and the queue's head read one gate, so a lane room counts as free is a lane the queue can start a run on
describe("room counts the lanes the queue's next run can take", () => {
  test("none while a pinned big head cannot start and no waiter fits past it", () => {
    const m = machine()
    m.hold("run-slot", 2, "medium")
    m.hold("run-slot-2", 2, "medium")
    m.ticket(1, "worker-big", BIG, PINNED)
    expect(room(m)).toEqual([0, "4 2 0 1\n"])
  })

  test("reads the lanes verdict a waiter wrote in the last 30 s, as the head saw it", () => {
    const m = machine()
    lanesSeen(m, "shut", 5)
    expect(room(m)).toEqual([0, "1 0 1 0\n"])
  })

  // the file today's run-slot writes, one word and only on a change, so during a roll it can sit stale: the gauges are read then
  test("reads the gauges when the lanes verdict is older than 30 s", () => {
    const m = machine()
    lanesSeen(m, "shut", 60)
    expect(room(m)).toEqual([0, "4 0 4 0\n"])
  })
})

describe("a run that fits passes a pinned big head the open lanes cannot serve", () => {
  test("a small waiter starts while held runs that started before the head block it", async () => {
    const m = machine()
    m.hold("run-slot", 2, "medium")
    m.hold("run-slot-2", 2, "medium")
    m.ticket(1, "worker-big", BIG, PINNED)
    const small = m.start("worker-s", { RUN_SLOT_SIZE: "small" })
    expect(await small.waits()).toBe(false)
    expect(existsSync(small.marker)).toBe(true)
  })

  // the head keeps its place: once it would fit but for the runs that passed it, no new run passes, and it starts as they end
  test("no new run passes once only passers block the head, and the head starts when they end", async () => {
    const m = machine()
    m.hold("run-slot", 2, "medium")
    m.hold("run-slot-2", 2, "medium", iso())
    const big = m.start("worker-big", { RUN_SLOT_SIZE: "big" })
    expect(await big.saw(WAITING)).toBe(true)
    const queue = join(m.ops, "run-slot.waiters")
    const own = readdirSync(queue).find((t) => t.endsWith("-worker-big"))!
    const at = Date.now() / 1000 - PINNED
    utimesSync(join(queue, own), at, at)
    expect(await m.start("worker-s", { RUN_SLOT_SIZE: "small" }).waits()).toBe(true)
    m.release("run-slot-2")
    expect(await big.ran()).toBe(true)
  })

  // review round 1: a commit or clone lane takes its slot outside the queue, so one taken after the head is a passer too, or each new lane would unname the head
  test("a commit lane taken after the head counts among the passers, so no new run passes it", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.ticket(1, "worker-big", BIG, PINNED)
    m.hold("run-slot-2", 1, "small", iso())
    m.hold("run-slot-commit", 0, "-", iso())
    expect(await m.start("worker-s", { RUN_SLOT_SIZE: "small" }).waits()).toBe(true)
  })

  // an older copy's ticket (no rank) or local CI's is a wall no newer ticket passes, since those take a slot only while theirs is the oldest
  test("an older copy's ticket at the head is still a wall", async () => {
    const m = machine()
    m.hold("run-slot", 2, "medium")
    m.hold("run-slot-2", 2, "medium")
    m.ticket(1, "worker-old", "s2", PINNED)
    expect(await m.start("worker-s", { RUN_SLOT_SIZE: "small" }).waits()).toBe(true)
  })
})

// ops-unstick asks can-take for the queue's head, so it reads the head's own units from its ticket rather than the session's size
describe("can-take on a queue ticket reads that ticket's units", () => {
  test("a pinned big head that cannot fit beside the held run cannot take run-slot", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot-2", 1, "small")
    m.ticket(1, "worker-big", BIG, PINNED)
    expect(await m.canTake("run-slot", `1-${process.pid}-worker-big`)).toBe(false)
  })

  test("a medium ticket that fits can take it", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot-2", 1, "small")
    m.ticket(1, "worker-m", "s2 22 2 medium")
    expect(await m.canTake("run-slot", `1-${process.pid}-worker-m`)).toBe(true)
  })

  // review round 1: a head that started between head and can-take leaves a ticket-shaped name with no file, which reads as no one's run rather than a session's
  test("a ticket name whose file is gone cannot take run-slot", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    expect(await m.canTake("run-slot", `1-${process.pid}-worker-gone`)).toBe(false)
  })

  // an older copy's ticket holds no units, so it reads as a medium, as the queue reads it
  test("an older copy's ticket reads as a medium", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot-2", 1, "small")
    m.ticket(1, "worker-old", "s2", PINNED)
    expect(await m.canTake("run-slot", `1-${process.pid}-worker-old`)).toBe(true)
  })
})
