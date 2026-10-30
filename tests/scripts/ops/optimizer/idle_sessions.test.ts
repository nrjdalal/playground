import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { costOf } from "../../../../api/hono/src/lib/usage/prices"
import {
  collect,
  formatRow,
  formatTotal,
  type PrState,
  prStateLive,
  type RegistryEntry,
  type Row,
  spend,
} from "../../../../scripts/ops/optimizer/idle_sessions"

const NOW = 1_760_700_000

type Deps = Parameters<typeof collect>[0]

const emptyDir = () => mkdtempSync(join(tmpdir(), "idle-sessions-"))

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name: "reviewer-quiet-copy",
  pid: 4242,
  sessionId: "sess-quiet-copy",
  status: "idle",
  statusUpdatedAt: (NOW - 45 * 60) * 1000,
  ...over,
})

const deps = (over: Partial<Deps> = {}): Deps => ({
  hours: 1,
  now: NOW,
  prState: async () => null,
  projectsDir: emptyDir(),
  roster: {},
  sessions: {},
  workerPrs: async () => [],
  ...over,
})

const whys = (rows: Row[]) => rows.map((r) => r.why)

describe("collect: live sessions with nothing to do", () => {
  test("a busy session is never listed", async () => {
    const rows = await collect(
      deps({
        roster: { "reviewer-quiet-copy": { name: "reviewer-quiet-copy", status: "ended" } },
        sessions: { "reviewer-quiet-copy": entry({ status: "busy" }) },
      }),
    )
    expect(rows).toEqual([])
  })

  test("a session quiet under 10 minutes is never listed", async () => {
    const rows = await collect(
      deps({
        roster: { "reviewer-quiet-copy": { name: "reviewer-quiet-copy", status: "ended" } },
        sessions: {
          "reviewer-quiet-copy": entry({ statusUpdatedAt: (NOW - 9 * 60) * 1000 }),
        },
      }),
    )
    expect(rows).toEqual([])
  })

  test("checker-worker-gone: listed when the worker has no live session, kept when it has", async () => {
    const roster = { "reviewer-lust-7": { name: "reviewer-lust-7", worker: "worker-lust" } }
    const reviewer = entry({ name: "reviewer-lust-7", sessionId: "sess-r7" })
    const gone = await collect(deps({ roster, sessions: { "reviewer-lust-7": reviewer } }))
    expect(whys(gone)).toEqual([["checker-worker-gone (worker-lust)"]])

    const kept = await collect(
      deps({
        roster,
        sessions: { "reviewer-lust-7": reviewer, "worker-lust": entry({ name: "worker-lust" }) },
      }),
    )
    expect(kept).toEqual([])

    // the py's semantics: a live worker- name that merely starts with the worker's keeps it
    const prefix = await collect(
      deps({
        roster,
        sessions: {
          "reviewer-lust-7": reviewer,
          "worker-lust-2": entry({ name: "worker-lust-2" }),
        },
      }),
    )
    expect(prefix).toEqual([])
  })

  // a checker is known by its roster kind, so a name with no role prefix still is one.
  test("a checker by its roster kind is flagged like one by its name; another kind is not a checker", async () => {
    const roster = {
      "k3v9q2-reviewer": { kind: "reviewer", name: "k3v9q2-reviewer", worker: "x7mh4d-worker" },
    }
    const reviewer = entry({ name: "k3v9q2-reviewer", sessionId: "sess-k3" })
    const gone = await collect(deps({ roster, sessions: { "k3v9q2-reviewer": reviewer } }))
    expect(whys(gone)).toEqual([["checker-worker-gone (x7mh4d-worker)"]])
    const kept = await collect(
      deps({
        roster,
        sessions: {
          "k3v9q2-reviewer": reviewer,
          "x7mh4d-worker": entry({ name: "x7mh4d-worker" }),
        },
      }),
    )
    expect(kept).toEqual([])
    const notChecker = await collect(
      deps({
        roster: { "reviewer-odd": { kind: "worker", name: "reviewer-odd" } },
        sessions: { "reviewer-odd": entry({ name: "reviewer-odd" }) },
      }),
    )
    expect(notChecker).toEqual([])
    // an id name carries no sin, so a checker with no roster link names no worker-reviewer
    const unlinked = await collect(
      deps({ sessions: { "k3v9q2-reviewer": entry({ name: "k3v9q2-reviewer" }) } }),
    )
    expect(unlinked).toEqual([])
  })

  test("checker-pr-done: one merged PR flags, and so do two closed ones", async () => {
    const sessions = {
      "tester-bright-lark": entry({ name: "tester-bright-lark", sessionId: "sess-t" }),
      "worker-bright-lark": entry({ name: "worker-bright-lark" }),
    }
    const merged = await collect(
      deps({
        prState: async () => ({ head: "abc1234", state: "merged", verdicts: [] }),
        sessions,
        workerPrs: async (name) =>
          name.startsWith("tester-") ? ["https://github.com/o/r/pull/1"] : [],
      }),
    )
    expect(whys(merged)).toEqual([["checker-pr-done (merged)"]])

    const closed = await collect(
      deps({
        prState: async () => ({ head: "abc1234", state: "closed", verdicts: [] }),
        sessions,
        workerPrs: async (name) =>
          name.startsWith("tester-")
            ? ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"]
            : [],
      }),
    )
    expect(whys(closed)).toEqual([["checker-pr-done (closed)"]])
  })

  test("checker-nothing: the head scored lists at 30+ quiet minutes, not at 15", async () => {
    const base = {
      prState: async () => ({ head: "abc1234567890", state: "open", verdicts: ["abc1234"] }),
      sessions: {
        "reviewer-held-gate": entry({ name: "reviewer-held-gate", sessionId: "sess-h" }),
        "worker-held-gate": entry({ name: "worker-held-gate" }),
      },
      workerPrs: async () => ["https://github.com/o/r/pull/9"],
    }
    const listed = await collect(deps(base))
    expect(whys(listed)).toEqual([["checker-nothing (head scored)"]])

    const fresh = await collect(
      deps({
        ...base,
        sessions: {
          "reviewer-held-gate": entry({
            name: "reviewer-held-gate",
            sessionId: "sess-h",
            statusUpdatedAt: (NOW - 15 * 60) * 1000,
          }),
          "worker-held-gate": entry({ name: "worker-held-gate" }),
        },
      }),
    )
    expect(fresh).toEqual([])
  })

  test("two PRs, one scored and one unscored, keep the checker off the list (Merritt's case)", async () => {
    const rows = await collect(
      deps({
        prState: async (url) =>
          url.endsWith("/1")
            ? { head: "abc1234567890", state: "open", verdicts: ["abc1234"] }
            : { head: "bbb2222999", state: "open", verdicts: [] },
        sessions: {
          "reviewer-sure-note": entry({ name: "reviewer-sure-note", sessionId: "sess-sn" }),
          "worker-sure-note": entry({ name: "worker-sure-note" }),
        },
        workerPrs: async () => ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
      }),
    )
    expect(rows).toEqual([])
  })

  test("roster-says-<status> fires for paused and ended", async () => {
    for (const status of ["paused", "ended"]) {
      const rows = await collect(
        deps({
          roster: { "worker-tame-hart": { name: "worker-tame-hart", status } },
          sessions: {
            "worker-tame-hart": entry({ name: "worker-tame-hart", sessionId: "sess-w" }),
          },
        }),
      )
      expect(whys(rows)).toEqual([[`roster-says-${status}`]])
    }
  })

  test("a shell session shows +bg, an idle one the blank column, and the total line closes", async () => {
    const flag = (status: string) =>
      collect(
        deps({
          roster: { "reviewer-held-gate": { name: "reviewer-held-gate", status: "ended" } },
          sessions: {
            "reviewer-held-gate": entry({
              name: "reviewer-held-gate",
              sessionId: "sess-h",
              status,
            }),
            "worker-held-gate": entry({ name: "worker-held-gate" }),
          },
        }),
      )
    const shell = await flag("shell")
    expect(shell[0]?.status).toBe("shell")
    expect(formatRow(shell[0], 1)).toBe(
      `${"reviewer-held-gate".padEnd(28)} +bg quiet    45m  $ 0.00/1h  roster-says-ended`,
    )
    expect(formatTotal(shell, 1)).toBe("1 idle with nothing to do; $0.00 over the last 1h")

    const idle = await flag("idle")
    expect(formatRow(idle[0], 1)).toBe(
      `${"reviewer-held-gate".padEnd(28)}     quiet    45m  $ 0.00/1h  roster-says-ended`,
    )
  })

  test("a non-checker session with nothing against it is never listed", async () => {
    const rows = await collect(
      deps({
        sessions: {
          "runner-plain-relay": entry({ name: "runner-plain-relay", sessionId: "sess-r" }),
          "worker-tame-hart": entry({ name: "worker-tame-hart", sessionId: "sess-w" }),
        },
      }),
    )
    expect(rows).toEqual([])
  })
})

// 5j9yqr-reviewer sat on a merged PR with no pr or worker on its roster row, and the detector read only that row.
describe("collect: a session's PRs, from the roster first, then its transcript", () => {
  const MERGED = "https://github.com/o/r/pull/2110"
  const OPEN = "https://github.com/o/r/pull/2111"
  const states: Record<string, PrState> = {
    [MERGED]: {
      head: "abc1234",
      mergeSha: "daaac8e0000",
      ref: "pg-2099-x",
      state: "merged",
      verdicts: [],
    },
    [OPEN]: { head: "bbb2222", ref: "pg-2100-y", state: "open", verdicts: [] },
  }
  const prState = async (url: string) => states[url] ?? null

  test("a checker whose own row holds no pr is done by its worker's roster pr", async () => {
    const rows = await collect(
      deps({
        prState,
        roster: {
          "m4tqzr-reviewer": { kind: "reviewer", name: "m4tqzr-reviewer", worker: "m4tqzr-worker" },
        },
        sessions: {
          "m4tqzr-reviewer": entry({ name: "m4tqzr-reviewer" }),
          "m4tqzr-worker": entry({ name: "m4tqzr-worker", status: "busy" }),
        },
        workerPrs: async (name) => (name === "m4tqzr-worker" ? [MERGED] : []),
      }),
    )
    expect(rows.map((r) => [r.name, r.why, r.sha])).toEqual([
      ["m4tqzr-reviewer", ["checker-pr-done (merged)"], "daaac8e0000"],
    ])
  })

  test("a checker the roster links to nothing is done by the PRs its transcript links", async () => {
    const rows = await collect(
      deps({
        linkedPrs: async (id) => (id === "sess-5j" ? [MERGED] : []),
        prState,
        sessions: {
          "5j9yqr-reviewer": entry({ name: "5j9yqr-reviewer", sessionId: "sess-5j" }),
          "5j9yqr-worker": entry({ name: "5j9yqr-worker" }),
        },
      }),
    )
    expect(whys(rows)).toEqual([["checker-pr-done (merged)"]])
  })

  test("a checker whose transcript links a second, open PR stays off the list", async () => {
    const rows = await collect(
      deps({
        linkedPrs: async () => [MERGED, OPEN],
        prState,
        roster: { "fnhq3x-reviewer": { kind: "reviewer", name: "fnhq3x-reviewer", pr: MERGED } },
        sessions: {
          "fnhq3x-reviewer": entry({ name: "fnhq3x-reviewer", sessionId: "sess-f" }),
          "fnhq3x-worker": entry({ name: "fnhq3x-worker" }),
        },
        workerPrs: async (name) => (name === "fnhq3x-reviewer" ? [MERGED] : []),
      }),
    )
    expect(rows).toEqual([])
  })

  test("worker-prs-done: a worker whose PRs are all merged, never one with an open PR or none", async () => {
    const worker = (prs: string[], pr = MERGED) =>
      collect(
        deps({
          prState,
          roster: { "q6dmtb-worker": { kind: "worker", name: "q6dmtb-worker", pr } },
          sessions: { "q6dmtb-worker": entry({ name: "q6dmtb-worker", sessionId: "sess-q" }) },
          workerPrs: async () => prs,
        }),
      )
    // nyrjqv-worker, 26 Oct: its transcript linked a merged PR while its roster held a new task and no pr
    expect(await worker([MERGED], "")).toEqual([])
    const done = await worker([MERGED])
    expect(done.map((r) => [r.why, r.refs])).toEqual([
      [["worker-prs-done (merged)"], ["pg-2099-x"]],
    ])
    expect(await worker([MERGED, OPEN])).toEqual([])
    expect(await worker([])).toEqual([])
  })
})

describe("spend: a transcript's Claude cost", () => {
  test("an assistant line costs what the repo's price table gives, deduped and unpriced models free", async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, "proj-a", "sess-9", "subagents"), { recursive: true })
    const line = (id: string, model: string) =>
      JSON.stringify({
        message: {
          id,
          model,
          usage: {
            cache_creation: { ephemeral_1h_input_tokens: 100 },
            cache_creation_input_tokens: 400,
            cache_read_input_tokens: 2000,
            input_tokens: 1000,
            output_tokens: 500,
          },
        },
        timestamp: new Date((NOW - 60) * 1000).toISOString(),
        type: "assistant",
      })
    writeFileSync(join(dir, "proj-a", "sess-9.jsonl"), `${line("m1", "claude-opus-5-5")}\n`)
    writeFileSync(
      join(dir, "proj-a", "sess-9", "subagents", "sub.jsonl"),
      `${line("m1", "claude-opus-5-5")}\n${line("m2", "claude-who-knows")}\n`,
    )
    const usd = await spend("sess-9", 1, NOW, dir)
    const priced = costOf("claude-opus-5-5", {
      cacheRead: 2000,
      cacheWrite: 400,
      cacheWrite1h: 100,
      input: 1000,
      output: 500,
    })
    if (priced === null) throw new Error("claude-opus-5-5 left the price table")
    expect(usd).toBe(priced)
    expect(usd).toBeCloseTo(0.0167, 10)
  })
})

describe("prStateLive: the PR cache", () => {
  const URL = "https://github.com/o/r/pull/2110"
  const pull = (state: string, merged = false) => ({
    head: { ref: "pg-2099-x", sha: "abc1234" },
    merge_commit_sha: merged ? "daaac8e0000" : null,
    merged_at: merged ? "2026-10-26T04:00:00Z" : null,
    state,
  })
  const reads = (answers: unknown[]) => {
    const paths: string[] = []
    return {
      api: async (path: string) => (
        paths.push(path),
        path.includes("/comments") ? [] : answers.shift()
      ),
      paths,
    }
  }

  test("a merged PR is read once and kept; a closed one is read again, since go.py reopens it", async () => {
    const cache = join(emptyDir(), "prs.json")
    const merged = reads([pull("closed", true)])
    expect((await prStateLive(URL, 1_000, cache, merged.api))?.state).toBe("merged")
    expect((await prStateLive(URL, 1_000_000, cache, merged.api))?.state).toBe("merged")
    expect(merged.paths).toHaveLength(1)

    const other = "https://github.com/o/r/pull/2111"
    const reopened = reads([pull("closed"), pull("open")])
    expect((await prStateLive(other, 1_000, cache, reopened.api))?.state).toBe("closed")
    expect((await prStateLive(other, 1_000_000, cache, reopened.api))?.state).toBe("open")
  })
})
