import { describe, expect, test } from "bun:test"

import {
  dropBlocked,
  filterMetrics,
  transcriptSums,
} from "../../../../../packages/scripts/src/loom-relay/filter"
import { exportBody, LOGIN, point, s, sum } from "./export-body"

// Loom learns one login, the owner's account, and every usage goes under it; no transcript, summary or other text reaches Loom, only usage.

// Every key and every string value in a body, so a test can hold both to a list.
const walk = (v: unknown, keys = new Set<string>(), strings = new Set<string>()) => {
  if (typeof v === "string") strings.add(v)
  else if (Array.isArray(v)) for (const x of v) walk(x, keys, strings)
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      keys.add(k)
      walk(x, keys, strings)
    }
  return { keys, strings }
}

const OTHER = [
  s("user.email", "other@example.com"),
  s("user.account_uuid", "other-acct"),
  s("organization.id", "other-org"),
]
const LEAKS = [
  s("prompt", "secret prompt text"),
  s("summary", "secret summary text"),
  s("cwd", "/Users/secret/repo"),
  s("tool_name", "secret-tool"),
  s("session.id", "secret-session"),
  s("host.name", "secret-host"),
]
const exportOf = (resource: ReturnType<typeof s>[], ...points: ReturnType<typeof point>[]) => ({
  resourceMetrics: [
    {
      resource: { attributes: resource },
      scopeMetrics: [{ metrics: [sum("claude_code.token.usage", ...points)] }],
    },
  ],
})
const tokens = (n: number, ...a: ReturnType<typeof s>[]) =>
  point(n, ...a, s("model", "claude-opus-5-5"), s("type", "input"))
const firstPoint = (body: ReturnType<typeof filterMetrics>) =>
  body?.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.sum.dataPoints[0]
const SENT_ATTRIBUTES = [s("user.email", LOGIN), s("model", "claude-opus-5-5"), s("type", "input")]

describe("filterMetrics", () => {
  const out = filterMetrics(exportBody, LOGIN)

  test("keeps token usage, cost and session count with the model, under the login", () => {
    const metrics = out?.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []
    expect(metrics.map((m) => m.name)).toEqual([
      "claude_code.cost.usage",
      "claude_code.token.usage",
      "claude_code.session.count",
    ])
    expect(metrics[0]?.sum.dataPoints[0]?.asDouble).toBe(0.42)
    expect(metrics[0]?.sum.aggregationTemporality).toBe(1)
    expect(metrics[0]?.sum.dataPoints[0]?.attributes).toEqual([
      s("user.email", LOGIN),
      s("model", "claude-opus-5-5"),
    ])
    expect(out?.resourceMetrics[0]?.resource.attributes).toEqual([s("user.email", LOGIN)])
  })

  test("builds the body from the allowlist alone: its keys are exactly the list", () => {
    expect([...walk(out).keys].sort()).toEqual([
      "aggregationTemporality",
      "asDouble",
      "attributes",
      "dataPoints",
      "isMonotonic",
      "key",
      "metrics",
      "name",
      "resource",
      "resourceMetrics",
      "scopeMetrics",
      "startTimeUnixNano",
      "stringValue",
      "sum",
      "timeUnixNano",
      "value",
    ])
  })

  test("sends no text: its only strings are the login, the model, the time and fixed names", () => {
    const fixed = [
      "claude_code.cost.usage",
      "claude_code.session.count",
      "claude_code.token.usage",
      "input",
      "model",
      "type",
      "user.email",
    ]
    for (const v of walk(out).strings)
      expect(v === LOGIN || v === "claude-opus-5-5" || /^\d+$/.test(v) || fixed.includes(v)).toBe(
        true,
      )
  })

  test("drops a prompt, a summary, a path, a tool name and every other name", () => {
    const text = JSON.stringify(filterMetrics(exportOf([...LEAKS], tokens(1, ...LEAKS)), LOGIN))
    expect(text).not.toContain("secret")
    expect(JSON.stringify(out)).not.toContain("secret")
  })

  test("sends another login's usage under the login, with none of that account's identity", () => {
    const other = filterMetrics(exportOf([...OTHER], tokens(5, ...OTHER)), LOGIN)
    expect(firstPoint(other)).toMatchObject({ asDouble: 5, attributes: SENT_ATTRIBUTES })
    for (const word of ["other@example.com", "other-acct", "other-org"])
      expect(JSON.stringify(other)).not.toContain(word)
    for (const word of ["acct-1", "org-1"]) expect(JSON.stringify(out)).not.toContain(word)
  })

  test("keeps usage with no login, under the login", () => {
    expect(firstPoint(filterMetrics(exportOf([], tokens(3)), LOGIN))?.attributes).toEqual(
      SENT_ATTRIBUTES,
    )
  })

  test("two logins' usage in one export all goes out under the login, adding up to their sum", () => {
    const both = filterMetrics(
      {
        resourceMetrics: [
          ...exportOf([...OTHER], tokens(5)).resourceMetrics,
          ...exportOf([s("user.email", LOGIN)], tokens(7)).resourceMetrics,
        ],
      },
      LOGIN,
    )
    const points = both?.resourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics.flatMap((m) => m.sum.dataPoints)),
    )
    expect(points?.reduce((n, p) => n + (p.asDouble ?? 0), 0)).toBe(12)
    expect(points?.every((p) => p.attributes[0]?.value.stringValue === LOGIN)).toBe(true)
    expect(JSON.stringify(both)).not.toContain("other@example.com")
  })

  test("drops a point whose model is not a Claude model id, another backend's use or a stray string", () => {
    for (const model of [
      "a sentence about a secret",
      "/Users/x/private-repo",
      "x@example.com",
      "my-secret-skill",
      "claude-opus-5-5@x@example.com",
      "glm-5.3",
      "glm-5.3[1m]",
      "glm-5.3-flash",
      "glm-5.3-flash[1m]",
    ])
      expect(filterMetrics(exportOf([], point(1, s("model", model))), LOGIN)).toBeNull()
  })

  test("keeps a point with no model, and drops a token type that is not a token class", () => {
    expect(firstPoint(filterMetrics(exportOf([], point(1)), LOGIN))?.attributes).toEqual([
      s("user.email", LOGIN),
    ])
    const odd = filterMetrics(
      exportOf([], point(1, s("model", "claude-opus-5-5"), s("type", "secret-type"))),
      LOGIN,
    )
    expect(firstPoint(odd)?.attributes).toEqual([
      s("user.email", LOGIN),
      s("model", "claude-opus-5-5"),
    ])
  })

  test("keeps every shape of Claude model id Claude Code sends", () => {
    for (const model of [
      "claude-opus-5-5",
      "claude-opus-5-5[1m]",
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-1@20250805",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "claude-opus-5-5[1M]",
      "claude-haiku-4-5",
    ])
      expect(
        firstPoint(filterMetrics(exportOf([], point(1, s("model", model))), LOGIN))?.attributes,
      ).toEqual([s("user.email", LOGIN), s("model", model)])
  })

  test("leaves nothing to send when no allowed metric is in the export", () => {
    expect(
      filterMetrics(
        {
          resourceMetrics: [
            { scopeMetrics: [{ metrics: [sum("claude_code.future.metric", point(1))] }] },
          ],
        },
        LOGIN,
      ),
    ).toBeNull()
    expect(filterMetrics("not an export", LOGIN)).toBeNull()
  })
})

describe("transcriptSums", () => {
  const row = {
    accountEmail: LOGIN,
    assistantTurns: 4,
    cacheCreationTokens: 3,
    cacheReadTokens: 5,
    day: "2026-10-12",
    inputTokens: 1,
    machineId: "a1b2c3d4e5f6",
    model: "claude-opus-5-5",
    outputTokens: 2,
    seatDir: ".claude",
    sessions: 1,
  }
  const sent = {
    accountEmail: LOGIN,
    assistantTurns: 4,
    cacheCreationTokens: 3,
    cacheReadTokens: 5,
    day: "2026-10-12",
    inputTokens: 1,
    machineId: "relay",
    model: "claude-opus-5-5",
    outputTokens: 2,
    seatDir: ".claude",
    sessions: 1,
  }
  const doubled = {
    ...sent,
    assistantTurns: 8,
    cacheCreationTokens: 6,
    cacheReadTokens: 10,
    inputTokens: 2,
    outputTokens: 4,
    sessions: 2,
  }
  const other = { ...row, accountEmail: "other@example.com", seatDir: ".claude-work" }
  const leaky = {
    ...row,
    accountEmail: "other@example.com",
    countingVersion: 2,
    cwd: "/Users/secret/repo",
    machineId: "secret-machine",
    prompt: "secret prompt text",
    seatDir: ".claude-secret",
    seatKind: "interactive",
    skillCounts: { "secret-skill": 2 },
    subagentCounts: { "secret-subagent": 1 },
    summary: "secret summary text",
    toolCalls: 9,
    toolCounts: { "secret-tool": 9 },
  }

  test("builds each row from the allowlist alone: its keys are exactly the list", () => {
    const out = transcriptSums()({ rollups: [leaky] }, LOGIN)
    expect(out?.rollups.length).toBe(1)
    for (const r of out?.rollups ?? []) expect(Object.keys(r).sort()).toEqual(Object.keys(sent))
  })

  test("sends no text: its only strings are the login, the model, the day and the fixed machine and seat", () => {
    const out = transcriptSums()({ rollups: [leaky] }, LOGIN)
    expect([...walk(out).strings].sort()).toEqual([
      ".claude",
      "2026-10-12",
      "claude-opus-5-5",
      LOGIN,
      "relay",
    ])
    expect(JSON.stringify(out)).not.toContain("secret")
  })

  test("sends another login's usage, and usage with no login, under the login", () => {
    for (const accountEmail of ["other@example.com", undefined, "(unknown)"])
      expect(transcriptSums()({ rollups: [{ ...row, accountEmail }] }, LOGIN)?.rollups).toEqual([
        sent,
      ])
  })

  test("sums two logins' rows that share a day and a model into one row", () => {
    expect(transcriptSums()({ rollups: [row, other] }, LOGIN)?.rollups).toEqual([doubled])
  })

  test("sends a key split across two posts whole, since Loom replaces the row it keys", () => {
    const sums = transcriptSums()
    expect(sums({ rollups: [row] }, LOGIN)?.rollups).toEqual([sent])
    expect(sums({ rollups: [other] }, LOGIN)?.rollups).toEqual([doubled])
  })

  test("a re-run sends the same sums, never double", () => {
    const sums = transcriptSums()
    sums({ rollups: [row] }, LOGIN)
    sums({ rollups: [other] }, LOGIN)
    expect(sums({ rollups: [row] }, LOGIN)?.rollups).toEqual([doubled])
    expect(sums({ rollups: [other] }, LOGIN)?.rollups).toEqual([doubled])
  })

  test("a re-run after the relay starts afresh sends the whole sums again", () => {
    const before = transcriptSums()
    before({ rollups: [row] }, LOGIN)
    const fresh = transcriptSums()
    expect(fresh({ rollups: [row] }, LOGIN)?.rollups).toEqual([sent])
    expect(fresh({ rollups: [other] }, LOGIN)?.rollups).toEqual([doubled])
  })

  test("a seat whose login changed between two runs counts once", () => {
    const sums = transcriptSums()
    sums({ rollups: [row] }, LOGIN)
    expect(
      sums({ rollups: [{ ...row, accountEmail: "other@example.com" }] }, LOGIN)?.rollups,
    ).toEqual([sent])
  })

  test("never forgets a row, however many come", () => {
    const sums = transcriptSums()
    sums({ rollups: [{ ...row, inputTokens: 5 }] }, LOGIN)
    sums(
      {
        rollups: Array.from({ length: 100_001 }, (_, i) => ({
          ...row,
          day: `20${String(10 + (i % 90))}-01-01`,
          seatDir: `.claude-${i}`,
        })),
      },
      LOGIN,
    )
    const out = sums({ rollups: [{ ...row, inputTokens: 7, seatDir: ".claude-work" }] }, LOGIN)
    expect(out?.rollups[0]?.inputTokens).toBe(12)
  })

  test("keeps other days and models apart, files a row with no model under unknown, and drops one whose model is not a Claude id", () => {
    const out = transcriptSums()(
      {
        rollups: [
          row,
          { ...row, day: "2026-10-11" },
          { ...row, model: undefined },
          { ...row, model: "/Users/x/private-repo" },
          { ...row, model: "glm-5.3-flash[1m]" },
        ],
      },
      LOGIN,
    )
    expect(out?.rollups.map((r) => `${r.day} ${r.model}`)).toEqual([
      "2026-10-12 claude-opus-5-5",
      "2026-10-11 claude-opus-5-5",
      "2026-10-12 unknown",
    ])
  })

  // Usage alone: Loom's measured sub-agent token counts pass, and its other measured counts do not.
  const measured = {
    subagentCacheCreationTokens: 13,
    subagentCacheReadTokens: 17,
    subagentInputTokens: 11,
    subagentOutputTokens: 19,
  }

  test("sends the sub-agent token counts summed, when every row summed measured them", () => {
    const out = transcriptSums()(
      {
        rollups: [
          { ...row, ...measured },
          { ...other, ...measured },
        ],
      },
      LOGIN,
    )
    expect(out?.rollups).toEqual([
      {
        ...doubled,
        subagentCacheCreationTokens: 26,
        subagentCacheReadTokens: 34,
        subagentInputTokens: 22,
        subagentOutputTokens: 38,
      },
    ])
  })

  test("leaves a sub-agent count absent, never 0, when a row summed did not measure it", () => {
    const sums = transcriptSums()
    expect(sums({ rollups: [row] }, LOGIN)?.rollups).toEqual([sent])
    expect(sums({ rollups: [{ ...other, ...measured }] }, LOGIN)?.rollups).toEqual([doubled])
    const { subagentInputTokens: _, ...rest } = measured
    expect(
      transcriptSums()(
        {
          rollups: [
            { ...row, ...measured },
            { ...other, ...rest },
          ],
        },
        LOGIN,
      )?.rollups,
    ).toEqual([
      {
        ...doubled,
        subagentCacheCreationTokens: 26,
        subagentCacheReadTokens: 34,
        subagentOutputTokens: 38,
      },
    ])
  })

  test("drops a sub-agent count that is not a non-negative number", () => {
    for (const bad of ["11", -1, null, true, [11], { n: 11 }])
      expect(
        transcriptSums()({ rollups: [{ ...row, ...measured, subagentInputTokens: bad }] }, LOGIN)
          ?.rollups[0],
      ).not.toHaveProperty("subagentInputTokens")
  })

  test("refuses Loom's other measured counts: sub-agent turns, product repo calls and context buckets", () => {
    const out = transcriptSums()(
      {
        rollups: [
          {
            ...row,
            mainContextBuckets: [1, 2, 3, 4, 5, 6],
            productRepoMainCalls: 7,
            subagentTurns: 8,
          },
        ],
      },
      LOGIN,
    )
    expect(out?.rollups).toEqual([sent])
  })

  test("leaves nothing to send for a body with no row that has a day", () => {
    expect(transcriptSums()({ rollups: [{ ...row, day: "not a day" }] }, LOGIN)).toBeNull()
    expect(transcriptSums()("not a backfill", LOGIN)).toBeNull()
  })
})

describe("dropBlocked", () => {
  test("drops every blocked key at any depth, and an attribute one names, keeping token counts", () => {
    const out = dropBlocked({
      inputTokens: 1,
      prompt: "x",
      rollups: [{ day: "2026-10-12", output: { text: "x" }, skillCounts: { s: 1 }, toolCalls: 2 }],
      resourceMetrics: [{ attributes: [s("cwd", "x"), s("model", "claude-opus-5-5")] }],
    })
    expect(out.body).toEqual({
      inputTokens: 1,
      rollups: [{ day: "2026-10-12" }],
      resourceMetrics: [{ attributes: [s("model", "claude-opus-5-5")] }],
    })
    expect(out.dropped).toEqual(["cwd", "output", "prompt", "skillCounts", "toolCalls"])
  })

  test("only takes keys away: a body's own __proto__ key stays a key, so no new body passes", () => {
    const body = JSON.parse('{"__proto__":{"rollups":[{"day":"2026-10-12","inputTokens":5}]}}')
    expect(transcriptSums()(body, LOGIN)).toBeNull()
    expect(transcriptSums()(dropBlocked(body).body, LOGIN)).toBeNull()
  })

  test("leaves a body with no blocked key as it is", () => {
    expect(dropBlocked(exportBody)).toEqual({ body: exportBody, dropped: [] })
  })
})
