import { describe, expect, test } from "bun:test"

import { queuesMarkdown } from "../../../../../../api/hono/src/lib/dashboard/queues"
import type { WorkPull } from "../../../../../../api/hono/src/lib/dashboard/work-queue"

const pull = (over: Partial<WorkPull>): WorkPull => ({
  approvals: "1 of 1",
  base: "main",
  number: 9,
  repo: "example/app",
  title: "Add the kettle timer",
  updatedAt: "2026-01-02T09:00:00Z",
  url: "https://github.com/example/app/pull/9",
  waitsOn: "Nothing",
  ...over,
})

const QUEUE = {
  parked: [{ pr: 103 }],
  queue: [
    { etaMerge: "2026-01-02T09:30:00.000Z", item: "Board status colours", pr: 101 },
    { pr: 102 },
  ],
}

describe("queuesMarkdown", () => {
  test("prints the dashboard's own queue, then the work queue, each in its order", () => {
    const text = queuesMarkdown({
      name: "Playground",
      queue: QUEUE,
      repo: "example/fixture",
      work: {
        label: "Work",
        problem: null,
        pulls: [pull({}), pull({ number: 4, repo: "example/api", waitsOn: "Review" })],
      },
    })
    expect(text).toBe(
      [
        "## Playground merge queue",
        "",
        "1. example/fixture#101 Board status colours, merging by 2026-01-02T09:30:00.000Z",
        "2. example/fixture#102",
        "",
        "Parked: example/fixture#103",
        "",
        "## Work queue",
        "",
        "1. example/app#9 Add the kettle timer, into main: waits on Nothing, approvals 1 of 1",
        "2. example/api#4 Add the kettle timer, into main: waits on Review, approvals 1 of 1",
        "",
      ].join("\n"),
    )
    expect(text.indexOf("## Playground")).toBeLessThan(text.indexOf("## Work"))
  })

  test("an empty queue says so, and a failed work read says why", () => {
    expect(
      queuesMarkdown({
        name: "Playground",
        queue: null,
        repo: "example/fixture",
        work: { label: "Work", problem: { reason: "gh is not logged in", setup: true }, pulls: [] },
      }),
    ).toBe(
      [
        "## Playground merge queue",
        "",
        "Nothing queued.",
        "",
        "## Work queue",
        "",
        "GitHub could not be read: gh is not logged in.",
        "",
      ].join("\n"),
    )
  })

  test("with no work queue set, only the dashboard's own queue prints", () => {
    const text = queuesMarkdown({
      name: "Playground",
      queue: QUEUE,
      repo: "example/fixture",
      work: null,
    })
    expect(text).toContain("## Playground merge queue")
    expect(text).not.toContain("## Work")
  })

  test("a work org with no open pulls says so", () => {
    expect(
      queuesMarkdown({
        name: "Playground",
        queue: { parked: [], queue: [] },
        repo: "example/fixture",
        work: { label: "Work", problem: null, pulls: [] },
      }),
    ).toContain("## Work queue\n\nNo open pull requests.\n")
  })
})
