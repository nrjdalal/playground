import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, SCRIPT } from "./run-slot-fake"

// a check waits on a run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>

const log = (m: Machine) => {
  const path = join(m.ops, "run-slot.runs.log")
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}
const logged = (m: Machine, kind: string, who: string, pid: number) =>
  log(m)
    .split("\n")
    .some(
      (l) => l.split(" ")[1] === kind && l.split(" ")[2] === who && l.split(" ")[3] === `${pid}`,
    )
const until = async (ok: () => boolean) => {
  while (!ok()) await Bun.sleep(20)
}
// every holder line and queue ticket that names the pid
const holds = (m: Machine, pid: number) => [
  ...readdirSync(m.ops)
    .filter((f) => f.endsWith(".holder"))
    .filter((f) => readFileSync(join(m.ops, f), "utf8").split(" ")[1] === `${pid}`),
  ...(existsSync(join(m.ops, "run-slot.waiters"))
    ? readdirSync(join(m.ops, "run-slot.waiters")).filter((f) => f.split("-")[1] === `${pid}`)
    : []),
]
// a run through run-slot that ends with `rc` once the test writes its gate file
const gated = (m: Machine, who: string, rc: number) => {
  const gate = join(m.root, `gate-${Math.random()}`)
  const p = Bun.spawn(
    [
      "bash",
      SCRIPT,
      who,
      "--",
      "bash",
      "-c",
      `until [ -e "${gate}" ]; do sleep 0.1; done; exit ${rc}`,
    ],
    { cwd: m.root, env: m.env(), stderr: "ignore" },
  )
  return { open: () => writeFileSync(gate, ""), p }
}
// an --after run of `touch <marker>`, its stderr read as it comes
const after = (m: Machine, who: string, pid: string) => {
  const marker = join(m.root, `after-${Math.random()}`)
  const p = Bun.spawn(["bash", SCRIPT, who, "--after", pid, "--", "touch", marker], {
    cwd: m.root,
    env: m.env(),
    stderr: "pipe",
  })
  let err = ""
  let ended = false
  void p.exited.then(() => (ended = true))
  void (async () => {
    const text = new TextDecoder()
    for await (const chunk of p.stderr) err += text.decode(chunk, { stream: true })
  })()
  return { ended: () => ended, err: () => err, marker, p }
}
const WAITING = /waiting for worker-a's run \d+ to end before this one asks/

// 4 Nov: a wait script took run-slot-2 and held it 1575 s, polling for its own worker's commit, which sat behind it in the queue
describe("run-slot --after <pid>", () => {
  test("waits outside the queue while the first run is queued and while it runs, then asks once it ends rc 0", async () => {
    // idle 30 keeps slots 2 to 4 shut, so the held run-slot leaves the first run queued
    const m = machine({ idle: 30 })
    m.hold("run-slot", 2, "medium")
    const first = gated(m, "worker-a", 0)
    await until(() => logged(m, "ask", "worker-a", first.p.pid))
    const second = after(m, "worker-a", `${first.p.pid}`)
    await until(() => second.ended() || WAITING.test(second.err()))
    expect(second.err()).toMatch(WAITING)
    expect(logged(m, "ask", "worker-a", second.p.pid)).toBe(false)
    expect(holds(m, second.p.pid)).toEqual([])

    m.release("run-slot")
    await until(() => logged(m, "start", "worker-a", first.p.pid))
    await Bun.sleep(500)
    expect(logged(m, "ask", "worker-a", second.p.pid)).toBe(false)
    expect(holds(m, second.p.pid)).toEqual([])

    first.open()
    expect(await first.p.exited).toBe(0)
    expect(await second.p.exited).toBe(0)
    expect(existsSync(second.marker)).toBe(true)
    expect(logged(m, "ask", "worker-a", second.p.pid)).toBe(true)
  })

  test("exits with the first run's rc, never asking or running, when it ends rc 1", async () => {
    const m = machine()
    const first = gated(m, "worker-a", 1)
    await until(() => logged(m, "start", "worker-a", first.p.pid))
    const second = after(m, "worker-a", `${first.p.pid}`)
    await until(() => second.ended() || WAITING.test(second.err()))
    expect(second.err()).toMatch(WAITING)
    first.open()
    expect(await first.p.exited).toBe(1)
    expect(await second.p.exited).toBe(1)
    expect(existsSync(second.marker)).toBe(false)
    expect(logged(m, "ask", "worker-a", second.p.pid)).toBe(false)
    expect(second.err()).toContain(
      `worker-a's run ${first.p.pid} ended rc=1, so this run never asks`,
    )
  })

  test("refuses a pid that ended with no end line, as a runner-host run does, never running", async () => {
    const m = machine()
    const gone = Bun.spawn(["true"])
    await gone.exited
    const second = after(m, "worker-a", `${gone.pid}`)
    expect(await second.p.exited).toBe(2)
    expect(existsSync(second.marker)).toBe(false)
    expect(logged(m, "ask", "worker-a", second.p.pid)).toBe(false)
    expect(second.err()).toContain("with no end line in run-slot.runs.log")
  })

  test("refuses an --after that names no pid", async () => {
    const m = machine()
    const second = after(m, "worker-a", "abc")
    expect(await second.p.exited).toBe(2)
    expect(existsSync(second.marker)).toBe(false)
    expect(second.err()).toContain("--after takes the pid")
  })
})
