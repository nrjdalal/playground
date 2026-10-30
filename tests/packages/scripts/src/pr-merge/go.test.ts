import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import "./scratch-config"
import { ciGo } from "../../../../../packages/scripts/src/pr-merge/go"
import type { Run } from "../../../../../packages/scripts/src/pr-merge/merge"
import type { Drop } from "../../../../../packages/scripts/src/pr-merge/train"

const REPO = "acme/factory"
const HEAD = "a860907fd962494f6f7b2e9341f14f35d32088c"
const NOW = new Date("2026-10-19T05:30:00Z")

type Pr = { author: string; head: string; labels: string[]; state: string }
const PR: Pr = { author: "acme", head: HEAD, labels: [], state: "OPEN" }

// A fake gh: answers pr view from the PR it holds, and records every call, an added or removed label landing on the PR.
const fakeGh = (pr: Pr) => {
  const calls: string[][] = []
  const run: Run = async (args) => {
    calls.push(args)
    if (args[0] === "pr" && args[1] === "view") {
      const view = {
        author: { login: pr.author },
        headRefOid: pr.head,
        labels: pr.labels.map((name) => ({ name })),
        state: pr.state,
      }
      return { code: 0, stderr: "", stdout: JSON.stringify(view) }
    }
    if (args[0] === "pr" && args[1] === "edit") {
      if (args.includes("--add-label")) pr.labels.push(args[args.indexOf("--add-label") + 1] ?? "")
      const removed = args.includes("--remove-label")
        ? args[args.indexOf("--remove-label") + 1]
        : ""
      pr.labels = pr.labels.filter((name) => name !== removed)
      return { code: 0, stderr: "", stdout: "" }
    }
    return { code: 1, stderr: `unexpected gh ${args.join(" ")}`, stdout: "" }
  }
  return { calls, run }
}

const QUEUE = {
  note: "kept as it is",
  queue: [
    { item: "dictation", pr: 1174 },
    { goAt: "2026-10-19T03:26:20Z", item: "ops-flow", pr: 1145 },
  ],
  updatedAt: "2026-10-19T05:06:49Z",
}

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-go-"))
  const queue = join(dir, "merge-queue.json")
  writeFileSync(queue, `${JSON.stringify(QUEUE, null, 2)}\n`)
  return { log: join(dir, "ops", "gos.jsonl"), queue }
}

// No predicted conflict, unless a test hands its own forecast.
const clean = async (): Promise<Drop[]> => []

const go = (
  run: Run,
  files: { log: string; queue: string },
  sha = "a860907",
  forecast: () => Promise<Drop[]> = clean,
) => ciGo(run, { by: "builder", forecast, n: 1174, now: () => NOW, repo: REPO, sha, ...files })

const edits = (calls: string[][]) => calls.filter((args) => args[1] === "edit")

describe("ciGo", () => {
  test("labels the PR Cloud CI, logs the go and stamps its goAt in the merge queue", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: [] })
    const outcome = await go(gh.run, files)
    expect(outcome.ok).toBe(true)
    expect(edits(gh.calls)).toEqual([["pr", "edit", "1174", "-R", REPO, "--add-label", "Cloud CI"]])
    const log = (await Bun.file(files.log).text()).trim().split("\n")
    expect(log.map((line) => JSON.parse(line))).toEqual([
      { at: NOW.toISOString(), by: "builder", pr: 1174, sha: HEAD },
    ])
    const queue = await Bun.file(files.queue).json()
    expect(queue.queue[0]).toEqual({ goAt: NOW.toISOString(), item: "dictation", pr: 1174 })
    expect(queue.queue[1]).toEqual(QUEUE.queue[1])
    expect(queue.note).toBe(QUEUE.note)
    expect(queue.updatedAt).toBe(QUEUE.updatedAt)
  })

  // The stamp Checks posts already counts as local CI, so a go starts no lane of its own
  test("starts no local CI lane, and no line names one", async () => {
    const outcome = await go(fakeGh({ ...PR, labels: [] }).run, scratch())
    expect(outcome.ok).toBe(true)
    expect(outcome.lines.join("\n")).not.toMatch(/lane|localci/i)
  })

  test("a second go at the same head adds nothing twice and says so", async () => {
    const files = scratch()
    const pr: Pr = { ...PR, labels: [] }
    await go(fakeGh(pr).run, files)
    const queueAfterFirst = await Bun.file(files.queue).text()
    const again = fakeGh(pr)
    const outcome = await go(again.run, files)
    expect(outcome.ok).toBe(true)
    expect(outcome.lines.join("\n")).toContain("already")
    expect(edits(again.calls)).toEqual([])
    expect((await Bun.file(files.log).text()).trim().split("\n")).toHaveLength(1)
    expect(await Bun.file(files.queue).text()).toBe(queueAfterFirst)
    expect(pr.labels).toEqual(["Cloud CI"])
  })

  test("swaps a Local CI label for Cloud CI in one edit, so the PR never carries both", async () => {
    const pr: Pr = { ...PR, labels: ["Local CI"] }
    const gh = fakeGh(pr)
    const outcome = await go(gh.run, scratch())
    expect(outcome.ok).toBe(true)
    expect(edits(gh.calls)).toEqual([
      ["pr", "edit", "1174", "-R", REPO, "--add-label", "Cloud CI", "--remove-label", "Local CI"],
    ])
    expect(pr.labels).toEqual(["Cloud CI"])
    expect(outcome.lines).toContain("#1174 Local CI removed")
  })

  test("refuses a sha that is not the PR's head, changing nothing", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: [] })
    const outcome = await go(gh.run, files, "1234567")
    expect(outcome.ok).toBe(false)
    expect(outcome.lines.join("\n")).toContain("a860907")
    expect(edits(gh.calls)).toEqual([])
    expect(await Bun.file(files.log).exists()).toBe(false)
    expect(await Bun.file(files.queue).json()).toEqual(QUEUE)
  })

  test("refuses a PR the repo's owner did not open, since local CI would run its code here", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, author: "someone-else", labels: [] })
    const outcome = await go(gh.run, files)
    expect(outcome.ok).toBe(false)
    expect(outcome.lines.join("\n")).toContain("someone-else")
    expect(edits(gh.calls)).toEqual([])
    expect(await Bun.file(files.log).exists()).toBe(false)
  })

  test("refuses a PR that is not open", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: [], state: "MERGED" })
    expect((await go(gh.run, files)).ok).toBe(false)
    expect(edits(gh.calls)).toEqual([])
  })

  test("refuses a sha shorter than 7 hex characters, which could name more than one head", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: [] })
    expect((await go(gh.run, files, "a86")).ok).toBe(false)
    expect(gh.calls).toEqual([])
  })

  test("a PR the merge queue does not list is labelled and logged, and the queue is left as it is", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: [] })
    const outcome = await ciGo(gh.run, {
      by: "builder",
      n: 1999,
      now: () => NOW,
      repo: REPO,
      forecast: clean,
      sha: "a860907",
      ...files,
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.lines.join("\n")).toContain("not in the merge queue")
    expect(edits(gh.calls)).toHaveLength(1)
    expect(await Bun.file(files.queue).json()).toEqual(QUEUE)
  })
})

describe("ciGo --outside-author", () => {
  const SOREN = "teammate-acme"
  const outside = (run: Run, files: { log: string; queue: string }, outsideAuthor?: string) =>
    ciGo(run, {
      by: "builder",
      forecast: clean,
      n: 1174,
      now: () => NOW,
      outsideAuthor,
      repo: REPO,
      sha: "a860907",
      ...files,
    })

  test("a go naming the PR's author labels, logs and stamps it as it does the owner's", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, author: SOREN, labels: [] })
    const outcome = await outside(gh.run, files, "Teammate-Acme")
    expect(outcome.ok).toBe(true)
    expect(edits(gh.calls)).toEqual([["pr", "edit", "1174", "-R", REPO, "--add-label", "Cloud CI"]])
    expect(JSON.parse((await Bun.file(files.log).text()).trim())).toEqual({
      at: NOW.toISOString(),
      by: "builder",
      pr: 1174,
      sha: HEAD,
    })
    expect((await Bun.file(files.queue).json()).queue[0].goAt).toBe(NOW.toISOString())
  })

  test("without the flag, or naming someone else, the outside PR is refused and nothing is written", async () => {
    for (const named of [undefined, "someone-else"]) {
      const files = scratch()
      const gh = fakeGh({ ...PR, author: SOREN, labels: [] })
      const outcome = await outside(gh.run, files, named)
      expect(outcome.ok).toBe(false)
      expect(outcome.lines.join("\n")).toContain(`--outside-author ${SOREN}`)
      expect(edits(gh.calls)).toEqual([])
      expect(await Bun.file(files.log).exists()).toBe(false)
      expect(await Bun.file(files.queue).json()).toEqual(QUEUE)
    }
  })

  // A fake gh on PATH answers pr view with an outside author's PR, so the go line proves the flag reaches ciGo; its exit 1 on anything else keeps the forecast off the network
  test("the ci:go script hands the flag to the go", async () => {
    const root = join(import.meta.dir, "..", "..", "..", "..", "..")
    const cli = join(root, "packages", "scripts", "src", "pr-merge", "go-cli.ts")
    const dir = mkdtempSync(join(tmpdir(), "ci-go-cli-"))
    const view = { author: { login: SOREN }, headRefOid: HEAD, labels: [], state: "OPEN" }
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh
case "$1 $2" in
  "pr view") echo '${JSON.stringify(view)}' ;;
  "pr edit") ;;
  *) exit 1 ;;
esac
`,
    )
    chmodSync(join(dir, "gh"), 0o755)
    writeFileSync(join(dir, "merge-queue.json"), `${JSON.stringify(QUEUE, null, 2)}\n`)
    const env = {
      ...process.env,
      PLAYGROUND_MERGE_LOCK_DIR: dir,
      PLAYGROUND_MERGE_QUEUE: join(dir, "merge-queue.json"),
      PATH: `${dir}:${process.env.PATH}`,
    }
    const goes = (...flags: string[]) =>
      Bun.spawn(
        [process.execPath, "--no-env-file", cli, "1174", "a860907", "--repo", REPO, ...flags],
        { env, stderr: "pipe", stdout: "pipe" },
      ).exited
    const log = join(dir, "ops", "gos.jsonl")
    expect(await goes()).toBe(1)
    expect(await Bun.file(log).exists()).toBe(false)
    expect(await goes("--outside-author", SOREN)).toBe(0)
    expect(JSON.parse((await Bun.file(log).text()).trim())).toMatchObject({ pr: 1174, sha: HEAD })
  })
})

describe("ciGo's forecast", () => {
  const drop = (n: number, ahead: string, files: string[]): Drop => ({
    files,
    head: HEAD,
    n,
    why: `conflicts with ${ahead} in ${files.join(", ")}`,
    with: ahead,
  })

  test("prints each conflict pr:train forecast predicts for the PR, with the PR ahead and its files", async () => {
    const outcome = await go(fakeGh({ ...PR, labels: [] }).run, scratch(), "a860907", async () => [
      drop(1174, "#1193", [".agents/dashboard/cmux.md"]),
      drop(1173, "#1193", [".agents/dashboard/cmux.md"]),
    ])
    expect(outcome.ok).toBe(true)
    const forecast = outcome.lines.filter((line) => line.startsWith("forecast"))
    expect(forecast).toEqual([
      "forecast: #1174 conflicts with #1193 in .agents/dashboard/cmux.md: merge #1193's branch, or canary once it lands, before the last round",
    ])
  })

  test("prints nothing when the forecast is clean for the PR", async () => {
    const outcome = await go(fakeGh({ ...PR, labels: [] }).run, scratch(), "a860907", async () => [
      drop(1173, "#1193", [".agents/dashboard/cmux.md"]),
    ])
    expect(outcome.lines.filter((line) => line.startsWith("forecast"))).toEqual([])
  })

  test("a forecast that cannot run says so and the go still stands", async () => {
    const outcome = await go(fakeGh({ ...PR, labels: [] }).run, scratch(), "a860907", async () => {
      throw new Error("git fetch failed")
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.lines).toContain("forecast could not run: git fetch failed")
  })
})

describe("the ci:go script", () => {
  test("ignores a worktree .env's PLAYGROUND_DATA_DIR, so the go log and the queue stay beside the merge lock", async () => {
    const root = join(import.meta.dir, "..", "..", "..", "..", "..")
    const script: string = (await Bun.file(join(root, "package.json")).json()).scripts["ci:go"]
    const words = script.split("&&").at(-1)!.trim().split(/\s+/)
    expect(words.at(-1)).toBe("packages/scripts/src/pr-merge/go-cli.ts")
    const cwd = mkdtempSync(join(tmpdir(), "ci-go-env-"))
    const elsewhere = join(cwd, "elsewhere")
    writeFileSync(join(cwd, ".env"), `PLAYGROUND_DATA_DIR=${elsewhere}\n`)
    const probe = join(cwd, "probe.ts")
    const src = join(root, "packages", "scripts", "src", "pr-merge")
    writeFileSync(
      probe,
      `import { goLogPath } from ${JSON.stringify(join(src, "go"))}\nimport { queuePath } from ${JSON.stringify(join(src, "train"))}\nconsole.log([goLogPath(), queuePath()].join("\\n"))\n`,
    )
    const env: Record<string, string | undefined> = { ...process.env }
    for (const key of [
      "PLAYGROUND_DATA_DIR",
      "PLAYGROUND_MERGE_LOCK_DIR",
      "PLAYGROUND_MERGE_QUEUE",
    ])
      delete env[key]
    const proc = Bun.spawn([process.execPath, ...words.slice(1, -1), probe], {
      cwd,
      env,
      stderr: "pipe",
      stdout: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    expect(await proc.exited).toBe(0)
    const paths = out.trim().split("\n")
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.startsWith(join(process.env.HOME!, ".playground"))).toBe(true)
      expect(path.startsWith(elsewhere)).toBe(false)
    }
  })
})

describe("ciGo --take-back", () => {
  const takeBack = (run: Run, files: { log: string; queue: string }) =>
    ciGo(run, {
      by: "builder",
      forecast: clean,
      n: 1174,
      now: () => NOW,
      repo: REPO,
      sha: "a860907",
      takeBack: true,
      ...files,
    })

  test("takes the label off first, then drops the go's log line and clears its goAt", async () => {
    const files = scratch()
    const pr: Pr = { ...PR, labels: [] }
    await go(fakeGh(pr).run, files)
    const other = { at: NOW.toISOString(), by: "builder", pr: 1145, sha: HEAD }
    await appendFile(files.log, `${JSON.stringify(other)}\n`)
    const gh = fakeGh(pr)
    const run: Run = async (args) => {
      if (args.includes("--remove-label"))
        expect(await Bun.file(files.log).text()).toContain('"pr":1174')
      return gh.run(args)
    }
    const outcome = await takeBack(run, files)
    expect(outcome.ok).toBe(true)
    expect(edits(gh.calls)).toEqual([
      ["pr", "edit", "1174", "-R", REPO, "--remove-label", "Cloud CI"],
    ])
    expect(pr.labels).toEqual([])
    const log = (await Bun.file(files.log).text()).trim().split("\n")
    expect(log.map((line) => JSON.parse(line))).toEqual([other])
    expect(await Bun.file(files.queue).json()).toEqual(QUEUE)
    expect(outcome.lines.join("\n")).toContain(
      "go.py stops the Checks run it started for #1174 within a cycle",
    )
  })

  test("refuses a head with no go and changes nothing", async () => {
    const files = scratch()
    const gh = fakeGh({ ...PR, labels: ["Cloud CI"] })
    const outcome = await takeBack(gh.run, files)
    expect(outcome.ok).toBe(false)
    expect(outcome.lines.join("\n")).toContain("no go")
    expect(edits(gh.calls)).toEqual([])
    expect(await Bun.file(files.log).exists()).toBe(false)
    expect(await Bun.file(files.queue).json()).toEqual(QUEUE)
  })
})
