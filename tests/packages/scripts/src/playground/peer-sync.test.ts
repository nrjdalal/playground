import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cloneState,
  type PeerRun,
  syncPeers,
} from "../../../../../packages/scripts/src/playground/peer-sync"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const dir = mkdtempSync(join(tmpdir(), "peer-sync-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const envFile = (text: string) => {
  const path = join(dir, `${crypto.randomUUID()}.env`)
  writeFileSync(path, text)
  return path
}

const ONE = envFile(
  "PLAYGROUND_PEERS=spark-b=you@10.0.0.2\nPLAYGROUND_PEER_KEY=/home/you/.ssh/cluster\n",
)
const SSH = ["ssh", "-i", "/home/you/.ssh/cluster", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]

// A stub ssh: answers each call by the first of its remote words the script names, and records every argv.
const stubSsh = (answers: Record<string, { code?: number; out?: string }> = {}) => {
  const calls: string[][] = []
  const script: typeof answers = { status: { out: "## main...origin/main\n" }, ...answers }
  const run: PeerRun = async (argv) => {
    calls.push(argv)
    const hit = Object.entries(script).find(([word]) => argv.includes(word))
    return { code: hit?.[1].code ?? 0, out: hit?.[1].out ?? "" }
  }
  return { calls, run }
}

const sync = async (env: string, run: PeerRun, sha = SHA) => {
  const lines: string[] = []
  await syncPeers(env, sha, run, (line) => lines.push(line))
  return lines
}

describe("cloneState", () => {
  test("reads the branch, a detached HEAD as null, and any line after the branch line as a change", () => {
    expect(cloneState("## main...origin/main\n")).toEqual({ branch: "main", changed: false })
    expect(cloneState("## main\n")).toEqual({ branch: "main", changed: false })
    expect(cloneState("## HEAD (no branch)\n")).toEqual({ branch: null, changed: false })
    expect(cloneState("## canary...origin/canary [behind 2]\n")).toEqual({
      branch: "canary",
      changed: false,
    })
    expect(cloneState("## main...origin/main\n M README.md\n")).toEqual({
      branch: "main",
      changed: true,
    })
    expect(cloneState("## HEAD (no branch)\n?? notes.txt\n")).toEqual({
      branch: null,
      changed: true,
    })
  })
})

describe("syncPeers", () => {
  test("a clean clone on main reads, then fetches, checks out the sha detached and installs, each a fixed ssh argv, and prints at <sha7>", async () => {
    const { calls, run } = stubSsh()
    expect(await sync(ONE, run)).toEqual(["peer spark-b: at 0123456"])
    expect(calls).toEqual([
      [
        ...SSH,
        "you@10.0.0.2",
        "git",
        "-C",
        "~/Desktop/playground",
        "status",
        "--porcelain",
        "--branch",
      ],
      [
        ...SSH,
        "you@10.0.0.2",
        "git",
        "-C",
        "~/Desktop/playground",
        "fetch",
        "-q",
        "origin",
        "--tags",
      ],
      [
        ...SSH,
        "you@10.0.0.2",
        "git",
        "-C",
        "~/Desktop/playground",
        "checkout",
        "-q",
        "--detach",
        SHA,
      ],
      [
        ...SSH,
        "you@10.0.0.2",
        "nice",
        "-n",
        "10",
        "~/.bun/bin/bun",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--cwd",
        "~/Desktop/playground",
      ],
    ])
  })

  test("a clone a sync left on a detached HEAD moves again", async () => {
    const { calls, run } = stubSsh({ status: { out: "## HEAD (no branch)\n" } })
    expect(await sync(ONE, run)).toEqual(["peer spark-b: at 0123456"])
    expect(calls).toHaveLength(4)
  })

  test("a clone with local changes is left as it is: the read alone, never a fetch, checkout or reset", async () => {
    const { calls, run } = stubSsh({
      status: { out: "## main...origin/main\n M packages/x.ts\n?? notes.txt\n" },
    })
    expect(await sync(ONE, run)).toEqual(["peer spark-b: local changes, left as it is"])
    expect(calls).toHaveLength(1)
    expect(calls.flat()).not.toContain("reset")
  })

  test("a clone on another branch is left as it is", async () => {
    const { calls, run } = stubSsh({ status: { out: "## canary...origin/canary\n" } })
    expect(await sync(ONE, run)).toEqual(["peer spark-b: on canary, not main, left as it is"])
    expect(calls).toHaveLength(1)
  })

  test("a peer ssh cannot reach prints why, and the next peer still moves", async () => {
    const env = envFile("PLAYGROUND_PEERS=spark-b=you@10.0.0.2,spark-c=me@10.0.0.3\n")
    const run: PeerRun = async (argv) =>
      argv.includes("you@10.0.0.2")
        ? { code: 255, out: "ssh: connect to host 10.0.0.2 port 22: Connection timed out\n" }
        : { code: 0, out: argv.includes("status") ? "## main\n" : "" }
    expect(await sync(env, run)).toEqual([
      "peer spark-b: not reached: ssh: connect to host 10.0.0.2 port 22: Connection timed out",
      "peer spark-c: at 0123456",
    ])
  })

  test("a step that fails stops that peer's move and names the step", async () => {
    const { calls, run } = stubSsh({
      fetch: { code: 128, out: "fatal: unable to access 'https://github.com/'\n" },
    })
    expect(await sync(ONE, run)).toEqual([
      "peer spark-b: fetch failed: fatal: unable to access 'https://github.com/'",
    ])
    expect(calls).toHaveLength(2)
  })

  test("a frozen lockfile that does not match fails as lockfile, with no plain install after it", async () => {
    const { calls, run } = stubSsh({
      install: { code: 1, out: "error: lockfile had changes, but lockfile is frozen\n" },
    })
    expect(await sync(ONE, run)).toEqual(["peer spark-b: install failed: lockfile"])
    expect(calls.filter((argv) => argv.includes("install"))).toHaveLength(1)
  })

  test("a run that throws is that peer's line, never the caller's error", async () => {
    const run: PeerRun = async () => {
      throw new Error("spawn ssh ENOENT")
    }
    expect(await sync(ONE, run)).toEqual(["peer spark-b: failed: spawn ssh ENOENT"])
  })

  test("a sha that is not 40 hex characters moves no peer and runs nothing", async () => {
    const { calls, run } = stubSsh()
    expect(await sync(ONE, run, "HEAD; rm -rf ~")).toEqual([
      "peer sync: HEAD; rm -rf ~ is not a commit sha, so no peer moved",
    ])
    expect(calls).toEqual([])
  })

  test("no peers, or no .env, prints nothing and runs nothing", async () => {
    const { calls, run } = stubSsh()
    expect(await sync(envFile("PLAYGROUND_PEERS=\n"), run)).toEqual([])
    expect(await sync(join(dir, "missing.env"), run)).toEqual([])
    expect(calls).toEqual([])
  })

  test("a PLAYGROUND_PEERS the schema refuses prints one line and runs nothing", async () => {
    const { calls, run } = stubSsh()
    const lines = await sync(envFile("PLAYGROUND_PEERS=spark-b=-oProxyCommand=x\n"), run)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("PLAYGROUND_PEERS does not read, so no peer moved")
    expect(calls).toEqual([])
  })
})
