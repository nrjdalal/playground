import { describe, expect, test } from "bun:test"

import {
  footprintOf,
  type FootprintInput,
} from "../../../../../../api/hono/src/lib/system/footprint"
import type { Proc } from "../../../../../../api/hono/src/lib/system/parse"

const MB = 1024 * 1024

const proc = (pid: number, ppid: number, mb: number): Proc => ({
  cpuSeconds: 0,
  pid,
  ppid,
  rssBytes: mb * MB,
})

// The checkout a directory sits in, as the sampler resolves it from .git.
const CHECKOUTS = ["/r/wt/a", "/r/wt/b", "/r/wt/old", "/r"]
const checkoutOf = (cwd: string): string | null =>
  CHECKOUTS.find((root) => cwd === root || cwd.startsWith(`${root}/`)) ?? null

// cmux (100) runs a shell (150) that runs worker-a's claude (200). worker-a has an MCP server (201), a background shell (210) running a dev stack whose web (212) and API (213) serve ports, the API connected to its Postgres, and a nested probe session (220) with a server of its own (222). A stack left behind in a removed worktree (300, 301) runs under launchd, beside an app (400) that sits in no checkout.
const input = (): FootprintInput => ({
  checkoutOf,
  containers: [
    { bytes: 30 * MB, id: "aaa", name: "playground-a-db", ports: [33591] },
    { bytes: 20 * MB, id: "bbb", name: "playground-x-db", ports: [40000] },
  ],
  cpu: new Map([
    [200, 5],
    [212, 0.5],
    [213, 0.25],
    [301, 2],
  ]),
  cwds: new Map([
    [100, "/"],
    [150, "/r"],
    [200, "/r"],
    [201, "/r"],
    [210, "/r/wt/a"],
    [211, "/r/wt/a"],
    [212, "/r/wt/a/web/next"],
    [213, "/r/wt/a/api/hono"],
    [220, "/r"],
    [221, "/r/wt/b"],
    [222, "/r/wt/b"],
    [300, "/r/wt/old"],
    [301, "/r/wt/old/api/hono"],
    [400, "/"],
  ]),
  procs: [
    proc(1, 0, 10),
    proc(100, 1, 200),
    proc(150, 100, 1),
    proc(200, 150, 400),
    proc(201, 200, 50),
    proc(210, 200, 2),
    proc(211, 210, 60),
    proc(212, 211, 350),
    proc(213, 211, 120),
    proc(220, 200, 300),
    proc(221, 220, 2),
    proc(222, 221, 40),
    proc(300, 1, 30),
    proc(301, 300, 90),
    proc(400, 1, 900),
  ],
  sessions: [
    { name: "probe-b", pid: 220, sessionId: "s-b" },
    { name: "worker-a", pid: 200, sessionId: "s-a" },
    { name: "gone", pid: 999, sessionId: "s-gone" },
  ],
  sockets: {
    connects: new Map([[213, new Set([33591])]]),
    listens: new Set([212, 213, 222, 301]),
  },
})

describe("footprintOf", () => {
  test("a session owns its claude and everything under it, but not a session nested inside it", () => {
    const { sessions } = footprintOf(input())
    expect(sessions.map((s) => s.name)).toEqual(["worker-a", "probe-b"])
    const [a, b] = sessions
    expect(a?.claudeBytes).toBe(400 * MB)
    expect(a?.bytes).toBe((400 + 50 + 2 + 60 + 350 + 120 + 30) * MB)
    expect(a?.cpuPercent).toBe(5.75)
    expect(b?.bytes).toBe((300 + 2 + 40) * MB)
  })

  test("a dev stack is a subtree that serves a port, by its server's checkout, with the container it connects to", () => {
    const [a, b] = footprintOf(input()).sessions
    expect(a?.stacks).toEqual([
      {
        bytes: (2 + 60 + 350 + 120 + 30) * MB,
        checkout: "/r/wt/a",
        containers: [{ bytes: 30 * MB, name: "playground-a-db" }],
        cpuPercent: 0.75,
        pids: [210, 211, 212, 213],
      },
    ])
    expect(b?.stacks.map((s) => [s.checkout, s.pids])).toEqual([["/r/wt/b", [221, 222]]])
  })

  test("what launchd runs from inside a checkout is detached, grouped by that checkout; an app elsewhere is not", () => {
    const { detached } = footprintOf(input())
    expect(detached).toEqual([
      { bytes: 120 * MB, checkout: "/r/wt/old", containers: [], cpuPercent: 2, pids: [300, 301] },
    ])
  })

  test("a detached group takes its root's checkout, even when a child holds a lower pid with no directory", () => {
    const base = input()
    base.procs.push(proc(500, 1, 40), proc(12, 500, 300))
    base.cwds.set(500, "/r/wt/old")
    const { detached } = footprintOf(base)
    expect(detached.map((s) => [s.checkout, s.pids])).toEqual([["/r/wt/old", [12, 300, 301, 500]]])
  })

  test("a container no stack connects to has no stack", () => {
    const { containers } = footprintOf(input())
    expect(containers.map((c) => [c.name, c.stack])).toEqual([
      ["playground-a-db", "/r/wt/a"],
      ["playground-x-db", null],
    ])
  })

  test("two subtrees serving from one checkout are one stack; a subtree that serves nothing is no stack", () => {
    const base = input()
    base.procs.push(proc(230, 200, 5), proc(231, 230, 70), proc(240, 200, 8))
    base.cwds.set(230, "/r/wt/a").set(231, "/r/wt/a/api/hono").set(240, "/r/wt/a")
    base.sockets.listens.add(231)
    const [a] = footprintOf(base).sessions
    expect(a?.stacks.map((s) => [s.checkout, s.pids])).toEqual([
      ["/r/wt/a", [210, 211, 212, 213, 230, 231]],
    ])
  })
})
