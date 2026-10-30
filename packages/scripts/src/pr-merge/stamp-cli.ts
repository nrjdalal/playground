import { parseArgs } from "node:util"

import {
  carried,
  CHECK_STATUSES,
  JOB_CHECKS,
  jobsStamp,
  readsOf,
  STAMP_STATUSES,
  stampAt,
  stampsAt,
  stampsIn,
  stampText,
  type CheckRun,
  type Exec,
  type Said,
  type StampCheck,
  type StampStatus,
} from "./stamp"

const USAGE = `Usage: bun run stamp <command> [options]

The stamp: the one comment every tester posts, a YAML block of status, commit,
checks and remark. Only the repo owner's stamps count.

  post <sha> <${STAMP_STATUSES.join("|")}> [--pr <n>] [--check "<name>=<${CHECK_STATUSES.join("|")}>[@<source>] [<comment>]"]... [--remark <sentence>]
            posts the stamp on PR <n> (Checks, the tester, the train's step, the reviewer's
            look), or with no --pr as a comment on commit <sha> (canary's own run); each
            --check adds a check, its source agent for an agent- check and only there, else
            a GitHub run id or local (the default), and its comment why; --remark is the stamp's
            own; a comment or remark may be left out, and is one sentence of at most 20 words,
            such as --check "verify=skip The diff has no dashboard code."
  carried <n> <sha>
            prints green=true when a green stamp holds at <sha> and every check GitHub's jobs
            run passed in it, on it or carried past clean canary merges and the reviewer's looks,
            else green=false; the workflows skip their steps on true
  read <n> <sha>
            prints what the stamp reads at <sha> as JSON (at, passed, reach, stamps, status,
            why), or {"error": ...}; ops-checks-go reads it to skip a head whose verify holds
  jobs <n> <sha>
            posts the stamp GitHub's gate jobs earned at <sha>: wait while one is queued,
            running or cancelled, else green or red, with verify skipped off the dashboard's code,
            unless it holds already or a green carries; ops-checks-go runs it on every PR with a go

--repo <owner/name> names the repo (default: GITHUB_REPOSITORY, else gh's own). git must
hold <sha> and origin/canary.`

const exec =
  (bin: string): Exec =>
  async (args) => {
    const proc = Bun.spawn([bin, ...args], { stderr: "pipe", stdin: "ignore", stdout: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stderr, stdout }
  }

const gh = exec("gh")
const git = exec("git")

const fail = (why: string): never => {
  console.error(`stamp: ${why}`)
  process.exit(1)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    check: { multiple: true, type: "string" },
    help: { short: "h", type: "boolean" },
    pr: { type: "string" },
    remark: { type: "string" },
    repo: { type: "string" },
  },
})
const [command] = positionals
if (values.help || !command) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}
const repo =
  values.repo ??
  process.env.GITHUB_REPOSITORY ??
  (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).stdout.trim()
const owner = repo.split("/")[0] ?? ""
const full = (sha = "") => (/^[0-9a-f]{40}$/.test(sha) ? sha : fail(`"${sha}" is not a full sha`))

const comments = async (
  n: string,
  where = `repos/${repo}/issues/${n}/comments`,
): Promise<Said[]> => {
  const listed = await gh([
    "api",
    where,
    "--paginate",
    "--jq",
    ".[] | {author: .user.login, body: .body, createdAt: .created_at, url: .html_url} | tojson",
  ])
  if (listed.code !== 0) fail(`the comments on ${n} did not read: ${listed.stderr.trim()}`)
  return listed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Said)
}

const post = async (body: string, n?: string, sha?: string) => {
  const where = n ? `repos/${repo}/issues/${n}/comments` : `repos/${repo}/commits/${sha}/comments`
  const done = await gh(["api", "-X", "POST", where, "-f", `body=${body}`, "--jq", ".html_url"])
  if (done.code !== 0) fail(`GitHub refused it: ${done.stderr.trim()}`)
  console.log(done.stdout.trim())
}

if (command === "post") {
  const [, sha, status] = positionals
  if (positionals.length !== 3 || !STAMP_STATUSES.includes(status as StampStatus)) fail(USAGE)
  const checks: Record<string, StampCheck> = {}
  for (const given of values.check ?? []) {
    const m = /^([^=\s]+)=(\w+)(?:@(\S+))?(?:\s+(.+))?$/.exec(given)
    if (!m || !CHECK_STATUSES.includes(m[2] as StampCheck["status"]))
      fail(
        `--check takes "<name>=<${CHECK_STATUSES.join("|")}>[@<source>] [<comment>]", not "${given}"`,
      )
    const name = m?.[1] ?? ""
    const source = m?.[3] ?? (name.startsWith("agent-") ? "agent" : "local")
    const status = m?.[2] as StampCheck["status"]
    checks[name] = m?.[4] ? { comment: m[4], source, status } : { source, status }
  }
  const commit = full(sha)
  let body = ""
  try {
    const keys = { checks, commit, status: status as StampStatus }
    body = stampText(values.remark === undefined ? keys : { ...keys, remark: values.remark })
  } catch (error) {
    fail((error as Error).message)
  }
  await post(body, values.pr, commit)
} else if (command === "carried" || command === "jobs" || command === "read") {
  const [, n = "", sha] = positionals
  const head = full(sha)
  if (!/^\d+$/.test(n)) fail(`"${n}" is not a PR number`)
  const read = await stampAt(head, await comments(n), owner, readsOf(git)).catch(
    (error: Error) => error.message,
  )
  // canary's tip's stamps: while they read red, no carried green skips the jobs, so the fix runs on its own head
  const tip = (await git(["rev-parse", "origin/canary"])).stdout.trim()
  const canary = /^[0-9a-f]{40}$/.test(tip)
    ? stampsAt(
        stampsIn(
          await comments(`canary ${tip.slice(0, 7)}`, `repos/${repo}/commits/${tip}/comments`),
          owner,
        ),
        tip,
      )
    : []
  if (command === "read") {
    console.log(JSON.stringify(typeof read === "string" ? { error: read } : read))
  } else if (command === "carried") {
    const { green, why } = carried(read, canary)
    console.error(why)
    console.log(`green=${green}`)
  } else {
    if (typeof read === "string") fail(read)
    const listed = await gh([
      "api",
      `repos/${repo}/commits/${head}/check-runs`,
      "--paginate",
      "--jq",
      ".check_runs[] | {conclusion, html_url, id, name, started_at, status} | tojson",
    ])
    if (listed.code !== 0) fail(`the check runs did not read: ${listed.stderr.trim()}`)
    const runs = listed.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CheckRun)
    // a gate job that ended in success with a skipped step ran under a carry, so it ran nothing new
    for (const job of runs.filter((r) => r.name in JOB_CHECKS && r.conclusion === "success")) {
      const steps = await gh([
        "api",
        `repos/${repo}/actions/jobs/${job.id}`,
        "--jq",
        '[.steps[] | select(.conclusion == "skipped")] | length > 0',
      ])
      if (steps.code !== 0) fail(`the steps of ${job.name} did not read: ${steps.stderr.trim()}`)
      job.skippedSteps = steps.stdout.trim() === "true"
    }
    const files = await gh([
      "api",
      `repos/${repo}/pulls/${n}/files`,
      "--paginate",
      "--jq",
      ".[].filename",
    ])
    if (files.code !== 0) fail(`the files of #${n} did not read: ${files.stderr.trim()}`)
    // gates.ts reads the workspace's packages, which carried runs before its install
    const { touchesDashboard } = await import("./gates")
    const dashboard = touchesDashboard(files.stdout.split("\n").filter(Boolean))
    const body = jobsStamp(
      typeof read === "string" ? undefined : read,
      head,
      runs,
      canary,
      dashboard,
    )
    if (body) await post(body, n)
  }
} else fail(USAGE)
