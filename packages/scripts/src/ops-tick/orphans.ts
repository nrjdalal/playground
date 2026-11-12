import { join } from "node:path"

import type { Context } from "./tick"

// The signal rule's one case beyond a session's own processes: a factory script's orphan, which the nightly-clean beat ends by its own pid once its parent is pid 1, its command runs a script from a worktree of this checkout, and that worktree no longer exists, so no session and no owner step is left to end it (issue 1346).

export type Proc = { age: string; command: string; pid: number; ppid: number }
export type Orphan = Proc & { worktree: string }

// Every process with its parent, its age as ps prints it and its whole command; -ww keeps a long command whole.
export const PS = ["ps", "-A", "-ww", "-o", "pid=,ppid=,etime=,command="]
export const GRACE_MS = 5000

// Pure: ps's rows, each read once.
export const procsOf = (out: string): Proc[] =>
  out.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)
    return m ? [{ age: m[3]!, command: m[4]!, pid: Number(m[1]), ppid: Number(m[2]) }] : []
  })

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// A dependency's file, never this repo's script: portless's shared proxy runs detached from a stack's node_modules with parent pid 1, and every stack routes through it.
const DEPENDENCY = /(^|\/)node_modules(\/|$)/
// A script file, since an app opened on a worktree's folder or a reader of a log there can have parent pid 1 too.
const SCRIPT = /\.(?:c?js|mjs|py|sh|tsx?)$/

// Pure but for exists: each process whose parent is pid 1 and whose command names a script file of this repo inside a worktree folder of worktrees, never one under node_modules, with every worktree its command names gone; a worktree is read by its whole folder name, so foo never stands for foo-2.
export const orphansOf = (
  procs: Proc[],
  worktrees: string,
  exists: (path: string) => boolean,
): Orphan[] => {
  const inside = new RegExp(`${escaped(worktrees)}/([^/\\s'"]+)/([^\\s'"]*)`, "g")
  return procs.flatMap((p) => {
    if (p.ppid !== 1) return []
    const paths = [...p.command.matchAll(inside)]
    const script = paths.find((m) => SCRIPT.test(m[2]!) && !DEPENDENCY.test(m[2]!))
    const named = new Set(paths.map((m) => join(worktrees, m[1]!)))
    return script && [...named].every((path) => !exists(path))
      ? [{ ...p, worktree: join(worktrees, script[1]!) }]
      : []
  })
}

// Each orphan gets TERM, then after the grace KILL when ps still lists its pid with the same command, so a pid reused since the read is never signalled twice; each one is named with how it ended or why it is kept.
export async function endOrphans(
  found: Orphan[],
  run: Context["run"],
  sleep: (ms: number) => Promise<void>,
): Promise<{ ended: string[]; kept: string[] }> {
  const out = { ended: [] as string[], kept: [] as string[] }
  if (!found.length) return out
  for (const o of found) await run(["kill", "-TERM", String(o.pid)])
  await sleep(GRACE_MS)
  const still = procsOf((await run(PS)).out)
  for (const o of found) {
    const about = `(age ${o.age}, its worktree ${o.worktree} gone): ${o.command}`
    if (!still.some((p) => p.pid === o.pid && p.command === o.command)) {
      out.ended.push(`orphan pid ${o.pid} ended by TERM ${about}`)
      continue
    }
    const kill = await run(["kill", "-KILL", String(o.pid)])
    if (kill.code === 0) out.ended.push(`orphan pid ${o.pid} ended by KILL ${about}`)
    else out.kept.push(`orphan pid ${o.pid} kept: its KILL failed: ${kill.out.trim()} ${about}`)
  }
  return out
}
