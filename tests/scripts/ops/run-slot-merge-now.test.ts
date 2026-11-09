import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { machine, SCRIPT, runSlot, stop, WAITING } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const NOTE =
  /^run-slot\.sh: bun run pr:(merge|train) runs at once, outside the queue: a merge carries its own gates/gm

// A machine whose one CPU slot a big run holds at 30% idle, so a medium run waits, and whose bun writes its NODE_ENV into its last word for `bun run pr:merge` and `bun run pr:train`, as a merge that lands, and for the direct pr-merge/cli.ts and train-cli.ts forms, which the scripts expand to as their second step
const busy = () => {
  const m = machine({ idle: 30 })
  renameSync(join(m.bin, "bun"), join(m.bin, "bun-machine"))
  writeFileSync(
    join(m.bin, "bun"),
    `#!/bin/bash\nfor a in "$@"; do case "$a" in pr:merge|pr:train|*pr-merge/cli.ts|*pr-merge/train-cli.ts) printf '%s' "\${NODE_ENV:-}" > "\${@: -1}"; exit 0 ;; esac; done\nexec ${join(m.bin, "bun-machine")} "$@"\n`,
  )
  chmodSync(join(m.bin, "bun"), 0o755)
  m.hold("run-slot", 3, "big")
  return m
}

// 5 Nov: three merges wrapped in run-slot in one hour each waited behind the heavy queue, and each one's type step queued a second time
describe("bun run pr:merge and pr:train through run-slot", () => {
  for (const command of [
    ["bun", "run", "pr:merge", "5"],
    ["bun", "run", "pr:train", "ready"],
  ])
    test(`${command.join(" ")} runs at once beside a held slot, with a one-line note`, async () => {
      const m = busy()
      const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, command)
      // the note or the waiting line, whichever comes first, so a run that queues fails here rather than by the timeout
      const said = await run.saw(new RegExp(`${NOTE.source}|${WAITING.source}`, "gm"))
      const queued = await run.saw(WAITING)
      if (queued) await stop(run.p)
      expect([said, queued]).toEqual([true, false])
      expect(await run.saw(NOTE)).toBe(true)
      expect(await run.ran()).toBe(true)
    })

  test("a chain script holding pr:merge among other steps still waits in the queue", async () => {
    const m = busy()
    const chain = join(m.root, "merge-chain.sh")
    writeFileSync(chain, 'set -euo pipefail\nbun run pr:merge 5\ntouch "$1"\n')
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, ["bash", chain])
    expect(await run.waits()).toBe(true)
  })

  // review round 1: a merge run --after another run waits for that run's end line first, and never runs after one that failed
  test("--after <pid> -- bun run pr:merge waits for that run, then exits with its rc 1, never merging", async () => {
    const m = busy()
    const log = join(m.ops, "run-slot.runs.log")
    // the named run: this test's own live process, asked and not yet ended
    appendFileSync(log, `2026-11-05T22:00:00Z ask worker-x ${process.pid} bun run test\n`)
    const marker = join(m.root, "merged")
    const p = runSlot(
      [
        "bash",
        SCRIPT,
        "worker-x",
        "--after",
        `${process.pid}`,
        "--",
        "bun",
        "run",
        "pr:merge",
        "5",
        marker,
      ],
      { cwd: m.root, env: m.env(), stderr: "pipe", ops: m.ops },
    )
    let err = ""
    const read = (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    while (!/waiting for worker-x's run \d+ to end/.test(err) && p.exitCode === null)
      await Bun.sleep(20)
    expect([err.match(NOTE), existsSync(marker)]).toEqual([null, false])
    appendFileSync(log, `2026-11-05T22:01:00Z end worker-x ${process.pid} rc=1 ran=60s\n`)
    expect(await p.exited).toBe(1)
    await read
    expect([err.match(NOTE), existsSync(marker)]).toEqual([null, false])
  })
})

// 7 Nov: env NODE_ENV=production SKIP_ENV_VALIDATION=true bun run pr:merge 1418 asked at 14:35:13Z and again 15:13:13Z, no start line either time, so the first waited at least the 38 minutes between the asks; the script words are the merge, only prefixed
describe("a merge behind an env prefix or bun's own flags runs at once beside a held slot", () => {
  for (const command of [
    ["env", "NODE_ENV=production", "SKIP_ENV_VALIDATION=true", "bun", "run", "pr:merge", "5"],
    ["env", "bun", "run", "pr:train", "ready"],
    ["bun", "--no-env-file", "packages/scripts/src/pr-merge/cli.ts", "5"],
    ["bun", "packages/scripts/src/pr-merge/train-cli.ts", "ready"],
    ["bun", "--cwd", "/tmp/x", "run", "pr:merge", "5"],
    ["bun", "--cwd=/tmp/x", "--silent", "run", "pr:merge", "5"],
  ])
    test(`${command.join(" ")} runs at once, with the one-line note`, async () => {
      const m = busy()
      const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, command)
      const said = await run.saw(new RegExp(`${NOTE.source}|${WAITING.source}`, "gm"))
      const queued = await run.saw(WAITING)
      if (queued) await stop(run.p)
      expect([said, queued]).toEqual([true, false])
      expect(await run.saw(NOTE)).toBe(true)
      expect(await run.ran()).toBe(true)
    })

  test("a piped call with the pipe outside run-slot runs at once", async () => {
    const m = busy()
    const marker = join(m.root, "piped-merge")
    const p = runSlot(
      ["bash", "-c", `bash ${SCRIPT} worker-x -- bun run pr:merge 5 ${marker} | tail -1`],
      { cwd: m.root, env: m.env(), stderr: "pipe", ops: m.ops },
    )
    let err = ""
    const read = (async () => {
      const text = new TextDecoder()
      for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
    })()
    while (!existsSync(marker) && p.exitCode === null) await Bun.sleep(20)
    expect(existsSync(marker)).toBe(true)
    expect(err.match(WAITING)).toBe(null)
    expect(err.match(NOTE)).not.toBe(null)
    await p.exited
    await read
  })

  test("env FOO=1 bun run test still queues", async () => {
    const m = busy()
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, [
      "env",
      "FOO=1",
      "bun",
      "run",
      "test",
    ])
    expect(await run.waits()).toBe(true)
  })

  test("the env prefix reaches the merge", async () => {
    const m = busy()
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, [
      "env",
      "NODE_ENV=production",
      "bun",
      "run",
      "pr:merge",
      "5",
    ])
    expect(await run.ran()).toBe(true)
    expect(readFileSync(run.marker, "utf8")).toBe("production")
  })

  for (const command of [
    ["bun", "run", "pr:merges", "5"],
    ["env", "FOO=1", "bun", "run", "pr:merge-dry", "5"],
  ])
    test(`${command.join(" ")}, a script whose name only begins pr:merge, still queues`, async () => {
      const m = busy()
      const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, command)
      expect(await run.waits()).toBe(true)
    })

  test("the inline chain 7 Nov queued, bash -lc with pr:merge inside, still queues", async () => {
    const m = busy()
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, [
      "bash",
      "-lc",
      `cd ${m.root} && bun run pr:merge 5 2>&1 | tail -30`,
    ])
    expect(await run.waits()).toBe(true)
  })
})
