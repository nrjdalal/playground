import { afterAll, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  linesOf,
  measureUnused,
  peerUnusedArgv,
  type Unused,
  unusedEverywhere,
} from "../../../../../packages/scripts/src/ops-tick/unused"

const HERE = hostname().split(".")[0]!
const NOW = Date.parse("2026-11-18T03:00:00Z")
const DAY = 86_400_000
const MB = 1024 ** 2
const homes: string[] = []
afterAll(() => {
  for (const home of homes) rmSync(home, { force: true, recursive: true })
})

// A sparse file of the given size, so a test lists a 200 MB weights file with no disk spent.
const sized = (path: string, bytes: number, at = NOW) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "")
  truncateSync(path, bytes)
  utimesSync(path, at / 1000, at / 1000)
}

// The docker this machine answers with: four images, one a container uses, one pulled yesterday, redis:alpine and the one a serve.sh names, and one old and unused.
const IMAGES = [
  "sha256:aaa\tpostgres:18-alpine",
  "sha256:bbb\tpostgres:alpine",
  "sha256:ccc\tfresh:1",
  "sha256:ddd\tredis:alpine",
  "sha256:eee\tvllm/vllm-openai:v0.32.0",
].join("\n")
const INSPECT = [
  `sha256:aaa\t${300 * MB}\t"2026-11-01T00:00:00Z"`,
  `sha256:bbb\t${300 * MB}\t"0001-01-01T00:00:00Z"`,
  `sha256:ccc\t${300 * MB}\t"2026-11-17T00:00:00Z"`,
  `sha256:ddd\t${50 * MB}\t"0001-01-01T00:00:00Z"`,
  `sha256:eee\t${24_000 * MB}\t"0001-01-01T00:00:00Z"`,
].join("\n")

// A scratch home: a data folder whose record holds ~/.bun, the clone and ~/probe-local-model/gguf, ~/models with a kept and a dropped hf repo, one old test row and one fresh, Ops' rehearse142, and a clone whose .env names one peer; every argv its run is handed is kept.
const setUp = (dashboard = false) => {
  const home = mkdtempSync(join(tmpdir(), "unused-"))
  homes.push(home)
  const data = join(home, ".playground")
  const repo = join(home, "code", "playground")
  const models = join(home, "models")
  const at = (rel: string) => join(home, rel)
  const desk = join(home, "code", "desk")
  for (const dir of [repo, desk]) mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dashboard ? desk : repo, ".env"),
    "PLAYGROUND_PEERS=spark-test=me@spark-test\nPLAYGROUND_PEER_KEY=/k/playground_spark\n",
  )
  const entry = (path: string) => ({
    added: "2026-11-17",
    by: "ops",
    kind: "folder",
    path,
    undo: "rm",
    why: "seed",
  })
  mkdirSync(data, { recursive: true })
  writeFileSync(
    join(data, "machine-record.json"),
    JSON.stringify({
      baseline: [],
      entries: [entry(at(".bun")), entry(repo), entry(at("probe-local-model/gguf"))],
    }),
  )
  sized(at(".bun/install/cache/big.tgz"), 900 * MB)
  sized(join(repo, "weights-like.gguf.txt"), 900 * MB)
  mkdirSync(join(models, "ornith"), { recursive: true })
  writeFileSync(join(models, "ornith/model.env"), "REPO=ornith-ai/Ornith-35B\n")
  writeFileSync(join(models, "ornith/serve.sh"), "docker run vllm/vllm-openai:v0.32.0\n")
  sized(join(models, "hf/hub/models--ornith-ai--Ornith-35B/blobs/a"), 2000 * MB)
  sized(join(models, "hf/hub/models--nvidia--Qwen-27B/blobs/b"), 1500 * MB)
  sized(at("probe-local-model/gguf/GLM-Flash.gguf"), 700 * MB)
  sized(at("probe-local-model/gguf/tiny.gguf"), 2 * MB)
  sized(join(models, "kit/runs/MB-old/pr0001/file.ts"), 200 * MB, NOW - 3 * DAY)
  sized(join(models, "kit/runs/MB-old/pr0001.grade.log"), 1 * MB, NOW - 2 * DAY)
  sized(join(models, "kit/runs/MB-new/pr0002/file.ts"), 200 * MB)
  sized(join(models, "kit/runs/MB-new/pr0002.grade.log"), 1 * MB, NOW - 3_600_000)
  sized(join(data, "scratchpad/ops/rehearse142/clone/a"), 150 * MB)
  sized(join(data, "scratchpad/ops/rehearse-template/a"), 150 * MB)
  const runs: string[][] = []
  const run = async (argv: string[]) => {
    runs.push(argv)
    const verb = argv.slice(0, 3).join(" ")
    if (verb === "docker image ls") return { code: 0, out: IMAGES }
    if (verb === "docker ps -a") return { code: 0, out: "postgres:alpine\n" }
    if (verb === "docker image inspect") return { code: 0, out: INSPECT }
    return { code: 127, out: "" }
  }
  const checkout = () => (dashboard ? desk : null)
  return { at, checkout, data, home, models, places: { data, home, now: NOW, run }, repo, runs }
}

test("this machine's unused space: an old unused image, the dropped repo, the recorded gguf, the old row's worktree and the rehearsal, largest first", async () => {
  const { at, data, models, places } = setUp()
  const items = await measureUnused(places)
  expect(items.map(({ kind, path, recorded }) => ({ kind, path, recorded }))).toEqual([
    { kind: "weights", path: join(models, "hf/hub/models--nvidia--Qwen-27B"), recorded: false },
    { kind: "weights", path: at("probe-local-model/gguf/GLM-Flash.gguf"), recorded: true },
    { kind: "image", path: "docker image postgres:18-alpine", recorded: false },
    { kind: "run", path: join(models, "kit/runs/MB-old/pr0001"), recorded: false },
    { kind: "rehearsal", path: join(data, "scratchpad/ops/rehearse142"), recorded: false },
    { kind: "weights", path: at("probe-local-model/gguf/tiny.gguf"), recorded: true },
  ])
  expect(items[0]!.bytes).toBe(1500 * MB)
})

test("the record guards and lists nothing itself: ~/.bun and the clone, both recorded, give no line", async () => {
  const { at, places, repo } = setUp()
  const paths = (await measureUnused(places)).map((i) => i.path)
  expect(paths.filter((p) => p.startsWith(at(".bun")) || p.startsWith(repo))).toEqual([])
})

test("a dry run removes nothing: every file stays, and docker is only read", async () => {
  const { at, models, places, runs } = setUp()
  await measureUnused(places)
  for (const path of [
    join(models, "hf/hub/models--nvidia--Qwen-27B/blobs/b"),
    at("probe-local-model/gguf/GLM-Flash.gguf"),
    join(models, "kit/runs/MB-old/pr0001/file.ts"),
  ])
    expect(existsSync(path)).toBe(true)
  expect(runs.map((argv) => argv.slice(0, 3).join(" "))).toEqual([
    "docker image ls",
    "docker ps -a",
    "docker image inspect",
  ])
})

test.each([
  ["the clone's own .env", false],
  ["the Dashboard checkout's .env, the main checkout keeping none", true],
])(
  "the peer %s names is read through one fixed, read-only ssh into the main checkout's clone, and its items join this machine's",
  async (_, dashboard) => {
    const { checkout, home, places, repo } = setUp(dashboard)
    const peer: Unused[] = [
      {
        bytes: 159 * 1024 ** 3,
        kind: "weights",
        path: "/home/me/probe-local-model/gguf/x.gguf",
        recorded: true,
      },
    ]
    const ssh: string[][] = []
    const found = await unusedEverywhere(
      { ...places, home },
      repo,
      async (argv) => {
        ssh.push(argv)
        return { code: 0, out: JSON.stringify(peer) }
      },
      checkout,
    )
    expect(ssh).toEqual([
      [
        "ssh",
        "-F",
        "none",
        "-i",
        "/k/playground_spark",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "me@spark-test",
        'cd ~/code/playground && PATH="$HOME/.bun/bin:$PATH" exec bun --no-env-file packages/scripts/src/ops-tick/unused.ts --json',
      ],
    ])
    expect(ssh[0]).toEqual(
      peerUnusedArgv("/k/playground_spark", "me@spark-test", "~/code/playground"),
    )
    expect(found.map((m) => m.machine)).toEqual([HERE, "spark-test"])
    expect(found[1]).toEqual({ items: peer, machine: "spark-test" })
  },
)

test("a peer that does not answer is named with its first line", async () => {
  const { checkout, home, places, repo } = setUp()
  const found = await unusedEverywhere(
    { ...places, home },
    repo,
    async () => ({ code: 255, out: "ssh: connect to host spark-test port 22: No route to host\n" }),
    checkout,
  )
  expect(found[1]).toEqual({
    machine: "spark-test",
    why: "ssh: connect to host spark-test port 22: No route to host",
  })
  expect(linesOf(found[1]!, home).item).toBe(
    "spark-test: not read: ssh: connect to host spark-test port 22: No route to host",
  )
})

test("a machine's lines: the log's totals by kind, the outbox's items with recorded marked, the small ones folded", () => {
  const home = "/home/me"
  const items: Unused[] = [
    {
      bytes: 38 * 1024 ** 3,
      kind: "weights",
      path: "/home/me/probe-local-model/gguf/x.gguf",
      recorded: true,
    },
    { bytes: 300 * MB, kind: "image", path: "docker image postgres:18-alpine", recorded: false },
    { bytes: 33 * MB, kind: "run", path: "/home/me/models/kit/runs/A/pr1", recorded: false },
    {
      bytes: 12 * MB,
      kind: "weights",
      path: "/home/me/models/hf/hub/models--a--b",
      recorded: false,
    },
  ]
  expect(linesOf({ items, machine: "spark-9dfb" }, home)).toEqual({
    item: "spark-9dfb unused: weights ~/probe-local-model/gguf/x.gguf 38.0 GB recorded; image docker image postgres:18-alpine 0.3 GB; small leftovers 2 at 45 MB",
    total: "spark-9dfb unused 38.3 GB (image 0.3 GB, weights 38.0 GB, small leftovers 2 at 45 MB)",
  })
  expect(linesOf({ items: [], machine: "spark-a566" }, home)).toEqual({
    item: "spark-a566 unused: none",
    total: "spark-a566 unused 0.0 GB",
  })
})
