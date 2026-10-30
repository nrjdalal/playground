import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SQL } from "bun"

import { backfill, connect } from "../../../../../../api/hono/src/lib/sessions/ingest"
import { projectsDir } from "../../../../../../api/hono/src/lib/sessions/paths"
import {
  type Bucket,
  calibrate,
  forecastOf,
  hourSlots,
  labelOf,
  prCosts,
  readBuckets,
  readPrSessions,
  readSessions,
  readWeek,
  roleOf,
  rootOf,
  rosterLinks,
  type SessionRow,
  summarize,
  usageProblem,
} from "../../../../../../api/hono/src/lib/usage/report"
import { readUsage } from "../../../../../../api/hono/src/lib/usage/window"
import { setSessionNames } from "../../../../../../packages/config/src/kinds"
import { onLiveDashboard } from "../../../../../dashboard-fixture"
import { liveReads } from "../../../../../live-reads"
import { SEEDED_NAMES } from "../../../../../session-names"

// workers.ts sets the names its data folder holds when it loads; the cases name the managers' old names, as a machine past the switch does.
setSessionNames(SEEDED_NAMES)

// The reads below run against the test's own scratch transcripts, as a live-reads stack opted in to every session would (own.ts).
liveReads({ PLAYGROUND_CMUX_SESSIONS: "true" })

const NOW = new Date("2026-10-06T12:30:00Z")
const MIN = 60_000

const session = (id: string, fields: Partial<SessionRow> = {}): SessionRow => ({
  agentType: null,
  costUsd: null,
  gitBranch: null,
  id,
  kind: "interactive",
  name: null,
  parentId: null,
  prUrls: [],
  startedAt: null,
  task: null,
  ...fields,
})

// A bucket of `calls` Opus 5.5 calls, each a million cache-read tokens ($0.20).
const bucket = (sessionId: string, at: number, calls = 1, model = "claude-opus-5-5"): Bucket => ({
  at,
  cacheRead: calls * 1e6,
  cacheWrite: 0,
  cacheWrite1h: 0,
  calls,
  input: 0,
  model,
  output: 0,
  sessionId,
})

const mapOf = (...rows: SessionRow[]) => new Map(rows.map((row) => [row.id, row]))

describe("roleOf and labelOf", () => {
  test("read the factory's names first, then the kind", () => {
    expect(roleOf({ kind: "interactive", name: "dispatcher" })).toBe("dispatcher")
    expect(roleOf({ kind: "interactive", name: "ops" })).toBe("lead")
    expect(roleOf({ kind: "interactive", name: "planner" })).toBe("lead")
    expect(roleOf({ kind: "interactive", name: "worker-wrath" })).toBe("worker")
    expect(roleOf({ kind: "interactive", name: "reviewer-wrath" })).toBe("reviewer")
    expect(roleOf({ kind: "interactive", name: "tester-wrath" })).toBe("tester")
    expect(roleOf({ kind: "interactive", name: "k3m9px-worker" })).toBe("worker")
    expect(roleOf({ kind: "interactive", name: "k3m9px-reviewer" })).toBe("reviewer")
    expect(roleOf({ kind: "interactive", name: "k3m9px-builder" })).toBe("lead")
    expect(roleOf({ kind: "subagent", name: null })).toBe("subagent")
    expect(roleOf({ kind: null, name: "merritt" })).toBe("other")
  })

  // the roster's kind places a session first, so a name with no role in it still has one.
  test("read the roster's kind before the name", () => {
    const { kinds } = rosterLinks({
      agents: [
        { kind: "reviewer", name: "k3v9q2-reviewer", role: "worker", status: "working", task: "t" },
        { kind: "builder", name: "x7mh4d-builder", role: "manager", status: "working", task: "t" },
        { kind: "dispatcher", name: "dispatcher-2", role: "manager", status: "working", task: "t" },
        { kind: "researcher", name: "worker-envy", role: "worker", status: "working", task: "t" },
      ],
      backlog: [],
      updatedAt: "2026-10-06T12:00:00Z",
    })
    expect(roleOf({ kind: "interactive", name: "k3v9q2-reviewer" }, kinds)).toBe("reviewer")
    expect(roleOf({ kind: "interactive", name: "x7mh4d-builder" }, kinds)).toBe("lead")
    expect(roleOf({ kind: "interactive", name: "dispatcher-2" }, kinds)).toBe("dispatcher")
    expect(roleOf({ kind: "interactive", name: "worker-envy" }, kinds)).toBe("worker")
    expect(roleOf({ kind: "interactive", name: "k3v9q2-reviewer" })).toBe("reviewer")
  })

  test("name a session by its name, type, command, else id", () => {
    expect(labelOf(session("abcdef123", { name: "builder" }))).toBe("builder")
    expect(labelOf(session("abcdef123", { agentType: "Explore" }))).toBe("Explore")
    expect(labelOf(session("abcdef123", { task: "/linear now" }))).toBe("/linear")
    expect(labelOf(session("abcdef123", { task: "do it" }))).toBe("id:abcdef12")
  })
})

describe("rootOf", () => {
  test("climbs to the top parent and stops at a loop or a missing one", () => {
    const sessions = mapOf(
      session("a"),
      session("b", { parentId: "a" }),
      session("c", { parentId: "b" }),
      session("x", { parentId: "y" }),
      session("y", { parentId: "x" }),
      session("z", { parentId: "gone" }),
    )
    expect(rootOf("c", sessions)).toBe("a")
    expect(["x", "y"]).toContain(rootOf("x", sessions))
    expect(rootOf("z", sessions)).toBe("z")
  })
})

describe("forecastOf", () => {
  test("projects the burn so far to when the window runs out", () => {
    // Opened at 10:00, 2.5 hours ago, 50% used: 20% an hour, so the rest lasts 2.5 hours, after the 15:00 reset.
    const forecast = forecastOf({ resetsAt: "2026-10-06T15:00:00Z", usedPercent: 50 }, 5, NOW)
    expect(forecast?.perHour).toBeCloseTo(20)
    expect(forecast?.runsOutAt).toBe("2026-10-06T15:00:00.000Z")
    expect(forecast?.beforeReset).toBe(false)
  })

  test("says when it runs out before the reset", () => {
    const forecast = forecastOf({ resetsAt: "2026-10-06T15:00:00Z", usedPercent: 80 }, 5, NOW)
    expect(forecast?.runsOutAt).toBe("2026-10-06T13:07:30.000Z")
    expect(forecast?.beforeReset).toBe(true)
  })

  test("has no burn with nothing used, and no forecast with no reset", () => {
    expect(forecastOf({ resetsAt: "2026-10-06T15:00:00Z", usedPercent: 0 }, 5, NOW)).toEqual({
      beforeReset: false,
      perHour: 0,
      runsOutAt: null,
    })
    expect(forecastOf({ resetsAt: null, usedPercent: 10 }, 5, NOW)).toBeNull()
  })
})

describe("hourSlots", () => {
  test("gives 24 hours ending with the one now is in", () => {
    const slots = hourSlots(NOW)
    expect(slots).toHaveLength(24)
    expect(slots[23]).toBeLessThanOrEqual(NOW.getTime())
    expect(NOW.getTime() - (slots[23] ?? 0)).toBeLessThan(60 * MIN)
    expect((slots[23] ?? 0) - (slots[0] ?? 0)).toBe(23 * 60 * MIN)
  })
})

describe("summarize", () => {
  const sessions = mapOf(
    session("main", { name: "worker-greed" }),
    session("sub", { kind: "subagent", parentId: "main", agentType: "Explore" }),
    session("lead", { name: "builder" }),
  )
  const buckets = [
    bucket("main", NOW.getTime() - 10 * MIN, 2),
    bucket("sub", NOW.getTime() - 20 * MIN, 1, "claude-haiku-4-5-20251001"),
    bucket("lead", NOW.getTime() - 3 * 24 * 60 * MIN, 5),
    bucket("lead", NOW.getTime() - 5 * MIN, 1, "claude-mystery-9"),
  ]
  const report = summarize(buckets, sessions, NOW)

  test("rolls a subagent into its agent and splits today from the week", () => {
    const greed = report.agents.find((a) => a.label === "worker-greed")
    expect(greed?.week.calls).toBe(3)
    expect(greed?.week.usd).toBeCloseTo(0.2 * 2 + 0.1)
    const kid = report.agents.find((a) => a.label === "builder")
    expect(kid?.week.calls).toBe(6)
    expect(kid?.today.calls).toBe(1)
    expect(report.agents[0]?.label).toBe("builder")
  })

  test("gives an agent one row however many sessions bore its name this week", () => {
    const restarted = summarize(
      [bucket("pg-1", NOW.getTime() - 3 * 24 * 60 * MIN, 2), bucket("pg-2", NOW.getTime(), 1)],
      mapOf(session("pg-1", { name: "dispatcher" }), session("pg-2", { name: "dispatcher" })),
      NOW,
    )
    expect(restarted.agents).toHaveLength(1)
    expect(restarted.agents[0]).toMatchObject({ label: "dispatcher", role: "dispatcher" })
    expect(restarted.agents[0]?.week.calls).toBe(3)
    expect(restarted.agents[0]?.today.calls).toBe(1)
    expect(restarted.sessions).toHaveLength(2)
  })

  test("keeps the 20 costliest sessions of the week and of today, so Today shows its own top", () => {
    const old = Array.from({ length: 21 }, (_, i) => `old-${i}`)
    const busy = summarize(
      [
        ...old.map((id) => bucket(id, NOW.getTime() - 3 * 24 * 60 * MIN, 10)),
        bucket("fresh", NOW.getTime(), 1),
      ],
      mapOf(...old.map((id) => session(id)), session("fresh")),
      NOW,
    )
    expect(busy.sessions.some((s) => s.id === "fresh")).toBe(true)
    expect(busy.sessions).toHaveLength(21)
  })

  test("keeps each session, with its parent's label", () => {
    const sub = report.sessions.find((s) => s.id === "sub")
    expect(sub?.label).toBe("Explore")
    expect(sub?.parent).toBe("worker-greed")
    expect(sub?.role).toBe("subagent")
  })

  test("sums models by their key, and names an unpriced one", () => {
    expect(report.models.map((m) => m.model)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-4-5",
      "claude-mystery-9",
    ])
    expect(report.models.find((m) => m.model === "claude-mystery-9")?.priced).toBe(false)
    expect(report.problems).toEqual([
      "No price for claude-mystery-9: its 1,000,000 tokens count as $0",
    ])
  })

  test("puts the last day's calls in its hours", () => {
    const tokens = report.hours.reduce((sum, h) => sum + h.tokens, 0)
    expect(tokens).toBe(4e6)
    expect(report.totals.week.tokens).toBe(9e6)
  })
})

describe("calibrate", () => {
  test("sets this table's dollars beside Claude Code's for exited sessions started this week", () => {
    const start = NOW.getTime() - 60 * MIN
    const sessions = mapOf(
      session("done", { costUsd: 0.5, startedAt: start }),
      session("done-sub", { kind: "subagent", parentId: "done" }),
      session("running", { startedAt: start }),
      session("old", { costUsd: 9, startedAt: start - 8 * 24 * 60 * MIN }),
    )
    const result = calibrate(
      [bucket("done", start), bucket("done-sub", start), bucket("running", start)],
      sessions,
      NOW.getTime() - 7 * 24 * 60 * MIN,
    )
    expect(result?.sessions).toBe(1)
    expect(result?.claudeCodeUsd).toBe(0.5)
    expect(result?.usd).toBeCloseTo(0.4)
  })

  test("is null with no exited session", () => {
    expect(calibrate([], mapOf(session("a")), 0)).toBeNull()
  })
})

describe("prCosts", () => {
  const t = (hhmm: string) => Date.parse(`2026-10-06T${hhmm}:00Z`)
  const sessions = mapOf(
    session("w1", {
      name: "worker-greed",
      prUrls: ["https://github.com/o/r/pull/1"],
      startedAt: t("10:00"),
    }),
    session("w1-sub", { kind: "subagent", parentId: "w1" }),
    session("w2", { gitBranch: "feat/b", name: "worker-lust", startedAt: t("10:30") }),
    session("r", { name: "reviewer-greed" }),
    session("r-sub", { kind: "subagent", parentId: "r" }),
    session("tst", { name: "tester-greed" }),
    session("r2", { name: "reviewer-lust" }),
  )
  const merged = (number: number, headRefName: string, mergedAt: string) => ({
    createdAt: "2026-10-06T10:00:00Z",
    fixes: [],
    headRefName,
    mergedAt,
    number,
    repo: "o/r",
    rounds: 2,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
  })
  const buckets = [
    bucket("w1", t("10:15"), 4),
    bucket("w1-sub", t("10:30"), 1),
    bucket("r", t("10:45"), 2),
    bucket("r-sub", t("10:45"), 1),
    bucket("r", t("12:00"), 7),
    bucket("tst", t("10:45"), 1),
    bucket("w2", t("11:00"), 3),
    bucket("r2", t("11:15"), 2),
  ]
  const rows = prCosts(
    [
      merged(1, "feat/a", "2026-10-06T11:00:00Z"),
      merged(2, "feat/b", "2026-10-06T11:30:00Z"),
      merged(3, "feat/c", "2026-10-06T11:40:00Z"),
    ],
    buckets,
    sessions,
  )

  test("finds each PR's worker by its URL or its branch, and drops a PR with none", () => {
    expect(rows.map((r) => [r.number, r.worker])).toEqual([
      [2, "worker-lust"],
      [1, "worker-greed"],
    ])
  })

  test("adds the worker's subagents and its sin's reviewer and tester while it was open", () => {
    const one = rows.find((r) => r.number === 1)
    expect(one?.workerSpend.calls).toBe(5)
    expect(one?.review.calls).toBe(3)
    expect(one?.test.calls).toBe(1)
    expect(one?.total.calls).toBe(9)
    expect(one?.total.usd).toBeCloseTo(9 * 0.2)
    expect(one?.wallMinutes).toBe(60)
    expect(one?.rounds).toBe(2)
  })

  test("charges another sin's reviewer to that sin's PR", () => {
    const two = rows.find((r) => r.number === 2)
    expect(two?.review.calls).toBe(2)
    expect(two?.workerSpend.calls).toBe(3)
  })

  // a reviewer named for no worker is that worker's by the roster's worker link.
  test("links a checker to its worker by the roster, whatever either is named", () => {
    const links = rosterLinks({
      agents: [
        { kind: "worker", name: "x7mh4d-worker", role: "worker", status: "working", task: "t" },
        {
          kind: "reviewer",
          name: "k3v9q2-reviewer",
          role: "worker",
          status: "working",
          task: "t",
          worker: "x7mh4d-worker",
        },
      ],
      backlog: [],
      updatedAt: "2026-10-06T12:00:00Z",
    })
    const kinded = prCosts(
      [merged(6, "feat/f", "2026-10-06T11:00:00Z")],
      [bucket("wk", t("10:15"), 2), bucket("rk", t("10:30"), 3), bucket("r", t("10:45"), 5)],
      mapOf(
        session("wk", {
          name: "x7mh4d-worker",
          prUrls: ["https://github.com/o/r/pull/6"],
          startedAt: t("10:00"),
        }),
        session("rk", { name: "k3v9q2-reviewer" }),
        session("r", { name: "reviewer-greed" }),
      ),
      links,
    )
    expect(kinded.map((r) => [r.worker, r.workerSpend.calls, r.review.calls])).toEqual([
      ["x7mh4d-worker", 2, 3],
    ])
  })

  test("times a worker's later PR from its previous merge, and gives its reviewer to that PR alone", () => {
    const pride = prCosts(
      [merged(4, "feat/d", "2026-10-06T11:00:00Z"), merged(5, "feat/e", "2026-10-06T12:00:00Z")],
      [bucket("rp", t("10:30"), 2), bucket("rp", t("11:30"), 4)],
      mapOf(
        session("wp", {
          name: "worker-pride",
          prUrls: ["https://github.com/o/r/pull/4", "https://github.com/o/r/pull/5"],
          startedAt: t("10:00"),
        }),
        session("rp", { name: "reviewer-pride" }),
      ),
    )
    expect(pride.map((r) => [r.number, r.wallMinutes, r.review.calls])).toEqual([
      [5, 60, 4],
      [4, 60, 2],
    ])
  })

  test("gives a slot that spans a worker's merge to the earlier PR alone, and splits Build by span", () => {
    const pride = prCosts(
      [merged(4, "feat/d", "2026-10-06T11:05:00Z"), merged(5, "feat/e", "2026-10-06T12:00:00Z")],
      [
        bucket("wp", t("10:15"), 3),
        bucket("wp", t("11:30"), 1),
        bucket("wp", t("12:30"), 2),
        bucket("rp", t("11:00"), 5),
      ],
      mapOf(
        session("wp", {
          name: "worker-pride",
          prUrls: ["https://github.com/o/r/pull/4", "https://github.com/o/r/pull/5"],
          startedAt: t("10:00"),
        }),
        session("rp", { name: "reviewer-pride" }),
      ),
    )
    expect(pride.map((r) => [r.number, r.workerSpend.calls, r.review.calls])).toEqual([
      [5, 3, 0],
      [4, 3, 5],
    ])
  })
})

describe("usageProblem (#1534)", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
  })
  // The banner's line for a usage.json holding `text`, or for none at all, read as usageReport reads it.
  const lineFor = async (text?: string, mode?: number) => {
    const dir = mkdtempSync(join(tmpdir(), "usage-banner-"))
    dirs.push(dir)
    const path = join(dir, "usage.json")
    if (text !== undefined) writeFileSync(path, text)
    if (mode !== undefined) chmodSync(path, mode)
    return usageProblem(await readUsage(path, NOW), path)
  }
  const written = (writtenAt: string, limits: Record<string, unknown>) =>
    JSON.stringify({ rate_limits: limits, writtenAt })

  test("no file: the ops-usage job has not written it", async () => {
    expect(await lineFor()).toBe("No usage windows: the ops-usage job has not written usage.json")
  })

  test("a file with neither window says so, with its write time when it holds one", async () => {
    expect(await lineFor(written("2026-10-06T12:25:00Z", {}))).toBe(
      "No usage windows: usage.json holds none, last written 2026-10-06T12:25:00.000Z",
    )
    expect(await lineFor(JSON.stringify({ rate_limits: {} }))).toBe(
      "No usage windows: usage.json holds none",
    )
    expect(await lineFor(written("yesterday", {}))).toBe("No usage windows: usage.json holds none")
  })

  const unreadable = "No usage windows: usage.json is there but cannot be read"

  test.skipIf(process.getuid?.() === 0)("a file that cannot be opened cannot be read", async () => {
    expect(await lineFor(written("2026-10-06T12:25:00Z", {}), 0o000)).toBe(unreadable)
  })

  test("a file that is not JSON, or holds windows with no time it was written, cannot be read", async () => {
    expect(await lineFor("{")).toBe(unreadable)
    expect(
      await lineFor(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1 } } })),
    ).toBe(unreadable)
  })

  test("a fresh file has no line, and a stale one names its write time", async () => {
    const window = { five_hour: { used_percentage: 1 } }
    expect(await lineFor(written("2026-10-06T12:25:00Z", window))).toBeNull()
    expect(await lineFor(written("2026-10-06T12:00:00Z", window))).toBe(
      "The usage windows are stale: last written 2026-10-06T12:00:00.000Z",
    )
  })
})

// The report's reads against what the importer wrote, in a throwaway Postgres in Docker published on 127.0.0.1 only, with the repo's migrations applied; skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../../packages/db/drizzle")
const PASSWORD = "usage-test"
const PROJECT = "-Users-me-repo"
const LEAD = "11111111-aaaa-4aaa-8aaa-111111111111"
const WORKER = "22222222-bbbb-4bbb-8bbb-222222222222"
const REVIEWER = "33333333-cccc-4ccc-8ccc-333333333333"
const AGENT = "a0b1c2d3e4f5a6b7c"
const SINCE = Date.parse("2026-10-06T00:00:00Z")
// dispatcher's and worker-sloth's sessions in the shipped fixture.
const FIXTURE_LEAD = "11111111-1111-4111-8111-000000000001"
const FIXTURE_SLOTH = "11111111-1111-4111-8111-000000000006"

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

let clock = 0
const line = (session: string, fields: Record<string, unknown>) => {
  clock += 1
  return `${JSON.stringify({
    cwd: "/Users/me/repo",
    entrypoint: "cli",
    sessionId: session,
    timestamp: new Date(Date.UTC(2026, 9, 6, 10, 0, clock)).toISOString(),
    ...fields,
  })}\n`
}

// One assistant line of message `id`: Claude Code writes a line per content block, each repeating the input and cache counts while output grows.
const call = (
  session: string,
  uuid: string,
  id: string,
  model: string,
  usage: Record<string, unknown>,
  fields: Record<string, unknown> = {},
) =>
  line(session, {
    message: { content: [{ text: uuid, type: "text" }], id, model, usage },
    type: "assistant",
    uuid,
    ...fields,
  })

describe.skipIf(!dockerUp())("the report's reads", () => {
  let container = ""
  let home = ""
  let db: ReturnType<typeof connect>
  let url = ""

  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`
    let admin: SQL | null = null
    for (let i = 0; i < 60; i++) {
      try {
        admin = new SQL(url, { max: 1 })
        await admin`select 1`
        break
      } catch {
        await Bun.sleep(500)
      }
    }
    const journal = await Bun.file(join(MIGRATIONS, "meta/_journal.json")).json()
    for (const { tag } of journal.entries as { tag: string }[]) {
      const migration = await Bun.file(join(MIGRATIONS, `${tag}.sql`)).text()
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await admin!.unsafe(statement)
      }
    }
    home = mkdtempSync(join(tmpdir(), "usage-report-"))
    const projects = join(home, "projects")
    mkdirSync(join(projects, PROJECT, WORKER, "subagents"), { recursive: true })
    writeFileSync(
      join(projects, PROJECT, `${LEAD}.jsonl`),
      line(LEAD, { agentName: "dispatcher", type: "agent-name" }) +
        call(
          LEAD,
          "l1",
          "m-old",
          "claude-opus-5-5",
          { input_tokens: 5, output_tokens: 5 },
          {
            timestamp: "2026-09-20T10:00:00.000Z",
          },
        ),
    )
    const usage = {
      cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 300 },
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 1000,
      input_tokens: 100,
    }
    writeFileSync(
      join(projects, PROJECT, `${WORKER}.jsonl`),
      line(WORKER, { agentName: "worker-wrath", gitBranch: "feat/usage", type: "agent-name" }) +
        call(WORKER, "w1", "m-1", "claude-opus-5-5", { ...usage, output_tokens: 10 }) +
        call(WORKER, "w2", "m-1", "claude-opus-5-5", { ...usage, output_tokens: 50 }) +
        call(WORKER, "w3", "m-2", "claude-opus-5-5", { input_tokens: 7, output_tokens: 3 }) +
        line(WORKER, { prUrl: "https://github.com/o/r/pull/7", type: "pr-link" }),
    )
    writeFileSync(
      join(projects, PROJECT, WORKER, "subagents", `agent-${AGENT}.jsonl`),
      line(WORKER, { message: { content: "Find it" }, type: "user", uuid: "s1" }) +
        call(WORKER, "s2", "m-s", "claude-haiku-4-5-20251001", {
          input_tokens: 20,
          output_tokens: 2,
        }),
    )
    writeFileSync(
      join(projects, PROJECT, WORKER, "subagents", `agent-${AGENT}.meta.json`),
      JSON.stringify({ agentType: "Explore", description: "Find it" }),
    )
    writeFileSync(
      join(projects, PROJECT, `${REVIEWER}.jsonl`),
      line(REVIEWER, { agentName: "reviewer-wrath", type: "agent-name" }) +
        call(REVIEWER, "r1", "m-r", "claude-sonnet-5-5", { input_tokens: 30, output_tokens: 4 }),
    )
    db = connect(url)
    await backfill(db, projects)
  }, 60_000)

  // docker rm -fv of a container on a loaded machine can cross bun's 5s default, the recorded hook timeout
  afterAll(() => {
    if (container) {
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
    }
    if (home) rmSync(home, { force: true, recursive: true })
  }, 60_000)

  test("readBuckets counts each message once, from its last line, with its hour-long cache writes", async () => {
    const buckets = await readBuckets(db, SINCE)
    const worker = buckets.filter((b) => b.sessionId === WORKER)
    expect(worker.reduce((sum, b) => sum + b.calls, 0)).toBe(2)
    expect(worker.reduce((sum, b) => sum + b.output, 0)).toBe(53)
    expect(worker.reduce((sum, b) => sum + b.input, 0)).toBe(107)
    expect(worker.reduce((sum, b) => sum + b.cacheWrite, 0)).toBe(400)
    expect(worker.reduce((sum, b) => sum + b.cacheWrite1h, 0)).toBe(100)
    expect(worker.reduce((sum, b) => sum + b.cacheRead, 0)).toBe(1000)
    expect(buckets.find((b) => b.sessionId === AGENT)?.model).toBe("claude-haiku-4-5-20251001")
    expect(buckets.some((b) => b.sessionId === LEAD)).toBe(false)
  })

  test("readBuckets reads hour-long cache writes from a line stored as one JSON string, as the importer once wrote it, as from an object", async () => {
    const admin = new SQL(url, { max: 1 })
    try {
      await admin`update claude_entry set raw = to_jsonb(raw::text) where session_id = ${WORKER} and uuid = 'w2'`
      const types =
        await admin`select uuid, jsonb_typeof(raw) as type from claude_entry where session_id = ${WORKER} and uuid in ('w1', 'w2') order by uuid`
      expect(types.map((r: { type: string; uuid: string }) => [r.uuid, r.type])).toEqual([
        ["w1", "object"],
        ["w2", "string"],
      ])
      const worker = (await readBuckets(db, SINCE)).filter((b) => b.sessionId === WORKER)
      expect(worker.reduce((sum, b) => sum + b.cacheWrite1h, 0)).toBe(100)
    } finally {
      await admin`update claude_entry set raw = (raw #>> '{}')::jsonb where session_id = ${WORKER} and jsonb_typeof(raw) = 'string'`
      await admin.close()
    }
  })

  test("readBuckets narrows to the sessions named, and to none for an empty list", async () => {
    const buckets = await readBuckets(db, SINCE, [REVIEWER, AGENT])
    expect(new Set(buckets.map((b) => b.sessionId))).toEqual(new Set([REVIEWER, AGENT]))
    expect(await readBuckets(db, SINCE, [])).toEqual([])
  })

  test("readSessions reads the sessions named and climbs to their parents", async () => {
    const sessions = await readSessions(db, [AGENT])
    expect(sessions.get(AGENT)).toMatchObject({ agentType: "Explore", parentId: WORKER })
    expect(sessions.get(WORKER)).toMatchObject({
      gitBranch: "feat/usage",
      name: "worker-wrath",
      prUrls: ["https://github.com/o/r/pull/7"],
    })
    expect(sessions.size).toBe(2)
  })

  test("readPrSessions takes this week's workers, reviewers and testers with every session under them", async () => {
    const sessions = await readPrSessions(db, SINCE)
    expect(new Set(sessions.keys())).toEqual(new Set([WORKER, AGENT, REVIEWER]))
  })

  test("readPrSessions also takes the names the roster gives a worker, reviewer or tester kind", async () => {
    const admin = new SQL(url, { max: 1 })
    try {
      await admin`update claude_session set name = 'k3v9q2-reviewer' where id = ${REVIEWER}`
      expect((await readPrSessions(db, SINCE)).has(REVIEWER)).toBe(false)
      expect((await readPrSessions(db, SINCE, ["k3v9q2-reviewer"])).has(REVIEWER)).toBe(true)
    } finally {
      await admin`update claude_session set name = 'reviewer-wrath' where id = ${REVIEWER}`
      await admin.close()
    }
  })

  test("readWeek reads the week's calls, their sessions and the PR sessions' own calls", async () => {
    const week = await readWeek(db, Date.parse("2026-10-07T00:00:00Z"))
    expect(new Set(week.buckets.map((b) => b.sessionId))).toEqual(
      new Set([WORKER, AGENT, REVIEWER]),
    )
    expect(new Set(week.sessions.keys())).toEqual(new Set([WORKER, AGENT, REVIEWER]))
    expect(new Set(week.prSessions.keys())).toEqual(new Set([WORKER, AGENT, REVIEWER]))
    expect(new Set(week.prBuckets.map((b) => b.sessionId))).toEqual(
      new Set([WORKER, AGENT, REVIEWER]),
    )
  })

  // Last in this block: it adds the fixture's sessions to the database.
  test.skipIf(onLiveDashboard())(
    "on a fixture stack every read keeps to the fixture's own sessions, never rows a live config folder left in its database",
    async () => {
      const before = {
        dir: process.env.PLAYGROUND_FIXTURE_DIR,
        live: process.env.PLAYGROUND_LIVE_READS,
      }
      delete process.env.PLAYGROUND_LIVE_READS
      process.env.PLAYGROUND_FIXTURE_DIR = join(home, "fixture")
      try {
        await backfill(db, projectsDir())
        const ours = (id: string) => id.startsWith("11111111-1111-") || id === "fixture0001"
        const buckets = await readBuckets(db, 0)
        expect(buckets.map((b) => b.sessionId)).toContain(FIXTURE_LEAD)
        expect(buckets.filter((b) => !ours(b.sessionId))).toEqual([])
        expect(await readBuckets(db, 0, [WORKER, REVIEWER, AGENT])).toEqual([])
        expect([...(await readSessions(db, [WORKER, AGENT, FIXTURE_LEAD])).keys()]).toEqual([
          FIXTURE_LEAD,
        ])
        const prSessions = [...(await readPrSessions(db, 0)).keys()]
        expect(prSessions).toContain(FIXTURE_SLOTH)
        expect(prSessions.filter((id) => !ours(id))).toEqual([])
        const week = await readWeek(db, Date.now())
        const ids = [
          ...week.buckets.map((b) => b.sessionId),
          ...week.sessions.keys(),
          ...week.prSessions.keys(),
          ...week.prBuckets.map((b) => b.sessionId),
        ]
        expect(ids).toContain(FIXTURE_SLOTH)
        expect(ids.filter((id) => !ours(id))).toEqual([])
      } finally {
        if (before.dir === undefined) delete process.env.PLAYGROUND_FIXTURE_DIR
        else process.env.PLAYGROUND_FIXTURE_DIR = before.dir
        if (before.live === undefined) delete process.env.PLAYGROUND_LIVE_READS
        else process.env.PLAYGROUND_LIVE_READS = before.live
      }
    },
  )
})
