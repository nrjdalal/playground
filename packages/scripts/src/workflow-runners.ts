// The runner guard: a workflow that names a self-hosted runner lets a fork's pull request run its code on that machine, so on a public repo every job runs on a hosted image.

// Labels that only a self-hosted runner carries.
export const FORBIDDEN_LABELS = ["Linux", "X64", "mac", "playground", "self-hosted"]

const HOSTED = /^(ubuntu|macos|windows)-[\w.]+$/
const MATRIX = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/

type Step = { uses?: unknown; with?: { ref?: unknown } }
type Job = { "runs-on"?: unknown; steps?: Step[]; strategy?: { matrix?: Record<string, unknown> } }

const triggers = (on: unknown): string[] =>
  typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : Object.keys(on ?? {})

// One problem per rule broken, naming the file, the job and the rule: (1) runs-on is one hosted image, a matrix value counting when every value it lists is one; (2) no self-hosted runner's label; (3) no other expression; (4) no object form (group: or labels:); (5) no pull_request_target or workflow_run trigger beside a checkout of the PR's head, which runs with the base repo's secrets.
export const runnerProblems = (name: string, text: string): string[] => {
  let doc: { jobs?: Record<string, Job>; on?: unknown }
  try {
    doc = Bun.YAML.parse(text) as typeof doc
  } catch (error) {
    return [`${name}: does not parse, so no job in it can be checked (${String(error)})`]
  }
  const problems: string[] = []
  const jobs = Object.entries(doc?.jobs ?? {})
  for (const [id, job] of jobs) {
    const at = `${name} job ${id}:`
    const runsOn = job["runs-on"]
    if (runsOn && typeof runsOn === "object" && !Array.isArray(runsOn)) {
      problems.push(`${at} rule 4, runs-on in the object form reaches runner groups`)
      continue
    }
    const labels = (Array.isArray(runsOn) ? runsOn : [runsOn]).map(String)
    const values = labels.flatMap((label) => {
      const listed = job.strategy?.matrix?.[label.match(MATRIX)?.[1] ?? ""]
      return Array.isArray(listed) ? listed.map(String) : [label]
    })
    if (labels.length !== 1 || values.some((value) => !HOSTED.test(value)))
      problems.push(
        `${at} rule 1, runs-on ${JSON.stringify(runsOn ?? null)} is not one hosted image`,
      )
    const forbidden = values.filter((value) => FORBIDDEN_LABELS.includes(value))
    if (forbidden.length)
      problems.push(`${at} rule 2, names a self-hosted runner's label: ${forbidden.join(", ")}`)
    const expressions = values.filter((value) => value.includes("${{"))
    if (expressions.length)
      problems.push(`${at} rule 3, picks its runner by an expression: ${expressions.join(", ")}`)
  }
  const risky = triggers(doc?.on).filter((t) => t === "pull_request_target" || t === "workflow_run")
  const headCheckout = jobs.some(([, job]) =>
    (job.steps ?? []).some(
      (step) =>
        String(step.uses ?? "").startsWith("actions/checkout") &&
        String(step.with?.ref ?? "").includes(".head"),
    ),
  )
  if (risky.length && headCheckout)
    problems.push(`${name}: rule 5, ${risky.join(", ")} checks out the pull request's head`)
  return problems
}
