// The retro's per-PR table: every factory PR updated since a time, read through GraphQL's search a page at a time, one tab-separated row each, from its first commit to its merge (or now), with its commits, force pushes, review rounds and their scores, and tester verdicts, each verdict read as the merge gate reads it.
import { verdictsOf } from "@packages/config/verdicts"

import { factoryRepoOf } from "../playground/setting"

export const QUERY = `query ($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        state
        title
        mergedAt
        firstCommit: commits(first: 1) { nodes { commit { authoredDate } } }
        allCommits: commits { totalCount }
        comments(first: 100) { totalCount nodes { author { login } body } }
        timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], first: 1) { totalCount }
      }
    }
  }
}`

export type Pr = {
  allCommits: { totalCount: number }
  comments: { nodes: { author: { login: string } | null; body: string }[]; totalCount: number }
  firstCommit: { nodes: { commit: { authoredDate: string } }[] }
  mergedAt: string | null
  number: number
  state: string
  timelineItems: { totalCount: number }
  title: string
}

export type Page = {
  issueCount?: number
  nodes: Pr[]
  pageInfo: { endCursor: string | null; hasNextPage: boolean }
}

export const searchOf = (repo: string, since: string): string =>
  `repo:${repo} is:pr updated:>=${since}`

// Every page of the search, each read from the last one's end, so no PR past the first hundred is left out.
export const readAll = async (read: (after: string | null) => Promise<Page>): Promise<Pr[]> => {
  const prs: Pr[] = []
  let after: string | null = null
  do {
    const page = await read(after)
    prs.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return prs
}

const clock = (iso: string | null | undefined) => iso?.slice(11, 16) ?? "-"

// Pure: the table's header, one row per PR by number, then a line for each PR whose comments ran past one read, since its later verdicts are missing from its row. Only the owner's comments count, as the merge gate counts them.
export const rowsOf = (prs: Pr[], owner: string, now: Date): string[] => {
  const sorted = [...prs].sort((a, b) => a.number - b.number)
  return [
    "pr\tstate\tfirst\tmerged\ttook\tcommits\tfp\trounds\tscores\ttests\ttitle",
    ...sorted.map((p) => {
      const first = p.firstCommit.nodes[0]?.commit.authoredDate
      const end = p.mergedAt ?? now.toISOString()
      const verdicts = p.comments.nodes
        .filter((c) => c.author?.login.toLowerCase() === owner.toLowerCase())
        .flatMap((c) => verdictsOf(c.body))
      const reviews = verdicts.filter((v) => v.gate === "review")
      const tests = verdicts.filter((v) => v.gate === "tester")
      return [
        p.number,
        p.state[0],
        clock(first),
        clock(p.mergedAt),
        first ? `${Math.round((Date.parse(end) - Date.parse(first)) / 60_000)}m` : "-",
        `c${p.allCommits.totalCount}`,
        `fp${p.timelineItems.totalCount}`,
        `r${reviews.length}`,
        `[${reviews.map((v) => `${v.round}:${v.score}`).join(" ")}]`,
        `t${tests.filter((v) => v.pass).length}/${tests.length}`,
        p.title.slice(0, 60),
      ].join("\t")
    }),
    ...sorted
      .filter((p) => p.comments.totalCount > p.comments.nodes.length)
      .map(
        (p) =>
          `#${p.number}: read ${p.comments.nodes.length} of ${p.comments.totalCount} comments, so later verdicts are missing from its row`,
      ),
  ]
}

if (import.meta.main) {
  const at = process.argv.indexOf("--since")
  const since = at === -1 ? undefined : process.argv[at + 1]
  if (!since || Number.isNaN(Date.parse(since))) {
    console.error("usage: table.ts --since <ISO 8601 time>")
    process.exit(2)
  }
  const repo = await factoryRepoOf()
  let found = 0
  const prs = await readAll(async (after) => {
    const gh = Bun.spawnSync(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${QUERY}`,
        "-f",
        `q=${searchOf(repo, since)}`,
        ...(after ? ["-f", `after=${after}`] : []),
      ],
      { stderr: "pipe", stdout: "pipe" },
    )
    const answer = gh.exitCode === 0 ? JSON.parse(gh.stdout.toString()) : null
    if (answer?.errors) console.error(JSON.stringify(answer.errors))
    if (!answer?.data?.search) {
      console.error(gh.stderr.toString().trim() || JSON.stringify(answer))
      process.exit(1)
    }
    found = answer.data.search.issueCount ?? found
    return answer.data.search as Page
  })
  console.log(rowsOf(prs, repo.split("/")[0]!, new Date()).join("\n"))
  // GitHub's search returns at most 1000 results, so a since that far back reads short
  if (found > prs.length) console.log(`read ${prs.length} of ${found} PRs: give a later --since`)
}
