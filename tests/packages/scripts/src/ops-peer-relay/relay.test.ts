import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appendOnce, linesFrom } from "../../../../../packages/scripts/src/ops-peer-relay/queue"
import {
  clusterOf,
  envKeysOf,
  type Far,
  keep,
  LACKS,
  link,
  sshArgs,
} from "../../../../../packages/scripts/src/ops-peer-relay/relay"
import { PEER_QUEUE, type PeerLine } from "../../../../../packages/scripts/src/playground/send"

// Every case runs agent.ts as a child over pipes, standing in for ssh, and waits on lines crossing.
setDefaultTimeout(30_000)

const AGENT = join(import.meta.dir, "../../../../../packages/scripts/src/ops-peer-relay/agent.ts")
const scratch = mkdtempSync(join(tmpdir(), "peer-relay-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
const PEER = { name: "spark-b", target: "me@spark-b" }

// Two machines' data folders, each with its own outbox.
const machines = (name: string) => {
  const here = join(scratch, name, "here")
  const there = join(scratch, name, "there")
  for (const data of [here, there]) mkdirSync(join(data, "ops", "outbox"), { recursive: true })
  return { here, there }
}
const queueOf = (data: string) => join(data, "ops", "outbox", PEER_QUEUE)
const rows = (data: string): PeerLine[] =>
  existsSync(queueOf(data))
    ? readFileSync(queueOf(data), "utf8")
        .split("\n")
        .filter((row) => row.startsWith('{"at"'))
        .map((row) => JSON.parse(row))
    : []
const line = (text: string, at = "2026-11-16T20:00:00Z", to = "probe-b"): PeerLine => ({
  at,
  from: "probe-a",
  id: crypto.randomUUID(),
  text,
  to,
})
const write = (data: string, row: object) =>
  appendFileSync(queueOf(data), `${JSON.stringify(row)}\n`)

// The far end: agent.ts on the other machine's data folder, started from the offset the relay names, ended by its own handle.
const agentFar = (there: string, from: number | "end" = "end"): Far => {
  const child = Bun.spawn(["bun", "--no-env-file", AGENT, String(from)], {
    env: { ...process.env, PLAYGROUND_DATA_DIR: there },
    stderr: "pipe",
    stdin: "pipe",
    stdout: "pipe",
  })
  return {
    exited: child.exited,
    kill: () => child.kill(),
    stderr: new Response(child.stderr).text(),
    stdin: child.stdin,
    stdout: child.stdout,
  }
}
const shFar = (script: string): Far => {
  const child = Bun.spawn(["bash", "-c", script], { stderr: "pipe", stdin: "pipe", stdout: "pipe" })
  return {
    exited: child.exited,
    kill: () => child.kill(),
    stderr: new Response(child.stderr).text(),
    stdin: child.stdin,
    stdout: child.stdout,
  }
}

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await Bun.sleep(20)
  }
}

const beatOf = (data: string) =>
  JSON.parse(readFileSync(join(data, "ops", "ops-peer-relay.json"), "utf8"))

const cursorOf = (data: string) =>
  JSON.parse(readFileSync(join(data, "ops", "peer-relay", `${PEER.name}.json`), "utf8"))

// One link between the two folders, held until stop is called; told holds what it told Ops.
const hold = (here: string, far: Far, replyMs = 5_000) => {
  const told: string[] = []
  const stop = new AbortController()
  let up = false
  const done = link({
    data: here,
    far,
    notify: async (text) => told.push(text),
    peer: PEER,
    pollMs: 20,
    replyMs,
    signal: stop.signal,
    up: () => (up = true),
  })
  return { done, isUp: () => up, stop: () => stop.abort(), told }
}

describe("the ops-peer queue (PG-2444)", () => {
  test("reads whole lines past an offset with each end, waits on a cut-off last line, and passes over a bad one", async () => {
    const { here } = machines("read")
    const one = line("one")
    write(here, one)
    appendFileSync(queueOf(here), "not json\n")
    writeFileSync(queueOf(here), `${readFileSync(queueOf(here), "utf8")}{"at":"cut`)
    const read = await linesFrom(queueOf(here), 0)
    expect(read.reads.map((r) => r.line)).toEqual([one])
    expect(read.skipped).toBe(1)
    expect(read.end).toBe(Buffer.byteLength(`${JSON.stringify(one)}\nnot json\n`))
  })

  test("appends a line once by its id, stamping relayedAt and keeping the sender's at", async () => {
    const { here } = machines("once")
    const one = line("one", "2026-11-16T19:50:00Z")
    expect(await appendOnce(queueOf(here), one, new Date("2026-11-16T20:00:00Z"))).toBe(true)
    expect(await appendOnce(queueOf(here), one)).toBe(false)
    expect(rows(here)).toEqual([{ ...one, relayedAt: "2026-11-16T20:00:00Z" }])
  })
})

describe("the relay's config and ssh (PG-2444)", () => {
  test("reads PLAYGROUND_PEERS and PLAYGROUND_PEER_KEY alone from the .env, through the org's cluster", () => {
    const keys = envKeysOf(
      'POSTGRES_URL=postgres://x\nPLAYGROUND_PEERS="spark-b=me@10.0.0.2"\nexport PLAYGROUND_PEER_KEY=/k/key\n',
    )
    expect(keys).toEqual({ PLAYGROUND_PEER_KEY: "/k/key", PLAYGROUND_PEERS: "spark-b=me@10.0.0.2" })
    expect(clusterOf(keys, "/h")).toEqual({
      key: "/k/key",
      peers: [{ name: "spark-b", target: "me@10.0.0.2" }],
    })
    expect(clusterOf({}, "/h")).toEqual({ key: "/h/.ssh/playground_spark", peers: [] })
    expect("why" in clusterOf({ PLAYGROUND_PEERS: "b=me@x;rm" }, "/h")).toBe(true)
  })

  test("ssh runs agent.ts from the far checkout with the key alone and no prompt", () => {
    expect(sshArgs("/k/key", "me@spark-b", "/home/me/play ground", 42)).toEqual([
      "-F",
      "none",
      "-i",
      "/k/key",
      ...[
        "BatchMode=yes",
        "ConnectTimeout=10",
        "IdentitiesOnly=yes",
        "ServerAliveCountMax=3",
        "ServerAliveInterval=15",
      ].flatMap((o) => ["-o", o]),
      "me@spark-b",
      `cd '/home/me/play ground' && PATH="$HOME/.bun/bin:$PATH" exec bun --no-env-file packages/scripts/src/ops-peer-relay/agent.ts 42`,
    ])
  })
})

describe("ops-peer-relay copies lines both ways (PG-2444)", () => {
  test("each machine's new lines reach the other once, a copied line never goes back, and a line there keeps its at", async () => {
    const { here, there } = machines("both")
    const link1 = hold(here, agentFar(there))
    await until(link1.isUp)
    const out = line("to there", "2026-11-16T20:00:01Z", "probe-b")
    const back = line("to here", "2026-11-16T20:00:02Z", "probe-a")
    write(here, out)
    write(there, back)
    await until(() => rows(there).length === 2 && rows(here).length === 2)
    await Bun.sleep(200)
    link1.stop()
    expect(await link1.done).toBe("")
    expect(rows(there)).toEqual([back, { ...out, relayedAt: expect.any(String) }])
    expect(rows(here)).toEqual([out, { ...back, relayedAt: expect.any(String) }])
    expect(link1.told).toEqual([])
  })

  test("a line written while the link is down arrives once after it, through the cursor on each side", async () => {
    const { here, there } = machines("drop")
    const first = hold(here, agentFar(there))
    await until(first.isUp)
    const before = line("before the drop")
    write(here, before)
    const sent = Buffer.byteLength(`${JSON.stringify(before)}\n`)
    await until(() => rows(there).length === 1 && cursorOf(here).local === sent)
    first.stop()
    await first.done
    const { local, remote } = cursorOf(here)
    expect(local).toBe(sent)

    const whileDownHere = line("while down, from here")
    const whileDownThere = line("while down, from there", "2026-11-16T19:50:00Z", "probe-a")
    write(here, whileDownHere)
    write(there, whileDownThere)

    const second = hold(here, agentFar(there, remote))
    await until(() => rows(there).length === 3 && rows(here).length === 3)
    await Bun.sleep(200)
    second.stop()
    await second.done
    expect(rows(there).map((r) => r.text)).toEqual([
      "before the drop",
      "while down, from there",
      "while down, from here",
    ])
    expect(rows(here).map((r) => r.text)).toEqual([
      "before the drop",
      "while down, from here",
      "while down, from there",
    ])
    expect(rows(here)[2]!.at).toBe("2026-11-16T19:50:00Z")
  })

  test("a far end killed by its own handle ends the link with why", async () => {
    const { here, there } = machines("kill")
    let far: Far | undefined
    const held = hold(here, (far = agentFar(there)))
    await until(held.isUp)
    far!.kill()
    expect(await held.done).toMatch(/^ssh to me@spark-b ended with code|^ssh said:/)
  })

  test("a malformed or oversized line on either side is passed over, told to Ops once, and the good ones still cross", async () => {
    const { here, there } = machines("bad")
    await Bun.write(queueOf(there), "")
    const held = hold(here, agentFar(there))
    await until(held.isUp)
    appendFileSync(
      queueOf(there),
      `${JSON.stringify({ ...line("big"), text: "x".repeat(17 * 1024) })}\n`,
    )
    appendFileSync(queueOf(here), "{not a line\n")
    const good = line("good")
    write(there, good)
    await until(() => rows(here).length === 1 && held.told.length === 2)
    held.stop()
    await held.done
    expect(rows(here).map((r) => r.text)).toEqual(["good"])
    expect(held.told.sort()).toEqual([
      `passed over 1 line in spark-b's ${PEER_QUEUE}: not a peer line, or over 16 KB`,
      `passed over 1 line in this machine's ${PEER_QUEUE}: not a peer line, or over 16 KB`,
    ])
  })

  test.each([
    [
      "no agent.ts there",
      "echo 'error: Module not found \"packages/scripts/src/ops-peer-relay/agent.ts\"' >&2; exit 1",
    ],
    ["the checkout missing", "echo 'bash: line 1: cd: /x: No such file or directory' >&2; exit 1"],
    ["an older hello", `echo '{"hello":"ops-peer-relay","version":0}'; sleep 5`],
  ])("a far end with %s reads as the version it lacks", async (_, script) => {
    const { here } = machines(`lacks-${_.replaceAll(" ", "-")}`)
    const held = hold(here, shFar(script))
    expect(await held.done).toBe(LACKS)
    expect(held.isUp()).toBe(false)
  })

  test("a refused key reads in ssh's words", async () => {
    const { here } = machines("refused")
    const held = hold(
      here,
      shFar("echo 'me@spark-b: Permission denied (publickey).' >&2; exit 255"),
    )
    expect(await held.done).toContain("refused the key")
  })

  test("a far end that says nothing reads as its silence, not as a missing agent.ts", async () => {
    const { here } = machines("silent")
    const held = hold(here, shFar("sleep 5"), 300)
    expect(await held.done).toBe("me@spark-b said no hello within 0.3s")
  })

  test("a far end that ends with no output reads as its exit code, not as a missing agent.ts", async () => {
    const { here } = machines("ended")
    const held = hold(here, shFar("exit 3"))
    expect(await held.done).toBe("me@spark-b ended with code 3 before its hello")
  })

  // The far end reads the line and drops it unwritten, so it never acks: the local cursor stays before the line, and the next link sends it again.
  const HI = `echo '{"hello":"ops-peer-relay","version":1}'; echo '{"end":0}'`
  test.each([
    ["never answers", `${HI}; read line; sleep 5`, "wrote no answer for a line within 0.3s"],
    ["ends before it answers", `${HI}; read line; exit 0`, "ssh to me@spark-b ended with code 0"],
  ])(
    "a far end that %s keeps the local cursor before the line, and the next link sends it",
    async (_, script, why) => {
      const { here, there } = machines(`unacked-${_.replaceAll(" ", "-")}`)
      writeFileSync(queueOf(here), "")
      const first = hold(here, shFar(script), 300)
      await until(first.isUp)
      const kept = line("not yet written there")
      write(here, kept)
      expect(await first.done).toContain(why)
      expect(cursorOf(here).local).toBe(0)
      const sent = Buffer.byteLength(`${JSON.stringify(kept)}\n`)
      const second = hold(here, agentFar(there))
      await until(() => rows(there).length === 1 && cursorOf(here).local === sent)
      second.stop()
      await second.done
      expect(rows(there)).toEqual([{ ...kept, relayedAt: expect.any(String) }])
      expect(cursorOf(here).local).toBe(sent)
    },
  )
})

describe("the relay job's loop (PG-2444)", () => {
  test("tells Ops once per down spell, once when it is up again, and retries", async () => {
    const { here, there } = machines("keep")
    const key = join(scratch, "keep", "key")
    writeFileSync(key, "fake\n")
    const told: string[] = []
    const fars: Far[] = []
    const stop = new AbortController()
    const running = keep({
      checkout: "/c",
      data: here,
      envText: async () => `PLAYGROUND_PEERS=spark-b=me@spark-b\nPLAYGROUND_PEER_KEY=${key}\n`,
      home: "/h",
      maxWaitMs: 200,
      minWaitMs: 20,
      notify: async (text) => told.push(text),
      open: (_key, _peer, from) => {
        const far = fars.length === 1 ? shFar("exit 255") : agentFar(there, from)
        fars.push(far)
        return far
      },
      pollMs: 20,
      replyMs: 5_000,
      signal: stop.signal,
      wait: (ms) => Bun.sleep(ms),
    })
    await until(() => existsSync(join(here, "ops", "peer-relay", `${PEER.name}.json`)))
    write(here, line("first"))
    await until(() => rows(there).length === 1)
    fars[0]!.kill()
    await until(() => fars.length === 3)
    write(here, line("after the drop"))
    await until(() => rows(there).length === 2)
    await until(() => told.length === 2)
    stop.abort()
    await running
    expect(told[0]).toStartWith("spark-b: down: ")
    expect(told[0]).toEndWith("; it retries")
    expect(told[1]).toBe(`spark-b: up again: copying ${PEER_QUEUE} both ways`)
    expect(rows(there).map((r) => r.text)).toEqual(["first", "after the drop"])
    expect(beatOf(here).lastResult).toBe("ok")
  })

  test("beats ok while every peer is up, and each peer's state once one is down (PG-2546)", async () => {
    const { here, there } = machines("beat")
    const key = join(scratch, "beat", "key")
    writeFileSync(key, "fake\n")
    const stop = new AbortController()
    const running = keep({
      checkout: "/c",
      data: here,
      envText: async () =>
        `PLAYGROUND_PEERS=spark-b=me@spark-b,spark-c=me@spark-c\nPLAYGROUND_PEER_KEY=${key}\n`,
      home: "/h",
      maxWaitMs: 200,
      minWaitMs: 20,
      notify: async () => {},
      open: (_key, peer, from) =>
        peer.name === "spark-b" ? agentFar(there, from) : shFar("exit 255"),
      pollMs: 20,
      replyMs: 5_000,
      signal: stop.signal,
      wait: (ms) => Bun.sleep(ms),
    })
    const said = () =>
      existsSync(join(here, "ops", "ops-peer-relay.json")) ? String(beatOf(here).lastResult) : ""
    await until(() => said().includes("spark-b: up: ") && said().includes("spark-c: down: "))
    stop.abort()
    await running
    expect(said()).not.toBe("ok")
  })

  // The relay has no peer set, so it cannot link one; it beats idle: bare each cycle, and the sweep reads that bare idle: as healthy, not as ops-peer-relay: idle: ...
  test("beats idle: bare each cycle when it has no peer, as the sweep reads it healthy (PG-2637)", async () => {
    const { here, there } = machines("idle")
    const key = join(scratch, "idle", "key")
    writeFileSync(key, "fake\n")
    const stop = new AbortController()
    const running = keep({
      checkout: "/c",
      data: here,
      envText: async () => `PLAYGROUND_PEER_KEY=${key}\n`,
      home: "/h",
      maxWaitMs: 200,
      minWaitMs: 20,
      notify: async () => {},
      open: () => agentFar(there),
      pollMs: 20,
      replyMs: 5_000,
      signal: stop.signal,
      wait: (ms) => Bun.sleep(ms),
    })
    const said = () =>
      existsSync(join(here, "ops", "ops-peer-relay.json")) ? String(beatOf(here).lastResult) : ""
    await until(() => said().startsWith("idle: "))
    stop.abort()
    await running
    expect(said()).toBe("idle: PLAYGROUND_PEERS names no peer")
  })
})
