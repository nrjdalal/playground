import { verdictsOf } from "@packages/config/verdicts"

import { cachedBy, ghFailure, run } from "@/lib/dashboard/agents"
import { readFixtureMachine, readsLive } from "@/lib/dashboard/fixture"

// The PRs merged in each repo a worker opened one in, from a cached `gh api graphql` read per repo: what each cost is joined in report.ts, and here each gets its review rounds and any fix PR that followed it.

const DAY_MS = 24 * 60 * 60 * 1000
const FIX_WINDOW_MS = 7 * DAY_MS
// A PR's files make the query heavy (one 100-PR `gh pr list` takes about 7s against GitHub's 10s limit), so PRs are read 25 at a time, newest updated first, back to a day past the week so a cached list still covers it.
const PAGE_SIZE = 25
const MAX_PAGES = 12
const LIST_WINDOW_MS = 8 * DAY_MS

const MERGED_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: ${PAGE_SIZE}, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        comments(last: 100) { nodes { body } }
        createdAt
        files(first: 100) { nodes { path } }
        headRefName
        mergedAt
        number
        title
        updatedAt
        url
      }
      pageInfo { endCursor hasNextPage }
    }
  }
}`

export type MergedPr = {
  createdAt: string
  fixes: number[]
  headRefName: string
  mergedAt: string
  number: number
  repo: string
  rounds: number
  title: string
  url: string
}

type Listed = {
  comments: string[]
  createdAt: string
  files: string[]
  headRefName: string
  mergedAt: string
  number: number
  title: string
  url: string
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const FIX_RE = /^fix(\([^)]*\))?!?:/i

// Pure: how many commits a ReviewBot comment scored, each round being one head it scored.
export function roundsOf(comments: string[]): number {
  const heads = new Set<string>()
  for (const body of comments) {
    for (const verdict of verdictsOf(body)) {
      if (verdict.gate === "review") heads.add(verdict.at.slice(0, 7))
    }
  }
  return heads.size
}

// Docs every change updates (AGENTS.md, the README, the docs pages), so sharing one says nothing about a fix.
const DOC_RE = /\.mdx?$/i

// Pure: the fix PRs merged within 7 days after this one that touch a file it touched, docs aside.
export function fixesOf(pr: Listed, all: Listed[]): number[] {
  const merged = Date.parse(pr.mergedAt)
  const files = new Set(pr.files.filter((file) => !DOC_RE.test(file)))
  return all
    .filter((other) => {
      const at = Date.parse(other.mergedAt)
      return (
        other.number !== pr.number &&
        FIX_RE.test(other.title) &&
        at > merged &&
        at <= merged + FIX_WINDOW_MS &&
        other.files.some((file) => files.has(file))
      )
    })
    .map((other) => other.number)
    .sort((a, b) => a - b)
}

export type Page = { listed: Listed[]; next: string | null; oldest: number | null }

// Pure: one page of the `gh api graphql` answer as the PRs it lists (anything off their shape dropped), the cursor to the next page and the oldest update on this one. An answer without the repository (an error, a rate limit) throws, so the cache keeps what it had.
export function pageOf(out: string): Page {
  const answer: unknown = JSON.parse(out)
  const data = isRecord(answer) ? answer.data : null
  const repository = isRecord(data) ? data.repository : null
  const pulls = isRecord(repository) ? repository.pullRequests : null
  if (!isRecord(pulls)) throw new Error("GitHub answered without the repository's pull requests")
  const nodes = (value: unknown): Json[] =>
    isRecord(value) && Array.isArray(value.nodes) ? value.nodes.filter(isRecord) : []
  const strings = (value: unknown, key: string): string[] =>
    nodes(value).flatMap((item) => (typeof item[key] === "string" ? [item[key]] : []))
  let oldest: number | null = null
  const listed = nodes(pulls).flatMap((pr) => {
    const updated = Date.parse(String(pr.updatedAt))
    if (!Number.isNaN(updated)) oldest = oldest === null ? updated : Math.min(oldest, updated)
    if (
      typeof pr.number !== "number" ||
      typeof pr.url !== "string" ||
      typeof pr.mergedAt !== "string"
    ) {
      return []
    }
    return [
      {
        comments: strings(pr.comments, "body"),
        createdAt: typeof pr.createdAt === "string" ? pr.createdAt : pr.mergedAt,
        files: strings(pr.files, "path"),
        headRefName: typeof pr.headRefName === "string" ? pr.headRefName : "",
        mergedAt: pr.mergedAt,
        number: pr.number,
        title: typeof pr.title === "string" ? pr.title : "",
        url: pr.url,
      },
    ]
  })
  const info = isRecord(pulls.pageInfo) ? pulls.pageInfo : {}
  const next =
    info.hasNextPage === true && typeof info.endCursor === "string" ? info.endCursor : null
  return { listed, next, oldest }
}

// Every PR merged in a repo that was updated inside the list window (a merge is an update, so every PR merged inside it is here), a page at a time until a page reaches past the window. A fixture stack asks GitHub nothing: its fixture holds each repo's merged PRs as the query would return them.
const listRepo = cachedBy(10 * 60 * 1000, async (repo: string): Promise<Listed[]> => {
  if (!readsLive()) {
    const nodes = readFixtureMachine().merged?.[repo] ?? []
    return pageOf(JSON.stringify({ data: { repository: { pullRequests: { nodes } } } })).listed
  }
  const [owner, name] = repo.split("/")
  const edge = Date.now() - LIST_WINDOW_MS
  const listed: Listed[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const { code, err, out } = await run(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${MERGED_QUERY}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        ...(after ? ["-f", `after=${after}`] : []),
      ],
      20_000,
    )
    if (code !== 0) {
      const { notFound, reason } = ghFailure(code, out, err)
      // GitHub holds no such repository, so none of its PRs merged.
      if (notFound) break
      throw new Error(reason)
    }
    const { listed: more, next, oldest } = pageOf(out)
    listed.push(...more)
    if (!next || (oldest !== null && oldest < edge)) break
    after = next
  }
  return listed
})

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

// A first read of a repo's pages can outlast the proxy's 10s, so a report waits this long and then answers without that repo, the read going on in the cache for the next report.
const WAIT_MS = 3000

const PENDING = Symbol("pending")

const within = <T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> =>
  Promise.race([promise, Bun.sleep(ms).then((): typeof PENDING => PENDING)])

// Every PR merged since `since` in the repos named, with what failed to read named in problems; pending is true while a repo's first read is still going past `waitMs`.
export async function mergedPrs(
  repos: string[],
  since: number,
  waitMs = WAIT_MS,
): Promise<{ pending: boolean; problems: string[]; prs: MergedPr[] }> {
  const problems: string[] = []
  const prs: MergedPr[] = []
  let pending = false
  await Promise.all(
    repos
      .filter((repo) => REPO_RE.test(repo))
      .map(async (repo) => {
        let listed: Listed[] | typeof PENDING
        try {
          listed = await within(listRepo(repo), waitMs)
        } catch (err) {
          problems.push(`Could not list ${repo}'s merged PRs: ${(err as Error).message}`)
          return
        }
        if (listed === PENDING) {
          pending = true
          return
        }
        for (const pr of listed) {
          if (Date.parse(pr.mergedAt) < since) continue
          prs.push({
            createdAt: pr.createdAt,
            fixes: fixesOf(pr, listed),
            headRefName: pr.headRefName,
            mergedAt: pr.mergedAt,
            number: pr.number,
            repo,
            rounds: roundsOf(pr.comments),
            title: pr.title,
            url: pr.url,
          })
        }
      }),
  )
  return { pending, problems: problems.sort(), prs }
}
