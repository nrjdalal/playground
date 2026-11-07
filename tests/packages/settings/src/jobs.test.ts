import { describe, expect, test } from "bun:test"

import {
  checkSetting,
  importedJob,
  JOBS,
  jobKey,
  jobSchema,
  orgJobs,
  plistProgram,
  renderJobs,
  settingFields,
  settingsFor,
} from "../../../../packages/settings/src"

const fill = {
  bun: "/b/bun",
  checkout: "/c",
  dashboard: "/c/desk",
  data: "/d",
  path: "/usr/bin:/bin",
}

const ON_BY_DEFAULT = ["ops-dashboard", "ops-usage"]

describe("the job registry", () => {
  test("each shipped job is a jobs.<camelName> setting, off by default but the Dashboard's and the usage read", () => {
    expect(jobKey("ops-merge-train")).toBe("jobs.opsMergeTrain")
    const keys = settingFields().map(({ key }) => key)
    for (const [name, job] of Object.entries(JOBS)) {
      expect(keys).toContain(jobKey(name))
      expect([name, job.enabled]).toEqual([name, ON_BY_DEFAULT.includes(name)])
    }
    expect(Object.keys(JOBS)).toEqual([...Object.keys(JOBS)].sort())
  })

  test("a fresh install renders every job paused but the Dashboard's and the usage read, with its placeholders filled", () => {
    const { jobs, plists } = renderJobs({}, [], fill)
    expect(jobs.map((job) => job.name)).toEqual(Object.keys(JOBS))
    expect(jobs.filter((job) => job.disabled !== true).map((job) => job.name)).toEqual(
      ON_BY_DEFAULT,
    )
    expect(jobs.find((job) => job.name === "ops-sweep")).toMatchObject({
      command: "/b/bun --no-env-file /c/packages/scripts/src/ops-sweep/cli.ts",
      cwd: "/c",
    })
    expect(plists.size).toBe(0)
  })

  test("the Dashboard's job runs its own checkout's run.sh from that checkout, the one its supervisor rolls", () => {
    const { jobs } = renderJobs({}, [], { ...fill, dashboard: "/c/.claude/worktrees/desk" })
    expect(jobs.find((job) => job.name === "ops-dashboard")).toMatchObject({
      command: "/c/.claude/worktrees/desk/scripts/ops/dashboard/run.sh",
      cwd: "/c/.claude/worktrees/desk",
    })
  })

  test("the Changelog's job runs its script from the Dashboard's checkout, the one that holds the database's .env", () => {
    const { jobs } = renderJobs({}, [], { ...fill, dashboard: "/c/.claude/worktrees/desk" })
    expect(jobs.find((job) => job.name === "ops-changelog")).toMatchObject({
      command:
        "/b/bun --no-env-file /c/.claude/worktrees/desk/packages/scripts/src/ops-changelog/cli.ts",
      cwd: "/c/.claude/worktrees/desk",
    })
  })

  test("a job turned on renders without its pause, and a launchd one gets its plist", () => {
    const tick = { ...JOBS["ops-tick"]!, enabled: true }
    const sweep = { ...JOBS["ops-sweep"]!, enabled: true, schedule: { every: 120 } }
    const { jobs, plists } = renderJobs(
      { [jobKey("ops-tick")]: tick, [jobKey("ops-sweep")]: sweep },
      [],
      fill,
    )
    const rendered = jobs.find((job) => job.name === "ops-sweep")!
    expect(rendered.disabled).toBeUndefined()
    expect(rendered.schedule).toEqual({ every: 120 })
    const entry = jobs.find((job) => job.name === "ops-tick")!
    expect(entry).toMatchObject({ launchd: "com.playground.ops-tick", name: "ops-tick" })
    expect(entry.command).toBeUndefined()
    const plist = plists.get("com.playground.ops-tick")!
    expect(plist).toContain("<string>/c/packages/scripts/src/ops-tick/cli.ts</string>")
    expect(plist).toContain("<string>/d/ops/tick/launchd.log</string>")
    expect([...plists.keys()]).toEqual(["com.playground.ops-tick"])
  })

  test("a value its schema refuses falls back to the default, and a job the registry does not know is kept as it stands", () => {
    const company = { command: "~/x/run.sh", heartbeat: "ops-company", name: "ops-company" }
    const { jobs } = renderJobs(
      { [jobKey("ops-sweep")]: { enabled: "yes" } },
      [company, { name: "ops-sweep" }],
      fill,
    )
    expect(jobs.find((job) => job.name === "ops-sweep")!.disabled).toBe(true)
    expect(jobs.find((job) => job.name === "ops-company")).toEqual(company)
    expect(jobs.filter((job) => job.name === "ops-sweep")).toHaveLength(1)
    expect(jobs.map((job) => job.name)).toEqual([...jobs.map((job) => job.name)].sort())
  })

  test("a stored row naming cmux, auto or herdr loads and runs in herdr, and one with an unknown key is skipped", () => {
    const sweep = jobKey("ops-sweep")
    const stored = (value: Record<string, unknown>) =>
      renderJobs(
        settingsFor([{ key: sweep, scope: "me", value }], "me").values,
        [],
        fill,
      ).jobs.find((job) => job.name === "ops-sweep")!
    const on = { ...JOBS["ops-sweep"]!, enabled: true }
    for (const row of [{ ...on, runtime: "cmux" }, { ...on, runtime: "auto" }, on]) {
      expect(stored(row).disabled).toBeUndefined()
      expect(stored(row).runtime).toBe("herdr")
    }
    expect(stored({ ...on, madeUp: true }).disabled).toBe(true)
  })

  test("a stored row that still carries needsCmux loads with its enabled state and without the field, and one that set it with no runtime runs in herdr", () => {
    const stored = (name: string, value: Record<string, unknown>) =>
      renderJobs(
        settingsFor([{ key: jobKey(name), scope: "me", value }], "me").values,
        [],
        fill,
      ).jobs.find((job) => job.name === name)!
    for (const name of Object.keys(JOBS)) expect(JOBS[name]).not.toHaveProperty("needsCmux")
    const sweep = { ...JOBS["ops-sweep"]!, enabled: true }
    const { runtime: _, ...noRuntime } = sweep
    for (const [row, runtime] of [
      [{ ...sweep, needsCmux: true }, "herdr"],
      [{ ...sweep, needsCmux: false, runtime: "cmux" }, "herdr"],
      [{ ...noRuntime, needsCmux: true }, "herdr"],
      // a field the row leaves out reads the registry's, ops-sweep's herdr (PG-1196)
      [{ ...noRuntime, needsCmux: false }, "herdr"],
    ] as const) {
      const job = stored("ops-sweep", row)
      expect(job.disabled).toBeUndefined()
      expect(job.runtime).toBe(runtime)
      expect(job).not.toHaveProperty("needsCmux")
    }
    expect(stored("ops-sweep", { ...sweep, needsCmux: true, madeUp: true }).disabled).toBe(true)
    const tick = stored("ops-tick", { ...JOBS["ops-tick"]!, enabled: false, needsCmux: false })
    expect(tick.disabled).toBe(true)
    expect(tick).not.toHaveProperty("needsCmux")
    const company = { command: "~/x/run.sh", heartbeat: "ops-company", name: "ops-company" }
    const kept = { ...company, needsCmux: true }
    const { jobs } = renderJobs({}, [kept], fill)
    expect(jobs.find((job) => job.name === "ops-company")).toEqual({ ...company, runtime: "herdr" })
  })

  test("its schema takes every shape the runner reads, and refuses a job with no schedule", () => {
    expect(
      jobSchema.safeParse({ ...JOBS["ops-dashboard"], pausedFor: "a made-up reason" }).success,
    ).toBe(true)
    const { schedule: _, ...noSchedule } = JOBS["ops-dashboard"]!
    expect(jobSchema.safeParse(noSchedule).success).toBe(false)
  })

  test("the login's job wins over its org's, whichever way it turns it", () => {
    const tick = jobKey("ops-tick")
    const row = (scope: string, enabled: boolean) => ({
      key: tick,
      scope,
      value: { ...JOBS["ops-tick"]!, enabled },
    })
    const linked = [
      { key: "ext.links", scope: "me", value: { acme: ["acme"] } },
      { key: "ext.order", scope: "me", value: ["me", "acme"] },
    ]
    const on = settingsFor([...linked, row("acme", false), row("me", true)], "me", "acme").values
    expect([...renderJobs(on, [], fill).plists.keys()]).toEqual(["com.playground.ops-tick"])
    const off = settingsFor([...linked, row("acme", true), row("me", false)], "me", "acme").values
    expect(renderJobs(off, [], fill).plists.size).toBe(0)
    expect(renderJobs(off, [], fill).jobs.find((job) => job.name === "ops-tick")!.disabled).toBe(
      true,
    )
  })

  test("a listed job imports over its default, and one with a field its schema refuses says which", () => {
    expect(importedJob({ name: "ops-company" }, null)).toEqual({ kept: "ops-company" })
    const refused = importedJob({ name: "ops-sweep", schedule: { every: -1 } }, null)
    expect(refused).toEqual({ problem: expect.stringContaining("ops-sweep: schedule") })
    const sweep = importedJob({ disabled: true, name: "ops-sweep", pausedFor: "made-up" }, null)
    expect(sweep).toMatchObject({
      key: "jobs.opsSweep",
      value: { enabled: false, pausedFor: "made-up" },
    })
    const old = importedJob({ name: "ops-sweep", needsCmux: true }, null)
    expect(old).toMatchObject({ key: "jobs.opsSweep", value: { enabled: true, runtime: "herdr" } })
    expect("value" in old && old.value).not.toHaveProperty("needsCmux")
  })

  test("a plist's program and folder read from its XML, and a plist with none reads as null", () => {
    const xml =
      "<key>ProgramArguments</key>\n<array>\n<string>/b/bun</string><string>a &amp; b</string></array><key>WorkingDirectory</key><string>/r</string>"
    expect(plistProgram(xml)).toEqual({ cwd: "/r", program: ["/b/bun", "a & b"] })
    expect(plistProgram("bplist00")).toBeNull()
  })
})

// PG-1196: a job's row may hold its enabled field alone, which every reader sees over the registry's entry, so a later change to the registry still reaches a job the owner turned on.
describe("a job's row holding some of its fields (PG-1196)", () => {
  const sweep = jobKey("ops-sweep")
  const on = (value: object) => settingsFor([{ key: sweep, scope: "me", value }], "me").values

  test("its setting takes some of a job's fields, refuses a field no job has, and no job the registry does not name", () => {
    expect(checkSetting(sweep, { enabled: true })).toEqual({
      key: sweep,
      ok: true,
      value: { enabled: true },
    })
    expect(checkSetting(sweep, { enabled: true, madeUp: 1 }).ok).toBe(false)
    expect(checkSetting(sweep, { enabled: "yes" }).ok).toBe(false)
    expect(checkSetting("jobs.notAJob", { enabled: true }).ok).toBe(false)
  })

  test("a row holding enabled alone reads as the registry's job turned on, and a registry change after it reaches the job", () => {
    expect(on({ enabled: true })[sweep]).toEqual({ ...JOBS["ops-sweep"], enabled: true })
    const job = JOBS["ops-sweep"]!
    const before = job.description
    try {
      job.description = "A made-up description the registry moved to."
      expect(on({ enabled: true })[sweep]).toMatchObject({
        description: "A made-up description the registry moved to.",
        enabled: true,
      })
    } finally {
      job.description = before
    }
  })

  test("a launchd job turned on by enabled alone renders its plist from the registry's label and program", () => {
    const tick = jobKey("ops-tick")
    const values = settingsFor([{ key: tick, scope: "me", value: { enabled: true } }], "me").values
    expect([...renderJobs(values, [], fill).plists.keys()]).toEqual(["com.playground.ops-tick"])
    expect(renderJobs(values, [], fill).jobs.find((job) => job.name === "ops-tick")).toMatchObject({
      launchd: "com.playground.ops-tick",
    })
  })

  test("a row's own fields win over the registry's, so a whole row stored before reads as it did", () => {
    expect(on({ enabled: true, schedule: { every: 7 } })[sweep]).toMatchObject({
      enabled: true,
      heartbeat: "ops-sweep",
      schedule: { every: 7 },
    })
    const whole = { ...JOBS["ops-sweep"]!, enabled: true, pausedFor: "made-up" }
    expect(on(whole)[sweep]).toEqual(whole)
  })
})

describe("an org's own job row (PG-1335)", () => {
  const watch = {
    callsModel: false,
    command: "{bun} --no-env-file {data}/ops/ops-watch/cli.ts --data {data}",
    cwd: "{data}/ops/ops-watch",
    description: "Watches an org's own queue.",
    enabled: true,
    heartbeat: "ops-watch",
    schedule: { always: true },
  }
  const scripts = { acme: ["ops-watch"], globex: ["ops-watch"] }
  const rows = (...list: [string, string, unknown][]) =>
    list.map(([scope, key, value]) => ({ key, scope, value }))
  const one = (value: unknown, scope = "acme", key = "jobs.opsWatch") =>
    orgJobs(rows([scope, key, value]), "tester", scripts)

  test("an org-scope row for a job the registry lacks renders into jobs.json, its command filled from the org's script folder", () => {
    const org = one({ ...watch, config: { prefixes: ["INC"] } })
    expect(org.refused).toEqual([])
    const { jobs } = renderJobs({}, [], fill, org.jobs)
    expect(jobs.find((job) => job.name === "ops-watch")).toEqual({
      callsModel: false,
      command: "/b/bun --no-env-file /d/ops/ops-watch/cli.ts --data /d",
      config: { prefixes: ["INC"] },
      cwd: "/d/ops/ops-watch",
      description: "Watches an org's own queue.",
      heartbeat: "ops-watch",
      name: "ops-watch",
      schedule: { always: true },
    })
  })

  test("a row with no cwd runs from its script folder, and one turned off renders paused", () => {
    const { cwd: _, ...rest } = watch
    const { jobs } = renderJobs({}, [], fill, one({ ...rest, enabled: false }).jobs)
    expect(jobs.find((job) => job.name === "ops-watch")).toMatchObject({
      cwd: "/d/ops/ops-watch",
      disabled: true,
    })
  })

  test.each([
    [
      "a command run from the checkout",
      { command: "{bun} {checkout}/packages/scripts/src/ops-watch/cli.ts" },
    ],
    ["a command run by another program", { command: "/bin/sh {data}/ops/ops-watch/run.sh" }],
    ["a script folder the org does not ship", { command: "{bun} {data}/ops/other/cli.ts" }],
    ["a .. segment out of the folder", { command: "{bun} {data}/ops/ops-watch/../x/cli.ts" }],
    [
      "a shell operator after the script",
      { command: "{bun} {data}/ops/ops-watch/cli.ts; touch x" },
    ],
    [
      "another placeholder in an argument",
      { command: "{bun} {data}/ops/ops-watch/cli.ts {checkout}" },
    ],
    ["a cwd outside the folder", { cwd: "{checkout}" }],
    ["a cwd in another script folder", { cwd: "{data}/ops/ops-watchers" }],
    ["a launchd label", { launchd: "com.playground.ops-dashboard" }],
    ["a program", { program: ["{bun}", "{data}/ops/ops-watch/cli.ts"] }],
    ["a config that is a list", { config: ["INC"] }],
    ["a config that is text", { config: "INC" }],
  ])("a row with %s is refused, named with its org and key, and nothing renders", (_, change) => {
    const org = one({ ...watch, ...change })
    expect(org.jobs).toEqual({})
    expect(org.refused).toHaveLength(1)
    expect(org.refused[0]).toStartWith("jobs: refused acme jobs.opsWatch: ")
    expect(renderJobs({}, [], fill, org.jobs).jobs.map((job) => job.name)).not.toContain(
      "ops-watch",
    )
  })

  test("a login-scope row for a job the registry lacks stays refused", () => {
    const org = one(watch, "tester")
    expect(org.jobs).toEqual({})
    expect(org.refused).toEqual([
      "jobs: refused tester jobs.opsWatch: only an org's scope may add a job the registry lacks",
    ])
  })

  test("a row for a registry job is left to the registry, and two orgs naming one job render the first", () => {
    expect(one(watch, "acme", "jobs.opsSweep")).toEqual({ jobs: {}, refused: [] })
    const org = orgJobs(
      rows(
        ["acme", "jobs.opsWatch", watch],
        ["globex", "jobs.opsWatch", { ...watch, description: "Theirs." }],
      ),
      "tester",
      scripts,
    )
    expect(org.jobs["ops-watch"]?.description).toBe("Watches an org's own queue.")
    expect(org.refused).toEqual(["jobs: refused globex jobs.opsWatch: acme already adds ops-watch"])
  })

  test("an org's job replaces a hand-kept jobs.json row of its name", () => {
    const { jobs } = renderJobs({}, [{ command: "old", name: "ops-watch" }], fill, one(watch).jobs)
    expect(jobs.filter((job) => job.name === "ops-watch")).toHaveLength(1)
    expect(jobs.find((job) => job.name === "ops-watch")?.command).not.toBe("old")
  })

  test("a registry job's row renders as before without config, and with config only adds it", () => {
    const before = renderJobs({}, [], fill).jobs.find((job) => job.name === "ops-sweep")
    const withConfig = renderJobs(
      { [jobKey("ops-sweep")]: { ...JOBS["ops-sweep"], config: { a: 1 } } },
      [],
      fill,
    ).jobs.find((job) => job.name === "ops-sweep")
    expect(withConfig).toEqual({ ...before, config: { a: 1 } })
    expect(jobSchema.safeParse({ ...JOBS["ops-sweep"], config: [1] }).success).toBe(false)
    expect(checkSetting(jobKey("ops-sweep"), { config: "a" }).ok).toBe(false)
    expect(checkSetting(jobKey("ops-sweep"), { config: { a: 1 } }).ok).toBe(true)
  })
})
