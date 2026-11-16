// playground update's last step: each peer's Playground clone moves to the commit this checkout reached, so a job that runs from a peer's clone (the relay) runs the same code.
import { isAbsolute, relative } from "node:path"

import { orgOf } from "@packages/config/org"
import { parse } from "dotenv"

// One ssh call to its end within its timeout, its stdout and stderr together as its output.
export type PeerRun = (argv: string[], timeoutMs: number) => Promise<{ code: number; out: string }>

export const spawnPeerRun: PeerRun = async (argv, timeout) => {
  const proc = Bun.spawn(argv, { stderr: "pipe", stdin: "ignore", stdout: "pipe", timeout })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out: `${out}${err}` }
}

const SHA = /^[0-9a-f]{40}$/
// a path a remote shell reads as itself: no space, quote, $, ; or glob
const PLAIN_PATH = /^[A-Za-z0-9._/-]+$/
const READ_MS = 30_000
const STEP_MS = 15 * 60_000

// Pure: where a peer's clone sits, the same place under its home as this checkout under this one's, as a ~ path; null when this checkout is outside home or its path holds a character a remote shell would read.
export const cloneOf = (repo: string, home: string): string | null => {
  const rel = relative(home, repo)
  return rel && !isAbsolute(rel) && PLAIN_PATH.test(rel) && !rel.split("/").includes("..")
    ? `~/${rel}`
    : null
}

// ssh's argv to one peer as the System panel's peer read builds it (api/hono/src/lib/system/probe.ts): no prompt, a short connect, and remote words fixed here but the clone's path and the sha, each checked before it gets here
const ssh = (key: string | undefined, target: string, words: string[]) => [
  "ssh",
  ...(key ? ["-i", key] : []),
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=5",
  target,
  ...words,
]

const read = (clone: string) => ["git", "-C", clone, "status", "--porcelain", "--branch"]
// a worktree cut from the clone (a replay run) reads its hooks through the clone's git dir, so a move under it changes what its later runs see
const worktrees = (clone: string) => ["git", "-C", clone, "worktree", "list", "--porcelain"]

// The move, a step at a time, so a failure names its step; each touches the clone alone, bun's own cache aside, which the clone's first install made.
const steps = (clone: string, sha: string): [string, string[]][] => [
  ["fetch", ["git", "-C", clone, "fetch", "-q", "origin", "--tags"]],
  ["checkout", ["git", "-C", clone, "checkout", "-q", "--detach", sha]],
  // no run slot: no factory run shares a peer yet, so nice lets the peer's own work go first; a worker placed on a peer brings run-slot, and this install takes a slot then
  [
    "install",
    [
      "nice",
      "-n",
      "10",
      "~/.bun/bin/bun",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--cwd",
      clone,
    ],
  ],
]

const firstLine = (out: string, code: number) =>
  out
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? `exit ${code}`

// Pure: what status --porcelain --branch says of the clone: its branch, null on a detached HEAD, and whether it holds changes of its own.
export const cloneState = (out: string) => {
  const [head = "", ...rest] = out.split("\n")
  const name = head.replace(/^## /, "").split(/\.\.\.| /)[0] ?? ""
  return {
    branch: name === "HEAD" || name === "" ? null : name,
    changed: rest.some((line) => line.trim() !== ""),
  }
}

// One peer to the sha, as one line: at <sha7>, left as it is and why, or the step that failed.
const syncPeer = async (
  run: PeerRun,
  key: string | undefined,
  target: string,
  clone: string,
  sha: string,
): Promise<string> => {
  const state = await run(ssh(key, target, read(clone)), READ_MS)
  if (state.code !== 0) return `not reached: ${firstLine(state.out, state.code)}`
  const { branch, changed } = cloneState(state.out)
  if (changed) return "local changes, left as it is"
  if (branch !== null && branch !== "main") return `on ${branch}, not main, left as it is`
  const listed = await run(ssh(key, target, worktrees(clone)), READ_MS)
  if (listed.code !== 0) return `worktree list failed: ${firstLine(listed.out, listed.code)}`
  const others = listed.out.split("\n").filter((line) => line.startsWith("worktree ")).length - 1
  if (others > 0)
    return `${others} ${others === 1 ? "worktree uses" : "worktrees use"} the clone, left as it is`
  for (const [name, words] of steps(clone, sha)) {
    const done = await run(ssh(key, target, words), STEP_MS)
    if (done.code === 0) continue
    // a frozen lockfile that does not match fails as itself, never as a plain install
    const why =
      name === "install" && /lockfile/i.test(done.out) ? "lockfile" : firstLine(done.out, done.code)
    return `${name} failed: ${why}`
  }
  return `at ${sha.slice(0, 7)}`
}

// Every peer the .env at envPath names, all at once, each clone at `clone` (cloneOf), one line each in their order; it never throws, so the update's own result stands.
export const syncPeers = async (
  envPath: string,
  sha: string,
  clone: string | null,
  run: PeerRun = spawnPeerRun,
  log: (line: string) => void = console.log,
): Promise<void> => {
  const file = Bun.file(envPath)
  let cluster
  try {
    cluster = orgOf((await file.exists()) ? parse(await file.text()) : {}).cluster
  } catch (error) {
    log(
      `peer sync: ${envPath}'s PLAYGROUND_PEERS does not read, so no peer moved: ${(error as Error).message}`,
    )
    return
  }
  if (!cluster.peers.length) return
  if (!SHA.test(sha)) {
    log(`peer sync: ${sha} is not a commit sha, so no peer moved`)
    return
  }
  if (clone === null) {
    log(
      "peer sync: this checkout's path is not a plain path under the home folder, so no peer moved",
    )
    return
  }
  const lines = await Promise.all(
    cluster.peers.map(({ target }) =>
      syncPeer(run, cluster.key, target, clone, sha).catch(
        (error: Error) => `failed: ${error.message}`,
      ),
    ),
  )
  cluster.peers.forEach(({ name }, i) => log(`peer ${name}: ${lines[i]}`))
}
