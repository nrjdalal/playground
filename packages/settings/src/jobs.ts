import { z } from "zod"

import { defineSettings } from "@/settings"

// The ops job registry: one setting per job, `jobs.<camelName>`, holding the whole job, so turning a job on, pausing it or moving its schedule is a settings write with a reason, never a PR. The runner renders <data>/ops/jobs.json and each launchd job's plist from it at the top of every pass. A fresh install has every job off but the Dashboard's (ops-dashboard) and ops-usage, so the Dashboard shows the account's week with no setting. In a command, cwd or program, {bun}, {checkout} (the install's checkout), {dashboard} (the Dashboard's checkout, on live.branch) and {data} (the data folder) are filled in by the render.
export const jobSchema = z.strictObject({
  callsModel: z.boolean(),
  // A job a terminal holds (herdr, cmux or auto): its command, run from cwd.
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  description: z.string().min(1),
  disabledWhy: z.string().optional(),
  enabled: z.boolean(),
  heartbeat: z.string().min(1),
  // A job launchd holds: its label, and the program its plist runs from cwd.
  launchd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  needsCmux: z.boolean(),
  neverPause: z.boolean().optional(),
  pausedFor: z.string().optional(),
  program: z.array(z.string().min(1)).min(1).optional(),
  runtime: z.enum(["auto", "cmux", "herdr"]).optional(),
  schedule: z.union([
    z.strictObject({ always: z.literal(true) }),
    z.strictObject({ every: z.number().int().positive() }),
  ]),
  // The process group name a job's stop keys on (procs.sh), for a job that holds a stack.
  stop: z.string().min(1).optional(),
})
export type Job = z.infer<typeof jobSchema>

// A job's name as its setting key: ops-merge-train is jobs.opsMergeTrain.
export const jobKey = (name: string): string =>
  `jobs.${name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}`

const terminal = (
  name: string,
  command: string,
  job: Partial<Job> & Pick<Job, "description" | "schedule">,
): Job => ({
  callsModel: false,
  command,
  cwd: "{checkout}",
  enabled: false,
  heartbeat: name,
  needsCmux: true,
  runtime: "herdr",
  ...job,
})

const launchd = (name: string, job: Pick<Job, "description" | "schedule">): Job => ({
  callsModel: false,
  cwd: "{checkout}",
  enabled: false,
  heartbeat: name,
  launchd: `com.playground.${name}`,
  needsCmux: false,
  program: ["{bun}", "--no-env-file", `{checkout}/packages/scripts/src/${name}/cli.ts`],
  ...job,
})

const bunJob = (name: string) =>
  `{bun} --no-env-file {checkout}/packages/scripts/src/${name}/cli.ts`

// The jobs Playground ships, each off until the owner turns it on but the Dashboard's own; A to Z.
export const JOBS: Record<string, Job> = {
  "ops-awake": terminal("ops-awake", `${bunJob("ops-awake")} --data {data}`, {
    description: "Keeps the Mac awake on AC power with caffeinate, display and lock unchanged.",
    needsCmux: false,
    schedule: { always: true },
  }),
  "ops-changelog": terminal("ops-changelog", bunJob("ops-changelog"), {
    description: "Syncs new canary merges and main versions into the Changelog every 5 minutes.",
    schedule: { every: 300 },
  }),
  "ops-checks-go": terminal("ops-checks-go", "python3 -I {checkout}/scripts/ops/checks/go.py", {
    description: "Runs Checks on each gated PR scored 5/5 at its head, in merge-queue order.",
    needsCmux: false,
    schedule: { every: 120 },
  }),
  // The one job on by default: the Dashboard serves first run and every settings write, so a store with no row for it, or no store, keeps it running. It runs from the Dashboard's checkout, since its supervisor rolls the checkout it runs in and refuses any other branch.
  "ops-dashboard": terminal("ops-dashboard", "{dashboard}/scripts/ops/dashboard/run.sh", {
    cwd: "{dashboard}",
    description: "Keeps the live dashboard running on its branch's latest head.",
    enabled: true,
    schedule: { every: 60 },
    stop: "dashboard",
  }),
  "ops-ext-sync": terminal("ops-ext-sync", bunJob("ops-ext-sync"), {
    description:
      "Syncs each extension with its private repository at 02:30, pushed only after a clean secrets scan.",
    needsCmux: false,
    schedule: { every: 86400 },
  }),
  "ops-flow": launchd("ops-flow", {
    description: "Tells the leads when a ready PR's checks stall or a run slot is held too long.",
    schedule: { every: 60 },
  }),
  "ops-herdr": launchd("ops-herdr", {
    description:
      "Starts each herdr server that is down, on the pinned binary and the repo's config.",
    schedule: { every: 60 },
  }),
  "ops-machine": terminal("ops-machine", `${bunJob("ops-machine")} --data {data}`, {
    description:
      "Writes one line a minute of the machine's load, memory and live sessions to machine.jsonl.",
    needsCmux: false,
    schedule: { every: 60 },
  }),
  "ops-merge-train": terminal(
    "ops-merge-train",
    "python3 -I {checkout}/scripts/ops/merge-train/run.py",
    {
      description: "Runs the merge train: builds a train of ready PRs and checks each step.",
      neverPause: true,
      schedule: { every: 60 },
    },
  ),
  "ops-session-resume": launchd("ops-session-resume", {
    description: "Queues a carry-on line for each factory session once its usage limit resets.",
    schedule: { every: 60 },
  }),
  "ops-sweep": terminal("ops-sweep", bunJob("ops-sweep"), {
    description: "The Ops lead's sweep: runners, probes, asks, heartbeats and the forecast.",
    schedule: { every: 300 },
  }),
  "ops-tick": launchd("ops-tick", {
    description:
      "The factory's timed beats: the roll gate, the tick, the usage-limit watch and the sweeps.",
    schedule: { every: 60 },
  }),
  "ops-unstick": terminal("ops-unstick", "python3 -I {checkout}/scripts/ops/unstick/run.py", {
    description:
      "Reads every live session's screen and clears a factory session stuck on a prompt.",
    neverPause: true,
    schedule: { every: 120 },
  }),
  "ops-usage": terminal("ops-usage", "python3 -I {checkout}/scripts/ops/usage/run.py", {
    description: "Reads the account's usage windows into usage.json every 5 minutes.",
    enabled: true,
    neverPause: true,
    schedule: { every: 300 },
  }),
  "ops-zai-usage": launchd("ops-zai-usage", {
    description: "Reads the GLM plan's credits into zai-usage.json, which the spawn gate reads.",
    schedule: { every: 300 },
  }),
}

// A job's old setting keys: the switch imports jobs.json under its old names before the migration renames them.
const OLD_KEYS: Record<string, string[]> = { "ops-dashboard": ["jobs.opsDesk"] }

export const jobSettings = defineSettings(
  Object.fromEntries(
    Object.entries(JOBS).map(([name, job]) => [
      jobKey(name),
      {
        aliases: OLD_KEYS[name],
        default: job,
        description: `The ${name} ops job: ${job.description}`,
        schema: jobSchema,
      },
    ]),
  ),
)

export type Fill = { bun: string; checkout: string; dashboard: string; data: string; path: string }

const filled = (text: string, fill: Fill) =>
  text
    .replaceAll("{bun}", fill.bun)
    .replaceAll("{checkout}", fill.checkout)
    .replaceAll("{dashboard}", fill.dashboard)
    .replaceAll("{data}", fill.data)

const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

// A launchd job's plist: its label, its program from its cwd, kept alive, logging into its own folder under ops.
const plistOf = (name: string, job: Job, fill: Fill): string => {
  const log = `${fill.data}/ops/${name.replace(/^ops-/, "")}/launchd.log`
  const string = (text: string) => `<string>${xml(text)}</string>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>EnvironmentVariables</key><dict><key>PATH</key>${string(fill.path)}</dict>`,
    "  <key>KeepAlive</key><true/>",
    `  <key>Label</key>${string(job.launchd!)}`,
    `  <key>ProgramArguments</key><array>${job.program!.map((arg) => string(filled(arg, fill))).join("")}</array>`,
    "  <key>RunAtLoad</key><true/>",
    `  <key>StandardErrorPath</key>${string(log)}`,
    `  <key>StandardOutPath</key>${string(log)}`,
    `  <key>WorkingDirectory</key>${string(filled(job.cwd ?? fill.checkout, fill))}`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

// Pure: the registry's values (policy.json's, over each job's default) as jobs.json in the shape every reader parses, and an enabled launchd job's plist by label. A job jobs.json lists that the registry does not know (a company script, until the store holds it) is kept as it stands.
export const renderJobs = (
  values: Record<string, unknown>,
  existing: { name?: unknown }[],
  fill: Fill,
): { jobs: Record<string, unknown>[]; plists: Map<string, string> } => {
  const plists = new Map<string, string>()
  const jobs: Record<string, unknown>[] = Object.entries(JOBS).map(([name, fallback]) => {
    const set = jobSchema.safeParse(values[jobKey(name)])
    const { command, cwd, enabled, program, ...job } = set.success ? set.data : fallback
    if (enabled && job.launchd && program)
      plists.set(job.launchd, plistOf(name, { ...job, cwd, enabled, program }, fill))
    return {
      name,
      ...job,
      ...(command
        ? { command: filled(command, fill), cwd: filled(cwd ?? fill.checkout, fill) }
        : {}),
      ...(enabled ? {} : { disabled: true }),
    }
  })
  const known = new Set(Object.keys(JOBS))
  jobs.push(
    ...(existing.filter((job) => typeof job.name === "string" && !known.has(job.name)) as Record<
      string,
      unknown
    >[]),
  )
  return { jobs: jobs.sort((a, b) => String(a.name).localeCompare(String(b.name))), plists }
}

const LISTED_FIELDS = [
  "callsModel",
  "command",
  "cwd",
  "description",
  "disabledWhy",
  "heartbeat",
  "launchd",
  "model",
  "needsCmux",
  "neverPause",
  "pausedFor",
  "runtime",
  "schedule",
  "stop",
] as const

// The program and working folder a launchd plist runs, read from its XML; null for a plist that is not XML (a binary one) or holds no program.
export const plistProgram = (xmlText: string): { cwd?: string; program: string[] } | null => {
  const unescape = (text: string) =>
    text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
  const strings = (text: string) =>
    [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => unescape(match[1]!))
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xmlText)
  const program = array ? strings(array[1]!) : []
  if (!program.length) return null
  const cwd = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(xmlText)?.[1]
  return { program, ...(cwd ? { cwd: unescape(cwd) } : {}) }
}

// Pure: one job jobs.json lists as the registry's setting, its fields over the job's default, enabled unless it is disabled, and a launchd job's program from its plist; a job the registry does not know is kept in jobs.json, and one its schema refuses says why.
export const importedJob = (
  listed: Record<string, unknown>,
  plist: { cwd?: string; program: string[] } | null,
): { key: string; value: Job } | { kept: string } | { problem: string } => {
  const name = String(listed.name ?? "")
  const fallback = JOBS[name]
  if (!fallback) return { kept: name }
  const fields = Object.fromEntries(
    LISTED_FIELDS.filter((f) => f in listed).map((f) => [f, listed[f]]),
  )
  const parsed = jobSchema.safeParse({
    ...fallback,
    ...(listed.launchd && plist ? plist : {}),
    ...fields,
    ...(listed.launchd && !listed.command ? { command: undefined } : {}),
    ...(listed.command && !listed.launchd ? { launchd: undefined, program: undefined } : {}),
    enabled: listed.disabled !== true,
  })
  if (!parsed.success)
    return {
      problem: `${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    }
  return { key: jobKey(name), value: parsed.data }
}
