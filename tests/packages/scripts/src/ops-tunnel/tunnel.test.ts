import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  keep,
  linkOf,
  sshArgs,
  type Tunnel,
  tunnelOf,
  whyOf,
} from "../../../../../packages/scripts/src/ops-tunnel/tunnel"

const scratch = mkdtempSync(join(tmpdir(), "ops-tunnel-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const TUNNEL: Tunnel = { host: "spark-a", key: "/h/.ssh/playground_spark", port: 1355, user: "me" }

// A folder holding a fake ssh first on PATH: it writes its argv to log, then runs body; no real ssh starts and no host is reached.
const fakeSsh = (name: string, body: string) => {
  const bin = join(scratch, name, "bin")
  mkdirSync(bin, { recursive: true })
  const log = join(scratch, name, "ssh.log")
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\necho "$@" >> "${log}"\n${body}\n`)
  chmodSync(join(bin, "ssh"), 0o755)
  return { env: { PATH: `${bin}:/usr/bin:/bin` }, log }
}

// A data folder whose jobs.json holds the tunnel job's row with config, and a key file by path, whose text no code reads.
const dataWith = (name: string, config: Record<string, unknown>) => {
  const data = join(scratch, name, "data")
  mkdirSync(join(data, "ops"), { recursive: true })
  const key = join(scratch, name, "key")
  writeFileSync(key, "not a key\n")
  writeFileSync(
    join(data, "ops", "jobs.json"),
    JSON.stringify({ jobs: [{ config: { key, ...config }, name: "ops-tunnel" }] }),
  )
  return data
}

const beatOf = (data: string) =>
  JSON.parse(readFileSync(join(data, "ops", "ops-tunnel.json"), "utf8")) as { lastResult: string }

const until = async (done: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) await Bun.sleep(20)
  expect(done()).toBe(true)
}

describe("the tunnel's ssh (PG-2207)", () => {
  test("forwards the port from the Mac's loopback alone to the Spark's loopback alone, with the key by path", () => {
    const args = sshArgs(TUNNEL)
    expect(args).toContain("-N")
    expect(args.join(" ")).toContain("-L 127.0.0.1:1355:127.0.0.1:1355")
    expect(args.join(" ")).toContain("-i /h/.ssh/playground_spark")
    expect(args).toContain("BatchMode=yes")
    expect(args).toContain("ExitOnForwardFailure=yes")
    expect(args).not.toContain("-g")
    expect(args.join(" ")).not.toMatch(/GatewayPorts|0\.0\.0\.0|\*:/)
    expect(args.at(-1)).toBe("me@spark-a")
  })

  test("the link is the Spark's own web origin on the same port, so its trusted origins already hold it", () => {
    expect(linkOf(1355)).toBe("https://playground.localhost:1355/dashboard")
  })

  test("its row's config names the host; the key, port and user fall back to the factory's key, 1355 and this Mac's user", () => {
    expect(tunnelOf({ host: "spark-a" }, "/h", "me")).toEqual(TUNNEL)
    expect(tunnelOf(undefined, "/h", "me").host).toBe("")
    expect(tunnelOf({ key: "~/.ssh/k", port: 2000, user: "u" }, "/h", "me")).toEqual({
      host: "",
      key: "/h/.ssh/k",
      port: 2000,
      user: "u",
    })
  })
})

describe("why a tunnel cannot connect (PG-2207)", () => {
  test.each([
    ["me@spark-a: Permission denied (publickey).", "refused the key /h/.ssh/playground_spark"],
    [
      "ssh: Could not resolve hostname spark-a: nodename nor servname provided",
      "spark-a does not resolve",
    ],
    ["ssh: connect to host spark-a port 22: Connection refused", "nothing answers ssh on spark-a"],
    ["ssh: connect to host spark-a port 22: Operation timed out", "spark-a is not reachable"],
    ["ssh: connect to host spark-a port 22: No route to host", "spark-a is not reachable"],
    ["Host key verification failed.", "host key"],
    ["bind [127.0.0.1]:1355: Address already in use", "port 1355 on this Mac is taken"],
    [
      "Warning: Identity file /h/.ssh/playground_spark not accessible: No such file or directory.",
      "the key /h/.ssh/playground_spark is missing",
    ],
  ])("%s names it", (stderr, why) => {
    expect(whyOf(`${stderr}\n`, TUNNEL, 255)).toContain(why)
  })

  test("a line it does not know is given as ssh said it, and no line gives the exit", () => {
    expect(
      whyOf("kex_exchange_identification: read: Connection reset by peer\n", TUNNEL, 255),
    ).toBe("ssh said: kex_exchange_identification: read: Connection reset by peer")
    expect(whyOf("", TUNNEL, 255)).toBe("ssh ended with code 255")
  })
})

describe("the tunnel job's loop (PG-2207)", () => {
  test("starts ssh again after it drops, and its heartbeat names why, never as an exit up.py restarts", async () => {
    const ssh = fakeSsh(
      "drop",
      'echo "ssh: connect to host spark-a port 22: Connection refused" >&2\nexit 255',
    )
    const data = dataWith("drop", { host: "spark-a", port: 1355 })
    const stop = new AbortController()
    const kept = keep({
      data,
      env: ssh.env,
      listens: async () => false,
      maxWaitMs: 20,
      minWaitMs: 10,
      signal: stop.signal,
    })
    await until(
      () => existsSync(ssh.log) && readFileSync(ssh.log, "utf8").trim().split("\n").length >= 3,
    )
    stop.abort()
    await kept
    for (const line of readFileSync(ssh.log, "utf8").trim().split("\n"))
      expect(line).toContain("-L 127.0.0.1:1355:127.0.0.1:1355")
    const { lastResult } = beatOf(data)
    expect(lastResult).toStartWith("down: nothing answers ssh on spark-a")
    expect(lastResult).not.toContain("exited")
  })

  test("with no host set it starts no ssh and says where the host goes", async () => {
    const ssh = fakeSsh("nohost", "exit 0")
    const data = dataWith("nohost", { host: "" })
    const stop = new AbortController()
    const kept = keep({ data, env: ssh.env, minWaitMs: 10, signal: stop.signal })
    await until(() => existsSync(join(data, "ops", "ops-tunnel.json")))
    stop.abort()
    await kept
    expect(existsSync(ssh.log)).toBe(false)
    expect(beatOf(data).lastResult).toContain("no host set")
    expect(beatOf(data).lastResult).toContain("jobs.opsTunnel")
  })

  test("a key that is not there starts no ssh and names the key by its path", async () => {
    const ssh = fakeSsh("nokey", "exit 0")
    const data = dataWith("nokey", { host: "spark-a", key: join(scratch, "nokey", "absent") })
    const stop = new AbortController()
    const kept = keep({ data, env: ssh.env, minWaitMs: 10, signal: stop.signal })
    await until(() => existsSync(join(data, "ops", "ops-tunnel.json")))
    stop.abort()
    await kept
    expect(existsSync(ssh.log)).toBe(false)
    expect(beatOf(data).lastResult).toBe(
      `down: the key ${join(scratch, "nokey", "absent")} is missing`,
    )
  })

  test("once up it beats the link and posts it to the Inbox once, and a stop ends its ssh", async () => {
    const ssh = fakeSsh("up", "exec sleep 30")
    const data = dataWith("up", { host: "spark-a", port: 1355 })
    const posts: string[] = []
    const run = async () => {
      const stop = new AbortController()
      const kept = keep({
        data,
        env: ssh.env,
        listens: async () => true,
        minWaitMs: 10,
        post: async (link) => (posts.push(link), "item-1"),
        signal: stop.signal,
      })
      await until(
        () =>
          existsSync(join(data, "ops", "ops-tunnel.json")) &&
          beatOf(data).lastResult.startsWith("up"),
      )
      stop.abort()
      await kept
    }
    await run()
    await run()
    expect(posts).toEqual(["https://playground.localhost:1355/dashboard"])
    expect(beatOf(data).lastResult).toBe(
      "up: https://playground.localhost:1355/dashboard through spark-a",
    )
  })
})
