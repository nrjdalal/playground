// `bun run release:notes <from-tag> <to-tag>` prints a ship's GitHub release notes in ZeroStarter's shape (notes.ts) from GitHub's compare of the two tags, for the release skill's step 4 to pass as `gh release create --notes-file`; it writes nothing.
import { renderNotes, type NoteCommit } from "./notes"

type Compared = {
  commits: {
    author: { login: string } | null
    commit: { author: { name: string } | null; message: string }
    parents: unknown[]
    sha: string
  }[]
  total_commits: number
}

const gh = (...args: string[]): string => {
  const run = Bun.spawnSync(["gh", ...args], { stderr: "pipe", stdout: "pipe" })
  if (run.exitCode !== 0) {
    console.error(`release:notes: gh ${args.join(" ")} failed: ${run.stderr.toString().trim()}`)
    process.exit(1)
  }
  return run.stdout.toString()
}

const [from, to] = process.argv.slice(2)
if (!from || !to) {
  console.error("usage: bun run release:notes <from-tag> <to-tag>")
  process.exit(1)
}
const repo = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").trim()
const commits: NoteCommit[] = []
for (let page = 1; ; page++) {
  const compared = JSON.parse(
    gh("api", `repos/${repo}/compare/${from}...${to}?per_page=100&page=${page}`),
  ) as Compared
  for (const c of compared.commits)
    commits.push({
      login: c.author?.login ?? null,
      message: c.commit.message,
      name: c.commit.author?.name || null,
      parents: c.parents.length,
      sha: c.sha,
    })
  if (compared.commits.length < 100 || commits.length >= compared.total_commits) break
}
process.stdout.write(renderNotes({ commits, from, repo, to }))
