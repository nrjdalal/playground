import { afterAll, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { jobsExit, renderJobsFile } from "../../../../../packages/scripts/src/playground/jobs"
import { writeFiles, writeRoot } from "../../../../../packages/settings/src/folder"
import { extensionsDir } from "../../../../../packages/settings/src/rendered"

const CHECKOUT = resolve(import.meta.dir, "../../../../..")
const scratch = mkdtempSync(join(tmpdir(), "jobs-render-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const fill = {
  bun: "/b/bun",
  checkout: "/c",
  dashboard: "/c/desk",
  data: "/d",
  path: "/usr/bin:/bin",
}
const tick = {
  callsModel: false,
  cwd: "{checkout}",
  description: "A made-up beat.",
  enabled: true,
  heartbeat: "ops-tick",
  launchd: "com.playground.ops-tick",
  needsCmux: false,
  program: ["{bun}", "{checkout}/packages/scripts/src/ops-tick/cli.ts"],
  schedule: { every: 60 },
}

// A data folder whose extensions root holds policy.json with the values given and the login tester, and any scope files given as <scope>/<path>.
const storeWith = (
  name: string,
  values: Record<string, unknown>,
  extra: [string, string][] = [],
) => {
  const data = join(scratch, name)
  writeRoot(
    extensionsDir(data),
    new Map([
      ["login", "tester\n"],
      ["policy.json", JSON.stringify({ orgs: {}, schemaVersion: 1, values })],
    ]),
  )
  for (const [path, text] of extra) {
    const [scope, ...rest] = path.split("/")
    writeFiles(data, scope!, new Map([[rest.join("/"), text]]), { author: "test", reason: "seed" })
  }
  return data
}

const run = async (data: string, jobs: string, launchAgents?: string) => {
  const out: string[] = []
  const err: string[] = []
  const code = await renderJobsFile(
    { data, fill, jobs, launchAgents },
    (l) => out.push(l),
    (l) => err.push(l),
  )
  return { code, err: err.join("\n"), out: out.join("\n") }
}

test("a machine with no store keeps its jobs.json untouched and exits 3", async () => {
  const jobs = join(scratch, "bare-jobs.json")
  writeFileSync(jobs, '{"jobs":[{"name":"ops-company"}]}\n')
  expect(await run(join(scratch, "no-store"), jobs)).toEqual({ code: 3, err: "", out: "" })
  expect(readFileSync(jobs, "utf8")).toBe('{"jobs":[{"name":"ops-company"}]}\n')
})

test("a fresh machine, with no store and no jobs.json, gets the registry's defaults: the Dashboard's job alone on", async () => {
  const jobs = join(scratch, "fresh", "ops", "jobs.json")
  const fresh = await run(join(scratch, "fresh"), jobs)
  expect(fresh).toEqual({ code: 0, err: "", out: "jobs: rendered jobs.json" })
  const rendered = JSON.parse(readFileSync(jobs, "utf8")).jobs as Record<string, unknown>[]
  expect(rendered.filter((job) => job.disabled !== true).map((job) => job.name)).toEqual([
    "ops-dashboard",
  ])
  expect((await run(join(scratch, "fresh"), jobs)).code).toBe(3)
})

test("a store renders jobs.json in the runner's shape, keeps a job it does not know, and writes the plist of each enabled launchd job", async () => {
  const data = storeWith("on", { "jobs.opsTick": tick })
  const jobs = join(scratch, "on-jobs.json")
  const agents = join(scratch, "on-agents")
  mkdirSync(agents)
  writeFileSync(join(agents, "com.playground.ops-flow.plist"), "stale")
  writeFileSync(join(agents, "com.other.keep.plist"), "theirs")
  writeFileSync(jobs, JSON.stringify({ jobs: [{ command: "~/x.sh", name: "ops-company" }] }))
  const first = await run(data, jobs, agents)
  expect(first.code).toBe(0)
  expect(first.out).toBe(
    "jobs: rendered jobs.json, com.playground.ops-tick, -com.playground.ops-flow.plist",
  )
  const rendered = JSON.parse(readFileSync(jobs, "utf8")).jobs as Record<string, unknown>[]
  expect(rendered.find((job) => job.name === "ops-company")).toEqual({
    command: "~/x.sh",
    name: "ops-company",
  })
  expect(rendered.find((job) => job.name === "ops-tick")!.disabled).toBeUndefined()
  expect(rendered.find((job) => job.name === "ops-sweep")!.disabled).toBe(true)
  expect(readFileSync(join(agents, "com.playground.ops-tick.plist"), "utf8")).toContain(
    "<string>/c/packages/scripts/src/ops-tick/cli.ts</string>",
  )
  expect(existsSync(join(agents, "com.playground.ops-flow.plist"))).toBe(false)
  expect(readFileSync(join(agents, "com.other.keep.plist"), "utf8")).toBe("theirs")
  expect((await run(data, jobs, agents)).out).toBe("jobs: unchanged")
})

test("each org's script folder is installed under ops beside the state its job keeps, and the login's own scripts are not", async () => {
  const data = storeWith("scripts", {}, [
    ["acme/scripts/watch/config.json", '{"places":[]}'],
    ["acme/scripts/watch/run.py", "print('watch')"],
    ["acme/scripts/watch/run.sh", "echo watch"],
    ["tester/scripts/backup.sh", "echo backup"],
  ])
  mkdirSync(join(data, "ops", "watch"), { recursive: true })
  writeFileSync(join(data, "ops", "watch", "state.json"), '{"seen":1}')
  const jobs = join(scratch, "scripts-jobs.json")
  const first = await run(data, jobs)
  expect(first.code).toBe(0)
  expect(first.out).toBe("jobs: rendered jobs.json, watch/config.json, watch/run.py, watch/run.sh")
  expect(readFileSync(join(data, "ops", "watch", "run.py"), "utf8")).toBe("print('watch')")
  expect(statSync(join(data, "ops", "watch", "run.sh")).mode & 0o777).toBe(0o755)
  expect(readFileSync(join(data, "ops", "watch", "state.json"), "utf8")).toBe('{"seen":1}')
  expect(existsSync(join(data, "ops", "backup.sh"))).toBe(false)
  expect((await run(data, jobs)).out).toBe("jobs: unchanged")
})

// ext init can stop after making the extensions root, before a first setting writes policy.json.
test("an extensions root that lacks policy.json gets the registry's defaults, as a fresh machine does", async () => {
  const data = join(scratch, "no-policy")
  writeRoot(extensionsDir(data), new Map([["hooks/a.json", "[]"]]))
  const jobs = join(scratch, "no-policy", "ops", "jobs.json")
  expect(await run(data, jobs)).toEqual({ code: 0, err: "", out: "jobs: rendered jobs.json" })
  const rendered = JSON.parse(readFileSync(jobs, "utf8")).jobs as Record<string, unknown>[]
  expect(rendered.filter((job) => job.disabled !== true).map((job) => job.name)).toEqual([
    "ops-dashboard",
  ])
})

test("a policy.json that does not parse is refused, exit 2, and jobs.json is kept", async () => {
  const data = join(scratch, "refused")
  writeRoot(extensionsDir(data), new Map([["policy.json", "{"]]))
  const jobs = join(scratch, "refused-jobs.json")
  writeFileSync(jobs, '{"jobs":[]}\n')
  const refused = await run(data, jobs)
  expect(refused.code).toBe(2)
  expect(refused.err).not.toBe("")
  expect(readFileSync(jobs, "utf8")).toBe('{"jobs":[]}\n')
})

test("the command line takes render and --jobs, and names its usage otherwise", async () => {
  const err: string[] = []
  expect(
    await jobsExit(
      ["draw"],
      {},
      () => {},
      (l) => err.push(l),
    ),
  ).toBe(2)
  expect(err.join("\n")).toContain("usage: bun packages/scripts/src/playground/jobs.ts render")
})

test("a render with no --data from a checkout that is not the live dashboard's writes nothing, exit 2", async () => {
  const err: string[] = []
  const jobs = join(scratch, "no-data-jobs.json")
  expect(
    await jobsExit(
      ["render", "--jobs", jobs],
      { CLAUDE_CONFIG_DIR: join(scratch, "no-data-config") },
      () => {},
      (l) => err.push(l),
    ),
  ).toBe(2)
  expect(err.join("\n")).toContain("writes nowhere until --data <folder> names where")
  expect(existsSync(jobs)).toBe(false)
  expect(existsSync(join(scratch, "no-data-config"))).toBe(false)
})

test("the command line's render runs the Dashboard's job from the Dashboard's checkout, which its supervisor rolls", async () => {
  const data = join(scratch, "cli-fresh")
  const jobs = join(data, "ops", "jobs.json")
  expect(
    await jobsExit(
      ["render", "--data", data, "--jobs", jobs],
      {},
      () => {},
      () => {},
    ),
  ).toBe(0)
  const rendered = JSON.parse(readFileSync(jobs, "utf8")).jobs as Record<string, unknown>[]
  const desk = join(CHECKOUT, ".claude", "worktrees", "desk")
  expect(rendered.find((job) => job.name === "ops-dashboard")).toMatchObject({
    command: `${desk}/scripts/ops/dashboard/run.sh`,
    cwd: desk,
  })
  expect(rendered.find((job) => job.name === "ops-sweep")!.cwd).toBe(CHECKOUT)
})
