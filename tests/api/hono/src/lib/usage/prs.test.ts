import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fixesOf, pageOf, roundsOf } from "../../../../../../api/hono/src/lib/usage/prs"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"

const pr = (number: number, title: string, mergedAt: string, files: string[]) => ({
  comments: [],
  createdAt: mergedAt,
  files,
  headRefName: `b${number}`,
  mergedAt,
  number,
  title,
  url: `https://github.com/o/r/pull/${number}`,
})

describe("roundsOf", () => {
  test("counts each head a ReviewBot verdict scored once, by the gate's own marker", () => {
    expect(
      roundsOf([
        "## ReviewBot · round 1: 4/5 at abc1234 · 1 blocking",
        "## ReviewBot · round 2: 4/5 at abc1234def · 1 blocking",
        "## ReviewBot · round 3: 5/5 at def5678 · 0 blocking",
        "## ReviewBot · local CI at 9999999: green",
        "## ReviewBot\n\n**Score: 5/5** at 8888888",
        "## ReviewBot with no score",
      ]),
    ).toBe(2)
  })

  test("is zero with no review", () => {
    expect(roundsOf([])).toBe(0)
  })
})

describe("fixesOf", () => {
  const base = pr(10, "feat: a", "2026-10-01T00:00:00Z", ["a.ts", "b.ts"])
  test("finds a fix PR within 7 days that touches the same file", () => {
    const all = [
      base,
      pr(11, "fix(dashboard): a", "2026-10-03T00:00:00Z", ["b.ts"]),
      pr(12, "fix: other file", "2026-10-03T00:00:00Z", ["c.ts"]),
      pr(13, "feat: same file", "2026-10-03T00:00:00Z", ["a.ts"]),
      pr(14, "fix: too late", "2026-10-09T00:00:01Z", ["a.ts"]),
      pr(9, "fix: before", "2026-09-30T00:00:00Z", ["a.ts"]),
    ]
    expect(fixesOf(base, all)).toEqual([11])
  })

  test("a fix that shares only docs with it does not count, since every change updates them", () => {
    const docs = pr(20, "feat: c", "2026-10-01T00:00:00Z", ["AGENTS.md", "docs/x.mdx", "c.ts"])
    const all = [
      docs,
      pr(21, "fix: docs only", "2026-10-02T00:00:00Z", ["AGENTS.md", "docs/x.mdx", "d.ts"]),
      pr(22, "fix: code", "2026-10-02T00:00:00Z", ["AGENTS.md", "c.ts"]),
    ]
    expect(fixesOf(docs, all)).toEqual([22])
  })
})

const answer = (nodes: unknown[], pageInfo: unknown) =>
  JSON.stringify({ data: { repository: { pullRequests: { nodes, pageInfo } } } })

describe("pageOf", () => {
  test("reads a page of GitHub's answer, drops what is off its shape and gives the next cursor", () => {
    const out = answer(
      [
        {
          comments: { nodes: [{ body: "hi" }] },
          createdAt: "2026-10-01T00:00:00Z",
          files: { nodes: [{ path: "a.ts" }] },
          headRefName: "feat/a",
          mergedAt: "2026-10-02T00:00:00Z",
          number: 1,
          title: "feat: a",
          updatedAt: "2026-10-03T00:00:00Z",
          url: "https://github.com/o/r/pull/1",
        },
        {
          mergedAt: null,
          number: 2,
          updatedAt: "2026-09-20T00:00:00Z",
          url: "https://github.com/o/r/pull/2",
        },
      ],
      { endCursor: "c2", hasNextPage: true },
    )
    expect(pageOf(out)).toEqual({
      listed: [
        {
          comments: ["hi"],
          createdAt: "2026-10-01T00:00:00Z",
          files: ["a.ts"],
          headRefName: "feat/a",
          mergedAt: "2026-10-02T00:00:00Z",
          number: 1,
          title: "feat: a",
          url: "https://github.com/o/r/pull/1",
        },
      ],
      next: "c2",
      oldest: Date.parse("2026-09-20T00:00:00Z"),
    })
  })

  test("has no next cursor on the last page", () => {
    expect(pageOf(answer([], { endCursor: null, hasNextPage: false }))).toEqual({
      listed: [],
      next: null,
      oldest: null,
    })
  })

  test("throws on an answer without the repository's pull requests", () => {
    expect(() => pageOf("{}")).toThrow()
    expect(() => pageOf(JSON.stringify({ errors: [{ message: "rate limited" }] }))).toThrow()
  })
})

// A gh on PATH that answers each repository's list as GitHub and gh answered the reads measured once: a repository GitHub does not hold, a refused query, and a gateway error on stderr alone.
const FAKE_GH = `#!/usr/bin/env bun
const name = process.argv.find((arg) => arg.startsWith("name="))?.slice(5)
const errors = (error) => JSON.stringify({ data: { repository: null }, errors: [error] })
const answers = {
  down: [1, "", "HTTP 502: Bad Gateway (https://api.github.com/graphql)\\n"],
  gone: [1, errors({ message: "Could not resolve to a Repository with the name 'o/gone'.", type: "NOT_FOUND" }), "gh: Could not resolve to a Repository with the name 'o/gone'.\\n"],
  refused: [1, errors({ message: "Resource not accessible by integration", type: "FORBIDDEN" }), "gh: Resource not accessible by integration\\n"],
}
const [code, out, err] = answers[name]
process.stdout.write(out)
process.stderr.write(err)
process.exit(code)
`

describe.skipIf(onLiveDashboard())("mergedPrs, when a list fails (#1672)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prs-gh-read-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  test("names GitHub's own answer or gh's stderr, and reads a repository GitHub does not hold as none merged", async () => {
    const bin = join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, "gh"), FAKE_GH)
    chmodSync(join(bin, "gh"), 0o755)
    const { code, result, stderr } = await inFixture(
      `const { mergedPrs } = await import(\`\${API}/lib/usage/prs\`)
// a wait past the test's timeout, since each fake gh is a bun process that a loaded machine starts later than the report's 3s
console.log(JSON.stringify(await mergedPrs(["o/down", "o/gone", "o/refused"], 0, 60_000)))
process.exit(0)`,
      dir,
      {
        CLAUDE_CONFIG_DIR: join(dir, "config"),
        PLAYGROUND_LIVE_READS: "1",
        PATH: `${bin}:${process.env.PATH}`,
      },
    )
    expect(stderr).not.toContain("error:")
    expect(code).toBe(0)
    expect(result).toEqual({
      pending: false,
      problems: [
        "Could not list o/down's merged PRs: HTTP 502: Bad Gateway (https://api.github.com/graphql)",
        "Could not list o/refused's merged PRs: Resource not accessible by integration",
      ],
      prs: [],
    })
  })
})
