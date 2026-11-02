import { describe, expect, test } from "bun:test"

import {
  checkSetting,
  importedJob,
  JOBS,
  jobKey,
  jobSchema,
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

  test("the channel watch is a setting, off by default, that jobs.json lists running its cli once turned on", () => {
    const key = jobKey("ops-channel-watch")
    const { field } = settingFields().find((f) => f.key === key)!
    expect(field.description).toContain("channel.slackId")
    expect(field.description).toContain("local.slack.channel_token")
    expect(
      renderJobs({}, [], fill).jobs.find((job) => job.name === "ops-channel-watch")!.disabled,
    ).toBe(true)
    const set = checkSetting(key, { ...JOBS["ops-channel-watch"]!, enabled: true })
    expect(set).toMatchObject({ key: "jobs.opsChannelWatch", ok: true })
    const { jobs } = renderJobs({ [key]: set.ok && set.value }, [], fill)
    expect(jobs.find((job) => job.name === "ops-channel-watch")).toMatchObject({
      command: "/b/bun --no-env-file /c/packages/scripts/src/ops-channel-watch/cli.ts",
      cwd: "/c",
      heartbeat: "ops-channel-watch",
    })
    expect(jobs.find((job) => job.name === "ops-channel-watch")!.disabled).toBeUndefined()
  })

  test("the Dashboard's job runs its own checkout's run.sh from that checkout, the one its supervisor rolls", () => {
    const { jobs } = renderJobs({}, [], { ...fill, dashboard: "/c/.claude/worktrees/desk" })
    expect(jobs.find((job) => job.name === "ops-dashboard")).toMatchObject({
      command: "/c/.claude/worktrees/desk/scripts/ops/dashboard/run.sh",
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
      [{ ...noRuntime, needsCmux: false }, undefined],
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
