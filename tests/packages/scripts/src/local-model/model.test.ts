import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  busyOf,
  commandArgv,
  type Figures,
  keepUp,
  type Machine,
  memOf,
  type ModelConfig,
  type ModelDeps,
  sizeOf,
  useModel,
} from "../../../../../packages/scripts/src/local-model/model"
import {
  machineState,
  modelHold,
  modelServers,
  readModelState,
  statePath,
  writeMachineState,
} from "../../../../../packages/scripts/src/local-model/state"
import { BEATS } from "../../../../../packages/scripts/src/ops-tick/tick"
import { JOBS } from "../../../../../packages/settings/src/jobs"

const KiB = 1024 * 1024
// the settings' measured figures for K and M
const K: Figures = { cap: 0.7, kvKiBPerToken: 12.77, overheadGiB: 6.65, weightsGiB: 21.86 }
const M: Figures = { cap: 0.75, kvKiBPerToken: 18.45, overheadGiB: 2.38, weightsGiB: 72.38 }
const meminfo = (availableGiB: number, totalGiB = 121) =>
  `MemTotal:       ${Math.round(totalGiB * KiB)} kB\nMemFree:        1000 kB\nMemAvailable:   ${Math.round(availableGiB * KiB)} kB\n`
const metrics = (running: number, waiting = 0) =>
  `# HELP vllm:num_requests_running Number of requests running.\nvllm:num_requests_running{engine="0",model_name="local"} ${running}.0\nvllm:num_requests_waiting{engine="0",model_name="local"} ${waiting}.0\n`
const SIZED = "${CONTAINER:-\n${PORT:-\n${GPU_MEMORY_UTILIZATION:-\n${MAX_NUM_SEQS:-\n"

type Box = {
  busy: Record<number, number[]>
  containers: Set<string>
  health: string[]
  memory: number[]
  serves: Record<string, string>
}

const PEER: Machine = { name: "spark-test", target: "me@spark-test" }
const HERE: Machine = { name: "spark-here" }
// the peer's reserve: the 15 GiB floor and two box runs of 2.25 GiB
const PEER_CONFIG: ModelConfig = {
  container: "local-vllm",
  drainMinutes: 30,
  idleMinutes: 30,
  keep: "k-model",
  minFreeGiB: 15,
  models: { "k-model": K, "m-model": M },
  reserveGiB: 19.5,
  sessionTokens: 65536,
}

// A stub machine: each argv's command answered from the box, every step named in order; nothing reaches a machine or Docker.
const stub = (box: Box, data: string, overrides: Partial<ModelDeps> = {}) => {
  const steps: string[] = []
  const calls: string[][] = []
  const holds: (string | null)[] = []
  let clock = Date.parse("2026-11-17T06:00:00.000Z")
  const next = <T>(list: T[] | undefined, last: T): T =>
    list && list.length > 1 ? list.shift()! : (list?.[0] ?? last)
  const deps: ModelDeps = {
    config: PEER_CONFIG,
    data,
    key: "/home/me/.ssh/playground_spark",
    machine: PEER,
    now: () => new Date(clock),
    record: async () => {},
    run: async (argv) => {
      calls.push(argv)
      expect(argv.slice(0, -1)).toEqual(commandArgv(deps.machine, deps.key, "").slice(0, -1))
      const command = argv.at(-1)!
      let found: RegExpExecArray | null
      if (
        (found = /^test -f ~\/models\/([a-z0-9.-]+)\/serve\.sh && echo found && grep /.exec(
          command,
        ))
      ) {
        steps.push(`serves ${found[1]}`)
        const text = box.serves[found[1]!]
        return text === undefined ? { code: 1, out: "" } : { code: 0, out: `found\n${text}` }
      }
      if (
        (found =
          /^CONTAINER=(\S+) PORT=(\d+) GPU_MEMORY_UTILIZATION=([0-9.]+) MAX_NUM_SEQS=(\d+) ~\/models\/([a-z0-9.-]+)\/serve\.sh$/.exec(
            command,
          ))
      ) {
        steps.push(`serve ${found[5]} as ${found[1]} on ${found[2]} at ${found[3]} for ${found[4]}`)
        box.containers.add(found[1]!)
        return { code: 0, out: "0123abcd\n" }
      }
      if ((found = /^docker inspect --format '\{\{\.State\.Running\}\}' (\S+)$/.exec(command))) {
        steps.push(`inspect ${found[1]}`)
        return box.containers.has(found[1]!)
          ? { code: 0, out: "true\n" }
          : { code: 1, out: "Error: No such object" }
      }
      if ((found = /^docker rm -fv (\S+)$/.exec(command))) {
        steps.push(`stop ${found[1]}`)
        return box.containers.delete(found[1]!)
          ? { code: 0, out: `${found[1]}\n` }
          : { code: 1, out: "Error: No such container" }
      }
      if (command === "cat /proc/meminfo") {
        steps.push("memory")
        return { code: 0, out: meminfo(next(box.memory, 100)) }
      }
      if ((found = /^curl -sf --max-time 5 http:\/\/127\.0\.0\.1:(\d+)\/metrics$/.exec(command))) {
        steps.push(`metrics ${found[1]}`)
        return { code: 0, out: metrics(next(box.busy[Number(found[1])], 0)) }
      }
      if (
        (found =
          /^curl -s --max-time 5 -o \/dev\/null -w '%\{http_code\}' http:\/\/127\.0\.0\.1:(\d+)\/health$/.exec(
            command,
          ))
      ) {
        steps.push(`health ${found[1]}`)
        return { code: 0, out: next(box.health, "200") }
      }
      throw new Error(`unexpected command: ${command}`)
    },
    say: () => {},
    sleep: async (ms) => {
      holds.push((await modelHold(data, deps.machine.name))?.for ?? null)
      clock += ms
    },
    ...overrides,
  }
  return { advance: (ms: number) => (clock += ms), calls, deps, holds, steps }
}

const scratch = () => mkdtempSync(join(tmpdir(), "local-model-"))
const box = (part: Partial<Box> = {}): Box => ({
  busy: {},
  containers: new Set(),
  health: ["200"],
  memory: [117.1],
  serves: { "k-model": SIZED, "m-model": SIZED },
  ...part,
})
const kServer = {
  busyAt: "2026-11-17T05:00:00.000Z",
  container: "local-vllm-k-model",
  maxSessions: 70,
  port: 8000,
  share: 0.7,
  startedAt: "2026-11-17T05:00:00.000Z",
}

describe("sizing a server from a memory reading (PG-2543)", () => {
  test("K and M on the idle peer take their working shares, and the sessions their KV cache leaves at 64k tokens", () => {
    // measured: 117.1 GiB free of 121 on the idle peer
    const idle = { available: 117.1, total: 121 }
    expect(sizeOf(idle, K, PEER_CONFIG)).toMatchObject({ maxSessions: 70, share: 0.7 })
    expect(sizeOf(idle, M, PEER_CONFIG)).toMatchObject({ maxSessions: 13, share: 0.75 })
  })

  test("this machine's 40 GiB reserve sizes K below its cap", () => {
    const here = { ...PEER_CONFIG, reserveGiB: 40 }
    expect(sizeOf({ available: 103, total: 121 }, K, here)).toMatchObject({
      maxSessions: 43,
      roomGiB: 63,
      share: 0.52,
    })
  })

  test("a reading that leaves no room for one session sizes to none", () => {
    // K serving at 0.70 leaves about 32 GiB free: M's weights alone do not fit there
    expect(sizeOf({ available: 32.4, total: 121 }, M, PEER_CONFIG).maxSessions).toBe(0)
    expect(sizeOf({ available: 10, total: 121 }, K, PEER_CONFIG)).toMatchObject({
      maxSessions: 0,
      share: 0,
    })
  })
})

describe("playground model use (PG-2543)", () => {
  test("K to M to K on the peer: holds, drains K, stops it by name, sizes M again, starts it; K comes back after M sits idle 30 minutes", async () => {
    const data = scratch()
    await writeMachineState(data, PEER.name, { servers: { "k-model": kServer } })
    const peer = box({
      busy: { 8000: [2, 0] },
      containers: new Set(["local-vllm-k-model"]),
      health: ["000", "200"],
      memory: [32.4, 32.4, 117.1, 26.3],
    })
    const { advance, deps, holds, steps } = stub(peer, data)
    expect(await useModel("m-model", deps)).toEqual({
      code: 0,
      line: "m-model serves on spark-test at 127.0.0.1:8000, share 0.75, up to 13 sessions, with 26.3 GiB free",
      started: true,
    })
    expect(steps).toEqual([
      "serves m-model",
      "inspect local-vllm-m-model",
      "memory",
      "metrics 8000",
      "metrics 8000",
      "stop local-vllm-k-model",
      "memory",
      "memory",
      "serve m-model as local-vllm-m-model on 8000 at 0.75 for 13",
      "inspect local-vllm-m-model",
      "memory",
      "health 8000",
      "memory",
      "health 8000",
    ])
    // the hold is set from the first wait on: no new start on the peer while K drains and M loads
    expect(holds).toEqual(["m-model", "m-model", "m-model"])
    expect(await modelHold(data, PEER.name)).toBeNull()
    expect(Object.keys(await modelServers(data, PEER.name))).toEqual(["m-model"])

    // M busy keeps it up and K waits; 30 idle minutes after that stop M by name and bring K back
    steps.length = 0
    peer.busy = { 8000: [1] }
    expect(await keepUp(deps)).toBeNull()
    expect(steps).toEqual(["metrics 8000"])
    advance(29 * 60_000)
    peer.busy = { 8000: [0] }
    expect(await keepUp(deps)).toBeNull()
    advance(60_000)
    steps.length = 0
    peer.memory = [117.1, 30]
    peer.health = ["200"]
    expect(await keepUp(deps)).toBe(
      "m-model sat idle 30 minutes on spark-test, so playground model use stopped it; k-model serves on spark-test at 127.0.0.1:8000, share 0.7, up to 70 sessions, with 30 GiB free",
    )
    expect(steps).toEqual([
      "metrics 8000",
      "stop local-vllm-m-model",
      "serves k-model",
      "inspect local-vllm-k-model",
      "memory",
      "serve k-model as local-vllm-k-model on 8000 at 0.7 for 70",
      "inspect local-vllm-k-model",
      "memory",
      "health 8000",
    ])
    expect(Object.keys(await modelServers(data, PEER.name))).toEqual(["k-model"])
    // with the kept model serving, the beat only checks it
    steps.length = 0
    expect(await keepUp(deps)).toBeNull()
    expect(steps).toEqual(["serves k-model", "inspect local-vllm-k-model"])
  })

  test("starts beside the running model when the reading holds a session of both, with no hold and nothing stopped", async () => {
    const data = scratch()
    await writeMachineState(data, HERE.name, { servers: { "k-model": kServer } })
    const here = box({ containers: new Set(["local-vllm-k-model"]), memory: [100, 30] })
    const { deps, holds, steps } = stub(here, data, {
      config: { ...PEER_CONFIG, reserveGiB: 15 },
      machine: HERE,
    })
    expect(await useModel("m-model", deps)).toEqual({
      code: 0,
      line: "m-model serves on spark-here at 127.0.0.1:8001, share 0.7, up to 8 sessions, beside k-model, with 30 GiB free",
      started: true,
    })
    expect(steps).toEqual([
      "serves m-model",
      "inspect local-vllm-m-model",
      "memory",
      "serve m-model as local-vllm-m-model on 8001 at 0.7 for 8",
      "inspect local-vllm-m-model",
      "memory",
      "health 8001",
    ])
    expect(holds).toEqual([])
    expect(Object.keys(await modelServers(data, HERE.name)).sort()).toEqual(["k-model", "m-model"])
  })

  test("refuses with the reading when not even one session fits once the wait for memory runs out", async () => {
    const data = scratch()
    const { deps, steps } = stub(box({ memory: [60] }), data)
    expect(await useModel("m-model", deps)).toEqual({
      code: 1,
      line: "spark-test has 60 GiB free; above its 19.5 GiB reserve that leaves 40.5 GiB, a share of 0.33, which holds no 65536-token session of m-model, so nothing started",
    })
    expect(steps.filter((step) => step === "memory").length).toBeGreaterThan(2)
    expect(steps.some((step) => step.startsWith("serve "))).toBe(false)
    expect(await modelHold(data, PEER.name)).toBeNull()
  })

  test("a call that set no hold leaves another run's hold standing", async () => {
    const data = scratch()
    const other = { for: "k-model", since: "2026-11-17T06:00:01.000Z" }
    const run = stub(box({ memory: [60] }), data, {
      // another swap sets its hold while this start waits for memory
      sleep: async (ms) => {
        if (!(await modelHold(data, PEER.name)))
          await writeMachineState(data, PEER.name, { hold: other })
        run.advance(ms)
      },
    })
    expect((await useModel("m-model", run.deps)).code).toBe(1)
    expect(await modelHold(data, PEER.name)).toEqual(other)
  })

  test("refuses a name with no serve.sh, one with no sizing figures, and one that could name a path, running nothing", async () => {
    const data = scratch()
    const { deps, steps } = stub(box(), data)
    expect(await useModel("q-model", deps)).toEqual({
      code: 1,
      line: "localModels.models has no sizing figures for q-model, so nothing changed: add its cap, weightsGiB, overheadGiB and kvKiBPerToken",
    })
    for (const name of ["../k-model", "K-Model", "-rf", "k model", ""])
      expect((await useModel(name, deps)).code).toBe(1)
    expect(steps).toEqual([])
    const bare = stub(box({ serves: {} }), data)
    expect(await useModel("m-model", bare.deps)).toEqual({
      code: 1,
      line: "spark-test has no ~/models/m-model/serve.sh, so nothing changed",
    })
    expect(bare.steps).toEqual(["serves m-model"])
  })

  test("a serve.sh that does not take the size from its environment is refused, so its hard-coded share never starts unsized", async () => {
    const data = scratch()
    const { deps, steps } = stub(box({ serves: { "m-model": "${CONTAINER:-\n" } }), data)
    expect((await useModel("m-model", deps)).line).toBe(
      "~/models/m-model/serve.sh on spark-test does not take PORT, GPU_MEMORY_UTILIZATION, MAX_NUM_SEQS from its environment, so it cannot be sized and nothing changed",
    )
    expect(steps).toEqual(["serves m-model"])
  })

  test("never stops a container it did not start: one under its own name but not in the state, or the hand-started local-vllm", async () => {
    const data = scratch()
    const claimed = stub(box({ containers: new Set(["local-vllm-m-model"]) }), data)
    expect(await useModel("m-model", claimed.deps)).toEqual({
      code: 1,
      line: "local-vllm-m-model on spark-test was not started by playground model use, so it is left as it is: stop it by hand, then run playground model use m-model",
    })
    expect(claimed.steps).toEqual(["serves m-model", "inspect local-vllm-m-model"])
    // the hand-started server holds the memory; the start waits, refuses, and leaves it running
    const hand = box({ containers: new Set(["local-vllm"]), memory: [32.4] })
    const handStart = stub(hand, data)
    expect((await useModel("m-model", handStart.deps)).code).toBe(1)
    expect(handStart.steps.some((step) => step.startsWith("stop"))).toBe(false)
    expect(hand.containers.has("local-vllm")).toBe(true)
    expect(await readModelState(data)).toEqual({})
  })

  test("stops the server it just started when free memory falls under 15 GiB while it loads", async () => {
    const data = scratch()
    const { deps, steps } = stub(box({ health: ["000"], memory: [117.1, 14] }), data)
    expect(await useModel("m-model", deps)).toEqual({
      code: 1,
      line: "free memory on spark-test fell to 14 GiB while m-model loaded, under 15 GiB, so playground model use stopped local-vllm-m-model",
    })
    expect(steps).toEqual([
      "serves m-model",
      "inspect local-vllm-m-model",
      "memory",
      "serve m-model as local-vllm-m-model on 8000 at 0.75 for 13",
      "inspect local-vllm-m-model",
      "memory",
      "stop local-vllm-m-model",
    ])
    expect(await modelServers(data, PEER.name)).toEqual({})
  })

  test("a drain that outlasts drainMinutes keeps K serving and lifts the hold", async () => {
    const data = scratch()
    await writeMachineState(data, PEER.name, { servers: { "k-model": kServer } })
    const { deps, steps } = stub(
      box({ busy: { 8000: [3] }, containers: new Set(["local-vllm-k-model"]), memory: [32.4] }),
      data,
    )
    expect((await useModel("m-model", deps)).line).toBe(
      "k-model still has 3 requests running or waiting after 30 minutes, so it keeps serving",
    )
    expect(steps.some((step) => step.startsWith("stop"))).toBe(false)
    expect(await modelHold(data, PEER.name)).toBeNull()
    expect(Object.keys(await modelServers(data, PEER.name))).toEqual(["k-model"])
  })

  test("a swap already running holds every other start, and a hold a killed run left behind is lifted", async () => {
    const data = scratch()
    await writeMachineState(data, PEER.name, {
      hold: { for: "k-model", since: "2026-11-17T05:50:00.000Z" },
    })
    const { deps } = stub(box(), data)
    expect((await useModel("m-model", deps)).line).toBe(
      "a swap to k-model has run on spark-test since 2026-11-17T05:50:00.000Z, so nothing changed",
    )
    await writeMachineState(data, PEER.name, {
      hold: { for: "k-model", since: "2026-11-16T05:50:00.000Z" },
    })
    expect((await useModel("m-model", deps)).code).toBe(0)
    expect(await modelHold(data, PEER.name)).toBeNull()
  })

  test("records the container on its own machine through the machine record's add, and a failed write never fails the start", async () => {
    const data = scratch()
    const recorded: { entries: { kind: string; path: string }[]; where: string }[] = []
    const { deps } = stub(box(), data, {
      record: async (entries, where) => void recorded.push({ entries, where }),
    })
    expect((await useModel("k-model", deps)).code).toBe(0)
    expect(recorded).toEqual([
      {
        entries: [
          expect.objectContaining({
            kind: "container",
            path: "docker container local-vllm-k-model",
          }),
        ],
        where: "peer",
      },
      {
        entries: [expect.objectContaining({ kind: "file", path: statePath(data) })],
        where: "here",
      },
    ])
    const failing = stub(box(), scratch(), {
      machine: HERE,
      record: async () => {
        throw new Error("no record")
      },
    })
    expect((await useModel("k-model", failing.deps)).code).toBe(0)
  })

  test("the keep beat starts the kept model when nothing serves, and says a repeated refusal once", async () => {
    const data = scratch()
    const { deps } = stub(box({ memory: [10] }), data, { machine: HERE })
    const refused =
      "spark-here has 10 GiB free; above its 19.5 GiB reserve that leaves 0 GiB, a share of 0, which holds no 65536-token session of k-model, so nothing started"
    expect(await keepUp(deps)).toBe(refused)
    expect(await keepUp(deps)).toBeNull()
    expect((await machineState(data, HERE.name)).refused).toBe(refused)
  })

  test("the state file keeps each machine's servers under its name, the shape the local-worker gate reads", async () => {
    const data = scratch()
    const { deps } = stub(box({ memory: [103] }), data, {
      config: { ...PEER_CONFIG, reserveGiB: 40 },
      machine: HERE,
    })
    expect((await useModel("k-model", deps)).code).toBe(0)
    expect(statePath(data)).toBe(join(data, "models", "state.json"))
    expect(await Bun.file(statePath(data)).json()).toEqual({
      machines: {
        "spark-here": {
          servers: {
            "k-model": {
              busyAt: "2026-11-17T06:00:00.000Z",
              container: "local-vllm-k-model",
              maxSessions: 43,
              port: 8000,
              share: 0.52,
              startedAt: "2026-11-17T06:00:00.000Z",
            },
          },
        },
      },
    })
  })

  test("a restart sizes from a fresh reading, never from the share the state file kept", async () => {
    const data = scratch()
    // K was sized at 0.70 before a reboot; its container is gone and 60 GiB is free now
    await writeMachineState(data, PEER.name, { servers: { "k-model": kServer } })
    const { deps, steps } = stub(box({ memory: [60] }), data)
    expect((await useModel("k-model", deps)).line).toBe(
      "k-model serves on spark-test at 127.0.0.1:8000, share 0.33, up to 14 sessions, with 60 GiB free",
    )
    expect(steps).toEqual([
      "serves k-model",
      "inspect local-vllm-k-model",
      "stop local-vllm-k-model",
      "inspect local-vllm-k-model",
      "memory",
      "serve k-model as local-vllm-k-model on 8000 at 0.33 for 14",
      "inspect local-vllm-k-model",
      "memory",
      "health 8000",
    ])
    expect((await modelServers(data, PEER.name))["k-model"]).toMatchObject({
      maxSessions: 14,
      share: 0.33,
    })
  })

  test("no command model use or the keep beat sends holds gh, a git credential helper, docker login or a keyring read", async () => {
    const data = scratch()
    await writeMachineState(data, PEER.name, { servers: { "k-model": kServer } })
    const peer = box({
      busy: { 8000: [2, 0] },
      containers: new Set(["local-vllm-k-model"]),
      memory: [32.4, 117.1, 26.3],
    })
    const { advance, calls, deps } = stub(peer, data)
    // a swap, the beat's idle stop and the kept model's start, and a start beside it
    expect((await useModel("m-model", deps)).code).toBe(0)
    advance(31 * 60_000)
    peer.memory = [117.1, 30]
    expect(await keepUp(deps)).toContain("k-model serves")
    peer.memory = [100, 30]
    deps.config = { ...PEER_CONFIG, reserveGiB: 15 }
    expect((await useModel("m-model", deps)).code).toBe(0)
    expect(calls.length).toBeGreaterThan(10)
    for (const argv of calls) {
      expect(argv[0]).toBe("ssh")
      const text = argv.join(" ")
      expect(text).not.toMatch(/(^|[\s;&|(])gh(\s|$)/)
      expect(text).not.toMatch(
        /credential|docker login|secret-tool|keyring|keychain|DBUS|security find|git /,
      )
    }
  })

  test("a usage pause leaves the models up: the keep beat runs in ops-tick and the tunnel in its own job, neither marked as calling a Claude model", () => {
    expect(BEATS.find((beat) => beat.name === "model-keep")).toMatchObject({ cron: "*/5 * * * *" })
    expect(JOBS["ops-tick"]!.callsModel).toBe(false)
    expect(JOBS["ops-model-tunnel"]!.callsModel).toBe(false)
  })

  test("a state file that does not read throws rather than read as no servers", async () => {
    const data = scratch()
    await Bun.write(statePath(data), "{not json")
    await expect(modelServers(data, HERE.name)).rejects.toThrow()
  })
})

describe("the model readers (PG-2543)", () => {
  test("ssh takes the key alone, never prompts, and runs one fixed command; this machine runs it under sh", () => {
    expect(commandArgv(PEER, "/k", "cat /proc/meminfo")).toEqual([
      "ssh",
      "-F",
      "none",
      "-i",
      "/k",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "me@spark-test",
      "cat /proc/meminfo",
    ])
    expect(commandArgv(HERE, "/k", "cat /proc/meminfo")).toEqual(["sh", "-c", "cat /proc/meminfo"])
  })

  test("memory reads in GiB from /proc/meminfo, and the request count sums running and waiting", () => {
    expect(memOf(meminfo(40, 120))).toEqual({ available: 40, total: 120 })
    expect(memOf("nothing")).toBeNull()
    expect(busyOf(metrics(2, 3))).toBe(5)
    expect(busyOf("")).toBeNull()
  })
})
