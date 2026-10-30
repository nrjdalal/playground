// audit-canary.ts <audit args>: audits canary's own head and keeps one bump issue for it: opens `canary audit: <ids>` labelled `audit` when canary carries an advisory, adds a new id to the open one, and closes it once the audit is clean
// A PR's audit fails only on what it adds over canary (audit.ts --new-over), so this issue is where canary's own advisories surface

import { advisories, advisoryLine } from "./audit"

const LABEL = "audit"
const PREFIX = "canary audit: "

// GitHub's REST API, with no gh needed; Actions sets GITHUB_API_URL and GITHUB_REPOSITORY, and the tests point the first at a local server
// A refused or failed call warns (unless asked not to) and answers null, since the audit alone decides the run
const github = async (method: string, path: string, body?: object, warn = true) => {
  const api = process.env.GITHUB_API_URL || "https://api.github.com"
  const res = await fetch(`${api}/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    body: body && JSON.stringify(body),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GH_TOKEN}`,
    },
    method,
  }).catch((error: Error) => error)
  if (res instanceof Response && res.ok) return res.json()
  const answer = res instanceof Response ? `answered ${res.status}` : `failed: ${res.message}`
  if (warn)
    console.error(
      `audit-canary: warning: GitHub ${method} ${path} ${answer}, so the bump issue is not kept`,
    )
  return null
}

const main = async (args: string[]) => {
  const found = await advisories(process.cwd(), args)
  if (!found) return 1
  const at = process.env.GITHUB_SHA?.slice(0, 7) || "canary's head"
  const open: { number: number; pull_request?: object; title: string }[] | null = await github(
    "GET",
    `/issues?labels=${LABEL}&state=open&per_page=100`,
  )
  const lines = found.map((a) => `- ${advisoryLine(a)}`).join("\n")
  // a clean audit passes whatever GitHub answers, and an advisory no issue holds fails the run on its job log, so it never goes unseen
  const unheld = () => {
    console.error(`audit-canary: canary's audit finds, with no bump issue to hold them:\n${lines}`)
    return 1
  }
  if (!open) return found.length ? unheld() : 0
  // the issues endpoint lists PRs too, and an issue labelled audit for another reason keeps its own title
  const issue = open
    .filter((i) => !i.pull_request && i.title.startsWith(PREFIX))
    .sort((a, b) => a.number - b.number)[0]
  if (!found.length) {
    if (!issue) return 0
    await github("POST", `/issues/${issue.number}/comments`, {
      body: `canary's audit is clean at ${at}.`,
    })
    if (await github("PATCH", `/issues/${issue.number}`, { state: "closed" }))
      console.log(`audit-canary: clean, so #${issue.number} is closed`)
    return 0
  }
  if (!issue) {
    // a second create of the label fails harmlessly
    await github(
      "POST",
      "/labels",
      { color: "f97316", description: "canary's own audit", name: LABEL },
      false,
    )
    const ids = found.map((a) => a.id).join(", ")
    const body = `canary's audit at ${at} finds:\n\n${lines}\n\nA PR's audit fails only on an advisory it adds, so these hold no PR. Bump them by the audit skill; this issue closes itself once canary's audit is clean.`
    if (!(await github("POST", "/issues", { body, labels: [LABEL], title: PREFIX + ids })))
      return unheld()
    console.log(`audit-canary: opened ${PREFIX}${ids}`)
    return 0
  }
  const known = issue.title.slice(PREFIX.length).split(", ")
  const added = found.filter((a) => !known.includes(a.id))
  if (!added.length) {
    console.log(`audit-canary: #${issue.number} already names every advisory`)
    return 0
  }
  const title = PREFIX + [...known, ...added.map((a) => a.id)].join(", ")
  if (!(await github("PATCH", `/issues/${issue.number}`, { title }))) return unheld()
  await github("POST", `/issues/${issue.number}/comments`, {
    body: `canary's audit at ${at} also finds:\n\n${added.map((a) => `- ${advisoryLine(a)}`).join("\n")}`,
  })
  console.log(`audit-canary: added ${added.map((a) => a.id).join(", ")} to #${issue.number}`)
  return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
