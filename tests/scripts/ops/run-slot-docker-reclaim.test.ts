import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { dockerMachine, SCRIPT } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// #3039: two reclaimers of one stale run-slot-docker could both pass their re-read, so the second's rmdir removed the slot the next taker had just made
describe("two reclaimers of one stale run-slot-docker", () => {
  // a machine whose stale run-slot-docker names a pid no process holds, and whose fake build waits while the hold file stands
  const race = () => {
    const m = dockerMachine()
    m.holdDocker()
    const slot = join(m.ops, "run-slot-docker")
    const holder = `${slot}.holder`
    writeFileSync(holder, "worker-gone 99999999 2026-11-06T01:00:00Z\n")
    const hold = join(m.root, "hold")
    const docker = join(m.bin, "docker")
    writeFileSync(
      docker,
      readFileSync(docker, "utf8").replace(
        'touch "${@: -1}"',
        `while [ -e ${hold} ]; do sleep 0.05; done\ntouch "\${@: -1}"`,
      ),
    )
    const rest = m.env().PATH
    const until = async (path: string) => {
      while (!existsSync(path)) await Bun.sleep(20)
    }
    // a reclaimer whose mkdir, mv, rm and rmdir of the slot, its claim or its holder line go through a shim: before its nth such call it writes at-<n> and waits for go-<n> while pause-<n> stands, and before its first call on the slot folder itself (the free's rmdir or mv) it does the same with at-folder and go-folder while pause-folder stands; after each it writes done-<n> or done-folder
    const reclaimer = (who: string, pauses: (number | "folder")[], held = false) => {
      const shims = join(m.root, `shims-${who}`)
      mkdirSync(shims)
      const count = join(shims, "count")
      for (const name of ["mkdir", "mv", "rm", "rmdir"]) {
        writeFileSync(
          join(shims, name),
          `#!/bin/bash
case " $* " in
  *"/run-slot-docker "*) [ "${name}" = rmdir ] || [ "${name}" = mv ] || { PATH=${rest} exec ${name} "$@"; }
    f=; [ -e ${shims}/at-folder ] || f=1 ;;
  *"/run-slot-docker.holder "* | *"/run-slot-docker/"*) f= ;;
  *) PATH=${rest} exec ${name} "$@" ;;
esac
n=$(($(cat ${count} 2>/dev/null || echo 0) + 1)); echo $n > ${count}
[ -n "$f" ] && [ -e ${shims}/pause-folder ] && { : > ${shims}/at-folder; until [ -e ${shims}/go-folder ]; do sleep 0.05; done; }
[ -e ${shims}/pause-$n ] && { : > ${shims}/at-$n; until [ -e ${shims}/go-$n ]; do sleep 0.05; done; }
PATH=${rest} ${name} "$@"; rc=$?; : > ${shims}/done-$n; [ -n "$f" ] && : > ${shims}/done-folder; exit $rc
`,
        )
        chmodSync(join(shims, name), 0o755)
      }
      for (const n of pauses) writeFileSync(join(shims, `pause-${n}`), "")
      if (held) writeFileSync(hold, "")
      const run = m.start(who, { PATH: `${shims}:${rest}` }, SCRIPT, ["docker", "build", "."])
      return {
        at: (n: number | "folder") => until(join(shims, `at-${n}`)),
        done: (n: number | "folder") => until(join(shims, `done-${n}`)),
        go: (n: number | "folder") => writeFileSync(join(shims, `go-${n}`), ""),
        run,
      }
    }
    // whether a holder line of one of `who` stands within 10 s, its take after the reclaim; the polls are 0.02 s apart
    const holds = async (...who: string[]) => {
      for (let i = 0; i < 500; i++) {
        const line = existsSync(holder) ? readFileSync(holder, "utf8") : ""
        if (who.some((name) => line.startsWith(`${name} `))) return true
        await Bun.sleep(20)
      }
      return false
    }
    const release = () => rmSync(hold, { force: true })
    return { holder, holds, m, reclaimer, release, slot }
  }

  test("leave the taker between them its slot", async () => {
    const r = race()
    // B's call 1 is its first act on the slot after its checks of the stale holder line: the claim's mkdir (canary: the holder's rm); call 2 its next (the rmdir of a claim that landed in A's folder)
    const b = r.reclaimer("worker-b", [1])
    await b.at(1)
    const a = r.reclaimer("worker-a", [], true)
    expect(await r.holds("worker-a")).toBe(true)
    b.go(1)
    await b.done(2)
    expect(existsSync(r.slot)).toBe(true)
    expect(readFileSync(r.holder, "utf8")).toStartWith("worker-a ")
    r.release()
    expect(await a.run.ran()).toBe(true)
    expect(await b.run.ran()).toBe(true)
  })

  test("free the slot when the taker gives it back while B's claim sits in its folder", async () => {
    const r = race()
    // B's call 1 is the claim's mkdir, which lands in A's folder; call 2 the rmdir that takes that claim back out
    const b = r.reclaimer("worker-b", [1, 2])
    await b.at(1)
    const a = r.reclaimer("worker-a", [], true)
    expect(await r.holds("worker-a")).toBe(true)
    b.go(1)
    await b.at(2)
    expect(existsSync(join(r.slot, "reclaim"))).toBe(true)
    r.release()
    expect(await a.run.ran()).toBe(true)
    expect(existsSync(r.slot)).toBe(false)
    expect(existsSync(r.holder)).toBe(false)
    b.go(2)
    expect(await b.run.ran()).toBe(true)
  })

  // review round 1: the winner took its claim out before the folder, so B's claim could land between the two, the folder's rmdir failed, and the slot stood with no holder line, young for 2 hours
  test("free the slot when B tries its claim while the winner is freeing the folder", async () => {
    const r = race()
    // B's call 1 is its claim's mkdir, after its checks of the stale holder line; call 2 its next act, which a claim that landed makes, and its free's rm reaches when none did
    const b = r.reclaimer("worker-b", [1, 2])
    await b.at(1)
    // A stops before its call on the slot folder itself, its holder rm and claim behind it
    const a = r.reclaimer("worker-a", ["folder"], true)
    await a.at("folder")
    b.go(1)
    await b.done(1)
    a.go("folder")
    await a.done("folder")
    b.go(2)
    // either run may take the freed slot first, as both poll it
    expect(await r.holds("worker-a", "worker-b")).toBe(true)
    r.release()
    expect(await a.run.ran()).toBe(true)
    expect(await b.run.ran()).toBe(true)
  })
})

// review round 3: drop() named its folder <slot>.gone-$ (one $), the same name for every run, so a folder an earlier drop left there took the next free's folder in, or refused it, and the slot stood held by nobody
test("each build frees run-slot-docker past a folder an earlier drop left behind", async () => {
  const m = dockerMachine()
  const slot = join(m.ops, "run-slot-docker")
  mkdirSync(join(`${slot}.gone-$`, "run-slot-docker", "reclaim"), { recursive: true })
  for (const who of ["worker-a", "worker-b"]) {
    expect(await m.start(who, {}, SCRIPT, ["docker", "build", "."]).ran()).toBe(true)
    expect(existsSync(slot)).toBe(false)
  }
})
