import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TRY_MS, fakeBun, lockOf } from "./audit-fake"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/audit-canary.ts")
const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// a scratch GitHub API: refuses any token but test-token, logging the refusal apart, logs each call as `<method> <path> <body>`, answers the status `status` gives a call (an issues API that refuses it), lists the open issues it is given, and refuses the label as GitHub does once it exists
const canary = async (
  lock: string,
  open: { number: number; pull_request?: object; title: string }[],
  token = "test-token",
  status: (method: string, path: string) => number = () => 200,
) => {
  const dir = mkdtempSync(join(tmpdir(), "audit-canary-"))
  dirs.push(dir)
  fakeBun(dir)
  writeFileSync(join(dir, "bun.lock"), lock)
  const calls: string[] = []
  const refused: string[] = []
  const server = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url)
      if (req.headers.get("authorization") !== "Bearer test-token") {
        refused.push(`${req.method} ${url.pathname}${url.search}`)
        return new Response("Bad credentials", { status: 401 })
      }
      const body = await req.text()
      calls.push(`${req.method} ${url.pathname}${url.search}${body ? ` ${body}` : ""}`)
      const answer = status(req.method, url.pathname)
      if (answer !== 200) return new Response("refused", { status: answer })
      if (req.method === "GET") return Response.json(open)
      if (url.pathname.endsWith("/labels")) return new Response("exists", { status: 422 })
      return Response.json({})
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  try {
    const proc = Bun.spawn([process.execPath, SCRIPT, "--audit-level", "high"], {
      cwd: dir,
      env: {
        AUDIT_TRY_MS: TRY_MS,
        GH_TOKEN: token,
        GITHUB_API_URL: `http://127.0.0.1:${server.port}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_SHA: "abcdef1234",
        PATH: `${dir}:/usr/bin:/bin`,
      },
      stderr: "pipe",
      stdout: "pipe",
    })
    const [code, err, out] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ])
    return { calls, code, err, out, refused }
  } finally {
    server.stop(true)
  }
}

const LIST = "GET /repos/o/r/issues?labels=audit&state=open&per_page=100"
const DOMPURIFY: [string, string, string] = ["dompurify", "GHSA-cg2g-xh64-v4q7", "critical"]
const TOML: [string, string, string] = ["toml", "GHSA-toml-high", "high"]

describe("audit-canary (#1704)", () => {
  test("canary's advisories with no bump issue open one, titled by their ids and labelled audit", async () => {
    const { calls, code } = await canary(lockOf(DOMPURIFY, TOML), [])
    expect(code).toBe(0)
    const creates = calls.filter((c) => c.startsWith("POST /repos/o/r/issues "))
    expect(creates).toHaveLength(1)
    const issue = JSON.parse(creates[0].slice("POST /repos/o/r/issues ".length))
    expect(issue.title).toBe("canary audit: GHSA-cg2g-xh64-v4q7, GHSA-toml-high")
    expect(issue.labels).toEqual(["audit"])
  })

  test("an open bump issue that names every advisory gets no second one, and an open PR is no bump issue", async () => {
    const open = [
      { number: 5, pull_request: {}, title: "a PR the label also lists" },
      { number: 7, title: "canary audit: GHSA-cg2g-xh64-v4q7, GHSA-toml-high" },
    ]
    const { calls, code } = await canary(lockOf(DOMPURIFY, TOML), open)
    expect(code).toBe(0)
    expect(calls).toEqual([LIST])
  })

  test("a new advisory joins the open issue's title and gets a comment", async () => {
    const { calls } = await canary(lockOf(DOMPURIFY, TOML), [
      { number: 7, title: "canary audit: GHSA-cg2g-xh64-v4q7" },
    ])
    expect(calls).toContain(
      `PATCH /repos/o/r/issues/7 ${JSON.stringify({ title: "canary audit: GHSA-cg2g-xh64-v4q7, GHSA-toml-high" })}`,
    )
    expect(calls.find((c) => c.startsWith("POST /repos/o/r/issues/7/comments"))).toContain(
      "GHSA-toml-high (toml, high)",
    )
    expect(calls.some((c) => c.startsWith("POST /repos/o/r/issues "))).toBe(false)
  })

  test("a clean audit closes the open issue, and with none open does nothing", async () => {
    const { calls } = await canary(lockOf(), [{ number: 7, title: "canary audit: GHSA-toml-high" }])
    expect(calls).toContain(
      `POST /repos/o/r/issues/7/comments ${JSON.stringify({ body: "canary's audit is clean at abcdef1." })}`,
    )
    expect(calls).toContain(`PATCH /repos/o/r/issues/7 ${JSON.stringify({ state: "closed" })}`)
    expect((await canary(lockOf(), [])).calls).toEqual([LIST])
  })

  test("an open issue labelled audit for another reason keeps its title, and a bump issue opens beside it", async () => {
    const { calls } = await canary(lockOf(TOML), [{ number: 3, title: "audit the docs" }])
    expect(calls.some((c) => c.includes("/issues/3"))).toBe(false)
    expect(calls.filter((c) => c.startsWith("POST /repos/o/r/issues "))).toHaveLength(1)
  })

  test("a token GitHub refuses fails an advisory's run, printing the advisory no issue holds", async () => {
    const { calls, code, err, refused } = await canary(lockOf(DOMPURIFY), [], "wrong-token")
    expect(code).toBe(1)
    expect(calls).toEqual([])
    // the 401 is the scratch API's own, kept off the job log, where it read as a real GitHub call
    expect(refused).toEqual([LIST])
    expect(err).toContain("GitHub GET /issues?labels=audit&state=open&per_page=100 answered 401")
    expect(err).toContain("GHSA-cg2g-xh64-v4q7 (dompurify, critical)")
  })

  test.each([403, 404, 410])(
    "a clean audit passes when the issues read answers %d, with one warning line",
    async (answer) => {
      const { code, err } = await canary(lockOf(), [], "test-token", () => answer)
      expect(code).toBe(0)
      expect(err.match(/audit-canary: warning: /g)).toHaveLength(1)
      expect(err).toContain(
        `GitHub GET /issues?labels=audit&state=open&per_page=100 answered ${answer}`,
      )
    },
  )

  test("an advisory the issues read refuses fails the run and prints the advisories", async () => {
    const { code, err } = await canary(lockOf(DOMPURIFY, TOML), [], "test-token", () => 403)
    expect(code).toBe(1)
    expect(err).toContain("GHSA-cg2g-xh64-v4q7 (dompurify, critical)")
    expect(err).toContain("GHSA-toml-high (toml, high)")
  })

  test("an advisory whose bump issue GitHub refuses to open fails the run and prints it", async () => {
    const refuseCreate = (method: string, path: string) =>
      method === "POST" && path.endsWith("/issues") ? 403 : 200
    const { code, err } = await canary(lockOf(TOML), [], "test-token", refuseCreate)
    expect(code).toBe(1)
    expect(err).toContain("GitHub POST /issues answered 403")
    expect(err).toContain("GHSA-toml-high (toml, high)")
  })

  test("a clean audit whose close GitHub refuses still passes, and says nothing is closed", async () => {
    const refuseClose = (method: string) => (method === "PATCH" ? 403 : 200)
    const { code, err, out } = await canary(
      lockOf(),
      [{ number: 7, title: "canary audit: GHSA-toml-high" }],
      "test-token",
      refuseClose,
    )
    expect(code).toBe(0)
    expect(err).toContain("GitHub PATCH /issues/7 answered 403")
    expect(out).not.toContain("is closed")
  })

  test("a new advisory whose title GitHub refuses to extend fails the run and prints it", async () => {
    const refuseTitle = (method: string) => (method === "PATCH" ? 403 : 200)
    const { code, err } = await canary(
      lockOf(DOMPURIFY, TOML),
      [{ number: 7, title: "canary audit: GHSA-cg2g-xh64-v4q7" }],
      "test-token",
      refuseTitle,
    )
    expect(code).toBe(1)
    expect(err).toContain("GitHub PATCH /issues/7 answered 403")
    expect(err).toContain("GHSA-toml-high (toml, high)")
  })
})
