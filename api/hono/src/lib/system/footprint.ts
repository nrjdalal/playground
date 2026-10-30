import type { DockerContainer, Proc, Sockets } from "@/lib/system/parse"

// Pure: which processes belong to which Claude session, and which of them are a dev stack. A process is a session's when it descends from that session's claude process, by parentage; claude itself keeps the directory it was launched in, so a directory alone cannot place a session. Within a session, a dev stack is a subtree under one of claude's direct children (a Bash tool's shell, a background task) that serves a TCP port, keyed by the checkout its server runs in; subtrees serving from one checkout are one stack. A process no session owns, reparented to launchd from inside a checkout, is detached and grouped by that checkout. A container belongs to the stack holding a connection to a port it publishes. Names are never read: a process is placed by its parent, its directory and its sockets.

export type Session = { name: string; pid: number; sessionId: string }

export type Container = DockerContainer & { bytes: number | null }

export type Stack = {
  bytes: number
  checkout: string
  containers: { bytes: number | null; name: string }[]
  cpuPercent: number
  pids: number[]
}

export type SessionFootprint = Session & {
  bytes: number
  claudeBytes: number
  cpuPercent: number
  stacks: Stack[]
}

export type Footprint = {
  containers: (Container & { stack: string | null })[]
  detached: Stack[]
  sessions: SessionFootprint[]
}

export type FootprintInput = {
  checkoutOf: (cwd: string) => string | null
  containers: Container[]
  // Each process's share of one core over the last interval, in percent.
  cpu: Map<number, number>
  cwds: Map<number, string>
  procs: Proc[]
  sessions: Session[]
  sockets: Sockets
}

const LAUNCHD = 1

export function footprintOf(input: FootprintInput): Footprint {
  const { checkoutOf, cpu, cwds, procs, sockets } = input
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const children = new Map<number, number[]>()
  for (const p of procs) {
    if (p.pid === p.ppid) continue
    children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid])
  }
  const sessions = input.sessions.filter((s) => byPid.has(s.pid)).sort((a, b) => a.pid - b.pid)
  const sessionPids = new Set(sessions.map((s) => s.pid))
  const claimed = new Set<number>()

  // A subtree stops at another session's claude, which is counted as its own.
  const subtree = (root: number): number[] => {
    const out: number[] = []
    const stack = [root]
    while (stack.length) {
      const pid = stack.pop() as number
      if (claimed.has(pid)) continue
      claimed.add(pid)
      out.push(pid)
      for (const child of children.get(pid) ?? []) if (!sessionPids.has(child)) stack.push(child)
    }
    return out.sort((a, b) => a - b)
  }

  const rss = (pids: number[]) =>
    pids.reduce((sum, pid) => sum + (byPid.get(pid)?.rssBytes ?? 0), 0)
  const cpuOf = (pids: number[]) => pids.reduce((sum, pid) => sum + (cpu.get(pid) ?? 0), 0)
  const checkoutAt = (pid: number): string | null => {
    const cwd = cwds.get(pid)
    return cwd ? checkoutOf(cwd) : null
  }

  // Subtrees that serve a port, merged by the checkout their first server runs in.
  const stacksOf = (roots: number[][]): Stack[] => {
    const merged = new Map<string, number[]>()
    for (const pids of roots) {
      const server = pids.find((pid) => sockets.listens.has(pid))
      if (server === undefined) continue
      const checkout = checkoutAt(server) ?? cwds.get(server) ?? "unknown"
      merged.set(checkout, [...(merged.get(checkout) ?? []), ...pids])
    }
    return [...merged].map(([checkout, pids]) => ({
      bytes: rss(pids),
      checkout,
      containers: [],
      cpuPercent: cpuOf(pids),
      pids: pids.sort((a, b) => a - b),
    }))
  }

  const footprints: SessionFootprint[] = []
  for (const session of sessions) {
    claimed.add(session.pid)
    const roots = (children.get(session.pid) ?? [])
      .filter((pid) => !sessionPids.has(pid))
      .map(subtree)
    const all = [session.pid, ...roots.flat()]
    footprints.push({
      ...session,
      bytes: rss(all),
      claudeBytes: byPid.get(session.pid)?.rssBytes ?? 0,
      cpuPercent: cpuOf(all),
      stacks: stacksOf(roots),
    })
  }

  // A detached group is keyed by its root's own checkout: pids wrap, so a child can hold a lower pid than the process that started it.
  const detached = new Map<string, number[]>()
  for (const root of procs) {
    if (root.ppid !== LAUNCHD || claimed.has(root.pid)) continue
    const checkout = checkoutAt(root.pid)
    if (checkout === null) continue
    detached.set(checkout, [...(detached.get(checkout) ?? []), ...subtree(root.pid)])
  }
  const detachedStacks: Stack[] = [...detached].map(([checkout, pids]) => ({
    bytes: rss(pids),
    checkout,
    containers: [],
    cpuPercent: cpuOf(pids),
    pids: pids.sort((a, b) => a - b),
  }))

  // Each container goes to the first stack, sessions' before detached ones, connected to a port it publishes.
  const everyStack = [...footprints.flatMap((f) => f.stacks), ...detachedStacks]
  const containers = input.containers.map((container) => {
    const owner = everyStack.find((stack) =>
      stack.pids.some((pid) =>
        container.ports.some((port) => sockets.connects.get(pid)?.has(port)),
      ),
    )
    owner?.containers.push({ bytes: container.bytes, name: container.name })
    if (owner && container.bytes) owner.bytes += container.bytes
    return { ...container, stack: owner?.checkout ?? null }
  })
  for (const footprint of footprints) {
    footprint.bytes += footprint.stacks.reduce(
      (sum, stack) => sum + stack.containers.reduce((s, c) => s + (c.bytes ?? 0), 0),
      0,
    )
  }

  return { containers, detached: detachedStacks, sessions: footprints }
}
