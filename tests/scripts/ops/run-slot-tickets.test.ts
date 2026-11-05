import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)

// retro 3, 31 Oct: a big session's 2s git push and 1s bun install each waited over 1,290s, ranked by the session's size until the age bump
describe("a ticket's units come from the run, not its session's size", () => {
  // whether a big session's command goes ahead of an older medium waiter's ticket
  const ahead = async (command: string[]) => {
    const m = machine()
    for (const bin of ["bun", "bunx"]) {
      writeFileSync(join(m.bin, bin), '#!/bin/bash\ntouch "${@: -1}"\n')
      chmodSync(join(m.bin, bin), 0o755)
    }
    m.ticket(1, "worker-m", "s2 22 2 medium")
    const run = m.start("worker-big", { RUN_SLOT_SIZE: "big" }, SCRIPT, command)
    return (await run.saw(WAITING)) ? !(await run.waits()) : run.ran()
  }

  test("a big session's bun install goes ahead of an older medium bun run test", async () => {
    expect(await ahead(["bun", "install"])).toBe(true)
  })

  test("and so does its filtered turbo run", async () => {
    expect(
      await ahead([
        "env",
        "NODE_ENV=production",
        "bunx",
        "turbo",
        "run",
        "build",
        "--filter=@packages/db",
      ]),
    ).toBe(true)
  })

  test("but its bun run test keeps the session's size", async () => {
    expect(await ahead(["bun", "run", "test"])).toBe(false)
  })

  test("and so does a full turbo build", async () => {
    expect(await ahead(["bunx", "turbo", "run", "build"])).toBe(false)
  })

  test("a big session's bunx tsc goes ahead", async () => {
    expect(await ahead(["bunx", "tsc", "--noEmit", "-p", "api/hono"])).toBe(true)
  })

  test("but an sh -c that builds and then runs tsc keeps the session's size", async () => {
    expect(
      await ahead([
        "sh",
        "-c",
        'bunx turbo run build --filter=@api/hono^...; bunx tsc --noEmit; touch "$0"',
      ]),
    ).toBe(false)
  })

  // the dry run's answer in the checkout --cwd names, printed only under the run's own NODE_ENV word, or a dry run that hangs
  const typeCheck = async (statuses: string[] | "hang") => {
    const m = machine()
    const checkout = join(m.root, "wt")
    mkdirSync(checkout)
    const tasks = [{ cache: { status: "MISS" }, command: "<NONEXISTENT>" }].concat(
      statuses === "hang" ? [] : statuses.map((status) => ({ cache: { status }, command: "tsc" })),
    )
    writeFileSync(join(checkout, "dry.json"), JSON.stringify({ tasks }))
    const dry =
      statuses === "hang" ? "exec sleep 60" : '[ "$NODE_ENV" = production ] && cat dry.json; exit 0'
    writeFileSync(
      join(m.bin, "bun"),
      `#!/bin/bash\ncase " $* " in *" --dry=json "*) ${dry} ;; esac\ntouch "\${@: -1}"\n`,
    )
    chmodSync(join(m.bin, "bun"), 0o755)
    m.ticket(1, "worker-m", "s2 22 2 medium")
    const run = m.start("worker-big", { RUN_SLOT_SIZE: "big" }, SCRIPT, [
      "env",
      "NODE_ENV=production",
      "bun",
      "run",
      "--cwd",
      checkout,
      "check-types",
    ])
    return (await run.saw(WAITING)) ? !(await run.waits()) : run.ran()
  }

  test("a big session's check-types whose every task is cached goes ahead", async () => {
    expect(await typeCheck(["HIT", "HIT"])).toBe(true)
  })

  test("but one with a task to run keeps the session's size", async () => {
    expect(await typeCheck(["HIT", "MISS"])).toBe(false)
  })

  test("and so does one whose dry run hangs past 10 s", async () => {
    expect(await typeCheck("hang")).toBe(false)
  })
})

// dispatcher, 19 Oct: Checks on a PR in the ready line (merge-queue.json's entries with a readyAt) goes first, by goAt then readyAt
describe("the ready line", () => {
  const line = (goAt7: string, goAt8: string) => ({
    queue: [
      { goAt: goAt7, pr: 7, readyAt: "2026-10-19T00:00:00Z" },
      { goAt: goAt8, pr: 8, readyAt: "2026-10-19T00:05:00Z" },
      { pr: 9 },
    ],
  })

  test("Checks for a PR earlier in it passes an older gate and a small run", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    m.ticket(2, "worker-small", "s2 21 1 small")
    expect(await m.runs("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("and waits for one with an earlier goAt", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:10:00Z", "2026-10-19T00:20:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("an ops-checks-<n> run takes its PR's place in it too", async () => {
    const m = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.runs("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("PLAYGROUND_MERGE_QUEUE names the file", async () => {
    const m = machine()
    const file = join(m.root, "queue.json")
    writeFileSync(file, JSON.stringify(line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z")))
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    const env = { PLAYGROUND_MERGE_QUEUE: file, RUN_SLOT_SIZE: "medium" }
    expect(await m.runs("ops-checks-8", env)).toBe(true)
  })

  test("with no merge-queue.json, ranks nothing", async () => {
    const m = machine()
    m.ticket(1, "ops-checks-7", "s2 02 2 medium")
    expect(await m.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("passes a worker's older pinned big ticket, as every run that goes ahead does", async () => {
    const aged = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    aged.ticket(1, "worker-big", "s2 23 3 big", 21 * 60)
    expect(await aged.runs("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("never passes local CI's older pinned ticket", async () => {
    const localci = machine({ mergeQueue: line("2026-10-19T00:20:00Z", "2026-10-19T00:10:00Z") })
    localci.ticket(1, "ops-localci", "s2")
    expect(await localci.waits("ops-checks-8", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})

// Ops, 2 Nov 21:32Z: 9 of 17 waiters were reviewers, 486 to 1304 s in, while a drafted 5/5 waited behind workers' long runs at the same class
describe("a reviewer's run", () => {
  test("takes the one free slot ahead of an older worker's medium run", async () => {
    const m = machine()
    m.ticket(1, "a1b2c3-worker", "s2 22 2 medium")
    expect(await m.runs("d4e5f6-reviewer", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("and ahead of one past AGED, which still holds back a worker's newer run", async () => {
    const aged = machine()
    aged.ticket(1, "a1b2c3-worker", "s2 22 2 medium", 21 * 60)
    expect(await aged.runs("d4e5f6-reviewer-spec", { RUN_SLOT_SIZE: "medium" })).toBe(true)
    const worker = machine()
    worker.ticket(1, "a1b2c3-worker", "s2 22 2 medium", 21 * 60)
    expect(await worker.waits("g7h8i9-worker", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  // the merge train takes its slot outside the queue, so it leaves no ticket to wait behind
  for (const [who, line] of [
    ["ops-checks-5", "s2 02 2 medium"],
    ["ops-localci", "s2"],
    ["a1b2c3-worker", "s2 12 2 medium"],
  ])
    for (const ago of [0, 21 * 60])
      test(`still waits behind an older ${who} ticket "${line}"${ago ? " past AGED" : ""}`, async () => {
        const m = machine()
        m.ticket(1, who, line, ago)
        expect(await m.waits("d4e5f6-reviewer", { RUN_SLOT_SIZE: "small" })).toBe(true)
      })

  // past AGED a ticket is pinned within its own class, as canary held it, so a big reviewer or Checks run still drains its class
  for (const [who, line, newer] of [
    ["a1b2c3-reviewer", "s2 23 3 big", "d4e5f6-reviewer"],
    ["a1b2c3-reviewer", "s2 22 2 medium", "d4e5f6-reviewer"],
    ["ops-checks-7", "s2 03 3 big", "ops-checks-9"],
  ])
    test(`a newer small ${newer} waits behind an aged ${who} ticket "${line}"`, async () => {
      const m = machine()
      m.ticket(1, who, line, 21 * 60)
      expect(await m.waits(newer, { RUN_SLOT_SIZE: "small" })).toBe(true)
    })

  test("goes ahead of a worker's newer small run, which its size alone ranked first before", async () => {
    const m = machine()
    m.ticket(1, "d4e5f6-reviewer", "s2 22 2 medium")
    expect(await m.waits("a1b2c3-worker", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

// 5 Nov: run-slot.priority moved only the pids workers reported, and 15 runs nobody reported waited 30 to 90 minutes; a session whose roster
// entry, or its worker's, has owner= (the owner's own ask, which its lead set) marks its ticket ask, ranked after the merge gates and before a reviewer's
describe("a run for the owner's own ask", () => {
  const asks = { agents: [{ name: "g7h8i9-worker", owner: "#i949" }] }

  for (const ago of [0, 21 * 60])
    test(`takes the one free slot ahead of an older worker's run${ago ? " past AGED" : ""}`, async () => {
      const m = machine({ roster: asks })
      m.ticket(1, "a1b2c3-worker", "s2 22 2 medium", ago)
      expect(await m.runs("g7h8i9-worker", { RUN_SLOT_SIZE: "medium" })).toBe(true)
    })

  test("and holds back a worker's newer small run", async () => {
    const m = machine()
    m.ticket(1, "g7h8i9-worker", "s2 22 2 medium ask")
    expect(await m.waits("a1b2c3-worker", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("goes ahead of an older reviewer's run", async () => {
    const m = machine({ roster: asks })
    m.ticket(1, "d4e5f6-reviewer", "s2 22 2 medium")
    expect(await m.runs("g7h8i9-worker", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("is the class of the worker's checker too", async () => {
    const m = machine({
      roster: { agents: [...asks.agents, { name: "g7h8i9-reviewer", worker: "g7h8i9-worker" }] },
    })
    m.ticket(1, "d4e5f6-reviewer", "s2 22 2 medium")
    expect(await m.runs("g7h8i9-reviewer", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("with an empty owner, keeps its place", async () => {
    const m = machine({ roster: { agents: [{ name: "g7h8i9-worker", owner: "" }] } })
    m.ticket(1, "a1b2c3-worker", "s2 22 2 medium")
    expect(await m.waits("g7h8i9-worker", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  // an org's, the ready line's Checks and the merge gates still go first, past AGED or not
  for (const [who, what, roster] of [
    ["worker-lw", "an org's", { agents: [{ name: "worker-lw", repo: "acme-co/web" }] }],
    ["ops-checks-8", "a ready-line Checks", undefined],
    ["ops-checks-5", "a merge gate's", undefined],
  ] as const)
    for (const ago of [0, 21 * 60])
      test(`waits behind ${what} newer run${ago ? ", past AGED" : ""}`, async () => {
        const m = machine({
          mergeQueue: { queue: [{ pr: 8, readyAt: "2026-10-19T00:00:00Z" }] },
          roster,
        })
        m.ticket(1, "g7h8i9-worker", "s2 22 2 medium ask", ago)
        expect(await m.runs(who, { RUN_SLOT_SIZE: "medium" })).toBe(true)
      })

  // past AGED a ticket is pinned within its own class, so a newer small run of the class waits behind a big one
  test("past AGED, holds back a newer small run of its class", async () => {
    const m = machine({ roster: asks })
    m.ticket(1, "a1b2c3-worker", "s2 23 3 big ask", 21 * 60)
    expect(await m.waits("g7h8i9-worker", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})
