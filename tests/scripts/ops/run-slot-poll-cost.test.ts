import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, WAITING, stop, machine } from "./run-slot-fake"

setDefaultTimeout(90_000)

// every external command run-slot.sh calls by name; a shim for each counts its start, so a start the shims miss is a fork that runs bash alone, which the trace's subshell levels count
const COMMANDS =
  "awk basename bun cat cut date diff dirname docker env find getconf git grep head id iostat ls mkdir mktemp mv nice ps python3 readlink realpath rm rmdir sed seq setsid sleep sort ssh stat sysctl tail timeout top touch tr uname uptime vm_stat wc xargs".split(
    " ",
  )

type Machine = ReturnType<typeof machine>
// shims ahead of the machine's PATH, each a perl script, which the waiters' xtrace leaves untraced, that writes its name to the count file and runs the command the machine's PATH finds
const shim = (m: Machine) => {
  const dir = join(m.root, "shims")
  const count = join(m.root, "starts")
  mkdirSync(dir)
  writeFileSync(count, "")
  const rest = m.env().PATH
  for (const name of COMMANDS) {
    writeFileSync(
      join(dir, name),
      `#!/usr/bin/perl\nopen(my $f, ">>", "${count}"); print $f "${name}\\n"; close $f;\n$ENV{PATH} = "${rest}";\nexec { "${name}" } "${name}", @ARGV or exit 127;\n`,
    )
    chmodSync(join(dir, name), 0o755)
  }
  return { count, path: `${dir}:${rest}` }
}
// starts a waiter under xtrace, its PS4 the subshell level, and keeps its stderr
const waiter = (
  m: Machine,
  path: string,
  who: string,
  command: string[],
  extra: Record<string, string>,
) => {
  const marker = join(m.root, `ran-${who}`)
  const p = Bun.spawn(["bash", SCRIPT, who, "--", ...command, marker], {
    cwd: m.root,
    env: m.env({ ...extra, PATH: path, PS4: "+$BASH_SUBSHELL ", SHELLOPTS: "xtrace" }),
    stderr: "pipe",
  })
  const w = { err: "", marker, p }
  void (async () => {
    const text = new TextDecoder()
    for await (const chunk of p.stderr) w.err += text.decode(chunk, { stream: true })
  })()
  return w
}
type Waiter = ReturnType<typeof waiter>
// the subshells a trace shows entered: each line at a deeper level than the line before it
const subshells = (trace: string) => {
  let n = 0
  let last = 0
  for (const line of trace.split("\n")) {
    const level = line.match(/^\++(\d+) /)?.[1]
    if (level === undefined) continue
    if (Number(level) > last) n++
    last = Number(level)
  }
  return n
}
// the processes the waiters started together each second over `window` seconds, once each has printed its first wait line
const starts = async (count: string, waiters: Waiter[], waits: RegExp, window: number) => {
  for (const w of waiters) while (!waits.test(w.err)) await Bun.sleep(50)
  const from = waiters.map((w) => w.err.length)
  const before = readFileSync(count, "utf8").split("\n").length
  await Bun.sleep(window * 1000)
  const execs = readFileSync(count, "utf8").split("\n").length - before
  const forks = waiters.reduce((n, w, i) => n + subshells(w.err.slice(from[i])), 0)
  await Promise.all(waiters.map((w) => stop(w.p)))
  expect(waiters.every((w) => !existsSync(w.marker))).toBe(true)
  return (execs + forks) / window
}

// issue 1338, 7 Nov: sixteen waiters started about 60 processes a second between them, which held load5 between 30 and 42 on 15 cores with the CPU half idle, so the slots they waited for stayed shut
describe("waiters cost close to nothing while they wait", () => {
  test("ten queue waiters behind held slots start fewer than 5 processes a second together", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["touch"], { RUN_SLOT_POLL: "15" }),
    )
    expect(await starts(count, waiters, new RegExp(WAITING.source, "m"), 30)).toBeLessThan(5)
  })

  test("and so do ten clone waiters behind the load brake", async () => {
    const m = machine({ cores: 8, load1: 2, load5: 20 })
    mkdirSync(join(m.root, "node_modules"))
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["cp", "-R", "node_modules"], { RUN_SLOT_POLL: "5" }),
    )
    expect(await starts(count, waiters, /^run-slot\.sh: this clone waits /m, 10)).toBeLessThan(5)
  })
})
