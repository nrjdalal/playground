import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { linearGql } from "../../../../../packages/scripts/src/linear-gql"
import { comment } from "../../../../../packages/scripts/src/linear-write/comment"

const KEY = "lin_api_made_up_key"
const BODY = "Handing this over: the branch and PR are on the ticket.\n\nState: draft."

type Node = { body: string; url: string }
const issue = (nodes: Node[], hasNextPage = false) => ({
  comments: { nodes, pageInfo: { hasNextPage } },
  id: "issue-uuid-1",
})
const PAST: Node = { body: "A past comment about something else.", url: "https://linear.app/x#c1" }

type Call = { auth: string | null; query: string; variables: Record<string, unknown> }
const calls: Call[] = []
let server: ReturnType<typeof Bun.serve>
let dir = ""
let ticket = issue([])

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "linear-write-"))
  server = Bun.serve({
    fetch: async (req) => {
      const { query, variables } = (await req.json()) as Omit<Call, "auth">
      calls.push({ auth: req.headers.get("Authorization"), query, variables })
      const data = query.includes("commentCreate(")
        ? {
            commentCreate: {
              comment: {
                id: "c-new",
                url: "https://linear.app/example/issue/DUNE-1#comment-c-new",
              },
              success: true,
            },
          }
        : query.includes("issue(")
          ? { issue: ticket }
          : null
      return data ? Response.json({ data }) : Response.json({ errors: [{ message: "unknown" }] })
    },
    port: 0,
  })
})
afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
  server.stop(true)
})

const gql = () =>
  linearGql(KEY, ((_url: string, init: RequestInit) => fetch(server.url, init)) as typeof fetch)

const file = async (body: string) => {
  const path = join(dir, `${calls.length}.md`)
  await Bun.write(path, body)
  return path
}

describe("linear-write comment", () => {
  test("posts the file's contents as the ticket's comment", async () => {
    ticket = issue([])
    const path = await file(BODY)
    const result = await comment(gql(), "DUNE-1", path)
    if (!result.posted) throw new Error("expected a post")
    expect(result.comment.id).toBe("c-new")
    const mutation = calls.at(-1)
    expect(mutation?.query).toContain("commentCreate(")
    expect(mutation?.variables).toMatchObject({
      input: { body: BODY, issueId: "issue-uuid-1" },
    })
    expect(mutation?.auth).toBe(KEY)
  })

  test("skips when a ticket comment's first line already matches, naming its url", async () => {
    ticket = issue([PAST])
    const path = await file("A past comment about something else.\nDifferent rest.")
    const result = await comment(gql(), "DUNE-1", path)
    if (result.posted) throw new Error("expected a skip")
    expect(result.url).toBe(PAST.url)
    expect(calls.at(-1)?.query).toContain("issue(")
    expect(calls.at(-1)?.query).not.toContain("commentCreate(")
  })

  test("matches the first line past surrounding whitespace", async () => {
    ticket = issue([{ body: BODY, url: "https://linear.app/x#c2" }])
    const path = await file(`  ${BODY.split("\n", 1)[0]}\nDifferent rest.`)
    const result = await comment(gql(), "DUNE-1", path)
    if (result.posted) throw new Error("expected a skip")
    expect(result.url).toBe("https://linear.app/x#c2")
  })

  test("refuses a ticket whose dedupe read is cut short", async () => {
    ticket = issue([PAST], true)
    const path = await file(BODY)
    await expect(comment(gql(), "DUNE-1", path)).rejects.toThrow("more than 100 comments")
  })

  test("refuses an empty file", async () => {
    ticket = issue([])
    const path = await file("   \n")
    await expect(comment(gql(), "DUNE-1", path)).rejects.toThrow("the file is empty")
  })

  test("refuses a missing file", async () => {
    ticket = issue([])
    await expect(comment(gql(), "DUNE-1", join(dir, "no-such.md"))).rejects.toThrow()
  })
})
