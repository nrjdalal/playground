import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { linearGql } from "../../../../../packages/scripts/src/linear-gql"
import { read } from "../../../../../packages/scripts/src/linear-read/read"

const KEY = "lin_api_made_up_key"
const merritt = { email: "merritt@example.test", name: "Merritt Other" }

const ISSUE = {
  assignee: null,
  comments: {
    nodes: [
      {
        body: "Looked into this, the import drops the field.",
        createdAt: "2026-10-20T09:00:00.000Z",
        id: "c1",
        parent: null,
        url: "https://linear.app/example/issue/MADEDUNE-1#comment-c1",
        user: merritt,
      },
    ],
  },
  description: "Made-up description.",
  identifier: "MADEDUNE-1",
  project: { id: "proj-1", name: "Listings" },
  state: { name: "Todo", type: "unstarted" },
  title: "Made-up ticket",
}
const PROJECT = {
  description: "Made-up project.",
  id: "proj-1",
  issues: {
    nodes: [{ assignee: merritt, identifier: "MADEDUNE-2", title: "Another made-up ticket" }],
  },
  lead: merritt,
  name: "Listings",
}

type Call = { auth: string | null; query: string; variables: Record<string, unknown> }
const calls: Call[] = []
let server: ReturnType<typeof Bun.serve>

// A stand-in for Linear's GraphQL endpoint on port 0, answering each read by its root field.
beforeAll(() => {
  server = Bun.serve({
    fetch: async (req) => {
      const { query, variables } = (await req.json()) as Omit<Call, "auth">
      calls.push({ auth: req.headers.get("Authorization"), query, variables })
      const data = query.includes("t0: issue(")
        ? Object.fromEntries(
            Object.entries(variables).map(([name, id]) => [
              `t${name.slice(1)}`,
              { identifier: id, state: { type: id === "MADEDUNE-1" ? "started" : "completed" } },
            ]),
          )
        : query.includes("issue(")
          ? { issue: ISSUE }
          : query.includes("project(")
            ? { project: PROJECT }
            : query.includes("projects(")
              ? { projects: { nodes: [{ id: "proj-1", name: "Listings" }] } }
              : query.includes("searchIssues(")
                ? { searchIssues: { nodes: [{ identifier: "MADEDUNE-3", title: "Covering" }] } }
                : query.includes("users(")
                  ? { users: { nodes: [{ ...merritt, active: true }] } }
                  : null
      return data ? Response.json({ data }) : Response.json({ errors: [{ message: "unknown" }] })
    },
    port: 0,
  })
})
afterAll(() => server.stop(true))

const gql = () =>
  linearGql(KEY, ((_url: string, init: RequestInit) => fetch(server.url, init)) as typeof fetch)

describe("linear-read", () => {
  test("returns a ticket with its comments", async () => {
    const { issue } = (await read(gql(), "issue", "MADEDUNE-1")) as { issue: typeof ISSUE }
    expect(issue.comments.nodes[0]?.user).toEqual(merritt)
    expect(issue.project?.id).toBe("proj-1")
    expect(calls.at(-1)).toMatchObject({ auth: KEY, variables: { q: "MADEDUNE-1" } })
  })

  test("returns a project with its issues from the last 30 days", async () => {
    const { project } = (await read(gql(), "project", "proj-1")) as { project: typeof PROJECT }
    expect(project.lead).toEqual(merritt)
    expect(project.issues.nodes.map((issue) => issue.identifier)).toEqual(["MADEDUNE-2"])
    expect(calls.at(-1)?.query).toContain('"-P30D"')
  })

  test("returns a user's email", async () => {
    const { users } = (await read(gql(), "user", "Merritt Other")) as {
      users: { nodes: { email: string }[] }
    }
    expect(users.nodes[0]?.email).toBe("merritt@example.test")
  })

  test("finds projects by name and open tickets by words", async () => {
    expect(await read(gql(), "projects", "list")).toEqual({
      projects: { nodes: [{ id: "proj-1", name: "Listings" }] },
    })
    expect(await read(gql(), "search", "parking import")).toEqual({
      searchIssues: { nodes: [{ identifier: "MADEDUNE-3", title: "Covering" }] },
    })
  })

  test("reads many tickets' state types in one query", async () => {
    const before = calls.length
    expect(await read(gql(), "states", "MADEDUNE-1,MADEDUNE-2")).toEqual({
      "MADEDUNE-1": "started",
      "MADEDUNE-2": "completed",
    })
    expect(calls.length - before).toBe(1)
    expect(calls.at(-1)?.variables).toEqual({ i0: "MADEDUNE-1", i1: "MADEDUNE-2" })
    await expect(read(gql(), "states", "MADEDUNE-1,} mutation {")).rejects.toThrow(
      "states takes ticket IDs",
    )
  })

  test("sends no mutation", async () => {
    for (const command of ["issue", "project", "projects", "search", "user"])
      await read(gql(), command, "x")
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.query).not.toMatch(/mutation/i)
  })

  test("refuses a command it does not know", async () => {
    await expect(read(gql(), "save", "x")).rejects.toThrow("unknown command save")
  })
})
