import { describe, expect, test } from "bun:test"

import {
  orderWork,
  readWorkQueue,
  workPullOf,
  workSearch,
  type WorkPull,
} from "../../../../../../api/hono/src/lib/dashboard/work-queue"

// A made-up open pull request as the search answers it, ready to merge unless a test says otherwise.
const node = (over: Record<string, unknown> = {}) => ({
  baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 1 }, rules: { nodes: [] } },
  baseRefName: "main",
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  isDraft: false,
  latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] },
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  number: 7,
  repository: { nameWithOwner: "example/app" },
  reviewDecision: "APPROVED",
  title: "Add the kettle timer",
  updatedAt: "2026-01-02T09:00:00Z",
  url: "https://github.com/example/app/pull/7",
  ...over,
})

const waitsOn = (over: Record<string, unknown>) => workPullOf(node(over))?.waitsOn

describe("workPullOf", () => {
  test("a pull with nothing left to do waits on nothing, with its repo, base and approvals", () => {
    expect(workPullOf(node())).toEqual({
      approvals: "1 of 1",
      base: "main",
      number: 7,
      repo: "example/app",
      title: "Add the kettle timer",
      updatedAt: "2026-01-02T09:00:00Z",
      url: "https://github.com/example/app/pull/7",
      waitsOn: "Nothing",
    })
  })

  test("each state reads as what the pull waits on", () => {
    expect(waitsOn({ isDraft: true, mergeStateStatus: "DRAFT" })).toBe("Draft")
    expect(waitsOn({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" })).toBe("Conflicts")
    expect(waitsOn({ reviewDecision: "CHANGES_REQUESTED" })).toBe("Changes requested")
    expect(
      waitsOn({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
    ).toBe("CI failing")
    expect(
      waitsOn({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } }),
    ).toBe("CI running")
    expect(
      waitsOn({ latestOpinionatedReviews: { nodes: [] }, reviewDecision: "REVIEW_REQUIRED" }),
    ).toBe("Review")
    expect(waitsOn({ mergeStateStatus: "BLOCKED" })).toBe("Blocked")
    expect(waitsOn({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })).toBe("Checking")
    expect(waitsOn({ mergeStateStatus: "UNKNOWN" })).toBe("Checking")
    expect(waitsOn({ mergeStateStatus: "BEHIND" })).toBe("Behind its base")
  })

  test("a pull waiting on several things waits on the one furthest from merging", () => {
    expect(
      waitsOn({
        isDraft: true,
        mergeStateStatus: "BEHIND",
        reviewDecision: "CHANGES_REQUESTED",
      }),
    ).toBe("Draft")
    expect(
      waitsOn({
        commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
        reviewDecision: "REVIEW_REQUIRED",
      }),
    ).toBe("Review")
    expect(waitsOn({ isDraft: true, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })).toBe(
      "Draft",
    )
    expect(waitsOn({ mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" })).toBe(
      "Review",
    )
  })

  test("approvals read in vs needed where the base's rules say, else GitHub's decision", () => {
    const approvals = (over: Record<string, unknown>) => workPullOf(node(over))?.approvals
    expect(
      approvals({
        baseRef: {
          branchProtectionRule: null,
          rules: { nodes: [{ parameters: { requiredApprovingReviewCount: 2 } }] },
        },
        latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }, { state: "COMMENTED" }] },
        reviewDecision: "REVIEW_REQUIRED",
      }),
    ).toBe("1 of 2")
    expect(approvals({ baseRef: null, reviewDecision: "APPROVED" })).toBe("Approved")
    expect(approvals({ baseRef: null, reviewDecision: "REVIEW_REQUIRED" })).toBe("Review required")
    expect(approvals({ baseRef: null, reviewDecision: null })).toBe("None required")
  })

  test("a node that is not a pull request reads as none", () => {
    expect(workPullOf({})).toBeNull()
    expect(workPullOf(null)).toBeNull()
  })
})

describe("orderWork", () => {
  const pull = (number: number, waits: WorkPull["waitsOn"], updatedAt: string): WorkPull => ({
    ...(workPullOf(node({ number })) as WorkPull),
    updatedAt,
    waitsOn: waits,
  })

  test("ready first, then by what each waits on, then the oldest update first", () => {
    const order = orderWork([
      pull(1, "Draft", "2026-01-01T00:00:00Z"),
      pull(2, "Review", "2026-01-03T00:00:00Z"),
      pull(3, "Nothing", "2026-01-04T00:00:00Z"),
      pull(4, "Review", "2026-01-02T00:00:00Z"),
      pull(5, "Conflicts", "2026-01-01T00:00:00Z"),
      pull(6, "Nothing", "2026-01-01T00:00:00Z"),
      pull(7, "Behind its base", "2026-01-01T00:00:00Z"),
      pull(8, "CI failing", "2026-01-01T00:00:00Z"),
      pull(9, "Changes requested", "2026-01-01T00:00:00Z"),
      pull(10, "CI running", "2026-01-01T00:00:00Z"),
      pull(11, "Blocked", "2026-01-01T00:00:00Z"),
      pull(12, "Checking", "2026-01-01T00:00:00Z"),
    ])
    expect(order.map((p) => p.number)).toEqual([6, 3, 12, 7, 11, 10, 4, 2, 8, 9, 5, 1])
  })
})

describe("readWorkQueue", () => {
  test("with no work org set there is no work queue, and GitHub is never searched", async () => {
    let calls = 0
    const search = async () => {
      calls++
      return []
    }
    expect(await readWorkQueue({ label: "Work", org: undefined }, search)).toBeNull()
    expect(calls).toBe(0)
  })

  test("with a work org set, one search reads the owner's open pulls there, in order", async () => {
    const asked: string[] = []
    const search = async (owner: string) => {
      asked.push(owner)
      return [node({ number: 8, reviewDecision: "REVIEW_REQUIRED" }), node({ number: 9 })]
    }
    const queue = await readWorkQueue({ label: "Day job", org: "example" }, search)
    expect(asked).toEqual(["example"])
    expect(queue).toMatchObject({ label: "Day job", problem: null })
    expect(queue?.pulls.map((p) => [p.number, p.waitsOn])).toEqual([
      [9, "Nothing"],
      [8, "Review"],
    ])
  })

  test("a search that fails names why, with no pulls", async () => {
    const search = async () => {
      throw Object.assign(new Error("gh is not logged in"), { setup: true })
    }
    expect(await readWorkQueue({ label: "Work", org: "example" }, search)).toEqual({
      label: "Work",
      problem: { reason: "gh is not logged in", setup: true },
      pulls: [],
    })
  })

  test("the search asks for the owner's open pulls in that org alone", () => {
    expect(workSearch("example")).toBe("is:pr is:open author:@me org:example")
  })
})
