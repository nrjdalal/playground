// The retro's per-PR table: every factory PR updated since a time, read in one batched GraphQL search, one tab-separated row each, from its first commit to its merge (or now), with its commits, force pushes, review rounds and their scores, and tester reports.
import { factoryRepoOf } from "../playground/setting"

export const QUERY = `query ($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        state
        title
        mergedAt
        firstCommit: commits(first: 1) { nodes { commit { authoredDate } } }
        allCommits: commits { totalCount }
        comments(first: 100) { nodes { body } }
        timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], first: 1) { totalCount }
      }
    }
  }
}`

export type Pr = {
  allCommits: { totalCount: number }
  comments: { nodes: { body: string }[] }
  firstCommit: { nodes: { commit: { authoredDate: string } }[] }
  mergedAt: string | null
  number: number
  state: string
  timelineItems: { totalCount: number }
  title: string
}

export const searchOf = (repo: string, since: string): string =>
  `repo:${repo} is:pr updated:>=${since}`

const ROUND = /^## ReviewBot · round (\d+): (\d)\/5/
const clock = (iso: string | null | undefined) => iso?.slice(11, 16) ?? "-"

// Pure: the table's header and one row per PR, by number.
export const rowsOf = (prs: Pr[], now: Date): string[] => [
  "pr\tstate\tfirst\tmerged\tmins\tcommits\tfp\trounds\tscores\ttests\ttitle",
  ...[...prs]
    .sort((a, b) => a.number - b.number)
    .map((p) => {
      const first = p.firstCommit.nodes[0]?.commit.authoredDate
      const end = p.mergedAt ?? now.toISOString()
      const scores = p.comments.nodes
        .map((c) => ROUND.exec(c.body))
        .filter((m) => m !== null)
        .map((m) => `${m[1]}:${m[2]}`)
      const tests = p.comments.nodes.filter((c) => c.body.startsWith("## TesterBot")).length
      return [
        p.number,
        p.state[0],
        clock(first),
        clock(p.mergedAt),
        first ? `${Math.round((Date.parse(end) - Date.parse(first)) / 60_000)}m` : "-",
        `c${p.allCommits.totalCount}`,
        `fp${p.timelineItems.totalCount}`,
        `r${scores.length}`,
        `[${scores.join(" ")}]`,
        `t${tests}`,
        p.title.slice(0, 60),
      ].join("\t")
    }),
]

if (import.meta.main) {
  const at = process.argv.indexOf("--since")
  const since = at === -1 ? undefined : process.argv[at + 1]
  if (!since || Number.isNaN(Date.parse(since))) {
    console.error("usage: table.ts --since <ISO 8601 time>")
    process.exit(2)
  }
  const gh = Bun.spawnSync(
    [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-f",
      `q=${searchOf(await factoryRepoOf(), since)}`,
    ],
    { stderr: "pipe", stdout: "pipe" },
  )
  if (gh.exitCode !== 0) {
    console.error(gh.stderr.toString().trim())
    process.exit(1)
  }
  const nodes = JSON.parse(gh.stdout.toString()).data.search.nodes as Pr[]
  console.log(rowsOf(nodes, new Date()).join("\n"))
}
